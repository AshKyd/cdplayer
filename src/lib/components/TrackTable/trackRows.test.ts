import { describe, expect, it } from "vitest";
import type { Track } from "$lib/disc/types";
import { toTrackRows } from "./trackRows";

const tracks: Track[] = [
  { number: 1, first_sector: 0, last_sector: 14_999, is_audio: true },
  { number: 2, first_sector: 15_000, last_sector: 20_000, is_audio: false },
];

describe("toTrackRows", () => {
  it("makes a row per track, in disc order, with the length as m:ss", () => {
    const [first] = toTrackRows(tracks);
    expect(first).toMatchObject({ key: "1", number: 1, title: "Track 1", duration: "3:20", playable: true });
    expect(first.track).toBe(tracks[0]);
  });

  it("marks a data track as not playable and gives it no length", () => {
    const [, data] = toTrackRows(tracks);
    expect(data).toMatchObject({ title: "Data track", duration: "", playable: false });
  });

  it("has no rows for no tracks", () => {
    expect(toTrackRows([])).toEqual([]);
  });
});
