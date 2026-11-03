# UI

The player window, built with [svelte-akui](https://github.com/ashkyd/svelte-akui) (`DetailsTable`, `Button`, `Icon`, `InfoBox`, `UIRoot`). All logic is in `CDPlayer` ([cd-player.md](cd-player.md)); the page and components only show its state and send it commands.

## Files

- `src/routes/+layout.svelte`: wraps the app in `UIRoot` (theme, base font) and sets `color-scheme`. It also renders `NativeWindowTheme` (`src/lib/components/NativeWindowTheme`), which sets `color-scheme` on `<html>` from the theme store: the picked theme's scheme, or `light dark` under "System". The macOS titlebar is drawn from the webview's `color-scheme`; the window API's `setTheme` does not change it.
- Start-up without a flash: every window starts hidden (`visible: false` in `tauri.conf.json` for the main window, in `openSettingsWindow()` for settings). The layout's `RevealWindow` component (`revealWindow()` in `src/lib/window/`) shows it after the first render. Under the "System" theme akui's theme store reads the OS scheme only after the first paint (it starts at `light`), so `NativeWindowTheme` sets `themeStore.systemScheme` from `currentSystemScheme()` (`src/lib/theme/systemScheme.ts`) while the page is built; the first paint is then already dark on a dark OS. If a page never loads, its window stays hidden.
- `src/routes/+page.svelte`: makes the `CDPlayer`, starts it on mount and destroys it on unmount, and chooses what to show for each `status`.
- `src/lib/components/AppControls/`: the top bar (album header, transport, seek bar, and playlist, fullscreen and settings buttons) as a props-and-callbacks component; see [app-controls.md](app-controls.md).
- Playlist button: the page's `playlistVisible` (bound to `AppControls`) shows or hides the track list with `riseFade` (`src/lib/transitions/riseFade.ts`: a custom transition with `cubicInOut` easing (an ease-out jumped ahead on the first frame; Svelte applies `easing` itself) that fades and moves up from below, and does the reverse on leaving; it doesn't change the layout). Hiding it removes the list; the window keeps its size and the visualiser shows behind the controls, which stay at the bottom edge.
- `src/lib/components/NowPlaying/`: renderless; feeds the OS media controls ([now-playing.md](now-playing.md)).
- The top bar has a gear button that opens the settings window (`src/routes/settings/+page.svelte`; see [settings.md](settings.md)).
- `src/lib/components/TrackTable/`: `TrackTable.svelte` (the track list) and `trackRows.ts` (`toTrackRows()` for disc tracks, `toFileTrackRows()` for files). A row has a `key` (track number, or file id); `onplay(row)` hands it back and the page finds the track.
- `src/lib/components/FileDrop/`: drop audio files on the window ([file-drop.md](file-drop.md)).
- Toasts: an akui `NotificationArea` at the bottom right shows problems with files (a file that won't play, damaged audio) from the `notifications` store ([notifications.md](notifications.md)). CD errors still use the `InfoBox` banner.
- File mode: the page has a `mode` (`cd` or `files`), set by either player's `onBeforePlay`. In `files` mode the transport, seek bar, visualiser, media keys and table act on the `FilePlayer` ([file-player.md](file-player.md)); the album header shows the current file's name; and the page goes back to the disc when an audio disc is inserted or replaced (`CDPlayer`'s `onDiscChange`), or when the MP3 CD being played is ejected. The two players share one `WebAudioHandler`.
- `src/lib/window/setWindowFullscreen.ts`: wraps the Tauri window `setFullscreen` call. The fullscreen button in `src/routes/+page.svelte` hides `<main>` and shows only the visualiser (even when disabled in settings); Escape exits. Needs the `core:window:allow-set-fullscreen` capability.
- `src/lib/window/watchWindowFullscreen.ts`: `watchWindowFullscreen(onChange)` reports native fullscreen changes (via `onResized` + `isFullscreen()`). The page leaves visualiser-only mode when the window leaves fullscreen by any route (green button, Ctrl+Cmd+F, another Space), and also when entering fullscreen fails.
- `src/lib/components/Visualiser/Visualiser.svelte`: the canvas backdrop. Runs the butterchurn preset chosen in settings on the main thread; see [visualisers.md](visualisers.md).
- `src/lib/components/CoverViewer/CoverViewer.svelte`: the cover full size with 32px padding, a 5px radius and a drop shadow, over a blurred copy of itself. An icon-only back button (top left) or Escape closes it. The page opens and closes it through `withViewTransition()` (`src/lib/transitions/withViewTransition.ts`), and the header's cover and the viewer's share `view-transition-name: album-cover` so one morphs into the other. Without view transition support it just appears.
- `src/lib/components/AlbumHeader/AlbumHeader.svelte` (the cover is a button that opens the viewer; the cover fades in once loaded): the cover, album, artist and year. Without metadata it shows `message` (with a `DiscSpinner` when `busy`) in the album's place, so the header keeps its height (4.5rem minimum). The cover's space (cover or disc icon) is kept while there is no `metadata` or a cover is loading; once the disc is known and has no cover (none listed, or it failed to load) the space slides out to the left (`slide` on the x axis, with the gap as a margin so it goes too) and the text takes the whole width. With `coverless` (the page sets it in `files` mode: MP3 CDs and dropped files have no art) there is never a cover space. The header stays mounted across discs (no wipe), so the space slides in and out as the source changes.
- The text changes with `wipeIn` and `wipeOut` (`src/lib/transitions/wipe.ts`, both left to right with `clip-path`, so the old text is erased exactly where the new text is revealed): the old and new text are absolutely positioned in the same box (each centres its own text, so nothing shifts when the old one is removed; the clip path has 1rem of vertical bleed so wrapped text isn't cut) and the block is keyed on heading and details. While a disc track is current, the page passes `track` (`{ title, artist }`) to the album header (through `AppControls`): the title replaces the album name and the artist (the track's own, else the album's) follows it, all in `CopyfitText`. MusicBrainz gives a year for the release only, so there is no per-track year and none is shown for a track. Files already show their name as the heading.
- `src/lib/components/CopyfitText/`: `CopyfitText.svelte` (text that wraps to `maxLines` lines, then scales down to fit its box) and `copyfitScale.ts` (picks the scale). Used for the album title and the artist line.
- `src/lib/components/TransportControls/TransportControls.svelte`: previous, play/pause and next buttons.
- `src/lib/components/SeekBar/SeekBar.svelte`: the progress bar and times.
- `src/lib/playback/format.ts`: `formatClock()` (`m:ss`, or `h:mm:ss` from one hour up).

## What shows for each status

- `noDisc`: the album header shows "No disc". If the drive is slow to report its TOC (`readingDisc`), it shows a spinning disc and "Reading disc…" instead. The transport and seek bar are disabled. There is no table.
- `loadingMetadata`: the album header shows a spinning disc and "Looking up album…". The controls are disabled and there is no table: tracks are not shown before their names are known.
- A disc that MusicBrainz doesn't know shows "Unknown disc" in the album header.
- `ready` and later: the album header (if MusicBrainz knew the disc) and the track table. If the lookup failed, the tracks are "Track 1", "Track 2", ... and a line says why names are unavailable.

When the disc is ejected the status becomes `noDisc`, so the table goes away and the player is stopped.

## Behaviour

- Layout: any notices, then the track table filling the window, then the controls bar (`AppControls`) at the bottom. The controls bar holds the album header (if known) and the controls (transport buttons, seek bar, settings). With no track table it is the only thing shown, on the bottom edge. The header is a grid of two rows. Row one is the seek bar across the full width; its time labels are 4.5rem wide and centred, the same width as the cover. Row two has three columns (`1fr auto 1fr`): the album on the left (up to 20rem), the previous/play/next buttons in the exact centre, and the (back-to-disc,) settings and fullscreen buttons on the right. At 45rem or narrower the transport stays centred on its own row, with the album and buttons on the row below.
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

- The table's header is hidden with CSS (`display: none` on the library's internal `.akui-details-head`), so there is no sorting, and the narrow layout has no sort menu.
- The double-click is read from the table's wrapper element; the table reports row clicks (`onrowclick`) but not double-clicks. The row is the last one clicked, and a header double-click is ignored by checking for a row element (`.akui-details-row`, an internal class of the library).
- No stop button, volume, repeat or shuffle.
- The layout is not tested on a narrow window. akui's `DetailsTable` switches to a card list below 640 px.
- akui is a git dependency (`github:ashkyd/svelte-akui`) and "likely to change without notice". It needs `bootstrap-icons` as a peer dependency, which is installed.
- Not checked in a running app: `svelte-check` and the tests pass, and the components have no browser tests.

## Tests

- `npm test` covers `trackRows.ts` and `format.ts`. The page and components are checked by hand; their logic is tested through `CDPlayer`.
