# Settings

User settings, kept in a store that every window shares, saved to `localStorage` and synced live between windows. No Rust.

## Files

- `src/lib/settings/settings.svelte.ts`: `AppSettings` (the store), the `settings` singleton, `SettingsValues`, `DEFAULT_SETTINGS`.
- `src/lib/settings/tauriSettingsSync.ts`: sends changes to other windows as Tauri events (`settings-changed`).
- `src/lib/settings/openSettingsWindow.ts`: opens the settings window, or focuses it if open.
- `src/routes/settings/+page.svelte`: the settings window, using akui `Settings`, `ControlGroup` and `ControlItemText`.
- `src-tauri/capabilities/default.json`: lists the `settings` window and allows creating and focusing windows.

## API

- `import { settings } from "$lib/settings/settings.svelte"`; read or assign fields, e.g. `settings.musicBrainzEnabled`. Fields are `$state`, so they work in `$derived` and `$effect`.
- To add a setting: add it to `SettingsValues`, `DEFAULT_SETTINGS`, `pickKnownValues()`, `AppSettings.values` and `AppSettings.#apply()`, then add a control to the settings page.
- `new AppSettings({ storage, sync })` takes a fake storage and sync for tests.

## Behaviour

- Saved under the `cdplayer.settings` key. Missing, corrupt or wrongly typed values fall back to the defaults.
- A change is saved and sent to other windows with a per-window id. A window ignores its own messages, and applies a received change without sending it on again.
- A window opened later reads `localStorage`, so it starts correct; events cover changes while it is open.
- Current settings:
  - `musicBrainzEnabled` (default on): `CDPlayer` looks discs up only when it is on. When off nothing is sent, the disc is ready straight away, and no error is shown. It applies from the next disc read.
  - `fadeEnabled` (default on): the audio fades in and out over 100 ms on play, resume and pause. Read each time, so it applies at once.

## Limits

- Outside Tauri (plain browser, tests) the sync does nothing; the store still works in one window.
- The settings window has one section ("General").
- No menu item or keyboard shortcut for the settings window; that would need Rust.
