/** The parts of a node-vibrant `Swatch` that we use. Declared here so this file stays pure and testable. */
export interface PaletteSwatch {
  rgb: [number, number, number];
  /** Hue 0–1, saturation 0–1, lightness 0–1. */
  hsl: [number, number, number];
  population: number;
}

export type CoverPalette = Partial<Record<string, PaletteSwatch | null>>;

/** A colour in the form akui themes by: OKLCH hue (degrees) and chroma. */
export interface CoverColour {
  hue: number;
  chroma: number;
}

export interface CoverColours {
  primary: CoverColour;
  /** A visibly different second colour, or `null` when the cover is essentially one colour. */
  secondary: CoverColour | null;
}

/** Below this HSL saturation a swatch is grey, and tinting the whole UI with it would look like a mistake. */
const MIN_SATURATION = 0.2;
/** akui's accent is a flat colour, so very faint or very loud chroma looks washed out or garish. */
const CHROMA_RANGE = { min: 0.09, max: 0.22 };
/** The secondary colour must differ in hue by at least this much, or it adds nothing. */
const MIN_HUE_SEPARATION_DEGREES = 40;

/** Vibrant first: it is the most saturated, which reads best as an accent. Muted swatches are the fallback. */
const PRIMARY_PREFERENCE = ["Vibrant", "DarkVibrant", "LightVibrant", "Muted", "DarkMuted", "LightMuted"];

const toLinear = (channel: number) => {
  const unit = channel / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

/** sRGB (0–255) to OKLCH hue in degrees and chroma, using Björn Ottosson's OKLab matrices. */
export function rgbToOklch([red, green, blue]: [number, number, number]): CoverColour {
  const [r, g, b] = [red, green, blue].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const hue = (Math.atan2(bAxis, a) * 180) / Math.PI;
  return { hue: (hue + 360) % 360, chroma: Math.hypot(a, bAxis) };
}

const isCoverColour = (value: unknown): value is CoverColour => {
  const { hue, chroma } = (value ?? {}) as Partial<CoverColour>;
  return Number.isFinite(hue) && Number.isFinite(chroma);
};

/** Checks saved or received data, so a hand-edited settings file can't put junk into the theme. */
export const isCoverColours = (value: unknown): value is CoverColours => {
  const { primary, secondary } = (value ?? {}) as Partial<CoverColours>;
  return isCoverColour(primary) && (secondary === null || isCoverColour(secondary));
};

const hueDistance =(first: number, second: number) => {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
};

const toCoverColour = ({ rgb }: PaletteSwatch): CoverColour => {
  const { hue, chroma } = rgbToOklch(rgb);
  return { hue, chroma: Math.min(CHROMA_RANGE.max, Math.max(CHROMA_RANGE.min, chroma)) };
};

/**
 * Picks one or two theme colours from a node-vibrant palette.
 * Returns `null` for greyscale or empty palettes so the app keeps its normal theme.
 */
export function pickCoverColours(palette: CoverPalette): CoverColours | null {
  const colourful = PRIMARY_PREFERENCE.map((name) => palette[name]).filter(
    (swatch): swatch is PaletteSwatch => Boolean(swatch) && swatch!.hsl[1] >= MIN_SATURATION,
  );
  const [primarySwatch, ...others] = colourful;
  if (!primarySwatch) return null;

  const primary = toCoverColour(primarySwatch);
  // The most common colour that is not just a shade of the primary.
  const secondarySwatch = others
    .filter((swatch) => hueDistance(toCoverColour(swatch).hue, primary.hue) >= MIN_HUE_SEPARATION_DEGREES)
    .sort((first, second) => second.population - first.population)[0];

  return { primary, secondary: secondarySwatch ? toCoverColour(secondarySwatch) : null };
}
