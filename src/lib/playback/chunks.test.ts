import { describe, expect, it } from "vitest";
import type { Track } from "$lib/disc/types";
import { chunkUrl, nextChunkSectorCount, startSectorForTime } from "./chunks";

/** 1000 sectors, about 13.3 s. */
const track: Track = { number: 2, first_sector: 500, last_sector: 1499, is_audio: true };

describe("startSectorForTime", () => {
  it("converts seconds to track-relative sectors", () => {
    expect(startSectorForTime(track, 2)).toBe(150);
  });

  it("clamps to the track", () => {
    expect(startSectorForTime(track, -5)).toBe(0);
    expect(startSectorForTime(track, 9999)).toBe(999);
  });
});

describe("nextChunkSectorCount", () => {
  it("starts short, then uses full chunks", () => {
    expect(nextChunkSectorCount(track, 0, true)).toBe(75);
    expect(nextChunkSectorCount(track, 75, false)).toBe(375);
  });

  it("stops at the track end", () => {
    expect(nextChunkSectorCount(track, 900, false)).toBe(100);
  });
});

describe("chunkUrl", () => {
  it("builds the cd-track URL", () => {
    expect(chunkUrl(2, 75, 375)).toBe("cd-track://localhost/track/2?start=75&count=375");
  });
});
