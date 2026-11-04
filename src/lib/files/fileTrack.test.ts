import { describe, expect, it } from "vitest";
import { applyTags, createFileTrack, titleFromPath } from "./fileTrack";

describe("applyTags", () => {
  it("takes the title, artist and track number from the tags", () => {
    const track = createFileTrack("/Music/01 intro.mp3");
    const tags = [
      { key: "TIT2", value: "Intro", standard: "TrackTitle" },
      { key: "TPE1", value: "Band", standard: "Artist" },
      { key: "TRCK", value: "1/10", standard: "TrackNumber" },
    ];
    const tagged = applyTags(track, tags);
    expect(tagged).toMatchObject({ id: track.id, path: track.path, title: "Intro", artist: "Band", trackNumber: 1, tags });
  });

  it("keeps the file name as the title when there is no title tag", () => {
    const track = createFileTrack("/Music/01 intro.mp3");
    expect(applyTags(track, []).title).toBe("01 intro");
  });
});

describe("titleFromPath", () => {
  it("drops the folders and only the last extension", () => {
    expect(titleFromPath("/Music/Album/01 Intro.v2.mp3")).toBe("01 Intro.v2");
  });

  it("handles Windows paths", () => {
    expect(titleFromPath("C:\\Music\\Song.flac")).toBe("Song");
  });

  it("keeps a name that is only an extension", () => {
    expect(titleFromPath("/Music/.mp3")).toBe(".mp3");
  });
});
