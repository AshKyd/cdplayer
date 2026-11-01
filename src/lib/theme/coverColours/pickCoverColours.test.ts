import { describe, expect, it } from "vitest";
import { pickCoverColours, rgbToOklch, type PaletteSwatch } from "./pickCoverColours";

const swatch = (rgb: [number, number, number], saturation: number, population = 100): PaletteSwatch => ({
  rgb,
  hsl: [0, saturation, 0.5],
  population,
});

describe("rgbToOklch", () => {
  it("puts pure red near hue 29° and pure blue near 264°", () => {
    expect(rgbToOklch([255, 0, 0]).hue).toBeCloseTo(29.2, 0);
    expect(rgbToOklch([0, 0, 255]).hue).toBeCloseTo(264.1, 0);
  });

  it("gives greys no chroma", () => {
    expect(rgbToOklch([128, 128, 128]).chroma).toBeLessThan(0.001);
  });
});

describe("pickCoverColours", () => {
  it("returns null for an empty palette", () => {
    expect(pickCoverColours({})).toBeNull();
  });

  it("returns null when every swatch is grey", () => {
    expect(pickCoverColours({ Vibrant: swatch([120, 120, 120], 0.02), Muted: swatch([60, 60, 60], 0.05) })).toBeNull();
  });

  it("prefers Vibrant as the primary and skips missing swatches", () => {
    const result = pickCoverColours({
      Vibrant: null,
      DarkVibrant: swatch([200, 30, 30], 0.7),
      Muted: swatch([30, 30, 200], 0.6),
    });
    expect(result?.primary.hue).toBeCloseTo(rgbToOklch([200, 30, 30]).hue);
  });

  it("picks a second colour only when its hue is clearly different", () => {
    const sameHue = pickCoverColours({
      Vibrant: swatch([220, 40, 40], 0.7),
      DarkVibrant: swatch([140, 20, 20], 0.7),
    });
    expect(sameHue?.secondary).toBeNull();

    const differentHue = pickCoverColours({
      Vibrant: swatch([220, 40, 40], 0.7),
      Muted: swatch([40, 60, 220], 0.6),
    });
    expect(differentHue?.secondary?.hue).toBeCloseTo(rgbToOklch([40, 60, 220]).hue);
  });

  it("clamps chroma into a range that suits an accent", () => {
    const result = pickCoverColours({ Vibrant: swatch([255, 0, 0], 1) });
    expect(result?.primary.chroma).toBeLessThanOrEqual(0.22);
    expect(result?.primary.chroma).toBeGreaterThanOrEqual(0.09);
  });
});
