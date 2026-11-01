import { describe, expect, it } from "vitest";
import type { Track } from "$lib/disc/types";
import {
  chunkUrl,
  currentSpanIndex,
  nextChunkSectorCount,
  startSectorForTime,
  type TrackSpan,
} from "./chunks";

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

describe("currentSpanIndex", () => {
  const spans: TrackSpan[] = [
    { trackNumber: 1, startSeconds: 0, offsetSeconds: 60 },
    { trackNumber: 2, startSeconds: 30, offsetSeconds: 0 },
    { trackNumber: 3, startSeconds: 100, offsetSeconds: 0 },
  ];

  it("finds the span containing the time", () => {
    expect(currentSpanIndex(spans, 10)).toBe(0);
    expect(currentSpanIndex(spans, 50)).toBe(1);
  });

  it("switches exactly on a boundary", () => {
    expect(currentSpanIndex(spans, 29.999)).toBe(0);
    expect(currentSpanIndex(spans, 30)).toBe(1);
  });

  it("stays on the last span past the end, and on the first when empty or before it", () => {
    expect(currentSpanIndex(spans, 9999)).toBe(2);
    expect(currentSpanIndex(spans, -1)).toBe(0);
    expect(currentSpanIndex([], 5)).toBe(0);
  });
});

describe("chunkUrl", () => {
  it("builds the cd-track URL", () => {
    expect(chunkUrl(2, 75, 375)).toBe("cd-track://localhost/track/2?start=75&count=375");
  });
});
