# WebAudioHandler

Schedules PCM segments back to back on the Web Audio clock. It knows nothing about CDs, sectors or files, so any source can feed it (CD now, MP3 CDs later).

## Files

- `src/lib/playback/WebAudioHandler.ts`: the class.
- `src/lib/playback/pcm.ts`: `int16InterleavedToChannels()`, 16-bit interleaved stereo to two `Float32Array`s.
- `src/lib/playback/FakeAudioContext.testing.ts`: a fake `AudioContext` for tests.

## API

- `new WebAudioHandler({ createContext })`: optional. `createContext` makes the `AudioContext`; tests pass a fake.
- `appendSegment(pcm: ArrayBuffer)`: queues headerless 16-bit, 44.1 kHz, stereo PCM after what is already scheduled.
- `leadSeconds`: audio scheduled but not yet played, on the context clock.
- `playedSeconds`: time heard since the first segment, i.e. what has reached the speakers. Holds while suspended.
- `latencySeconds`: output latency: `outputLatency`, or `baseLatency` if that is missing or zero, or 0.
- `hasQueuedAudio`: true while a scheduled segment hasn't finished.
- `suspend()` / `resume()`: pause and resume the `AudioContext`. Scheduled sources are kept.
- `stop()`: stops and drops all sources, clears a requested pause and resets the clock.
- `onEnded`: callback set by the owner. Called when no scheduled source is left.
- `onInterruption(interrupted)`: callback set by the owner. `true` when the system stops the audio without being asked, `false` when it runs again.

## Behaviour

- The `AudioContext` is created lazily at 44100 Hz, so the browser does not resample.
- Each segment starts at `baseTime + scheduledFrames / sampleRate`. Frames are counted as integers, never by summing `buffer.duration`.
- If playback catches up with the schedule (underrun), the next segment re-anchors `baseTime`. `playedSeconds` stays continuous.
- Because it only counts frames, segments from different tracks or sources join with no gap. Track boundaries are the caller's business: `playedSeconds` is one timeline across everything appended.
- Each source is removed from the handler when it ends, so memory stays flat.
- A requested pause is remembered. `suspend()` before the first segment works: the context is created already suspended. `resume()` and `stop()` clear it. A context made outside a user gesture can start suspended, so a new context is also told to resume unless a pause was requested.
- Interruptions come from the context's `statechange` event. A state other than `running` that was not requested (`suspended`, or WebKit's `interrupted`) is an interruption: the handler reports it once, then calls `context.resume()`. If that works the state returns to `running` and it reports recovery. If the webview refuses (it needs a user gesture), the owner's `resume()` from a click does it.
- `playedSeconds` subtracts `latencySeconds` from the context clock, because audio scheduled at time `t` reaches the speakers at `t + latency`. It is read on every call, so a change of output device is picked up. `leadSeconds` does not, since it is about buffering, not what is heard.

## Limits

- Stereo, 44.1 kHz input only.
- Conversion runs on the main thread.
- `onEnded` also fires after an underrun. The owner decides if that is the real end.
- No way yet to drop audio that is scheduled but hasn't started. It would be possible (stop those sources and rewind the frame count) and would allow gapless skips and seeks.
- No volume control or analyser node.
- `outputLatency` may be missing in WebKit; `baseLatency` understates the delay on Bluetooth.
- The context follows the system default output device. It is not re-pointed at a new device.
- Interruption recovery is untested on real hardware.
