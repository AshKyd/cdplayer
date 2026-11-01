import { describe, expect, it } from "vitest";
import { tocFingerprint } from "./tocFingerprint";
import type { Toc } from "./types";

const toc: Toc = {
  tracks: [
    { number: 1, first_sector: 0, last_sector: 999, is_audio: true },
    { number: 2, first_sector: 1000, last_sector: 1099, is_audio: true },
  ],
  leadout_sector: 1100,
};

describe("tocFingerprint", () => {
  it("is the same for the same disc read twice", () => {
    expect(tocFingerprint(structuredClone(toc))).toBe(tocFingerprint(toc));
  });

  it("differs when a track boundary, the lead-out or a track type changes", () => {
    const base = tocFingerprint(toc);
    expect(tocFingerprint({ ...toc, leadout_sector: 1200 })).not.toBe(base);
    expect(tocFingerprint({ ...toc, tracks: [toc.tracks[0]] })).not.toBe(base);
    expect(
      tocFingerprint({ ...toc, tracks: [toc.tracks[0], { ...toc.tracks[1], is_audio: false }] }),
    ).not.toBe(base);
  });

  it("has its own value for no disc", () => {
    expect(tocFingerprint(null)).not.toBe(tocFingerprint(toc));
    expect(tocFingerprint(null)).toBe(tocFingerprint(null));
  });
});
