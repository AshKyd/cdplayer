import { describe, expect, it } from "vitest";
import { int16InterleavedToChannels } from "./pcm";

describe("int16InterleavedToChannels", () => {
  it("de-interleaves and scales by 32768", () => {
    const pcm = new Int16Array([-32768, 16384, 0, -16384]).buffer;
    const [left, right] = int16InterleavedToChannels(pcm);
    expect([...left]).toEqual([-1, 0]);
    expect([...right]).toEqual([0.5, -0.5]);
  });

  it("drops a trailing partial frame", () => {
    const [left, right] = int16InterleavedToChannels(new Int16Array([1, 2, 3]).buffer);
    expect(left.length).toBe(1);
    expect(right.length).toBe(1);
  });

  it("returns empty channels for empty input", () => {
    const [left] = int16InterleavedToChannels(new ArrayBuffer(0));
    expect(left.length).toBe(0);
  });
});
