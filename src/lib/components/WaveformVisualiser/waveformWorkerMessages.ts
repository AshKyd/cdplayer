/** Messages the page sends to the waveform worker, which owns the canvas. */
export type WaveformWorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas }
  /** Canvas size in device pixels, plus the ratio so line widths stay the same on retina screens. */
  | { type: "resize"; width: number; height: number; pixelRatio: number }
  /** One animation frame. `samples` is null when nothing is sounding, so the worker only fades the trail. */
  | { type: "frame"; samples: Uint8Array<ArrayBuffer> | null; colour: string };
