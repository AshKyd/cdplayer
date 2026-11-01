import type { VisualiserFactory } from "./types";
import type { VisualiserId } from "./visualiserCatalogue";

/**
 * Where each visualiser's code is. Loaded on demand, so only the chosen one is fetched.
 * To add a visualiser: write a module that default-exports a `VisualiserFactory`, then add it here
 * and to `VISUALISERS` in `visualiserCatalogue.ts`.
 */
export const VISUALISER_LOADERS = {
  waveform: () => import("./waveform/waveformVisualiser"),
  rings: () => import("./rings/ringsVisualiser"),
} satisfies Record<VisualiserId, () => Promise<{ default: VisualiserFactory }>>;
