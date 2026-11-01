import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { copyfitScale } from "./copyfitScale";

describe("copyfitScale", () => {
  it("leaves text that already fits at full size", () => {
    assert.equal(copyfitScale(300, 200, 0.5), 1);
    assert.equal(copyfitScale(200, 200, 0.5), 1);
  });

  it("shrinks text in proportion to the missing width", () => {
    assert.equal(copyfitScale(150, 200, 0.5), 0.75);
  });

  it("stops shrinking at the minimum", () => {
    assert.equal(copyfitScale(50, 200, 0.5), 0.5);
  });

  it("ignores empty text", () => {
    assert.equal(copyfitScale(100, 0, 0.5), 1);
  });
});
