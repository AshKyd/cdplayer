# UI

The player window, built with [svelte-akui](https://github.com/ashkyd/svelte-akui) (`DetailsTable`, `Button`, `Icon`, `InfoBox`, `UIRoot`). Logic stays in `CDPlayer` and `DiscWatcher`; the components only show state and report clicks.

## Files

- `src/routes/+layout.svelte`: wraps the app in `UIRoot` (theme, base font) and sets `color-scheme`.
- `src/routes/+page.svelte`: makes the `CDPlayer` and `DiscWatcher`, and wires them to the components.
- `src/lib/components/TrackTable/`: `TrackTable.svelte` (the track list) and `trackRows.ts` (tracks to rows).
- `src/lib/components/TransportControls/TransportControls.svelte`: previous, play/pause and next buttons.
- `src/lib/components/SeekBar/SeekBar.svelte`: the progress bar and times.
- `src/lib/playback/navigation.ts`: `tracksFrom()` and `previousStep()`.
- `src/lib/playback/format.ts`: `formatClock()`.

## Behaviour

- Layout: a top bar (transport buttons and seek bar), then any notices, then the track table filling the rest of the window.
- `TrackTable` uses akui `DetailsTable`. Columns: a marker, `#`, title and time. Rows are always in disc order (no sorting), because "play from here" means "the tracks after this one on the disc".
  - The current track is bold and has a speaker icon (a pause icon when paused).
  - Data tracks are dimmed and cannot be played.
  - Double-clicking a row, or pressing Enter on it, calls `onplay(track)`.
- The page's `playFrom(track)` calls `CDPlayer.playQueue(tracksFrom(tracks, track))`. That clears the queue, plays that track and queues every playable track after it.
- `TransportControls` uses icon-only akui `Button`s.
  - Play/pause: when stopped it plays the first playable track and everything after it; otherwise it toggles pause. It shows a pause icon while audio is active (loading, playing or buffering).
  - Previous: `previousStep()` restarts the track if it is more than 3 s in or is the first, otherwise plays the track before it on the disc.
  - Next: `CDPlayer.next()`. Disabled when nothing is queued after the current track.
- `SeekBar` is a native `<input type="range">`, since akui has no slider. It follows `positionSeconds` until dragged, then calls `CDPlayer.seek()` on release.
- When the disc is ejected, `DiscWatcher.toc` becomes `null`, so `tracks` is empty and the table shows its empty message ("No disc: ..." with the reason). The player is stopped by the watcher's `onChange`.
- The table is keyed on `tracks`, so a new or removed disc clears the selection and scroll position.
- Notices (`InfoBox`): audio output interrupted, unreadable sectors played as silence, and a playback error.

## Limits

- Tracks are titled "Track N". There is no CD-TEXT or MusicBrainz metadata yet.
- The double-click is read from the table's wrapper element; the table reports row clicks (`onrowclick`) but not double-clicks. The row is the last one clicked, and a header double-click is ignored by checking for a row element (`.akui-details-row`, an internal class of the library).
- No stop button, volume, repeat or shuffle.
- The layout is not tested on a narrow window. akui's `DetailsTable` switches to a card list below 640 px.
- akui is a git dependency (`github:ashkyd/svelte-akui`) and "likely to change without notice". It needs `bootstrap-icons` as a peer dependency, which is installed.
- Not checked in a running app: the build and `svelte-check` pass, and the components have no browser tests.

## Tests

- `npm test` covers `trackRows.ts`, `navigation.ts` and `format.ts`. The components themselves are checked by hand.
