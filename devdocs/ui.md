# UI

The player window, built with [svelte-akui](https://github.com/ashkyd/svelte-akui) (`DetailsTable`, `Button`, `Icon`, `InfoBox`, `Loader`, `UIRoot`). All logic is in `CDPlayer` ([cd-player.md](cd-player.md)); the page and components only show its state and send it commands.

## Files

- `src/routes/+layout.svelte`: wraps the app in `UIRoot` (theme, base font) and sets `color-scheme`. It also renders `NativeWindowTheme` (`src/lib/components/NativeWindowTheme`), which sets `color-scheme` on `<html>` from the theme store: the picked theme's scheme, or `light dark` under "System". The macOS titlebar is drawn from the webview's `color-scheme`; the window API's `setTheme` does not change it.
- `src/routes/+page.svelte`: makes the `CDPlayer`, starts it on mount and destroys it on unmount, and chooses what to show for each `status`.
- `src/lib/components/NowPlaying/`: renderless; feeds the OS media controls ([now-playing.md](now-playing.md)).
- The top bar has a gear button that opens the settings window (`src/routes/settings/+page.svelte`; see [settings.md](settings.md)).
- `src/lib/components/TrackTable/`: `TrackTable.svelte` (the track list) and `trackRows.ts` (tracks and names to rows).
- `src/lib/window/setWindowFullscreen.ts`: wraps the Tauri window `setFullscreen` call. The fullscreen button in `src/routes/+page.svelte` hides `<main>` and shows only the visualiser (even when disabled in settings); Escape exits. Needs the `core:window:allow-set-fullscreen` capability.
- `src/lib/window/watchWindowFullscreen.ts`: `watchWindowFullscreen(onChange)` reports native fullscreen changes (via `onResized` + `isFullscreen()`). The page leaves visualiser-only mode when the window leaves fullscreen by any route (green button, Ctrl+Cmd+F, another Space), and also when entering fullscreen fails.
- `src/lib/components/Visualiser/Visualiser.svelte`: the canvas backdrop. Runs the visualiser chosen in settings in a worker; see [visualisers.md](visualisers.md).
- `src/lib/components/CoverViewer/CoverViewer.svelte`: the cover full size with 32px padding, a 5px radius and a drop shadow, over a blurred copy of itself. An icon-only back button (top left) or Escape closes it. The page opens and closes it through `withViewTransition()` (`src/lib/transitions/withViewTransition.ts`), and the header's cover and the viewer's share `view-transition-name: album-cover` so one morphs into the other. Without view transition support it just appears.
- `src/lib/components/AlbumHeader/AlbumHeader.svelte` (the cover is a button that opens the viewer; the cover fades in once loaded): the cover, album, artist and year. Without metadata it shows `message` (with a loader when `busy`) in the album's place, so the header keeps its height.
- `src/lib/components/CopyfitText/`: `CopyfitText.svelte` (text that wraps to `maxLines` lines, then scales down to fit its box) and `copyfitScale.ts` (picks the scale). Used for the album title and the artist line.
- `src/lib/components/TransportControls/TransportControls.svelte`: previous, play/pause and next buttons.
- `src/lib/components/SeekBar/SeekBar.svelte`: the progress bar and times.
- `src/lib/playback/format.ts`: `formatClock()`.

## What shows for each status

- `noDisc`: the album header shows "No disc" (with a loader while the drive is being asked). The transport and seek bar are disabled. There is no table.
- `loadingMetadata`: the album header shows a loader and "Reading…". The controls are disabled and there is no table: tracks are not shown before their names are known.
- The album header is keyed on the disc ID and changes with the `wipe` transition (`src/lib/transitions/wipe.ts`, a left-to-right `clip-path` reveal). The old and new headers share one grid cell so they overlap while wiping.
- A disc that MusicBrainz doesn't know shows "Unknown disc" in the album header.
- `ready` and later: the album header (if MusicBrainz knew the disc) and the track table. If the lookup failed, the tracks are "Track 1", "Track 2", ... and a line says why names are unavailable.

When the disc is ejected the status becomes `noDisc`, so the table goes away and the player is stopped.

## Behaviour

- Layout: a top bar, then any notices, then the track table filling the rest of the window. The top bar holds the album header (if known) and the controls (transport buttons, seek bar, settings). Side by side, the album comes first and the controls fill the rest. The album is as wide as its text needs (fit-content), up to 20rem. At 45rem or narrower the controls take the first line and the album wraps below them (`order: 1`, up to the full width).
- `CopyfitText`: the container takes the parent's fixed width (the album block is a fixed 16rem). A `ResizeObserver` tries `font-size` scales (in `em`, from 1 in steps of 0.05). It prefers one line, shrinking to `minSingleLineScale` (default 0.75). If that is too small, the text wraps to `maxLines` lines (default 2, via line-clamp, never mid-word) at the largest scale that fits, never below `minScale` (default 0.6). Line height is 1.15. Below that the text is clipped with an ellipsis. The full-size look (`font-size`, `font-weight`, `color`) is passed in `style`.
- `WaveformVisualiser` is a proof of concept, drawn as a fixed full-window backdrop behind `main` (`z-index` 0 vs 1, no pointer events). The track table's wrapper (`section`) is frosted glass: a 55% `--akui-bg` tint and a 12px `backdrop-filter` blur, so the waveform shows through softly. It is an oscilloscope line of the last ~46 ms of output, drawn in the accent colour. Each frame erases only 15% of the last (`DECAY_ERASE_ALPHA`), so earlier lines fade out over about half a second. While paused or stopped (`playing` false) nothing new is drawn, so the last lines fade to an empty canvas.
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
