/** The parts of a node-vibrant `Swatch` that we use. Declared here so this file stays pure and testable. */
export interface PaletteSwatch {
  rgb: [number, number, number];
  /** Hue 0–1, saturation 0–1, lightness 0–1. */
  hsl: [number, number, number];
  /** How many sampled pixels fall in this colour cluster. */
  population: number;
}

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
const MIN_SATURATION = 0.25;
/** Near-black and near-white clusters carry no usable hue, whatever their saturation says. */
const LIGHTNESS_RANGE = { min: 0.12, max: 0.88 };
/** akui's accent is a flat colour, so very faint or very loud chroma looks washed out or garish. */
const CHROMA_RANGE = { min: 0.09, max: 0.22 };
/** The secondary colour must differ in hue by at least this much, or it adds nothing. */
const MIN_HUE_SEPARATION_DEGREES = 40;
/** A secondary colour must cover at least this share of the primary's weight, so a small accent isn't promoted. */
const MIN_SECONDARY_WEIGHT_SHARE = 0.4;
/** Shades of one colour are merged into hue bands this wide, so a big blue area isn't split into rival clusters. */
const HUE_BAND_DEGREES = 30;

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

const hueDistance = (first: number, second: number) => {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
};

const clampChroma = ({ hue, chroma }: CoverColour): CoverColour => ({
  hue,
  chroma: Math.min(CHROMA_RANGE.max, Math.max(CHROMA_RANGE.min, chroma)),
});

interface HueBand {
  /** Population × saturation of every swatch in the band. Big, vivid areas outweigh small ones. */
  weight: number;
  /** The most common swatch in the band, which stands for the band's colour. */
  representative: PaletteSwatch;
}

/**
 * Picks one or two theme colours from node-vibrant's raw colour clusters.
 *
 * We don't use Vibrant's named swatches (Vibrant, Muted…). Each name holds the single most saturated colour for its
 * lightness, regardless of area, so a small orange hand beats a large blue object. Instead, similar hues are merged
 * and ranked by area × saturation, so the colour that dominates the cover wins.
 *
 * Returns `null` for greyscale covers, so the app keeps its normal theme.
 */
export function pickCoverColours(swatches: PaletteSwatch[]): CoverColours | null {
  const bands = swatches
    .filter(({ hsl: [, saturation, lightness] }) => {
      return saturation >= MIN_SATURATION && lightness >= LIGHTNESS_RANGE.min && lightness <= LIGHTNESS_RANGE.max;
    })
    .reduce((bandsByIndex, swatch) => {
      const band = Math.floor(rgbToOklch(swatch.rgb).hue / HUE_BAND_DEGREES);
      const existing = bandsByIndex.get(band);
      const weight = (existing?.weight ?? 0) + swatch.population * swatch.hsl[1];
      const representative =
        existing && existing.representative.population >= swatch.population ? existing.representative : swatch;
      return bandsByIndex.set(band, { weight, representative });
    }, new Map<number, HueBand>());

  const [strongest, ...rest] = [...bands.values()].sort((first, second) => second.weight - first.weight);
  if (!strongest) return null;

  const primary = clampChroma(rgbToOklch(strongest.representative.rgb));
  const secondaryBand = rest.find(
    ({ weight, representative }) =>
      weight >= strongest.weight * MIN_SECONDARY_WEIGHT_SHARE &&
      hueDistance(rgbToOklch(representative.rgb).hue, primary.hue) >= MIN_HUE_SEPARATION_DEGREES,
  );

  return { primary, secondary: secondaryBand ? clampChroma(rgbToOklch(secondaryBand.representative.rgb)) : null };
}
