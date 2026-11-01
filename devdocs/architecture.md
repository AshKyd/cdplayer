# Architecture Specification: Cross-Platform Gapless CD Player

## 1. Overview
This document outlines the architecture for a cross-platform (macOS, Windows, Linux) gapless CD player built using **Tauri**, **Rust**, and **web technologies**. Because Windows and Linux do not natively expose Audio CDs as playable files (unlike macOS), we use the pure-Rust `cd-da-reader` crate (MIT) in the Rust backend to read raw optical sectors directly. The web frontend manages the UI, visualization, and perfect gapless playback scheduling via the **Web Audio API**.

## 2. High-Level Architecture

The system is divided into a Rust backend managing hardware access and a Web frontend handling audio routing and UI, communicating via Tauri's custom protocol.

**Design principle: keep it a JS app.** Rust only does what JS cannot: talk to the drive (read the TOC, read sectors, re-open the drive). State, timing, polling, queueing and decisions live in JS. When a feature can be done in either, do it in JS. For example, disc insert/eject detection is a JS poll ([disc-watcher.md](disc-watcher.md)) over one thin Rust command, and the MusicBrainz disc ID and lookup are JS ([musicbrainz.md](musicbrainz.md)).

```text
[ Physical Audio CD ]
        │
        ▼ (cd-da-reader / OS-level drive access: SPTI / ioctl / IOKit)
[ Rust Backend: Reads raw 2352-byte PCM sectors ]
        │
        ▼ (Rust serves headerless PCM in ~5 s chunks, addressed by sector range)
[ Tauri Custom Protocol (cd-track://) ] <-- Chunked raw PCM bytes
        │
        ▼ (JS: fetch() & ArrayBuffer -> Int16 to Float32 -> AudioBuffer)
[ Web Audio API ]
        │
        ├──> AudioBufferSourceNode per chunk (sample-count scheduling)
        │
        ├──> AnalyserNode (FFT / Time Domain Data)
        │       └─> requestAnimationFrame() -> Canvas / WebGL Visualizer
        │
        ▼
[ Cross-Platform OS Speakers ]
```

## 3. Component Breakdown

### 3.1. The Rust Backend (The OS-Agnostic Layer)
The Rust backend bridges the gap between raw hardware and the web view. Details: [cd-bridge.md](cd-bridge.md).
* **Drive Access:** Opens the drive and re-opens it on request (`get_toc`). It does not poll. Detecting optical drives and CD insertions is done by polling from JS (see [disc-watcher.md](disc-watcher.md)).
* **cd-da-reader Integration:** Uses `cd-da-reader` to read the Table of Contents (TOC). It gives each track's start address (LBA); a track ends where the next begins, or at the lead-out.
* **Chunked Sector Reads:** Rust reads raw 16-bit, 44.1kHz stereo PCM sectors (2352 bytes, 75 per second) for a requested sector range. It never reads or holds a whole track. One chunk is 375 sectors (5 s, 882,000 bytes).
* **No WAV Wrapping:** Chunks are returned as headerless PCM. The frontend already knows the format (CD audio is always 16-bit/44.1kHz/stereo), and converts the samples itself, so `decodeAudioData()` is not used.
* **Chunk Serving:** Uses Tauri's custom URI scheme with an explicit sector range, e.g. `cd-track://localhost/track/1?start=0&count=375` (on Windows and Android the scheme is served as `http://cd-track.localhost`, so the frontend gets the root URL from Tauri rather than hardcoding it). Each request is one blocking drive read, run on a single dedicated reader thread so reads never overlap.
* **Drive Speed:** Set the drive to its maximum read speed. Playback needs 1x (150 KB/s) as a bare minimum, and reads must be faster than real time to build a lead.

### 3.2. The Web Frontend (The Presentation & Audio Routing Layer)
The frontend handles playback, gapless transitions, and visualizations, treating the dynamic Rust stream just like a standard web file fetch.
* **AudioContext:** The central hub for all audio routing and timing.
* **Buffer Management:** Holds a rolling lead of about 30 s of decoded `AudioBuffer` chunks ahead of the playhead, regardless of track length (about 10 MB as Float32). Played chunks are dropped. Memory use is constant; it does not grow with track length.
* **AnalyserNode:** Intercepts the audio graph to provide real-time frequency (FFT) and waveform data to the visualizer.
* **UI & Visualizer:** Svelte 5 (runes). Playback state lives in the `CDPlayer` class ([cd-player.md](cd-player.md), `src/lib/playback/CDPlayer.svelte.ts`), exposing `$state` for the track, position and status. The UI components read that state. The visualizer is a `<canvas>` component driven by `requestAnimationFrame`.
* **Player lifecycle:** `CDPlayer` is one state machine from no disc, through looking up the disc's metadata, to playing ([player-lifecycle.md](player-lifecycle.md)). Each step only happens in a state that allows it.
* **Disc detection:** The `DiscWatcher` class ([disc-watcher.md](disc-watcher.md)), owned by `CDPlayer`, polls for the disc while no audio is active and reports when it changes.
* **Metadata:** Track names, artist and cover come from MusicBrainz and the Cover Art Archive ([musicbrainz.md](musicbrainz.md)), looked up in JS by the disc ID computed from the TOC.
* **Window UI:** Built with the svelte-akui library: a `DetailsTable` track list, an album header, icon transport buttons, a seek bar and a selectable visualiser as the window background ([ui.md](ui.md), [visualisers.md](visualisers.md)). The components show `CDPlayer`'s state and send it commands. Components can be viewed alone in Storybook ([storybook.md](storybook.md)).
* **Disc spinner:** The `DiscSpinner` component ([disc-spinner.md](disc-spinner.md)) is the spinning disc shown while a disc is read or looked up.
* **Settings:** The `settings` store ([settings.md](settings.md)) is saved to `localStorage`, shared by every part of a window, and synced live to the other windows with Tauri events. The settings window is a second webview that opens the `/settings` route. No Rust.
* **System media controls:** The `NowPlaying` component (`NowPlayingBridge`; [now-playing.md](now-playing.md)) shows the track in the OS Now Playing display (macOS menubar) and handles media keys, using the Media Session API. No Rust.
* **Cover theme:** The `CoverTheme` component ([cover-theme.md](cover-theme.md)) takes 1–2 colours from the cover with `node-vibrant` and sets the akui accent. No Rust.
* **Last.fm:** The `LastFmScrobbler` component ([last-fm.md](last-fm.md)) sends "now playing" and scrobbles from the player's state, using the login in settings. No Rust.
* **Audio scheduling:** The `WebAudioHandler` class ([web-audio-handler.md](web-audio-handler.md)) appends PCM segments to the playback buffer and owns the `AudioContext`.
* **Source / engine split:** MP3 CDs will be supported later using the same architecture. A source (`CDPlayer` for audio CDs, an MP3 source later) reads or decodes audio into PCM and feeds it to `WebAudioHandler`. `WebAudioHandler` knows nothing about CDs or sectors, so the Web Audio code and the CD playback code must stay separate.

## 4. Achieving True Gapless Playback

The Web Audio API's hardware clock (`AudioContext.currentTime`) provides sample-accurate gapless transitions. The player treats the disc as one continuous stream of sectors. Track boundaries are not special: chunk N+1 is simply the next sectors after chunk N, whether or not a track changes.

The `AudioContext` is created at the CD sample rate, `new AudioContext({sampleRate: 44100})`. Otherwise the browser resamples each chunk separately, which can cause artefacts at chunk joins.

**The Scheduling Pipeline:**
1. **Start fast:** On play, request a short first chunk (e.g. 75 sectors, 1 s) so playback starts in about a second. Later chunks use the full 375 sectors.
2. **Convert:** Each response is Int16 interleaved PCM. Convert to Float32 (divide by 32768), de-interleave, and fill an `AudioBuffer` with `copyToChannel()`.
3. **Schedule by sample count:** Keep a running `scheduledFrames` total. Each chunk starts at `baseTime + scheduledFrames / 44100`, then `scheduledFrames` increases by the chunk's frame count. Never add up `buffer.duration` floats, which can drift.
   ```javascript
   const startTime = baseTime + scheduledFrames / audioCtx.sampleRate;
   source.start(startTime);
   scheduledFrames += audioBuffer.length;
   ```
4. **Keep the lead topped up:** When the scheduled lead (`baseTime + scheduledFrames / 44100 - audioCtx.currentTime`) falls below about 30 s, request the next chunk. Near the end of a track this carries on into the next track's first sectors, so the next track is already buffered when the current one ends.
5. **Pause/resume:** Use `audioCtx.suspend()` and `audioCtx.resume()`. Scheduled nodes are kept.
6. **Seek/skip:** Stop and discard all scheduled sources, clear the queue, set the sector cursor, reset `baseTime` and `scheduledFrames`, and restart from step 1.
7. **Position:** Derive the current sector from `scheduledFrames` and `audioCtx.currentTime`, not from node state.

Because CD tracks are split precisely on sample boundaries and every chunk is placed by integer frame count, playback across chunks and tracks is gapless without encoder padding issues.

## 5. Implementation Roadmap

### Phase 1: Rust & cd-da-reader Setup
* Initialize the Tauri v2 project.
* Add the `cd-da-reader` crate.
* Write Rust functions to read the TOC and extract raw sectors based on Logical Block Addressing (LBA).
* Create the custom Tauri protocol to serve a sector range as raw PCM (e.g. `cd-track://localhost/track/1?start=0&count=375`), read on a dedicated thread at max drive speed.

### Phase 2: Web Audio Engine
*Done for audio CDs: queued gapless playback, pause/resume, stop, seek, next and clear queue (`CDPlayer`, `WebAudioHandler`). Seek and next are instant inside buffered audio and restart outside it.*
* Build the `CDPlayer` class (`CDPlayer.svelte.ts`, Svelte 5 runes) and `WebAudioHandler`, and initialize the `AudioContext` at 44100 Hz.
* Write the logic to fetch a chunk, convert Int16 to Float32 and fill an `AudioBuffer`.
* Implement the sample-count scheduler with a ~30 s rolling lead, including seek, skip and pause/resume.

### Phase 3: The Visualizer
* Attach an `AnalyserNode` to the Web Audio graph: `source -> analyser -> destination`.
* Configure FFT size (e.g., `analyser.fftSize = 2048`).
* Create a `<canvas>` visualizer polling frequency data (`getByteFrequencyData`) via a `requestAnimationFrame` loop.

### Phase 4: Metadata & Polish
* ~~MusicBrainz DiscID calculation~~ Done, in JS rather than Rust (`crypto.subtle` over the TOC we already have), following "keep it a JS app" ([musicbrainz.md](musicbrainz.md)).
* ~~Fetch album art and tracklists from the MusicBrainz/Cover Art Archive APIs~~ Done in JS: the first matching release's names and highest-quality front cover, cached by disc ID in a Dexie key/value table. `CDPlayer` runs the lookup in its `loadingMetadata` state. Still to do: choosing between several matching releases, and a custom `User-Agent`.
* ~~Optical drive polling~~ Done: the JS `DiscWatcher` polls `get_toc` for insertion/ejection ([disc-watcher.md](disc-watcher.md)). Native OS notifications (DiskArbitration, `WM_DEVICECHANGE`, udev) are not used, to keep this one cross-platform code path.

## 6. Known Issues to Solve

1. **Drive Spin-Up Latency:**
   * *Issue:* Optical drives spin down when idle, and the first read can take 2-4 seconds. Seeks also cost time while the head repositions.
   * *Solution:* Do not pre-fetch whole tracks; at 1x a 4-minute track takes 4 minutes to read. Instead, keep a ~30 s lead of decoded chunks (see section 4) and read at max drive speed so reads run well ahead of real time. The next track's opening sectors are read before the current track ends. Show a loading state on first play and after a seek, since the first chunk can still take a few seconds.
2. **Licensing:**
   * *Issue:* libcdio is GPL, which would constrain how the app can be distributed.
   * *Solution:* Use `cd-da-reader` (MIT), which has no native C dependencies. Check dependency licences (e.g. with `cargo deny`) before release.
3. **Chunk Conversion Cost:**
   * *Issue:* Converting Int16 to Float32 in JS for each 5 s chunk (882,000 bytes) runs on the main thread.
   * *Solution:* It is small enough (about 220k samples per channel) to do inline. If it causes UI jank, move fetch and conversion into a Web Worker and transfer the Float32 arrays.
4. **Memory Footprint:**
   * *Issue:* A full 80-minute disc is about 846 MB as PCM, and about 1.7 GB as Float32.
   * *Solution:* Never hold whole tracks. The rolling ~30 s lead keeps memory at about 10 MB regardless of track length.
5. **Queue Edits After Buffering:**
   * *Issue:* The next track is buffered up to ~30 s ahead, so the queue, skips and seeks have to work on audio that is already scheduled.
   * *Solution:* `WebAudioHandler` keeps each scheduled segment's buffer until it ends. `dropAfter()` stops audio that hasn't started (for `clearQueue()`), and `skipTo()` schedules buffered audio again to play now (for `next()` and `seek()`). Anything not yet buffered restarts and waits for the first chunk. See [cd-player.md](cd-player.md).
