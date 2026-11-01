/** The track that is playing (or ready to play). */
export interface VisualiserTrackInfo {
  /** Track number on the disc. */
  number: number | null;
  title: string;
  artist: string;
  durationSeconds: number;
}

/** The disc's album, with its cover already decoded so a visualiser can draw it straight away. */
export interface VisualiserAlbumInfo {
  title: string;
  artist: string;
  /** Release year, or empty if unknown. */
  year: string;
  /** The front cover, or `null` when there is none (or it hasn't loaded yet). */
  cover: ImageBitmap | null;
}

/** Canvas size in device pixels. */
export interface VisualiserSize {
  width: number;
  height: number;
  /** Device pixel ratio, so line widths look the same on retina screens. */
  pixelRatio: number;
}

/** One animation frame of audio. */
export interface VisualiserFrame {
  /** Latest output samples as unsigned bytes (128 = silence); `null` when nothing is sounding. */
  samples: Uint8Array<ArrayBuffer> | null;
  /** The theme's accent colour, as a CSS colour string. */
  accentColour: string;
  /** Milliseconds on the page's animation clock, for anything that moves with time. */
  timeMs: number;
}

/**
 * A visualiser draws onto the canvas it was created with, inside a worker. The host calls these in order:
 * `resize`, `setTrack` and `setAlbum` once on load (and again whenever they change), then `renderFrame`
 * for every frame. Frames keep coming while paused, with `samples: null`, so trails can fade out.
 */
export interface Visualiser {
  resize(size: VisualiserSize): void;
  /** `null` when there is no disc. */
  setTrack(track: VisualiserTrackInfo | null): void;
  /** `null` when there is no disc. The visualiser owns `cover` and may keep it. */
  setAlbum(album: VisualiserAlbumInfo | null): void;
  renderFrame(frame: VisualiserFrame): void;
}

/** Makes a visualiser that draws onto `canvas`. Each visualiser module default-exports one. */
export type VisualiserFactory = (canvas: OffscreenCanvas) => Visualiser;
