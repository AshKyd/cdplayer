# CDPlayer

The player: finds the disc, looks up its track names ([musicbrainz.md](musicbrainz.md)), and plays a queue of its tracks gaplessly. It holds all the state for the UI. It reads chunks from the `cd-track` protocol (see [cd-bridge.md](cd-bridge.md)) and gives the PCM to a [WebAudioHandler](web-audio-handler.md). Its steps follow a state machine: see [player-lifecycle.md](player-lifecycle.md).

## Files

- `src/lib/playback/CDPlayer.svelte.ts`: the class (Svelte 5 runes).
- `src/lib/playback/playerMachine.ts`: the states, events and `transition()` rules.
- `src/lib/playback/navigation.ts`: `tracksFrom()` and `previousStep()`.
- `src/lib/disc/DiscWatcher.svelte.ts` and `src/lib/metadata/`: used by the class for the disc and its names.
- `src/lib/playback/chunks.ts`: start sector, chunk size, URL and `TrackSpan` helpers.
- `src/lib/disc/cdTrackUrl.ts`: `cdTrackBaseUrl()`, the platform's root URL for the `cd-track` protocol.
- `src/lib/disc/types.ts`: `Track`, `Toc` and constants.

## API

- `new CDPlayer({ handler, fetchChunk, baseUrl, loadToc, loadMetadata, isMetadataLookupEnabled, isAutoplayEnabled, discCheckIntervalMs, prebufferSeconds, onBeforePlay })`: all optional. `onBeforePlay` is called when a run starts, so the file player ([file-player.md](file-player.md)), which shares the handler, can let go of it. `prebufferSeconds` defaults to 5; the default handler fades by 100 ms when the `fadeEnabled` setting is on. `isMetadataLookupEnabled` defaults to the `musicBrainzEnabled` setting; when false the lookup is skipped and the disc is `ready` with no error. Tests pass a `WebAudioHandler` on a fake `AudioContext`, a fake chunk fetch, a fake drive (`loadToc`) and a fake lookup (`loadMetadata`). `baseUrl` is the `cd-track` protocol root, by default from `cdTrackBaseUrl()`.
- `start()`: starts watching the drive for a disc. `destroy()`: stops watching and stops the audio. `checkDisc()`: looks at the drive now (does nothing while playing, loading or buffering).
- Disc state: `status`, `tracks` (the disc's tracks, empty with no disc), `metadata` (`DiscMetadata` or `null`), `metadataError`, `discError` (why there is no disc) and `readingDisc` (the drive is slow to report its TOC).
- Playback state: `trackNumber`, `positionSeconds`, `durationSeconds` (length of the current track), `error`, `queue`, `unreadableSectors`, `interrupted`.
- `status` is one of `noDisc`, `loadingMetadata`, `ready`, `loading`, `playing`, `buffering` and `paused`. What each means, and which moves between them are allowed, is in [player-lifecycle.md](player-lifecycle.md). Playing is only possible from `ready` onward, so nothing plays before the track names are settled.
- `interrupted`: true while the system has stopped the audio without being asked (sleep, an output device change). The UI shows "press Play".
- `trackTitle(track)` and `trackArtist(track)`: names from MusicBrainz, or "Track N" and empty.
- `queue`: the playing track first, then the tracks after it.
- `play(track, timeSeconds = 0)`: stops the current queue, then plays `track` alone from `timeSeconds`.
- `playQueue(tracks, timeSeconds = 0)`: stops the current queue, then plays `tracks` in order, starting the first at `timeSeconds`. Data tracks are skipped.
- `playFrom(track)`: `playQueue()` of that track and every playable track after it on the disc. This is what a double-click on a track does.
- `playPause()`: the play/pause button. Toggles a pause if audio is active, otherwise plays the disc from its first playable track.
- `previous()`: restarts the track if it is more than 3 s in or is the first, otherwise plays the track before it on the disc.
- `enqueue(track)`: adds an audio track to the end of the queue. Starts it if `ready`. Data tracks are ignored.
- `clearQueue()`: removes every track after the current one, including tracks already buffered (see Behaviour).
- `next()`: skips to the next queued track. Instant if that track's start is already buffered.
- `seek(seconds)`: moves within the current track and keeps the queue. Instant if that point is already buffered. A pause is kept.
- `onDiscChange(toc | null)` option: called whenever the watcher finds, swaps or loses a disc, before the state changes. The page uses it to leave files mode.
- `stop()` (back to `ready`, queue cleared), `pause()`, `resume()`, `togglePause()`.
- `release()`: like `stop()` but leaves the handler alone, for when the file player takes it. A run sets the handler's `onEnded` and `onInterruption` callbacks when it starts.

## Behaviour

- The first chunk of a run is 75 sectors (1 s) so playback starts quickly. Later chunks are 375 sectors (5 s).
- Chunks are fetched until about 30 s is scheduled ahead, then the loop waits. It also waits while paused.
- When a track's last chunk is scheduled, the loop moves on to the next queued track. The next track is therefore buffered before the current one ends. The handler joins it by frame count, so there is no gap.
- The loop reads `queue` as it runs, so tracks added during playback are picked up. If the loop had already finished, `enqueue()` restarts it.
- The handler's timeline runs across all tracks. `#spans` holds one `TrackSpan` per fetched track (start second on the timeline, and the offset into the track). Each frame, `currentSpanIndex()` finds the playing span, finished tracks are removed from the front of `queue`, and `trackNumber` and `positionSeconds` are set from it.
- Every `playQueue()` and `stop()` bumps a run id. An older run sees the change and drops its late responses.
- A non-200 chunk sets `error` and stops. Unreadable sectors inside a 200 chunk do not: they are already silence.
- Playback is finished only when every queued track is fetched and the handler reports it has ended. A mid-queue underrun does not end it: it sets `buffering`.
- Prebuffer: every run (`play`, `next` and `seek` restarts) starts with the handler suspended and stays `loading` until `handler.leadSeconds` reaches 5 s (`prebufferSeconds` option), or until the whole queue is fetched if that is shorter. Then the handler resumes (fading in) and the status becomes `playing`. A pause during this keeps it held; `resume()` returns to `loading` and the gate opens once enough is buffered. Underruns later in a run do not wait for 5 s.
- `pause()` works from `loading`, `buffering` and `playing`. Paused during `loading`, the first chunk still arrives but stays silent until `resume()`. `resume()` goes back to `playing` if audio is queued, to `buffering` if audio had started and run dry, and to `loading` if no chunk had arrived.
- Interruptions: when the handler reports the system stopped the audio (`onInterruption(true)`), a playing or buffering player becomes `paused` with `interrupted` set. The handler tries to resume by itself; if that works the player returns to its status and clears `interrupted`. If the webview needs a user gesture, the user presses Play, and `resume()` does it. A pause made by the user is never undone by the system recovering.
- `positionSeconds` comes from `WebAudioHandler.playedSeconds`, which allows for output latency, so it follows what is heard.
- Buffered tracks can be taken back, because scheduled audio that hasn't started can be stopped and track boundaries are exact chunk boundaries:
  - `clearQueue()` calls `WebAudioHandler.dropAfter()` at the next track's start, rewinds `#scheduledSeconds`, removes the later spans and queue entries, and bumps `#fetchGeneration` so a fetch loop that was reading one of those tracks stops. If the next track has already started playing, nothing is dropped and only unfetched tracks are removed.
  - `next()` calls `WebAudioHandler.skipTo()` at the next track's start. The buffered audio is scheduled again to play now, from the same buffers, so the switch is instant with no fetch. If the next track isn't buffered yet (the loop only reaches it when the current track is within about 30 s of its end), it flushes and restarts, and waits for the first chunk.
  - `seek()` calls `skipTo()` when the target is inside audio that is still buffered. Otherwise (further ahead than is buffered, or back in audio that has played out) it restarts the current track from the target, keeping the rest of the queue.
- Chunk URLs are built on `cdTrackBaseUrl()`: `cd-track://localhost/` on macOS and Linux, `http://cd-track.localhost/` on Windows and Android. It asks Tauri's `convertFileSrc` for the platform prefix, and falls back to the first form outside Tauri.
- The class owns a `DiscWatcher` ([disc-watcher.md](disc-watcher.md)). While no audio is playing (paused counts as not playing) it polls for the disc; a change stops any playback, clears the tracks and metadata, and starts a new lookup (or goes to `noDisc`). A failed chunk read stops playback and checks the drive straight away.
- The UI is described in [ui.md](ui.md). It only reads state and calls `playFrom()`, `playPause()`, `previous()`, `next()` and `seek()`. `enqueue()` and `clearQueue()` are not used by it yet.

## Known issues

- `next()` is only instant when the next track is already buffered, which is the last ~30 s of the current track. Earlier than that it restarts and waits for the first chunk (a second or more on a drive that has spun down).
- `seek()` is only instant within buffered audio (up to about 30 s ahead of the playhead, and nothing behind it). Any other seek restarts the track from the target.
- `clearQueue()` and `next()` can't undo a next track that has already started playing; a late `clearQueue()` leaves it.
- `seek()` and `next()` jump to the chosen frame; they do not fade, so a click is possible at the cut.
- The first chunk after the drive has been idle can take a few seconds while the drive spins up. `status` stays `loading` until it arrives.
- Sectors the drive can't read are sent as silence by the bridge (see [cd-bridge.md](cd-bridge.md)). `unreadableSectors` adds up the `X-Unreadable-Sectors` header of each chunk for the current run, and the UI shows a warning. Playback carries on.
- A chunk the bridge can't serve at all (disc ejected, or more than 32 bad sectors in one chunk, about 0.4 s) stops playback and clears the queue, rather than playing silence.
- Reading around damage can be slow, so the buffer may run dry near a scratch (shown as `buffering`).
- Interruptions are untested on real hardware (Bluetooth switching, sleep/wake). The context follows the system default output device and is not re-pointed at a new one.
- Output latency uses `AudioContext.outputLatency`, falling back to `baseLatency` (WebKit may not have `outputLatency`). The fallback understates the delay on Bluetooth, so the position can still run slightly ahead there.
- Unreadable sectors are silent, not interpolated, so a click or dropout is audible. Damage the drive reports as read fine is not detected.
- PCM conversion runs on the main thread. If it causes jank, move it to a Web Worker.
- The disc is not checked while audio is playing, loading or buffering, or while a chunk is being read. It is checked while paused, so an eject or swap during a pause is noticed and playback is torn down.
- Only tested with the Rust bridge on macOS. Windows and Linux are untested. The Windows/Android URL form comes from Tauri's `convertFileSrc` and is only tested against a stand-in for it.

## Limits

- No reordering, previous or visualiser.
- Audio CD tracks only. Data tracks are ignored by `enqueue()`.

## Tests

- `npm test` covers `pcm.ts`, `chunks.ts` (including `currentSpanIndex` and `chunkUrl`), `cdTrackUrl.ts` and `CDPlayer` itself: loading, buffering, pausing from each state, interruptions, position latency, `clearQueue()`, `next()`, `seek()` and `stop()`. These run on `FakeAudioContext` (`FakeAudioContext.testing.ts`, a clock and state the test controls) and a fake chunk fetch that answers when the test says.
- Real audio output, gapless quality by ear and a real drive are tested by hand.
