# CDPlayer

Plays a queue of CD tracks gaplessly and holds the playback state for the UI. It reads chunks from the `cd-track` protocol (see [cd-bridge.md](cd-bridge.md)) and gives the PCM to a [WebAudioHandler](web-audio-handler.md).

## Files

- `src/lib/playback/CDPlayer.svelte.ts`: the class (Svelte 5 runes).
- `src/lib/playback/chunks.ts`: start sector, chunk size, URL and `TrackSpan` helpers.
- `src/lib/disc/cdTrackUrl.ts`: `cdTrackBaseUrl()`, the platform's root URL for the `cd-track` protocol.
- `src/lib/disc/types.ts`: `Track`, `Toc` and constants.

## API

- `new CDPlayer({ handler, fetchChunk, baseUrl })`: all optional. Tests pass a `WebAudioHandler` on a fake `AudioContext` and a fake chunk fetch. `baseUrl` is the `cd-track` protocol root, by default from `cdTrackBaseUrl()`.
- State: `status`, `trackNumber`, `positionSeconds`, `durationSeconds` (length of the current track), `error`, `queue`, `unreadableSectors`, `interrupted`.
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
- `clearQueue()`: removes every track after the current one, including tracks already buffered (see Behaviour).
- `next()`: skips to the next queued track. Instant if that track's start is already buffered.
- `seek(seconds)`: moves within the current track and keeps the queue. Instant if that point is already buffered. A pause is kept.
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
- Buffered tracks can be taken back, because scheduled audio that hasn't started can be stopped and track boundaries are exact chunk boundaries:
  - `clearQueue()` calls `WebAudioHandler.dropAfter()` at the next track's start, rewinds `#scheduledSeconds`, removes the later spans and queue entries, and bumps `#fetchGeneration` so a fetch loop that was reading one of those tracks stops. If the next track has already started playing, nothing is dropped and only unfetched tracks are removed.
  - `next()` calls `WebAudioHandler.skipTo()` at the next track's start. The buffered audio is scheduled again to play now, from the same buffers, so the switch is instant with no fetch. If the next track isn't buffered yet (the loop only reaches it when the current track is within about 30 s of its end), it flushes and restarts, and waits for the first chunk.
  - `seek()` calls `skipTo()` when the target is inside audio that is still buffered. Otherwise (further ahead than is buffered, or back in audio that has played out) it restarts the current track from the target, keeping the rest of the queue.
- Chunk URLs are built on `cdTrackBaseUrl()`: `cd-track://localhost/` on macOS and Linux, `http://cd-track.localhost/` on Windows and Android. It asks Tauri's `convertFileSrc` for the platform prefix, and falls back to the first form outside Tauri.
- The demo UI is in `src/routes/+page.svelte`: Play and Queue buttons per track, Play/Pause, Stop, Next, Clear queue, a seek bar with the position and track length, a start-time input and an "Up next" list.

## Known issues

- `next()` is only instant when the next track is already buffered, which is the last ~30 s of the current track. Earlier than that it restarts and waits for the first chunk (a second or more on a drive that has spun down).
- `seek()` is only instant within buffered audio (up to about 30 s ahead of the playhead, and nothing behind it). Any other seek restarts the track from the target.
- `clearQueue()` and `next()` can't undo a next track that has already started playing; a late `clearQueue()` leaves it.
- `seek()` and `next()` jump to the chosen frame; they do not fade, so a click is possible at the cut.
- The first chunk after idle can take a few seconds while the drive spins up. `status` stays `loading` until it arrives.
- Sectors the drive can't read are sent as silence by the bridge (see [cd-bridge.md](cd-bridge.md)). `unreadableSectors` adds up the `X-Unreadable-Sectors` header of each chunk for the current run, and the demo UI shows a warning. Playback carries on.
- A chunk the bridge can't serve at all (disc ejected, or more than 32 bad sectors in one chunk, about 0.4 s) stops playback and clears the queue, rather than playing silence.
- Reading around damage can be slow, so the buffer may run dry near a scratch (shown as `buffering`).
- Interruptions are untested on real hardware (Bluetooth switching, sleep/wake). The context follows the system default output device and is not re-pointed at a new one.
- Output latency uses `AudioContext.outputLatency`, falling back to `baseLatency` (WebKit may not have `outputLatency`). The fallback understates the delay on Bluetooth, so the position can still run slightly ahead there.
- Unreadable sectors are silent, not interpolated, so a click or dropout is audible. Damage the drive reports as read fine is not detected.
- PCM conversion runs on the main thread. If it causes jank, move it to a Web Worker.
- Disc changes are found by the page's [DiscWatcher](disc-watcher.md), which calls `stop()` when the disc changes. `CDPlayer` itself does not know about discs: if a disc is swapped during a pause, the old queue keeps its (now wrong) tracks until a read fails.
- Only tested with the Rust bridge on macOS. Windows and Linux are untested. The Windows/Android URL form comes from Tauri's `convertFileSrc` and is only tested against a stand-in for it.

## Limits

- No reordering, previous or visualiser.
- Audio CD tracks only. Data tracks are ignored by `enqueue()`.

## Tests

- `npm test` covers `pcm.ts`, `chunks.ts` (including `currentSpanIndex` and `chunkUrl`), `cdTrackUrl.ts` and `CDPlayer` itself: loading, buffering, pausing from each state, interruptions, position latency, `clearQueue()`, `next()`, `seek()` and `stop()`. These run on `FakeAudioContext` (`FakeAudioContext.testing.ts`, a clock and state the test controls) and a fake chunk fetch that answers when the test says.
- Real audio output, gapless quality by ear and a real drive are tested by hand.
