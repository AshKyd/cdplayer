/**
 * The presets on offer, in the order shown. "Relative dimensions" is ours (see `customPresets/`); the rest are keys
 * in the `butterchurn-presets` base pack, spelt exactly as there. This module holds only names, not the (large)
 * preset data, so it is safe to import anywhere.
 */
export const PRESET_NAMES = [
  "Relative dimensions",
  "Martin - acid wiring",
  "Halfbreak - Light of Breakers",
  "Geiss - Cauldron - painterly 2 (saturation remix)",
  "martin - bombyx mori",
  "martin - chain breaker",
  "martin - frosty caves 2",
  "ORB - Waaa",
  "Rovastar + Loadus + Geiss - FractalDrop (Triple Mix)",
  "yin - 393 - Artificial Inspiration (music driven - outward)",
] as const;

/** A visualiser is one of the `PRESET_NAMES`, or `"random"`. */
export type VisualiserId = string;

/** Plays a random preset and switches to another every `RANDOM_PRESET_SECONDS`. */
export const RANDOM_VISUALISER_ID = "random";

export const RANDOM_PRESET_SECONDS = 30;

export const DEFAULT_VISUALISER_ID: VisualiserId = "Geiss - Cauldron - painterly 2 (saturation remix)";

/** A saved choice that is no longer on offer is not valid, so settings fall back to the default. */
export const isVisualiserId = (value: unknown): value is VisualiserId =>
  value === RANDOM_VISUALISER_ID || PRESET_NAMES.some((name) => name === value);
