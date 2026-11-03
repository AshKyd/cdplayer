# AppControls

The controls bar of the player, shown below the track list as one presentational component. It holds no player logic: the page passes in values and callbacks.

## Files

- `src/lib/components/AppControls/AppControls.svelte`: renders a `<header>` with `AlbumHeader` (cover, album, artist, year), `TransportControls`, `SeekBar`, and the playlist, fullscreen and settings buttons.
- `src/lib/components/AppControls/AppControls.stories.svelte`: stories (`Interactive`, `No disc`, `Reading disc`, `Paused mid-track`, `Last track`, `Playing files`).

## API

- Display props: `metadata`, `message`, `busy`, `coverOpen`, `track`, `coverless`, `playing`, `transportDisabled`, `canPrevious`, `canNext`, `positionSeconds`, `durationSeconds`, `seekDisabled`, `playlistToggleable` (default `true`; false hides the playlist button). The page sets it when the playlist has 2 or more rows, and sets `transportDisabled` and `seekDisabled` when there is no disc or the playlist is empty.
- Bindable: `playlistVisible` (default `true`). The playlist button flips it; the page shows or hides the track list from it.
- Callbacks: `onopencover`, `onprevious`, `onplaypause`, `onnext`, `onseek(seconds)`, `onsettings`, `onfullscreen`. All are optional and default to no-ops.

## Behaviour

- The component has no background of its own. The page wraps it in `.controls-bar`, which is the frosted bottom of the window: edge to edge, a 40% `--akui-bg` tint, a 12px `backdrop-filter` blur and a 1px top border of `--akui-fg` at 10%.
- `AlbumHeader` stays mounted across discs (no wipe), so the cover's space slides in and out as the source changes and the text slides across with it. The `Interactive` story has buttons for each case.
- Layout: a grid. Row one is the seek bar, whose time labels are 4.5rem wide and centred, the width of the cover below; row two is album | transport (centred) | playlist, fullscreen and settings buttons (right). At 45rem or narrower the transport stays centred on its own row, with the album and buttons on the row below.

## Limits

- The narrow layout uses a viewport media query, so it can't be shown by narrowing a container in Storybook.
- The `Interactive` story uses a fake clock, not a real player.
