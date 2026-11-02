import { describe, expect, it } from "vitest";
import { audioPathsFrom, isAudioPath } from "./audioFiles";

describe("isAudioPath", () => {
  it("accepts a known extension, ignoring case", () => {
    expect(isAudioPath("/Music/Song.FLAC")).toBe(true);
    expect(isAudioPath("C:\\Music\\song.mp3")).toBe(true);
  });

  it("rejects other files and folders", () => {
    expect(isAudioPath("/Music/cover.jpg")).toBe(false);
    expect(isAudioPath("/Music/My Album")).toBe(false);
    expect(isAudioPath("/Music/mp3")).toBe(false);
  });
});

describe("audioPathsFrom", () => {
  it("keeps only audio files, in the order given", () => {
    const dropped = ["/b.mp3", "/notes.txt", "/a.ogg"];

    expect(audioPathsFrom(dropped)).toEqual(["/b.mp3", "/a.ogg"]);
  });
});
