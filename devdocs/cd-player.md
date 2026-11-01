# CDPlayer

Plays a queue of CD tracks gaplessly and holds the playback state for the UI. It reads chunks from the `cd-track` protocol (see [cd-bridge.md](cd-bridge.md)) and gives the PCM to a [WebAudioHandler](web-audio-handler.md).

## Files

- `src/lib/playback/CDPlayer.svelte.ts`: the class (Svelte 5 runes).
- `src/lib/playback/chunks.ts`: start sector, chunk size, URL and `TrackSpan` helpers.
- `src/lib/disc/types.ts`: `Track`, `Toc` and constants.

## API

- `new CDPlayer({ handler, fetchChunk })`: both optional. Tests pass a `WebAudioHandler` on a fake `AudioContext` and a fake chunk fetch.
- State: `status`, `trackNumber`, `positionSeconds`, `error`, `queue`, `unreadableSectors`, `interrupted`.
- `status`:
  - `idle`: nothing playing.
  - `loading`: waiting for the first chunk of a run.
  - `playing`.
  - `buffering`: playing, but the audio ran out before the next chunk arrived. It returns to `playing` when the chunk lands.
  - `paused`: by the user, or by the system (see `interrupted`).
- `interrupted`: true while the system has stopped the audio without being asked (sleep, an output device change). The UI shows "press Play".
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
- Playback is finished only when every queued track is fetched and the handler reports it has ended. A mid-queue underrun does not end it: it sets `buffering`.
- `pause()` works from `loading`, `buffering` and `playing`. Paused during `loading`, the first chunk still arrives but stays silent until `resume()`. `resume()` goes back to `playing` if audio is queued, to `buffering` if audio had started and run dry, and to `loading` if no chunk had arrived.
- Interruptions: when the handler reports the system stopped the audio (`onInterruption(true)`), a playing or buffering player becomes `paused` with `interrupted` set. The handler tries to resume by itself; if that works the player returns to its status and clears `interrupted`. If the webview needs a user gesture, the user presses Play, and `resume()` does it. A pause made by the user is never undone by the system recovering.
- `positionSeconds` comes from `WebAudioHandler.playedSeconds`, which allows for output latency, so it follows what is heard.
- The demo UI is in `src/routes/+page.svelte`: Play and Queue buttons per track, Play/Pause, Stop, Next, Clear queue, a start-time input and an "Up next" list.

## Known issues

- `clearQueue()` cannot remove a track that is already buffered. The next track is fetched up to about 30 s before the current one ends, and `WebAudioHandler` has no way yet to drop audio it has scheduled. Tracks not yet fetched are removed. In practice it only matters in the last ~30 s of a track, or when tracks are short. A fix is a handler method that stops sources that haven't started and rewinds its frame count: track boundaries are chunk boundaries, so it would be exact.
- `next()` is not gapless: it flushes the buffer and restarts at the next queued track. The same handler method would fix this.
- The first chunk after idle can take a few seconds while the drive spins up. `status` stays `loading` until it arrives.
- Sectors the drive can't read are sent as silence by the bridge (see [cd-bridge.md](cd-bridge.md)). `unreadableSectors` adds up the `X-Unreadable-Sectors` header of each chunk for the current run, and the demo UI shows a warning. Playback carries on.
- A chunk the bridge can't serve at all (disc ejected, or more than 32 bad sectors in one chunk, about 0.4 s) stops playback and clears the queue, rather than playing silence.
- Reading around damage can be slow, so the buffer may run dry near a scratch (shown as `buffering`).
- Interruptions are untested on real hardware (Bluetooth switching, sleep/wake). The context follows the system default output device and is not re-pointed at a new one.
- Output latency uses `AudioContext.outputLatency`, falling back to `baseLatency` (WebKit may not have `outputLatency`). The fallback understates the delay on Bluetooth, so the position can still run slightly ahead there.
- Unreadable sectors are silent, not interpolated, so a click or dropout is audible. Damage the drive reports as read fine is not detected.
- PCM conversion runs on the main thread. If it causes jank, move it to a Web Worker.
- Disc changes are found by the page's [DiscWatcher](disc-watcher.md), which calls `stop()` when the disc changes. `CDPlayer` itself does not know about discs: if a disc is swapped during a pause, the old queue keeps its (now wrong) tracks until a read fails.
- Only tested with the Rust bridge on macOS. Windows and Linux are untested.

## Limits

- No seek bar, reordering, previous or visualiser. A seek is `play(track, time)` again.
- Audio CD tracks only. Data tracks are ignored by `enqueue()`.

## Tests

- `npm test` covers `pcm.ts`, `chunks.ts` (including `currentSpanIndex`) and `CDPlayer` itself: loading, buffering, pausing from each state, interruptions, position latency and `stop()`. These run on `FakeAudioContext` (`FakeAudioContext.testing.ts`, a clock and state the test controls) and a fake chunk fetch that answers when the test says.
- Real audio output, gapless quality by ear and a real drive are tested by hand.
