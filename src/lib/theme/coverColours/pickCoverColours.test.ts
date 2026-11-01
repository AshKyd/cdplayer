import { describe, expect, it } from "vitest";
import { pickCoverColours, rgbToOklch, type PaletteSwatch } from "./pickCoverColours";

/** A cluster of `population` pixels of the given colour; saturation and lightness are set to describe it. */
const swatch = (
  rgb: [number, number, number],
  population: number,
  saturation = 0.7,
  lightness = 0.5,
): PaletteSwatch => ({ rgb, hsl: [0, saturation, lightness], population });

const BLUE: [number, number, number] = [60, 70, 210];
const ORANGE: [number, number, number] = [240, 130, 30];
const RED: [number, number, number] = [220, 40, 40];
const DARK_RED: [number, number, number] = [150, 25, 25];
const GREY: [number, number, number] = [200, 200, 200];

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
  it("returns null with no swatches", () => {
    expect(pickCoverColours([])).toBeNull();
  });

  it("returns null when every swatch is grey, black or white", () => {
    expect(
      pickCoverColours([swatch(GREY, 900, 0.02), swatch([5, 5, 5], 500, 0.9, 0.02), swatch([250, 250, 250], 500, 0.9, 0.97)]),
    ).toBeNull();
  });

  it("picks the large blue area over a small, more saturated orange one", () => {
    const result = pickCoverColours([swatch(GREY, 5000, 0.03), swatch(BLUE, 1200, 0.6), swatch(ORANGE, 80, 0.9)]);
    expect(result?.primary.hue).toBeCloseTo(rgbToOklch(BLUE).hue);
  });

  it("merges shades of one hue, so they outweigh a single bigger cluster of another", () => {
    const result = pickCoverColours([
      swatch(RED, 400),
      swatch(DARK_RED, 400),
      swatch([230, 60, 50], 300),
      swatch(BLUE, 600),
    ]);
    expect(Math.abs(result!.primary.hue - rgbToOklch(RED).hue)).toBeLessThan(15);
  });

  it("offers a second colour only when it is a different hue and big enough", () => {
    const similar = pickCoverColours([swatch(RED, 1000), swatch(DARK_RED, 900)]);
    expect(similar?.secondary).toBeNull();

    const tiny = pickCoverColours([swatch(BLUE, 1000), swatch(ORANGE, 100)]);
    expect(tiny?.secondary).toBeNull();

    const real = pickCoverColours([swatch(BLUE, 1000), swatch(ORANGE, 700)]);
    expect(real?.secondary?.hue).toBeCloseTo(rgbToOklch(ORANGE).hue);
  });

  it("clamps chroma into a range that suits an accent", () => {
    const result = pickCoverColours([swatch([255, 0, 0], 100, 1)]);
    expect(result?.primary.chroma).toBeLessThanOrEqual(0.22);
    expect(result?.primary.chroma).toBeGreaterThanOrEqual(0.09);
  });
});
