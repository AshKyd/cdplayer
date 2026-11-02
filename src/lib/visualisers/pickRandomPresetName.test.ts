import { describe, expect, it } from "vitest";
import { pickRandomPresetName } from "./pickRandomPresetName";

describe("pickRandomPresetName", () => {
  it("never repeats the previous name when there is another", () => {
    const names = ["a", "b", "c"];
    [0, 0.34, 0.67, 0.99].forEach((roll) => expect(pickRandomPresetName(names, "b", () => roll)).not.toBe("b"));
  });

  it("repeats the only name, and returns null for none", () => {
    expect(pickRandomPresetName(["a"], "a")).toBe("a");
    expect(pickRandomPresetName([])).toBeNull();
  });
});
