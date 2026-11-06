# Visualisers

[butterchurn](https://github.com/jberg/butterchurn) (MilkDrop in WebGL2) draws the backdrop. The user picks one preset from a short list (`PRESET_NAMES`), or "Random".

## Files

- `src/lib/components/Visualiser/Visualiser.svelte`: creates the butterchurn renderer on its canvas, feeds it samples at 30 fps, loads the chosen preset.
- `src/lib/visualisers/visualiserCatalogue.ts`: `PRESET_NAMES` (the presets on offer, in order), `RANDOM_VISUALISER_ID`, `DEFAULT_VISUALISER_ID`, `isVisualiserId()`. Names only, so it is safe to import anywhere. A saved choice that is not in the list falls back to the default.
- `src/lib/visualisers/butterchurnPresets.ts`: `listPresetNames()` (just `PRESET_NAMES`, no pack load) and `loadButterchurnPreset(name)`, which returns one of ours or imports `butterchurn-presets` (the large base pack) on first use.
- `src/lib/visualisers/customPresets/`: presets written for this app (`CUSTOM_PRESETS`, by display name). Each preset has its own folder; `unusedParts.ts` holds the switched-off shapes and waves they share. `relativeDimensions/` is "Relative dimensions" (`frameEquations.ts`, `pathEquations.ts`, `warpShader.ts`, assembled in `relativeDimensions.ts`). Sizes are relative to the longer canvas side, and `q7` / `q8` keep shapes round on any canvas size. Emitter A is 192 shape instances along a path that eases between spiral, circle and star while rotating; emitter B is two rings of evenly spaced emitters that follow the treble drawn in the `warp` shader (see below). Hues are complementary and cycle the rainbow every 20 s, drawn into a zooming, twisting feedback loop.
- `src/lib/visualisers/presetTweaks.ts`: `PRESET_TWEAKS`, literal text edits to individual presets (for example to tame one that is too bright), applied to a copy when the preset loads. An edit that no longer matches logs a warning.
- `src/lib/visualisers/butterchurn.d.ts`: types for the two packages, which ship none.

## Behaviour

- Runs on the main thread. butterchurn needs `window`, `document` and WebGL2, so it cannot run in a worker.
- Each frame the page reads the `AnalyserNode` bytes (`readWaveform`) and passes them to `render({ audioLevels })`, the same samples for both channels. `readWaveform` delays them by the output latency, so the picture matches Bluetooth speakers (see `web-audio-handler.md`). When not playing it passes silence (128), so the preset settles.
- butterchurn is given an `OfflineAudioContext` only for its sample rate (44.1 kHz).
- Changing preset blends over 1.5 s. Settings re-create the component (`{#key}`) anyway.
- No track title is drawn over the picture.
- The canvas is opaque: the visualiser fully covers the backdrop.
- Resolution: the canvas is drawn in device pixels, but one with more than 1.5 million pixels (`FULL_RESOLUTION_MAX_PIXELS`) is drawn at half size each way (`BIG_CANVAS_SCALE`, a quarter of the pixels), and never at more than 1920 x 1080 worth of pixels (`MAX_RENDER_PIXELS`). The browser stretches it to fit. A small window is drawn 1:1.
- Resizing: size changes are debounced by 120 ms (`RESIZE_SETTLE_MS`). Fullscreen and dragging the window edge fire a resize every frame, and each real resize reallocates butterchurn's textures and blanks the canvas. In between, the old picture is stretched. After a resize a frame is drawn at once so the canvas is never blank.
- macOS title bar: the main window has `titleBarStyle: "Overlay"` and `hiddenTitle` in `tauri.conf.json`, so the canvas fills the whole window, under the traffic lights. `+page.svelte` makes `main` a `data-tauri-drag-region` (needs `core:window:allow-start-dragging`), so any bare part of the visualiser drags the window, and pads `main` to clear the buttons. Both are macOS only (`navigator.userAgent`); other platforms keep the native title bar.

## Adding a visualiser

Add the name to `PRESET_NAMES`. For a pack preset, spell it exactly as the pack does (`presetNames.test.ts` checks against the real pack). For one of ours, also export a preset object from its own folder in `customPresets/` and add it to `CUSTOM_PRESETS`.

## Relative dimensions: the emitter rings in the warp shader

- Butterchurn has no GPU instancing: each shape instance costs a wasm call and about 12 GL calls. Hundreds of particles as shapes were too slow, so the emitters are drawn by the `warp` shader, which runs in the feedback pass (so they get the zoom, twist and fade, the same as the main shape).
- Butterchurn only gives a preset three bands: bass (20 to 320 Hz), mid (320 Hz to 2.8 kHz) and treb (2.8 to 11 kHz), each relative to the track's own long-term average. The main shape uses bass (the kick). Both rings follow the treble: `q9` is the treble level above average, eased, times the sound level (`q6`). With no drive nothing is drawn. Each emitter also flickers on its own, eight times a second, like a cymbal wash.
- Two rings: the outer has 24 emitters and turns steadily counterclockwise on screen, so its dots trace lines. The inner has 16 and jumps to a new random angle twenty times a second, so its dots land all round and the zoom spreads each into a star-like burst. Their distance from the centre swings on a sine wave (outer, 0.34 +- 0.06) and a cosine wave (inner, 0.20 +- 0.05), so the emitters wander in and out as they turn.
- An emitter emits one point at a time: a dot (radius 0.0075 of the screen height) where it is now, every frame. The feedback zoom and twist carry the earlier dots outward, which makes the trail. Nothing depends on earlier frames inside the shader, so there is no state.
- The emitters of a ring are identical, turned by whole sectors, so the shader turns each pixel back into the nearest emitter's sector and measures from that one.
- `q7`/`q8` (longer side over `pixelsx`/`pixelsy`, not `aspectx`/`aspecty`, which butterchurn leaves stale after a resize) make offsets from the centre round on screen, in units of the longer side. Dot radii use the same unit. The shader relies on that for the rotation.
- Tried and removed: a mids row (lit nearly all the time), and streams of 16 particles in flight per emitter.
- GLSL is not compiled by the tests. Check it in Storybook (the console shows compile errors).

## Frame rate

`Visualiser.svelte` logs `visualiserFps` and `renderMs` (CPU time in `render()`) every 5 s. A slow GPU shows as low fps with low `renderMs`. The textures are `width * pixelRatio` and the component already passes device pixels, so `pixelRatio` is 1.

## Limits

- Only presets from the base pack (by exact name) and `CUSTOM_PRESETS`. The other packs are not loaded.
- Album art is not used.
- Mono analyser, so no stereo effects.
