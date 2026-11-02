# FilePlayer

Plays audio files dropped onto the window, as a playlist. The file counterpart of `CDPlayer` ([cd-player.md](cd-player.md)): it reads decoded audio from Rust ([file-decoder.md](file-decoder.md)) and feeds `WebAudioHandler` ([web-audio-handler.md](web-audio-handler.md)), so the visualiser and gapless joins work the same way.

## Files

- `src/lib/playback/FilePlayer.svelte.ts`: the class.
- `src/lib/files/FileDecoder.ts`: the `FileDecoder` interface (`durationSeconds`, `read()`, `seek()`, `close()`).
- `src/lib/files/RustFileDecoder.ts`: the real decoder, reading chunks from Rust.
- `src/lib/files/fileTrack.ts`: `FileTrack` and `createFileTrack()`.
- `src/lib/files/audioFiles.ts`: `isAudioPath()`, `audioPathsFrom()`.

## API

- `new FilePlayer({ handler, openDecoder, prebufferSeconds, onBeforePlay, onProblem })`: all optional. Tests pass a fake `handler` and `openDecoder(path)`. `onProblem(problem)` gets files that can't be played and warnings about damaged ones; the page shows them as toasts ([notifications.md](notifications.md)).
- State (`$state`): `status` (`idle | loading | playing | buffering | paused`), `tracks` (the whole playlist), `currentIndex`, `positionSeconds`, `interrupted`. Derived: `current`, `durationSeconds`, `isActive`.
- `enqueue(paths)`: adds to the playlist; starts playing the first new file if idle.
- `playFrom(track)`, `playPause()`, `pause()`, `resume()`, `togglePause()`, `next()`, `previous()`, `seek(seconds)`, `stop()`, `clear()`, `destroy()`.
- `release()`: like `stop()` but leaves the handler alone. Called when another player takes the handler.
- `readWaveform(target)`: forwards to the handler, for the visualiser.

## Behaviour

- One `WebAudioHandler` is shared with `CDPlayer`. Each player's `onBeforePlay` calls the other's `release()`, and the page switches to that source. A run claims the handler's `onEnded` and `onInterruption` callbacks.
- `tracks` stays whole while playing (unlike the CD queue, where played tracks are removed). `stop()` keeps it; `clear()` empties it.
- The decode loop keeps `TARGET_LEAD_SECONDS` (30 s) scheduled, then opens the next file while the lead is still ahead, so files join with no gap. Memory is that lead and no more.
- A `TrackSpan` per file (`trackNumber` is the playlist index) maps the handler's timeline back to file and position, as in `CDPlayer`.
- Starting holds the handler silent until `prebufferSeconds` (5 s) are decoded.
- `next()` and an in-buffer `seek()` use `handler.skipTo()` and are instant.
- Any other `seek()` in the file being decoded keeps its decoder open: it clears the scheduled audio, holds the handler silent, and the decode loop calls `decoder.seek()` after its current read finishes (`#pendingSeekSeconds`), then refills the prebuffer. If the loop has already moved on to the next file, the file is reopened instead (`#start()`).
- A file that can't be opened is skipped and reported through `onProblem` as an error. If nothing at all can be played the player goes `idle`. The decoder's `onDamagedAudio` (Rust skipped damaged packets) is reported once per file as a warning.
- File lengths (`FileTrack.durationSeconds`) are known once a file is opened.

## Limits

- No tags: the title is the file name, with no artist, album or cover. So Last.fm ignores files.
- No opus (see [file-decoder.md](file-decoder.md)).
- Needs Tauri: files are opened by path, which only the Tauri drop event gives. It does nothing in a plain browser.
- Playlist is not saved, and can't be reordered or have single files removed.
- A seek back into audio that has already played goes through the decoder again.
