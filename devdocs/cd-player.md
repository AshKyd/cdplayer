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
- A non-200 chunk sets `error` and stops. Unreadable sectors inside a 200 chunk do not: they are already silence.
- Playback is finished only when every queued track is fetched and the handler reports it has ended. A mid-queue underrun does not end it.
- The demo UI is in `src/routes/+page.svelte`: Play and Queue buttons per track, Play/Pause, Stop, Next, Clear queue, a start-time input and an "Up next" list.

## Known issues

- `clearQueue()` cannot remove a track that is already buffered. The next track is fetched up to about 30 s before the current one ends, and scheduled audio cannot be unscheduled. Tracks not yet fetched are removed. In practice it only matters in the last ~30 s of a track, or when tracks are short. A fix would be to flush and restart the current track from its position, which causes a small glitch.
- `next()` is not gapless: it flushes the buffer and restarts at the next queued track.
- The first chunk after idle can take a few seconds while the drive spins up. `status` stays `loading` until it arrives.
- A slow read can run the buffer dry. Playback pauses briefly and carries on from the next chunk (the handler re-anchors its clock). It is not reported as an error.
- Sectors the drive can't read are sent as silence by the bridge (see [cd-bridge.md](cd-bridge.md)). `unreadableSectors` adds up the `X-Unreadable-Sectors` header of each chunk for the current run, and the demo UI shows a warning. Playback carries on.
- A chunk the bridge can't serve at all (disc ejected, or more than 32 bad sectors in one chunk, about 0.4 s) stops playback and clears the queue, rather than playing silence.
- Reading around damage can be slow, so the buffer may run dry near a scratch.
- Unreadable sectors are silent, not interpolated, so a click or dropout is audible. Damage the drive reports as read fine is not detected.
- PCM conversion runs on the main thread. If it causes jank, move it to a Web Worker.
- Disc changes are found by the page's [DiscWatcher](disc-watcher.md), which calls `stop()` when the disc changes. `CDPlayer` itself does not know about discs: if a disc is swapped during a pause, the old queue keeps its (now wrong) tracks until a read fails.
- Only tested with the Rust bridge on macOS. Windows and Linux are untested.

## Limits

- No seek bar, reordering, previous or visualiser. A seek is `play(track, time)` again.
- Audio CD tracks only. Data tracks are ignored by `enqueue()`.

## Tests

- `npm test` covers `pcm.ts` and `chunks.ts` (including `currentSpanIndex`). Playback itself is tested by hand with a disc.
