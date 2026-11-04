import { describe, expect, it } from "vitest";
import { pickTrackInfo, readFileTags, type FileTag } from "./fileMetadata";

const tag = (key: string, value: FileTag["value"], standard: string | null = null): FileTag => ({ key, value, standard });

describe("readFileTags", () => {
  it("asks Rust for the tags of the path", async () => {
    const tags = [tag("TITLE", "Song", "TrackTitle")];
    const calls: string[] = [];
    const result = await readFileTags("/music/a.flac", {
      invokeCommand: (async (command: string, args: Record<string, unknown>) => {
        calls.push(JSON.stringify({ command, args }));
        return tags;
      }) as never,
    });
    expect(result).toEqual(tags);
    expect(calls).toEqual([JSON.stringify({ command: "get_metadata", args: { path: "/music/a.flac" } })]);
  });

  it("gives no tags when the file can't be read", async () => {
    const result = await readFileTags("/music/a.flac", { invokeCommand: () => Promise.reject(new Error("nope")) });
    expect(result).toEqual([]);
  });
});

describe("pickTrackInfo", () => {
  it("picks fields by standard name", () => {
    const info = pickTrackInfo([
      tag("TIT2", " Song ", "TrackTitle"),
      tag("TPE1", "Band", "Artist"),
      tag("TALB", "Record", "Album"),
      tag("TPE2", "Various", "AlbumArtist"),
      tag("TRCK", "3/12", "TrackNumber"),
      tag("TDRC", "2004-05-01", "RecordingDate"),
    ]);
    expect(info).toEqual({ title: "Song", artist: "Band", album: "Record", albumArtist: "Various", trackNumber: 3, year: "2004" });
  });

  it("falls back to raw keys, case-insensitively, when there is no standard name", () => {
    const info = pickTrackInfo([tag("title", "Song"), tag("Artist", "Band"), tag("TRACKNUMBER", "7"), tag("date", "1999")]);
    expect(info).toMatchObject({ title: "Song", artist: "Band", trackNumber: 7, year: "1999" });
  });

  it("takes numeric track numbers and the first non-empty value", () => {
    const info = pickTrackInfo([tag("TIT2", "  ", "TrackTitle"), tag("TITLE", "Real", "TrackTitle"), tag("trkn", 4, "TrackNumber")]);
    expect(info.title).toBe("Real");
    expect(info.trackNumber).toBe(4);
  });

  it("leaves out what the file doesn't have, and ignores bad numbers", () => {
    const info = pickTrackInfo([tag("TRCK", "abc", "TrackNumber"), tag("TDRC", "unknown", "RecordingDate")]);
    expect(info).toEqual({});
    expect(pickTrackInfo([])).toEqual({});
  });
});
