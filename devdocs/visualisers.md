# Visualisers

Canvas animations behind the player. Each one runs in a worker on an `OffscreenCanvas`.

## Files

- `src/lib/components/Visualiser/Visualiser.svelte`: creates the worker, transfers the canvas, sends data.
- `src/lib/visualisers/types.ts`: the `Visualiser` interface and its data types.
- `src/lib/visualisers/visualiserCatalogue.ts`: `VISUALISERS` (id, label, description), `VisualiserId`, `isVisualiserId()`. Safe to import anywhere.
- `src/lib/visualisers/visualiserLoaders.ts`: `VISUALISER_LOADERS`, a dynamic import per id.
- `src/lib/visualisers/visualiser.worker.ts`: loads the chosen visualiser, passes messages to it, logs the framerate every 5 s.
- `src/lib/visualisers/visualiserMessages.ts`: page-to-worker message types.
- `src/lib/visualisers/loadCoverBitmap.ts`: fetches a cover URL as an `ImageBitmap`.
- `src/lib/visualisers/waveform/`: the `waveform` visualiser (`waveformVisualiser.ts`, `waveformPoints.ts`).
- `src/lib/visualisers/rings/`: the `rings` visualiser (`ringsVisualiser.ts`, `ringGeometry.ts`).

## API

A visualiser module default-exports a `VisualiserFactory`: `(canvas: OffscreenCanvas) => Visualiser`.

`Visualiser` methods, called in order:

- `resize({ width, height, pixelRatio })`: canvas size in device pixels.
- `setTrack(track | null)`: `number`, `title`, `artist`, `durationSeconds`.
- `setAlbum(album | null)`: `title`, `artist`, `year`, `cover` (`ImageBitmap | null`). The visualiser owns `cover`; call `close()` if it is not kept.
- `renderFrame({ samples, accentColour, timeMs })`: `samples` are analyser bytes (128 = silence), or `null` when not playing.

## Behaviour

- On load the page sends `resize`, `setTrack`, `setAlbum` (text first, then again with the decoded cover), then frames. `setTrack` and `setAlbum` are sent again when they change.
- The `AnalyserNode` only exists on the main thread, so the page reads samples and posts them. Frames are sent at 30 fps, also while paused (with `samples: null`) so trails can fade.
- Messages that arrive while the visualiser module is loading wait for it and keep their order.
- Choosing another visualiser in settings re-creates the component (`{#key}`), so it gets a new canvas and worker.

## Adding a visualiser

1. Write a module that default-exports a `VisualiserFactory`.
2. Add it to `VISUALISER_LOADERS`.
3. Add it to `VISUALISERS`.

## Visualisers

- `waveform`: one line across the window in the accent colour. Each frame erases 28% of the previous one, so old lines fade.
- `rings`: each frame the previous frame is enlarged 5% about the centre and repainted at 92% opacity, then a ring is drawn in the middle. Angle is the sample index, radius is the amplitude. The colour cycles through the rainbow at 50° of hue per second.

## Limits

- Neither visualiser uses the track or album yet.
- Adding a visualiser outside the repo (a true plugin) is not supported: the loaders are a fixed list.
