import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { waveformPoints } from "./waveformPoints";

describe("waveformPoints", () => {
  it("puts silence on the centre line, spread across the width", () => {
    const points = waveformPoints(new Uint8Array([128, 128, 128]), 100, 40);
    assert.deepEqual(points, [
      [0, 20],
      [50, 20],
      [100, 20],
    ]);
  });

  it("maps the extremes to the top and bottom edges", () => {
    const [, top, bottom] = waveformPoints(new Uint8Array([128, 255, 0]), 10, 40);
    assert.ok(top[1] < 0.5);
    assert.equal(bottom[1], 40);
  });

  it("returns nothing for fewer than two samples", () => {
    assert.deepEqual(waveformPoints(new Uint8Array([128]), 100, 40), []);
  });
});
