/**
 * The visualisers the user can choose from. This list is safe to import anywhere (settings, the page);
 * the code that draws each one is loaded by `visualiserLoaders.ts` inside the worker.
 */
export const VISUALISERS = [
  { id: "waveform", label: "Waveform", description: "A glowing line of the sound, fading as it ages." },
  { id: "rings", label: "Rainbow tunnel", description: "Rings of sound in changing colours, flying toward you." },
] as const;

export type VisualiserId = (typeof VISUALISERS)[number]["id"];

export const DEFAULT_VISUALISER_ID: VisualiserId = "waveform";

export const isVisualiserId = (value: unknown): value is VisualiserId =>
  VISUALISERS.some(({ id }) => id === value);
