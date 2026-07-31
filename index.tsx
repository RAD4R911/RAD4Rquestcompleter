/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { find, findStore } from "@webpack";
import {
    ApplicationStreamingStore,
    ChannelStore,
    FluxDispatcher,
    GuildChannelStore,
    RestAPI,
    RunningGameStore
} from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    autoAcceptQuests: {
        type: OptionType.BOOLEAN,
        description: "Automatically accept all available quests",
        default: true,
        restartNeeded: false
    },
    logProgress: {
        type: OptionType.BOOLEAN,
        description: "Log quest completion progress to console",
        default: true,
        restartNeeded: false
    }
});

const SUPPORTED_TASKS = [
    "WATCH_VIDEO",
    "WATCH_VIDEO_ON_MOBILE",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY"
] as const;

type TaskName = typeof SUPPORTED_TASKS[number];

// api is RestAPI (imported above) — Discord's internal {url, body} REST wrapper
const api = RestAPI;

let QuestsStore: any;
let isApp: boolean;

let initialized = false;
let processingQuests = false;
let questQueue: any[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;
let questsFindInterval: ReturnType<typeof setInterval> | null = null;
let fluxUnsubs: (() => void)[] = [];
let sessionStarting = false;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function log(...args: any[]) {
    if (settings.store.logProgress) console.log("[RAD4Rquestcompleter]", ...args);
}

function getTaskConfig(quest: any) {
    return quest.config.taskConfig ?? quest.config.taskConfigV2;
}

function isCompletable(quest: any): boolean {
    if (new Date(quest.config.expiresAt).getTime() <= Date.now()) return false;
    const tasks = getTaskConfig(quest)?.tasks;
    if (!tasks) return false;
    return SUPPORTED_TASKS.some(t => tasks[t] != null);
}

function isEnrolled(quest: any): boolean {
    return !!quest.userStatus?.enrolledAt;
}

function isCompleted(quest: any): boolean {
    return !!quest.userStatus?.completedAt;
}

// ── QuestsStore lookup ────────────────────────────────────────────────────────
// QuestsStore is lazy-loaded by Discord and only exists in the webpack module
// cache after the Quests/gift-icon panel has been touched at least once this
// session. We keep retrying in the background (cheap, name-based lookup) and
// separately try a predicate-based search as a fallback in case the store's
// registered name ever changes.
function tryFindQuestsStore(): any {
    let store = findStore("QuestsStore");
    if (store) return store;

    store = find((m: any) => m && typeof m.getQuest === "function" && m.quests !== undefined);
    return store ?? null;
}

// QuestsStore only gets registered in the webpack module cache once the
// Quests/gift-icon panel has actually been mounted at least once this
// session. We can force that by programmatically clicking the icon and
// then closing the panel again a moment later, so the user never has to
// do it manually.
let autoOpenAttempted = false;

function tryAutoOpenQuestsPanel(): boolean {
    if (autoOpenAttempted) return false;
    autoOpenAttempted = true;

    try {
        const icon = document.querySelector(
            '[aria-label*="Quest" i], [aria-label*="Gift" i]'
        ) as HTMLElement | null;

        if (!icon) {
            log("Could not find the Quests/gift icon in the DOM to auto-open (will keep retrying via polling instead)");
            return false;
        }

        icon.click();
        log("Auto-opened the Quests panel to force-load QuestsStore...");

        // Close it again shortly after so it doesn't stay open/visible
        setTimeout(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true
            }));
        }, 1500);

        return true;
    } catch (e) {
        log("Auto-open of Quests panel failed:", e);
        return false;
    }
}

// ── enrolment ────────────────────────────────────────────────────────────────
async function enrollQuest(quest: any): Promise<boolean> {
    const name = quest.config.messages.questName;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await api.post({
                url: `/quests/${quest.id}/enroll`,
                body: {
                    location: 11,
                    is_targeted: false,
                    metadata_raw: null,
                    metadata_sealed: null,
                    traffic_metadata_raw: null
                }
            });

            if (res?.status === 429) {
                const waitMs = ((res.body?.retry_after ?? 5) + 1) * 1000;
                log(`Rate limited on "${name}" (attempt ${attempt}/${MAX_RETRIES}) – waiting ${Math.ceil(waitMs / 1000)}s...`);
                if (attempt < MAX_RETRIES) await sleep(waitMs);
                continue;
            }

            log(`Auto-accepted: ${name}`);
            return true;
        } catch (e: any) {
            const status: number = e?.status ?? e?.res?.status ?? 0;
            const body: any = e?.body ?? e?.res?.body ?? {};

            if (status === 429) {
                const waitMs = ((body?.retry_after ?? 5) + 1) * 1000;
                log(`Rate limited on "${name}" (attempt ${attempt}/${MAX_RETRIES}) – waiting ${Math.ceil(waitMs / 1000)}s...`);
                if (attempt < MAX_RETRIES) await sleep(waitMs);
                continue;
            }

            log(`Failed to accept "${name}" (status ${status}):`, body?.message ?? e);
            return false;
        }
    }

    log(`Gave up enrolling "${name}" after ${MAX_RETRIES} rate-limited attempts`);
    return false;
}

async function autoAcceptAvailableQuests(): Promise<boolean> {
    if (!settings.store.autoAcceptQuests) return false;
    if (!QuestsStore?.quests) return false;

    const unaccepted = [...QuestsStore.quests.values()].filter((q: any) =>
        !isEnrolled(q) && !isCompleted(q) && isCompletable(q)
    );

    if (unaccepted.length === 0) return false;

    log(`Auto-accepting ${unaccepted.length} quest(s)...`);
    let enrolledAny = false;

    for (const q of unaccepted) {
        const ok = await enrollQuest(q);
        if (ok) enrolledAny = true;
        await sleep(3000);
    }

    return enrolledAny;
}

// ── queue management ─────────────────────────────────────────────────────────
function syncQueueFromStore() {
    if (!QuestsStore?.quests) return;

    const enrolled = [...QuestsStore.quests.values()].filter((q: any) =>
        isEnrolled(q) && !isCompleted(q) && isCompletable(q)
    );

    let added = 0;
    for (const quest of enrolled) {
        if (!questQueue.find(q => q.id === (quest as any).id)) {
            questQueue.push(quest);
            added++;
            log(`Queued: ${(quest as any).config.messages.questName}`);
        }
    }

    if (added > 0) log(`${added} quest(s) added to queue (total: ${questQueue.length})`);

    if (!processingQuests && questQueue.length > 0) {
        log("Starting processing loop...");
        doJob();
    }
}

async function scan() {
    if (!initialized) return;
    const newlyEnrolled = await autoAcceptAvailableQuests();
    if (newlyEnrolled) await sleep(1500);
    syncQueueFromStore();
}

// ── session lifecycle ────────────────────────────────────────────────────────
function startSession() {
    if (sessionStarting) return;
    sessionStarting = true;

    initialized = false;
    processingQuests = false;
    questQueue = [];
    autoOpenAttempted = false;

    if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (questsFindInterval !== null) {
        clearInterval(questsFindInterval);
        questsFindInterval = null;
    }

    const finishInit = async () => {
        sessionStarting = false;
        initialized = true;

        try {
            log("Fetching quests from API...");
            await api.get({ url: "/quests/@me" });
            log("Quest data loaded");
        } catch (e) {
            log("Could not pre-fetch quests (will retry on next poll):", e);
        }

        pollInterval = setInterval(() => scan(), 60_000);
        scan();
    };

    QuestsStore = tryFindQuestsStore();
    if (QuestsStore) {
        log("QuestsStore found immediately");
        finishInit();
        return;
    }

    log("QuestsStore not loaded yet — attempting to auto-load it...");
    tryAutoOpenQuestsPanel();

    let attempts = 0;
    questsFindInterval = setInterval(() => {
        attempts++;
        QuestsStore = tryFindQuestsStore();

        if (QuestsStore) {
            log(`QuestsStore found after ${attempts} retries`);
            if (questsFindInterval !== null) {
                clearInterval(questsFindInterval);
                questsFindInterval = null;
            }
            sessionStarting = false;
            finishInit();
        } else if (attempts === 3) {
            // Give the auto-open a couple retries to land, then try once more
            // in case the icon wasn't ready on the first attempt.
            autoOpenAttempted = false;
            tryAutoOpenQuestsPanel();
        } else if (attempts % 15 === 0) {
            log(`Still waiting for QuestsStore (${attempts * 2}s elapsed). Try opening the gift icon in your DM list once.`);
        }
    }, 2000);
}

// ── task processor ───────────────────────────────────────────────────────────
function doJob() {
    const quest = questQueue.shift();
    if (!quest) {
        processingQuests = false;
        log("All queued quests done.");
        return;
    }

    processingQuests = true;

    const pid = Math.floor(Math.random() * 30000) + 1000;
    const questName = quest.config.messages.questName;
    const taskConfig = getTaskConfig(quest);
    const taskName = SUPPORTED_TASKS.find(x => taskConfig.tasks[x] != null) as TaskName;
    const taskData = taskConfig.tasks[taskName];
    const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
    const applicationName = quest.config.application?.name ?? applicationId;
    const secondsNeeded = taskData.target;
    let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

    // ── WATCH_VIDEO / WATCH_VIDEO_ON_MOBILE ──────────────────────────────────
    if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
        const speed = 7;
        let completed = false;

        (async () => {
            try {
                while (true) {
                    const remaining = Math.min(speed, secondsNeeded - secondsDone);
                    await sleep(remaining * 1000);

                    const timestamp = secondsDone + speed;
                    const res = await api.post({
                        url: `/quests/${quest.id}/video-progress`,
                        body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) }
                    });
                    completed = res.body.completed_at != null;
                    secondsDone = Math.min(secondsNeeded, timestamp);

                    if (timestamp >= secondsNeeded) break;
                }

                if (!completed) {
                    await api.post({
                        url: `/quests/${quest.id}/video-progress`,
                        body: { timestamp: secondsNeeded }
                    });
                }

                log(`Completed: ${questName}`);
            } catch (e) {
                log(`Error completing "${questName}":`, e);
            }
            doJob();
        })();

        log(`Spoofing video: ${questName}`);

    // ── PLAY_ON_DESKTOP ──────────────────────────────────────────────────────
    } else if (taskName === "PLAY_ON_DESKTOP") {
        if (!isApp) { log(`${questName} requires the desktop app – skipping`); doJob(); return; }

        api.get({ url: `/applications/public?application_ids=${applicationId}` })
            .then((res: any) => {
                const appData = res.body?.[0];
                if (!appData) { log(`No app data for "${questName}" – skipping`); doJob(); return; }

                const exeName = appData.executables?.find((x: any) => x.os === "win32")?.name?.replace(">", "")
                    ?? appData.name.replace(/[\/\\:*?"<>|]/g, "") + ".exe";

                const fakeGame = {
                    cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                    exeName,
                    exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                    hidden: false, isLauncher: false,
                    id: applicationId, name: appData.name,
                    pid, pidPath: [pid], processName: appData.name, start: Date.now(),
                };

                const realGames = RunningGameStore.getRunningGames();
                const realGetRunningGames = RunningGameStore.getRunningGames;
                const realGetGameForPID = RunningGameStore.getGameForPID;

                const cleanup = () => {
                    RunningGameStore.getRunningGames = realGetRunningGames;
                    RunningGameStore.getGameForPID = realGetGameForPID;
                    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                };

                RunningGameStore.getRunningGames = () => [fakeGame];
                RunningGameStore.getGameForPID = (p: number) => p === pid ? fakeGame : undefined;
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: [fakeGame] });

                const fn = (data: any) => {
                    try {
                        const progress = quest.config.configVersion === 1
                            ? data.userStatus.streamProgressSeconds
                            : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);
                        log(`[${questName}] Progress: ${progress}/${secondsNeeded}`);
                        if (progress >= secondsNeeded) { log(`Completed: ${questName}`); cleanup(); doJob(); }
                    } catch (e) {
                        log(`Error in heartbeat handler for "${questName}":`, e);
                        cleanup(); doJob();
                    }
                };

                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                log(`Spoofed game: ${applicationName} – ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min left`);
            })
            .catch((e: any) => { log(`Failed to fetch app data for "${questName}":`, e); doJob(); });

    // ── STREAM_ON_DESKTOP ────────────────────────────────────────────────────
    } else if (taskName === "STREAM_ON_DESKTOP") {
        if (!isApp) { log(`${questName} requires the desktop app – skipping`); doJob(); return; }

        const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        const cleanup = () => {
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
        };

        ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
            id: applicationId, pid, sourceName: null
        });

        const fn = (data: any) => {
            try {
                const progress = quest.config.configVersion === 1
                    ? data.userStatus.streamProgressSeconds
                    : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);
                log(`[${questName}] Progress: ${progress}/${secondsNeeded}`);
                if (progress >= secondsNeeded) { log(`Completed: ${questName}`); cleanup(); doJob(); }
            } catch (e) {
                log(`Error in heartbeat handler for "${questName}":`, e);
                cleanup(); doJob();
            }
        };

        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
        log(`Spoofed stream: ${applicationName} – ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min left (need 1+ in VC)`);

    // ── PLAY_ACTIVITY ────────────────────────────────────────────────────────
    } else if (taskName === "PLAY_ACTIVITY") {
        const channelId =
            ChannelStore?.getSortedPrivateChannels()[0]?.id ??
            (Object.values(GuildChannelStore?.getAllGuilds?.() ?? {}) as any[])
                .find((x: any) => x?.VOCAL?.length > 0)?.VOCAL[0]?.channel?.id;

        if (!channelId) { log("No suitable channel found for PLAY_ACTIVITY – skipping"); doJob(); return; }

        const streamKey = `call:${channelId}:1`;

        (async () => {
            try {
                log(`Activity: ${questName}`);
                while (true) {
                    const res = await api.post({
                        url: `/quests/${quest.id}/heartbeat`,
                        body: { stream_key: streamKey, terminal: false }
                    });
                    const progress = res.body.progress.PLAY_ACTIVITY.value;
                    log(`[${questName}] Progress: ${progress}/${secondsNeeded}`);

                    if (progress >= secondsNeeded) {
                        await api.post({
                            url: `/quests/${quest.id}/heartbeat`,
                            body: { stream_key: streamKey, terminal: true }
                        });
                        break;
                    }

                    await sleep(20000);
                }
                log(`Completed: ${questName}`);
            } catch (e) {
                log(`Error completing "${questName}":`, e);
            }
            doJob();
        })();
    }
}

// ── plugin definition ────────────────────────────────────────────────────────
export default definePlugin({
    name: "RAD4Rquestcompleter",
    description: "Automatically completes Discord quests with auto-accept and progress automation.",
    authors: [{ name: "RAD4R", id: 755936860932669541n }],
    settings,

    start() {
        log("Starting...");

        isApp = typeof (window as any).DiscordNative !== "undefined";

        const onConnectionOpen = () => {
            log("CONNECTION_OPEN – starting new session...");
            startSession();
        };

        const onStatusUpdate = () => {
            log("QUEST_USER_STATUS_UPDATE – syncing queue...");
            setTimeout(() => syncQueueFromStore(), 500);
        };

        FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
        FluxDispatcher.subscribe("QUEST_USER_STATUS_UPDATE", onStatusUpdate);

        fluxUnsubs = [
            () => FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen),
            () => FluxDispatcher.unsubscribe("QUEST_USER_STATUS_UPDATE", onStatusUpdate),
        ];

        startSession();
    },

    stop() {
        log("Stopping...");

        for (const unsub of fluxUnsubs) unsub();
        fluxUnsubs = [];

        if (pollInterval !== null) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        if (questsFindInterval !== null) {
            clearInterval(questsFindInterval);
            questsFindInterval = null;
        }

        questQueue = [];
        processingQuests = false;
        initialized = false;
        sessionStarting = false;
    }
});
