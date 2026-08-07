# RAD4Rquestcompleter

RAD4Rquestcompleter is a Vencord userplugin that automatically handles Discord Quests. It can automatically accept eligible quests and complete supported quest progress types from the Discord desktop client.

> **Note**
> This plugin is intended for **personal Vencord builds**. Discord frequently updates its internal modules, so occasional plugin updates may be required.

---

# Features

* Automatically accepts available Discord Quests.
* Processes multiple quests in a queue.
* Supports:

  * `WATCH_VIDEO`
  * `WATCH_VIDEO_ON_MOBILE`
  * `PLAY_ON_DESKTOP`
  * `STREAM_ON_DESKTOP`
  * `PLAY_ACTIVITY`
* Optional console progress logging.
* Automatically resumes after Discord reconnects or reloads.

---

# Requirements

Before installing, you'll need:

* Windows, Linux, or macOS
* Discord Desktop
* Git
* Node.js (LTS recommended)
* npm (included with Node.js)

---

# Installing Vencord

If you already have a working Vencord source build, skip to **Installing RAD4Rquestcompleter**.

## 1. Clone Vencord

```bash
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
```

## 2. Install dependencies

```bash
npm install
```

## 3. Install Vencord

```bash
npm run inject
```

Follow the prompts until installation completes.

---

# Installing RAD4Rquestcompleter

## Option 1 — Git Clone (Recommended)

Clone this repository:

```bash
git clone https://github.com/RAD4R911/RAD4Rquestcompleter.git
```

Create the plugin folder inside your Vencord source:

```text
Vencord/
└── src/
    └── userplugins/
        └── RAD4Rquestcompleter/
```

Copy the plugin file:

```text
RAD4Rquestcompleter/index.tsx
        ↓
Vencord/src/userplugins/RAD4Rquestcompleter/index.tsx
```

---

## Option 2 — Download ZIP

1. Open:

   https://github.com/RAD4R911/RAD4Rquestcompleter

2. Click **Code → Download ZIP**.

3. Extract the archive.

4. Copy `index.tsx` into:

```text
Vencord/src/userplugins/RAD4Rquestcompleter/
```

---

# Building Vencord

After copying the plugin:

```bash
npm run build
```

or

```bash
pnpm build
```

depending on your package manager.

---

# Starting Discord

Restart Discord completely.

Open:

```
Settings
    ↓
Vencord
    ↓
Plugins
```

Enable:

```
RAD4Rquestcompleter
```

The plugin will now begin monitoring available Discord Quests.

---

# Updating the Plugin

If you installed using Git:

```bash
cd RAD4Rquestcompleter
git pull
```

Copy the updated `index.tsx` into:

```text
Vencord/src/userplugins/RAD4Rquestcompleter/
```

Then rebuild Vencord:

```bash
npm run build
```

Restart Discord.

---

# Settings

| Setting            | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `autoAcceptQuests` | Automatically accepts available quests.                  |
| `logProgress`      | Logs quest status and progress to the developer console. |

---

# Supported Quest Types

| Quest Type            | Supported |
| --------------------- | --------- |
| WATCH_VIDEO           | ✅         |
| WATCH_VIDEO_ON_MOBILE | ✅         |
| PLAY_ON_DESKTOP       | ✅         |
| STREAM_ON_DESKTOP     | ✅         |
| PLAY_ACTIVITY         | ✅         |

---

# Troubleshooting

## Plugin does not appear

* Verify the folder structure is:

```text
Vencord/
└── src/
    └── userplugins/
        └── RAD4Rquestcompleter/
            └── index.tsx
```

* Rebuild Vencord.
* Restart Discord.
* Check for TypeScript compilation errors.

---

## Quests are not completing

* Make sure the quest type is supported.
* Ensure you're using the Discord desktop client.
* Discord updates may temporarily break the plugin until it is updated.

---

# Repository

GitHub:

https://github.com/RAD4R911/RAD4Rquestcompleter

---

# License

This project is provided as-is for educational and personal use.

---

# Author

Created by **RAD4R**.
