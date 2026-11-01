# CDPlayer

Plays a queue of CD tracks gaplessly and holds the playback state for the UI. It reads chunks from the `cd-track` protocol (see [cd-bridge.md](cd-bridge.md)) and gives the PCM to a [WebAudioHandler](web-audio-handler.md).

## Files

- `src/lib/playback/CDPlayer.svelte.ts`: the class (Svelte 5 runes).
- `src/lib/playback/chunks.ts`: start sector, chunk size, URL and `TrackSpan` helpers.
- `src/lib/disc/types.ts`: `Track`, `Toc` and constants.

## API

- State: `status` (`idle`, `loading`, `playing`, `paused`), `trackNumber`, `positionSeconds`, `error`, `queue`.
- `queue`: the playing track first, then the tracks after it.
- `play(track, timeSeconds = 0)`: stops the current queue, then plays `track` from `timeSeconds`.
- `enqueue(track)`: adds an audio track to the end of the queue. Starts it if idle. Data tracks are ignored.
- `clearQueue()`: drops tracks that have not been fetched yet.
- `next()`: skips to the next queued track.
- `stop()`, `pause()`, `resume()`, `togglePause()`.

## Behaviour

- The first chunk of a run is 75 sectors (1 s) so playback starts quickly. Later chunks are 375 sectors (5 s).
- Chunks are fetched until about 30 s is scheduled ahead, then the loop waits. It also waits while paused.
- When a track's last chunk is scheduled, the loop moves on to the next queued track. The next track is therefore buffered before the current one ends. The handler joins it by frame count, so there is no gap.
- The loop reads `queue` as it runs, so tracks added during playback are picked up. If the loop had already finished, `enqueue()` restarts it.
- The handler's timeline runs across all tracks. `#spans` holds one `TrackSpan` per fetched track (start second on the timeline, and the offset into the track). Each frame, `currentSpanIndex()` finds the playing span, finished tracks are removed from the front of `queue`, and `trackNumber` and `positionSeconds` are set from it.
- Every `play()` and `stop()` bumps a run id. An older run sees the change and drops its late responses.
- A failed or non-200 chunk sets `error` and stops.
- Playback is finished only when every queued track is fetched and the handler reports it has ended. A mid-queue underrun does not end it.
- The demo UI is in `src/routes/+page.svelte`: Play and Queue buttons per track, Play/Pause, Stop, Next, Clear queue, a start-time input and an "Up next" list.

## Limits

- `next()` is not gapless: it flushes the buffer and restarts.
- `clearQueue()` cannot remove a track that is already buffered. It stays in `queue` and plays.
- No seek bar, reordering, previous or visualiser. A seek is `play(track, time)` again.

## Tests

- `npm test` covers `pcm.ts` and `chunks.ts` (including `currentSpanIndex`). Playback itself is tested by hand with a disc.
