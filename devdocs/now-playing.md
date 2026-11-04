# Now Playing

Shows the player in the OS media controls (macOS menubar Now Playing, media keys) and lets them control it. JS only; no Rust.

## Why it exists

- Without it the OS has no idea the app is playing: nothing in the menubar, and the keyboard media keys do nothing.
- The Media Session API does this on the web, so no native code is needed.
- It is not enough to call the API. WebKit only lists a page when an HTML media element is playing, and this app's sound comes from Web Audio. So a silent looping `<audio>` element plays alongside, only to make the page eligible. It is never used for sound or timing.

## Files

All in `src/lib/components/NowPlaying/`:

- `NowPlaying.svelte`: renders nothing. Takes `nowPlaying` (a `NowPlayingState`) and `controls` props, makes the bridge on mount, and calls `update()` from an `$effect`. Used once, in `src/routes/+page.svelte`, which passes the state and controls of whichever player (CD or files) is showing.
- `NowPlayingBridge.ts`: `NowPlayingBridge`, plus `nowPlayingState(player)` and `fileNowPlayingState(player)` which read a `CDPlayer` or `FilePlayer`, and `nowPlayingControls(player)` which maps the media keys to any object with the player methods.
- `silentAudio.ts`: `createSilentAudio()`, a looping silent `<audio>` built from an inline 16-bit WAV data URL (no asset to ship).
- `NowPlayingBridge.test.ts`.

## API

- `new NowPlayingBridge({ controls, mediaSession, audio, createMetadata, now })`: only `controls` is required. The rest default to the browser's and are replaced in tests.
- `update(state)`: sets the metadata, play state, position and the Next handler. Clears everything if `state.status` is not an active playback state.
- `clear()`: removes the player from the OS display and pauses the silent element.
- Handlers set: `play`, `pause`, `stop`, `previoustrack`, `seekto`, and `nexttrack` only while a track is queued after the current one.

## Behaviour

- The silent element plays whenever the player is not paused, and pauses with it.
- Title, artist, album and cover come from `CDPlayer` (MusicBrainz). The artist falls back to the album artist. With no MusicBrainz match the title is "Track N". For files ([file-player.md](file-player.md)) only the title is set: the title tag, or the file name when there is none.
- The position is reported with `setPositionState()` only when first shown, when the play state or duration changes, or when it differs from the OS's own extrapolation by more than 1 s (a seek). Not every frame.
- `CDPlayer` is the source of truth. The OS buttons call its methods, and the silent element follows its state.

## Limits

- Checked on macOS in the Tauri webview (the entry appears in the menubar). Windows and Linux are untested.
- If the webview refuses the silent element's `play()` (no user gesture yet), the failure is ignored and retried on the next update.
- Cover art is the Cover Art Archive URL, loaded by the OS.

## Tests

- `NowPlayingBridge.test.ts` runs the bridge against a fake `MediaSession` and a fake audio element.
