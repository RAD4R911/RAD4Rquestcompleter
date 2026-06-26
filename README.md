# RAD4Rquestcompleter

RAD4Rquestcompleter is a Vencord userplugin for automatically handling Discord Quests. It can auto-accept available quests and automate supported quest progress types from the desktop client.

## Features

- Automatically accepts available quests when enabled.
- Queues enrolled quests and processes them one at a time.
- Supports common quest task types:
  - `WATCH_VIDEO`
  - `WATCH_VIDEO_ON_MOBILE`
  - `PLAY_ON_DESKTOP`
  - `STREAM_ON_DESKTOP`
  - `PLAY_ACTIVITY`
- Optional console progress logging.
- Handles reconnect/session events so quest scanning resumes after Discord reloads.

## Installation

This is a Vencord/BetterVencord userplugin.

1. Copy `index.tsx` into:

   ```text
   src/userplugins/RAD4Rquestcompleter/index.tsx
   ```

2. Rebuild Vencord/BetterVencord.
3. Restart Discord.
4. Enable `RAD4Rquestcompleter` in Vencord settings.

## Settings

- `autoAcceptQuests`: Automatically enrolls available quests.
- `logProgress`: Prints quest progress and status messages to the console.

## Notes

RAD4Rquestcompleter is intended for personal userplugin builds. Discord changes its internal modules often, so the plugin may need updates after client changes.

## Author

Created for RAD4R.
