import { describe, expect, it } from "vitest";
import { cleanPath, comparePaths, naturalCompare, normalisePath } from "./paths";

describe("paths", () => {
  it("normalises separators and trailing slashes", () => {
    expect(normalisePath("D:\\Music\\")).toBe("D:/Music");
    expect(normalisePath("/Volumes/Disc/")).toBe("/Volumes/Disc");
    expect(normalisePath("/")).toBe("/");
  });

  it("cleans . and .. without letting .. climb past the top", () => {
    expect(cleanPath("/Volumes/Disc/Album/../01.mp3")).toBe("/Volumes/Disc/01.mp3");
    expect(cleanPath("/Volumes/./Disc//01.mp3")).toBe("/Volumes/Disc/01.mp3");
    expect(cleanPath("/Volumes/../../../etc")).toBe("/etc");
  });

  it("sorts numbers as numbers and ignores case", () => {
    expect(naturalCompare("2 song.mp3", "10 song.mp3")).toBeLessThan(0);
    expect(naturalCompare("a.mp3", "B.mp3")).toBeLessThan(0);
    expect(naturalCompare("track", "track 2")).toBeLessThan(0);
    expect(naturalCompare("Same", "same")).toBe(0);
  });

  it("sorts folder by folder", () => {
    const sorted = ["Disc 10/1.mp3", "Disc 2/10.flac", "Disc 2/9.mp3", "a.mp3"].sort(comparePaths);
    expect(sorted).toEqual(["a.mp3", "Disc 2/9.mp3", "Disc 2/10.flac", "Disc 10/1.mp3"]);
  });
});
