import { describe, expect, it } from "vitest";
import type { Track } from "$lib/disc/types";
import { toFileTrackRows, toTrackRows } from "./trackRows";

const tracks: Track[] = [
  { number: 1, first_sector: 0, last_sector: 14_999, is_audio: true },
  { number: 2, first_sector: 15_000, last_sector: 20_000, is_audio: false },
];

const titleOf = ({ number }: Track) => `Title ${number}`;
const artistOf = ({ number }: Track) => (number === 1 ? "Guest" : "");

describe("toTrackRows", () => {
  it("makes a row per track, in disc order, with the names and the length as m:ss", () => {
    const [first] = toTrackRows(tracks, titleOf, artistOf);
    expect(first).toEqual({ key: "1", number: 1, title: "Title 1", artist: "Guest", duration: "3:20", playable: true });
  });

  it("marks a data track as not playable and gives it no length", () => {
    const [, data] = toTrackRows(tracks, titleOf, artistOf);
    expect(data).toMatchObject({ duration: "", playable: false });
  });

  it("has no rows for no tracks", () => {
    expect(toTrackRows([], titleOf, artistOf)).toEqual([]);
  });
});

describe("toFileTrackRows", () => {
  const files = [
    { id: "a", path: "/music/a.mp3", title: "First", durationSeconds: 200, tags: [] },
    { id: "b", path: "/music/b.mp3", title: "Second", durationSeconds: 0, artist: "Band", tags: [] },
  ];

  it("makes a playable row per file, keyed by id and numbered in order", () => {
    const [first] = toFileTrackRows(files);
    expect(first).toEqual({ key: "a", number: 1, title: "First", artist: "", duration: "3:20", playable: true });
  });

  it("shows the artist from the file's tags", () => {
    const [, second] = toFileTrackRows(files);
    expect(second.artist).toBe("Band");
  });

  it("leaves the length empty until the file has been opened", () => {
    const [, second] = toFileTrackRows(files);
    expect(second).toMatchObject({ number: 2, duration: "" });
  });
});
