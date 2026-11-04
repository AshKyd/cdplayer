# File decoder (Rust)

Decodes audio files for `FilePlayer` ([file-player.md](file-player.md)). Rust opens the file by path, decodes it with symphonia, converts it to 44.1 kHz stereo `f32`, and serves it in chunks over the `file-track` protocol. The JS side only copies samples into `AudioBuffer`s.

This is outside "keep it a JS app" on purpose: WebKit's own flac decoder fails, WASM decoding blocked the main thread, and codec support differs per webview. Decoding in Rust is the same on every OS, uses little memory and seeks natively.

## Files

- `src-tauri/src/files/mod.rs`: `FileRegistry` (the open files, by id) and `OpenedFile`.
- `src-tauri/src/files/session.rs`: `FileSession`, one open file. Reads, seeks, decodes, mixes to stereo.
- `src-tauri/src/files/resampler.rs`: `Resampler`, a streaming polyphase windowed-sinc converter (32 taps, exact rational ratio).
- `src-tauri/src/files/protocol.rs`: the `file-track` protocol.
- `src-tauri/src/files/metadata.rs`: `read_tags`, every tag in a file (see [file-metadata.md](file-metadata.md)).
- `src-tauri/src/commands.rs`: `open_audio_file`, `close_audio_file`, `get_metadata`.
- `src/lib/files/RustFileDecoder.ts`: the JS `FileDecoder` for it. `src/lib/files/FileDecoder.ts` is the interface.

## API

- `open_audio_file(path) -> { id, duration_seconds }`. The path must be an existing file with an audio extension (mp3, m4a, mp4, aac, flac, ogg, oga, wav, aif, aiff, caf, mka). `duration_seconds` is 0 if the file doesn't say.
- `close_audio_file(id)`.
- `get_metadata(path) -> [{ key, value, standard }]`: every tag in the file, unfiltered, with the same path checks as `open_audio_file`. `key` is the file's own key (`TIT2`, `TITLE`, `©nam`), `value` is text, a number or a flag (binary values, such as pictures, are replaced by a note of their size), and `standard` is symphonia's format-independent name when it has one (`TrackTitle`, `Artist`, `Album`, `TrackNumber`...). Oldest revision first, so a leading ID3v2 tag comes before a trailing ID3v1 tag. It doesn't decode or open a session. Rust picks nothing; the JS side does.
- `file-track://localhost/{id}?start={frame}&count={frames}` (`http://file-track.localhost/` on Windows): `start` and `count` are in output frames at 44.1 kHz. `count` defaults to 2 s and is capped at 10 s. The body is headerless little-endian `f32`, stereo interleaved. It is shorter than asked at the end of the file, and empty past it. Header `X-Decode-Errors`: damaged packets skipped in the chunk; `RustFileDecoder` passes a non-zero count to `onDamagedAudio`, and `FilePlayer` shows it as a warning toast. Errors: 400 bad request, 404 unknown id, 500 with a message.

## Behaviour

- A read that starts where the last one ended just decodes on. Any other `start` seeks first: `FormatReader::seek` to the track timestamp, decoder reset, then packets before the target are decoded and dropped so the chunk starts on the exact frame (rounded to the file's own time base).
- Gapless: symphonia trims encoder delay and padding itself (the mp3 decoder applies `trim_start`/`trim_end` from the LAME tag), so the end of one file joins the next.
- Channels: mono is doubled; more than two channels keep the front left and right only.
- Sample rates other than 44.1 kHz go through `Resampler`. It keeps state between packets and is reset on a seek. A rate that reduces to a ratio with a numerator over 4096 is refused.
- Each file has its own `Mutex`, so its reads never overlap. Requests are answered on their own threads.
- A packet that fails to decode is skipped and counted. Any other error ends the read with a 500.

## Limits

- No opus: symphonia 0.6 has no opus decoder. `.opus` files are not accepted.
- No cover art: pictures are not sent by `get_metadata`.
- No tags from WAV files: symphonia 0.6.1 reads a WAV's RIFF `INFO` tags but drops them (`symphonia-format-riff` `wave/mod.rs`), so only an ID3v2 tag in front of the file comes through.
- Surround files are not downmixed properly (see above).
- Seeking in an mp3 without a Xing/VBRI table, or a flac without a seek table, builds an index as it goes (every 1 s of audio), so the first far seek can scan the file.
- Files are opened by any path the page gives, checked only for being a file with an audio extension.
- The Rust code was written without a compiler to hand: run `cargo test` in `src-tauri`.
