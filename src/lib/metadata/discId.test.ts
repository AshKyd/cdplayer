import { describe, expect, it } from "vitest";
import type { Toc, Track } from "$lib/disc/types";
import { computeDiscId, discIdInput } from "./discId";

/**
 * Builds a TOC from MusicBrainz-style frame offsets (LBA + 150): track 1 first, then the lead-out.
 * Each track ends where the next begins.
 */
const tocFromOffsets = (offsets: number[], leadOut: number): Toc => {
  const tracks: Track[] = offsets.map((offset, index) => ({
    number: index + 1,
    first_sector: offset - 150,
    last_sector: (offsets[index + 1] ?? leadOut) - 150 - 1,
    is_audio: true,
  }));
  return { tracks, leadout_sector: leadOut - 150 };
};

describe("computeDiscId", () => {
  // Published examples, so these check the whole calculation, not just our reading of it.
  it("matches the example on MusicBrainz's Disc ID Calculation page", async () => {
    const toc = tocFromOffsets([150, 15363, 32314, 46592, 63414, 80489], 95462);
    expect(await computeDiscId(toc)).toBe("49HHV7Eb8UKF3aQiNmu1GR8vKTY-");
  });

  it("matches the example in python-discid's documentation", async () => {
    const offsets = [150, 17510, 33275, 45910, 57805, 78310, 94650, 109580, 132010, 149160, 165115, 177710, 203325, 215555, 235590];
    expect(await computeDiscId(tocFromOffsets(offsets, 258725))).toBe("TqvKjMu7dMliSfmVEBtrL7sBSno-");
  });

  it("is 28 characters from the MusicBrainz alphabet", async () => {
    const id = await computeDiscId(tocFromOffsets([150, 20000, 40000], 60000));
    expect(id).toMatch(/^[A-Za-z0-9._-]{28}$/);
  });

  it("is null for a disc with no audio tracks", async () => {
    const toc: Toc = { tracks: [{ number: 1, first_sector: 0, last_sector: 99, is_audio: false }], leadout_sector: 100 };
    expect(await computeDiscId(toc)).toBeNull();
  });
});

describe("discIdInput", () => {
  it("starts with the first and last track and the lead-out, then 100 slots in all", () => {
    const input = discIdInput(tocFromOffsets([150, 15363, 32314, 46592, 63414, 80489], 95462))!;
    expect(input.startsWith("0106000174E60000009600003C03")).toBe(true);
    expect(input).toHaveLength(4 + 100 * 8);
  });

  it("leaves out a data track and ends the audio at the session's lead-out", () => {
    // MusicBrainz's multi-session example: 7 audio tracks and a data track whose offset is 125824.
    // The TOC ends the last audio track 11,400 sectors before the data track, as the Rust side does.
    const audioOffsets = [150, 14109, 33586, 53077, 65781, 77892, 99174];
    const audio = tocFromOffsets(audioOffsets, 125824 + 150 - 11400);
    const data: Track = { number: 8, first_sector: 125824, last_sector: 130000, is_audio: false };
    const input = discIdInput({ tracks: [...audio.tracks, data], leadout_sector: 130001 })!;

    expect(input.startsWith("0107" + (114574).toString(16).toUpperCase().padStart(8, "0"))).toBe(true);
    expect(input.slice(4 + 8 + 7 * 8)).toBe("0".repeat(92 * 8));
  });
});
