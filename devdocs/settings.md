# Settings

User settings, kept in a store that every window shares, saved to `localStorage` and synced live between windows. No Rust.

## Files

- `src/lib/settings/settings.svelte.ts`: `AppSettings` (the store), the `settings` singleton, `SettingsValues`, `DEFAULT_SETTINGS`.
- `src/lib/settings/tauriSettingsSync.ts`: sends changes to other windows as Tauri events (`settings-changed`).
- `src/lib/settings/openSettingsWindow.ts`: opens the settings window, or focuses it if open.
- `src/routes/settings/+page.svelte`: the settings window, using akui `Settings`, `ControlGroup` and `ControlItemText`. The "General" section is here; the others are components.
- `src/lib/components/VisualiserSettings/VisualiserSettings.svelte`: the "Visualisations" section (`visualiserEnabled`, `visualiserId`).
- `src/lib/components/LastFmSettings/LastFmSettings.svelte`: the "Last.fm" section ([last-fm.md](last-fm.md)).
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
  - `autoplayEnabled` (default off): a disc plays from the first track once it is ready (after the metadata lookup). Read by `CDPlayer` each time a disc settles.
  - `fadeEnabled` (default on): the audio fades in and out over 100 ms on play, resume and pause. Read each time, so it applies at once.
  - `visualiserEnabled` (default on): the page shows the `Visualiser` behind the player. When off the component is unmounted, so nothing is drawn or measured. It applies at once, in every window.
  - `visualiserId` (default `Geiss - Cauldron - painterly 2 (saturation remix)`): a butterchurn preset name, or `random`. Non-strings fall back to the default; a name missing from the pack draws nothing. Changing it re-creates the canvas.
  - `lastFmUsername`, `lastFmPasswordHash` (default empty): the Last.fm login, set in the "Last.fm" section. Only the MD5 of the password is stored. Read each time `LastFmScrobbler` sends, so it applies at once. See [last-fm.md](last-fm.md).
  - `coverColours` (default `null`): the `{ primary, secondary }` colours of the current cover, written by `CoverTheme` and applied by `CoverAccent` in every window. It is kept between runs so the app opens already tinted. `CoverTheme` replaces it once the disc has been read, and sets `null` if the disc has no usable cover. See [cover-theme.md](cover-theme.md).

## Limits

- Outside Tauri (plain browser, tests) the sync does nothing; the store still works in one window.
- The settings window opens at 640 × 520 and has three sections ("General", "Visualisations", "Last.fm").
- No menu item or keyboard shortcut for the settings window; that would need Rust.
