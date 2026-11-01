# CD bridge (Rust)

Reads an audio CD in Rust and gives the frontend its track list and raw audio, in chunks.

## Files

- `src-tauri/src/lib.rs`: starts the reader, registers the `cd-track` protocol and the `get_toc` command.
- `src-tauri/src/disc/mod.rs`: `Disc`, `Toc`, `Track` and constants.
- `src-tauri/src/disc/reader.rs`: `spawn_reader()` and `DiscHandle`.
- `src-tauri/src/protocol.rs`: the `cd-track` URI scheme.
- `src-tauri/src/commands.rs`: `get_toc` and `DiscState`.

## Disc access

- Uses the `cd-da-reader` crate (MIT). No native C libraries.
- `Disc::open_default()` opens the first drive with an audio CD.
- `Disc::read_toc()` returns a `Toc`: `tracks` and `leadout_sector`.
- `Track` has `number`, `first_sector`, `last_sector` and `is_audio`.
- A track ends where the next one starts, or at the lead-out. Before a data session, 11,400 sectors (`SESSION_GAP_SECTORS`) are left out.
- `Disc::read_sectors(start_sector, sector_count)` returns raw PCM: 16-bit, 44.1 kHz, stereo, 2352 bytes per sector.
- Reads ask for 52x (`REQUESTED_READ_SPEED`). The drive may ignore this.
- Sector numbers are the crate's LBAs. Only `disc` uses their meaning.

## Reader thread

- `spawn_reader()` opens the drive and reads the TOC on a thread named `cd-reader`, then returns a `DiscHandle`.
- All reads go through that one thread, so two reads never overlap.
- `DiscHandle::read_sectors()` queues a read and blocks until it is done. It is cheap to clone.
- If the drive cannot be opened, `DiscState` holds the error text. The app still starts.

## `get_toc` command

- `invoke("get_toc")` returns the `Toc`, or the error string.
- It reflects the disc at startup. Inserting or ejecting a disc is not detected yet.

## `cd-track` protocol

- URL: `cd-track://localhost/track/{n}?start={sector}&count={sectors}`.
- `start` is relative to the track's first sector. It defaults to 0.
- `count` defaults to `MAX_CHUNK_SECTORS`.
- `count` is capped at `MAX_CHUNK_SECTORS` (375 sectors, 5 s, 882,000 bytes) and clamped to the track end.
- Success: 200, `application/octet-stream`, raw PCM, no header.
- Errors: 400 (bad URL), 404 (unknown or data track, or `start` past the end), 500 (read failed), 503 (no disc).
- Every response sends `Access-Control-Allow-Origin: *`.
- Each request is handled on its own thread, so the UI is never blocked.
- On Windows the scheme is served as `http://cd-track.localhost`. Not tested.

## Tests

- `cargo test` in `src-tauri` covers URL parsing and range clamping in `protocol.rs`.
- Drive reads are tested by hand: the "Test read" button on the page shows bytes and time for the first chunk of a track.

## Limits

- No disc insert or eject detection.
- No read retries or error recovery beyond what `cd-da-reader` does.
- No CD-TEXT. No MusicBrainz Disc ID yet.
- The first read after idle can take a few seconds while the drive spins up.
