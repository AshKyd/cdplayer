# WebAudioHandler

Schedules PCM segments back to back on the Web Audio clock. It knows nothing about CDs, sectors or files, so any source can feed it (CD now, MP3 CDs later).

## Files

- `src/lib/playback/WebAudioHandler.ts`: the class.
- `src/lib/playback/pcm.ts`: `int16InterleavedToChannels()`, 16-bit interleaved stereo to two `Float32Array`s.
- `src/lib/playback/FakeAudioContext.testing.ts`: a fake `AudioContext` for tests.

## API

- `new WebAudioHandler({ createContext, fadeSeconds })`: optional. `createContext` makes the `AudioContext`; tests pass a fake. `fadeSeconds` returns the fade length in seconds, read on each pause/resume; default 0 (no fade).
- `appendSegment(pcm: ArrayBuffer)`: queues headerless 16-bit, 44.1 kHz, stereo PCM after what is already scheduled.
- `appendBuffer(buffer: AudioBuffer)`: queues already-decoded 44.1 kHz audio (any channel count) after what is already scheduled. Throws for another sample rate. `appendSegment()` builds a buffer and calls this.
- `leadSeconds`: audio scheduled but not yet played, on the context clock.
- `playedSeconds`: time heard since the first segment, i.e. what has reached the speakers. Holds while suspended.
- `latencySeconds`: output latency: `outputLatency`, or `baseLatency` if that is missing or zero, or 0.
- `hasQueuedAudio`: true while a scheduled segment hasn't finished.
- `dropAfter(timelineSeconds): boolean`: removes the audio that starts at or after that time and rewinds, so the next `appendSegment()` follows on from the cut. Returns `false`, cutting nothing, if any of that audio has already started.
- `skipTo(timelineSeconds): boolean`: jumps playback to that time, which must be inside audio still scheduled. Returns `false`, changing nothing, if it isn't (before the earliest segment still held, or past the end).
- Times for `dropAfter`/`skipTo` are on the timeline: the same clock as `playedSeconds`.
- `suspend()` / `resume()`: pause and resume the `AudioContext`. Scheduled sources are kept. All sources play through one `GainNode`. With a fade, `suspend()` ramps the gain to 0, waits, then suspends (only if audio is playing; skipped if `resume()` or `stop()` came during the fade). `resume()` ramps the gain from 0 to 1.
- `stop()`: stops and drops all sources, clears a requested pause and resets the clock.
- `readWaveform(target)`: fills `target` with output samples (bytes, 128 = silence) from an `AnalyserNode` placed after the gain (`WAVEFORM_SAMPLES` = 2048), delayed by `latencySeconds` so a visualiser matches what is heard (Bluetooth can be 150 to 300 ms late). Silence until that much time has passed. Returns `false` before the first segment. Frozen while suspended. `stop()` and `skipTo()` clear the stored snapshots.
- `onEnded`: callback set by the owner. Called when no scheduled source is left. The handler is shared by `CDPlayer` and `FilePlayer`; whichever starts a run sets these callbacks.
- `onInterruption(interrupted)`: callback set by the owner. `true` when the system stops the audio without being asked, `false` when it runs again.

## Behaviour

- The `AudioContext` is created lazily at 44100 Hz, so the browser does not resample.
- Each segment starts at `baseTime + scheduledFrames / sampleRate`. Frames are counted as integers, never by summing `buffer.duration`.
- If playback catches up with the schedule (underrun), the next segment re-anchors `baseTime`. `playedSeconds` stays continuous.
- Because it only counts frames, segments from different tracks or sources join with no gap. Track boundaries are the caller's business: `playedSeconds` is one timeline across everything appended.
- Each segment is kept (its `AudioBuffer`, and where it starts in frames from the anchor) until it ends, then released, so memory stays flat.
- `dropAfter()` stops the segments from the cut on, which is possible because audio that hasn't started can be stopped. It reports nothing as ended for them. `scheduledFrames` goes back to where the first dropped segment started.
- `skipTo()` stops every segment, then schedules the ones from the cut on again from their same buffers: the segment containing the cut starts partway in (the `offset` argument of `start()`), the rest keep their distance after it. A new anchor is set at now plus 50 ms, and the timeline is set to the requested time, so `playedSeconds` jumps there. No audio is fetched or converted again.
- Neither call fades. A cut in the middle of a waveform can click.
- A requested pause is remembered. `suspend()` before the first segment works: the context is created already suspended. `resume()` and `stop()` clear it. A context made outside a user gesture can start suspended, so a new context is also told to resume unless a pause was requested.
- Interruptions come from the context's `statechange` event. A state other than `running` that was not requested (`suspended`, or WebKit's `interrupted`) is an interruption: the handler reports it once, then calls `context.resume()`. If that works the state returns to `running` and it reports recovery. If the webview refuses (it needs a user gesture), the owner's `resume()` from a click does it.
- `playedSeconds` subtracts `latencySeconds` from the context clock, because audio scheduled at time `t` reaches the speakers at `t + latency`. It is read on every call, so a change of output device is picked up. `leadSeconds` does not, since it is about buffering, not what is heard.

## Limits

- 44.1 kHz input only. `appendSegment()` takes stereo PCM; `appendBuffer()` takes any channel count.
- Conversion runs on the main thread.
- `onEnded` also fires after an underrun. The owner decides if that is the real end.
- Audio that is already playing can't be unplayed, so `dropAfter()` refuses if any of the audio to drop has started.
- `skipTo()` can't go back to audio that has finished (its segment is gone), or to audio not yet appended. The owner restarts the source for those.
- No volume control (the gain is only for fades).
- `outputLatency` may be missing in WebKit; `baseLatency` understates the delay on Bluetooth.
- `readWaveform()` keeps one snapshot per call, so its delay is accurate to the caller's poll interval (about 33 ms at 30 fps).
- The context follows the system default output device. It is not re-pointed at a new device.
- Interruption recovery is untested on real hardware.
