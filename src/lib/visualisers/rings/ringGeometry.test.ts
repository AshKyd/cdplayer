import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { rainbowColour, ringPoints } from "./ringGeometry";

describe("ringPoints", () => {
  const centre = { x: 100, y: 50 };

  it("puts silence on a circle of the base radius", () => {
    const points = ringPoints(new Uint8Array(4).fill(128), centre, 10, 5);
    points.forEach(([x, y]) => assert.ok(Math.abs(Math.hypot(x - centre.x, y - centre.y) - 10) < 1e-9));
  });

  it("starts at the right of the centre and goes round", () => {
    const [first, second] = ringPoints(new Uint8Array(4).fill(128), centre, 10, 5);
    assert.deepEqual(first.map(Math.round), [110, 50]);
    assert.deepEqual(second.map(Math.round), [100, 60]);
  });

  it("moves loud samples outward and quiet ones inward by the swing", () => {
    const [loud, quiet] = ringPoints(Uint8Array.from([255, 0]), centre, 10, 5);
    assert.ok(Math.hypot(loud[0] - centre.x, loud[1] - centre.y) > 14);
    assert.ok(Math.hypot(quiet[0] - centre.x, quiet[1] - centre.y) < 6);
  });
});

describe("rainbowColour", () => {
  it("starts at red and moves on with time", () => {
    assert.match(rainbowColour(0), /^hsl\(0 /);
    assert.notEqual(rainbowColour(1000), rainbowColour(0));
  });

  it("wraps after a full turn", () => {
    assert.equal(rainbowColour(7200), rainbowColour(0));
  });
});
