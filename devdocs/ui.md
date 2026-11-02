# UI

The player window, built with [svelte-akui](https://github.com/ashkyd/svelte-akui) (`DetailsTable`, `Button`, `Icon`, `InfoBox`, `UIRoot`). All logic is in `CDPlayer` ([cd-player.md](cd-player.md)); the page and components only show its state and send it commands.

## Files

- `src/routes/+layout.svelte`: wraps the app in `UIRoot` (theme, base font) and sets `color-scheme`. It also renders `NativeWindowTheme` (`src/lib/components/NativeWindowTheme`), which sets `color-scheme` on `<html>` from the theme store: the picked theme's scheme, or `light dark` under "System". The macOS titlebar is drawn from the webview's `color-scheme`; the window API's `setTheme` does not change it.
- Start-up without a flash: every window starts hidden (`visible: false` in `tauri.conf.json` for the main window, in `openSettingsWindow()` for settings). The layout's `RevealWindow` component (`revealWindow()` in `src/lib/window/`) shows it after the first render. Under the "System" theme akui's theme store reads the OS scheme only after the first paint (it starts at `light`), so `NativeWindowTheme` sets `themeStore.systemScheme` from `currentSystemScheme()` (`src/lib/theme/systemScheme.ts`) while the page is built; the first paint is then already dark on a dark OS. If a page never loads, its window stays hidden.
- `src/routes/+page.svelte`: makes the `CDPlayer`, starts it on mount and destroys it on unmount, and chooses what to show for each `status`.
- `src/lib/components/NowPlaying/`: renderless; feeds the OS media controls ([now-playing.md](now-playing.md)).
- The top bar has a gear button that opens the settings window (`src/routes/settings/+page.svelte`; see [settings.md](settings.md)).
- `src/lib/components/TrackTable/`: `TrackTable.svelte` (the track list) and `trackRows.ts` (`toTrackRows()` for disc tracks, `toFileTrackRows()` for files). A row has a `key` (track number, or file id); `onplay(row)` hands it back and the page finds the track.
- `src/lib/components/FileDrop/`: drop audio files on the window ([file-drop.md](file-drop.md)).
- Toasts: an akui `NotificationArea` at the bottom right shows problems with files (a file that won't play, damaged audio) from the `notifications` store ([notifications.md](notifications.md)). CD errors still use the `InfoBox` banner.
- File mode: the page has a `mode` (`cd` or `files`), set by either player's `onBeforePlay`. In `files` mode the transport, seek bar, visualiser, media keys and table act on the `FilePlayer` ([file-player.md](file-player.md)); the album header shows the current file's name; the window is never collapsed; and a disc button next to the settings button goes back to the disc. The two players share one `WebAudioHandler`.
- `src/lib/window/setWindowFullscreen.ts`: wraps the Tauri window `setFullscreen` call. The fullscreen button in `src/routes/+page.svelte` hides `<main>` and shows only the visualiser (even when disabled in settings); Escape exits. Needs the `core:window:allow-set-fullscreen` capability.
- `src/lib/window/AnimatedWindowHeight.ts`: `collapseTo(height)` and `restore()` animate the window height (250 ms, eased, one `setSize` per frame, since Tauri has no animated resize). The height is remembered only when a collapse starts from an expanded window, so a restore returns to what the user had. A window already shorter than the target is not grown, and fullscreen or maximised windows are left alone. `tauriWindowHeightControl.ts` is the Tauri adapter and needs the `core:window:allow-set-size` capability.
- The page collapses the window to fit its content while the track list is hidden (no disc, or reading one) and restores it when tracks arrive. Nothing happens during visualiser-only mode.
- The app opens already small: `tauri.conf.json` sets the window height to 164 (`COLLAPSED_PAGE_HEIGHT` 132 + `DEFAULT_WINDOW_HEIGHT_OFFSET` 32), so there is no animation on load. If the first collapse finds the window already that small it doesn't move, and the height to grow back to comes from `localStorage` (`cdplayer.expandedWindowHeight`, default 600). That is stored when a collapse starts from an expanded window, and while the user resizes the expanded window (`watchUserHeight`, after they stop for 400 ms). If the numbers in `windowHeights.ts` change, change the config height to match.
- Calibration: the page's real viewport (`window.innerHeight`, read 150 ms after a collapse so it has settled) can differ from the requested height by a constant (observed: 32 px shorter, which clipped the collapsed page's bottom padding). After each collapse `AnimatedWindowHeight` works out that offset (set height minus viewport) and adds it to every later size and minimum request. Both numbers start hard coded in `windowHeights.ts`: `COLLAPSED_PAGE_HEIGHT` (132 px, the measured header plus padding; the live measurement can only raise it) and `DEFAULT_WINDOW_HEIGHT_OFFSET` (32 px), so the first collapse is right without waiting for a measurement. The offset is kept in `localStorage` (`cdplayer.windowHeightOffset`), so only the very first collapse on a machine undershoots and then bounces back; later launches start with the right offset. Only collapses are checked, since their target is the page's own content height.
- The content height (the lowest non-track element plus the page's bottom padding, kept current by a `ResizeObserver`) is also the window's minimum height (`setMinimumHeight`, capability `core:window:allow-set-min-size`), so the window can't be dragged smaller than the header and its padding. The minimum width is 420 px (`minWidth` in `tauri.conf.json`, repeated in `tauriWindowHeightControl.ts` because `setMinSize` replaces the whole limit). Elements added later (warnings) are not observed until the next resize.
- `src/lib/window/watchWindowFullscreen.ts`: `watchWindowFullscreen(onChange)` reports native fullscreen changes (via `onResized` + `isFullscreen()`). The page leaves visualiser-only mode when the window leaves fullscreen by any route (green button, Ctrl+Cmd+F, another Space), and also when entering fullscreen fails.
- `src/lib/components/Visualiser/Visualiser.svelte`: the canvas backdrop. Runs the butterchurn preset chosen in settings on the main thread; see [visualisers.md](visualisers.md).
- `src/lib/components/CoverViewer/CoverViewer.svelte`: the cover full size with 32px padding, a 5px radius and a drop shadow, over a blurred copy of itself. An icon-only back button (top left) or Escape closes it. The page opens and closes it through `withViewTransition()` (`src/lib/transitions/withViewTransition.ts`), and the header's cover and the viewer's share `view-transition-name: album-cover` so one morphs into the other. Without view transition support it just appears.
- `src/lib/components/AlbumHeader/AlbumHeader.svelte` (the cover is a button that opens the viewer; the cover fades in once loaded): the cover, album, artist and year. Without metadata it shows `message` (with a `DiscSpinner` when `busy`) in the album's place, so the header keeps its height.
- `src/lib/components/CopyfitText/`: `CopyfitText.svelte` (text that wraps to `maxLines` lines, then scales down to fit its box) and `copyfitScale.ts` (picks the scale). Used for the album title and the artist line.
- `src/lib/components/TransportControls/TransportControls.svelte`: previous, play/pause and next buttons.
- `src/lib/components/SeekBar/SeekBar.svelte`: the progress bar and times.
- `src/lib/playback/format.ts`: `formatClock()`.

## What shows for each status

- `noDisc`: the album header shows "No disc". If the drive is slow to report its TOC (`readingDisc`), it shows a spinning disc and "Reading disc…" instead. The transport and seek bar are disabled. There is no table.
- `loadingMetadata`: the album header shows a spinning disc and "Looking up album…". The controls are disabled and there is no table: tracks are not shown before their names are known.
- The album header is keyed on the disc ID and changes with the `wipe` transition (`src/lib/transitions/wipe.ts`, a left-to-right `clip-path` reveal). The old and new headers share one grid cell so they overlap while wiping.
- A disc that MusicBrainz doesn't know shows "Unknown disc" in the album header.
- `ready` and later: the album header (if MusicBrainz knew the disc) and the track table. If the lookup failed, the tracks are "Track 1", "Track 2", ... and a line says why names are unavailable.

When the disc is ejected the status becomes `noDisc`, so the table goes away and the player is stopped.

## Behaviour

- Layout: a top bar, then any notices, then the track table filling the rest of the window. The top bar holds the album header (if known) and the controls (transport buttons, seek bar, settings). Side by side, the album comes first and the controls fill the rest. The album is as wide as its text needs (fit-content), up to 20rem. At 45rem or narrower the controls take the first line and the album wraps below them (`order: 1`, up to the full width).
- `CopyfitText`: the container takes the parent's fixed width (the album block is a fixed 16rem). A `ResizeObserver` tries `font-size` scales (in `em`, from 1 in steps of 0.05). It prefers one line, shrinking to `minSingleLineScale` (default 0.75). If that is too small, the text wraps to `maxLines` lines (default 2, via line-clamp, never mid-word) at the largest scale that fits, never below `minScale` (default 0.6). Line height is 1.15. Below that the text is clipped with an ellipsis. The full-size look (`font-size`, `font-weight`, `color`) is passed in `style`.
- The visualiser is a fixed full-window backdrop behind `main` (`z-index` 0 vs 1, no pointer events). The track table's wrapper (`section`) is frosted glass: a 55% `--akui-bg` tint and a 12px `backdrop-filter` blur, so the visualiser shows through softly.
- `TrackTable` uses akui `DetailsTable`. Columns: `#`, title, an artist column only on compilations (tracks whose artist differs from the album's), and time. `autoFit` sizes `#` and time to their content; title and artist share the spare width 2 : 1 (`fitFlex`). The playing/paused icon sits in the `#` cell, in a reserved slot, and fades in. Rows are always in disc order (no sorting), because "play from here" means "the tracks after this one on the disc".
  - The current track is bold and has a speaker icon (a pause icon when paused).
  - Data tracks are dimmed and cannot be played.
  - Double-clicking a row, or pressing Enter on it, calls `onplay(track)`; the page calls `player.playFrom(track)`, which clears the queue, plays that track and queues every playable track after it.
- `TransportControls` uses icon-only akui `Button`s.
  - Play/pause: `player.playPause()`. When stopped it plays the first playable track and everything after it; otherwise it toggles pause. It shows a pause icon while audio is active (loading, playing or buffering).
  - Previous: `player.previous()`. Disabled when no audio is active.
  - Next: `player.next()`. Disabled when nothing is queued after the current track.
  - All are disabled with no disc or while the metadata loads.
- `SeekBar` is a native `<input type="range">`, since akui has no slider. It follows `positionSeconds` until dragged, then calls `player.seek()` on release.
- The table is keyed on its rows, so a new disc clears the selection and scroll position.
- Notices (`InfoBox`): audio output interrupted, unreadable sectors played as silence, and a playback error.

## Limits

- The double-click is read from the table's wrapper element; the table reports row clicks (`onrowclick`) but not double-clicks. The row is the last one clicked, and a header double-click is ignored by checking for a row element (`.akui-details-row`, an internal class of the library).
- No stop button, volume, repeat or shuffle.
- The layout is not tested on a narrow window. akui's `DetailsTable` switches to a card list below 640 px.
- akui is a git dependency (`github:ashkyd/svelte-akui`) and "likely to change without notice". It needs `bootstrap-icons` as a peer dependency, which is installed.
- Not checked in a running app: `svelte-check` and the tests pass, and the components have no browser tests.

## Tests

- `npm test` covers `trackRows.ts` and `format.ts`. The page and components are checked by hand; their logic is tested through `CDPlayer`.
