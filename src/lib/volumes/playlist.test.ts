import { describe, expect, it } from "vitest";
import { decodePlaylistBytes, parseM3u, parsePls, resolvePlaylistEntry } from "./playlist";

describe("playlist parsing", () => {
  it("reads M3U paths, skipping comments, blank lines and CRLF", () => {
    expect(parseM3u("#EXTM3U\r\n#EXTINF:1,x\r\nb.mp3\r\n\r\n  a.mp3  \r\n")).toEqual(["b.mp3", "a.mp3"]);
  });

  it("orders PLS entries by file number, whatever the line order or case", () => {
    const text = "[playlist]\nFile2=two.mp3\nTitle2=Two\nfile1=one.mp3\nNumberOfEntries=2\n";
    expect(parsePls(text)).toEqual(["one.mp3", "two.mp3"]);
  });

  it("decodes UTF-8 without the BOM, and falls back to Windows-1252", () => {
    expect(decodePlaylistBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodePlaylistBytes(new TextEncoder().encode("café.mp3"))).toBe("café.mp3");
    expect(decodePlaylistBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});

describe("resolvePlaylistEntry", () => {
  const root = "/Volumes/Disc";

  it("resolves relative to the playlist's folder, accepting backslashes", () => {
    expect(resolvePlaylistEntry("01.mp3", `${root}/Album`, root)).toBe(`${root}/Album/01.mp3`);
    expect(resolvePlaylistEntry("..\\Album\\01.mp3", `${root}/Album`, root)).toBe(`${root}/Album/01.mp3`);
  });

  it("drops URLs, other file types and anything outside the disc", () => {
    expect(resolvePlaylistEntry("http://example.com/a.mp3", root, root)).toBeNull();
    expect(resolvePlaylistEntry("notes.txt", root, root)).toBeNull();
    expect(resolvePlaylistEntry("../escape.mp3", root, root)).toBeNull();
    expect(resolvePlaylistEntry("/etc/passwd.mp3", root, root)).toBeNull();
    expect(resolvePlaylistEntry("/Volumes/DiscTwo/a.mp3", root, root)).toBeNull();
  });

  it("accepts an absolute entry on the disc", () => {
    expect(resolvePlaylistEntry(`${root}/a.mp3`, root, root)).toBe(`${root}/a.mp3`);
  });
});
