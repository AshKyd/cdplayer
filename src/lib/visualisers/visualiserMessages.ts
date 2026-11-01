import type { VisualiserAlbumInfo, VisualiserFrame, VisualiserSize, VisualiserTrackInfo } from "./types";
import type { VisualiserId } from "./visualiserCatalogue";

/** Messages the page sends to the visualiser worker, which owns the canvas. They are handled in the order sent. */
export type VisualiserWorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas; visualiserId: VisualiserId }
  | ({ type: "resize" } & VisualiserSize)
  | { type: "track"; track: VisualiserTrackInfo | null }
  | { type: "album"; album: VisualiserAlbumInfo | null }
  | ({ type: "frame" } & VisualiserFrame);
