import { describe, expect, it } from "vitest";
import { titleFromPath } from "./fileTrack";

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
