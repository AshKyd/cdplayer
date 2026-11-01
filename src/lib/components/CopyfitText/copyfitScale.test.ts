import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { copyfitScale } from "./copyfitScale";

describe("copyfitScale", () => {
  it("leaves text that already fits at full size", () => {
    assert.equal(copyfitScale(() => true, 0.5), 1);
  });

  it("returns the largest scale that fits", () => {
    assert.equal(copyfitScale((scale) => scale <= 0.75, 0.5), 0.75);
  });

  it("stops shrinking at the minimum", () => {
    assert.equal(copyfitScale(() => false, 0.5), 0.5);
  });
});
