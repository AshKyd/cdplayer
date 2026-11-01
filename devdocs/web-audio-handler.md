# WebAudioHandler

Schedules PCM segments back to back on the Web Audio clock. It knows nothing about CDs, sectors or files, so any source can feed it (CD now, MP3 CDs later).

## Files

- `src/lib/playback/WebAudioHandler.ts`: the class.
- `src/lib/playback/pcm.ts`: `int16InterleavedToChannels()`, 16-bit interleaved stereo to two `Float32Array`s.

## API

- `appendSegment(pcm: ArrayBuffer)`: queues headerless 16-bit, 44.1 kHz, stereo PCM after what is already scheduled.
- `leadSeconds`: audio scheduled but not yet played.
- `playedSeconds`: time played since the first segment. Holds while suspended.
- `suspend()` / `resume()`: pause and resume the `AudioContext`. Scheduled sources are kept.
- `stop()`: stops and drops all sources and resets the clock.
- `onEnded`: callback set by the owner. Called when no scheduled source is left.

## Behaviour

- The `AudioContext` is created lazily at 44100 Hz, so the browser does not resample.
- Each segment starts at `baseTime + scheduledFrames / sampleRate`. Frames are counted as integers, never by summing `buffer.duration`.
- If playback catches up with the schedule (underrun), the next segment re-anchors `baseTime`. `playedSeconds` stays continuous.
- Each source is removed from the handler when it ends, so memory stays flat.

## Limits

- Stereo, 44.1 kHz input only.
- Conversion runs on the main thread.
- `onEnded` also fires after an underrun. The owner decides if that is the real end.
