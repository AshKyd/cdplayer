# CDPlayer

Plays one CD track and holds the playback state for the UI. It reads chunks from the `cd-track` protocol (see [cd-bridge.md](cd-bridge.md)) and gives the PCM to a [WebAudioHandler](web-audio-handler.md).

## Files

- `src/lib/playback/CDPlayer.svelte.ts`: the class (Svelte 5 runes).
- `src/lib/playback/chunks.ts`: start sector, chunk size and URL helpers.
- `src/lib/disc/types.ts`: `Track`, `Toc` and constants.

## API

- State: `status` (`idle`, `loading`, `playing`, `paused`), `trackNumber`, `positionSeconds`, `error`.
- `play(track, timeSeconds = 0)`: stops the current track, then plays `track` from `timeSeconds`.
- `stop()`, `pause()`, `resume()`, `togglePause()`.

## Behaviour

- The first chunk is 75 sectors (1 s) so playback starts quickly. Later chunks are 375 sectors (5 s).
- Chunks are fetched until about 30 s is scheduled ahead, then the loop waits. It also waits while paused.
- Every `play()` and `stop()` bumps a run id. An older run sees the change and drops its late responses.
- A failed or non-200 chunk sets `error` and stops.
- The track is finished only when the last chunk is scheduled and the handler reports it has ended.
- The demo UI is in `src/routes/+page.svelte`: a Play button per track, plus Play/Pause, Stop and a start-time input.

## Limits

- One track only. It does not continue into the next track, so there is no gapless playback across tracks yet.
- No seek bar and no visualiser.
- A seek is `play(track, time)` again.

## Tests

- `npm test` covers `pcm.ts` and `chunks.ts`. Playback itself is tested by hand with a disc.
