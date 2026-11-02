import { describe, expect, it } from "vitest";
import type { VolumeFileSystem } from "./fileSystem";
import { listAudioFiles } from "./listAudioFiles";

const root = "/Volumes/Disc";

/** A disc made from a map of file paths (relative to `root`) to contents. Folders exist because files are in them. */
const fakeDisc = (files: Record<string, string>): VolumeFileSystem => {
  const absolute = Object.fromEntries(Object.entries(files).map(([path, contents]) => [`${root}/${path}`, contents]));
  const paths = Object.keys(absolute);
  return {
    readFile: async (path) => new TextEncoder().encode(absolute[path] ?? ""),
    exists: async (path) => path in absolute,
    readDir: async (folder) => {
      const children = paths
        .filter((path) => path.startsWith(`${folder}/`))
        .map((path) => path.slice(folder.length + 1).split("/"));
      const names = [...new Set(children.map(([name]) => name))];
      return names.map((name) => ({
        name,
        isDirectory: children.some((parts) => parts[0] === name && parts.length > 1),
        isFile: children.some((parts) => parts[0] === name && parts.length === 1),
      }));
    },
  };
};

const listed = async (files: Record<string, string>) =>
  (await listAudioFiles(root, fakeDisc(files))).map((path) => path.slice(root.length + 1));

describe("listAudioFiles", () => {
  it("walks folders in natural order and skips other files and hidden ones", async () => {
    expect(
      await listed({
        "Disc 10/1.mp3": "",
        "Disc 2/10.flac": "",
        "Disc 2/9.mp3": "",
        "cover.jpg": "",
        ".hidden/1.mp3": "",
        "._1.mp3": "",
      }),
    ).toEqual(["Disc 2/9.mp3", "Disc 2/10.flac", "Disc 10/1.mp3"]);
  });

  it("uses a top-level playlist's order instead of walking", async () => {
    expect(await listed({ "a.mp3": "", "b.mp3": "", "list.m3u": "b.mp3\na.mp3\n" })).toEqual(["b.mp3", "a.mp3"]);
  });

  it("ignores a playlist in a subfolder", async () => {
    expect(await listed({ "a.mp3": "", "b.mp3": "", "sub/list.m3u": "../b.mp3\n" })).toEqual(["a.mp3", "b.mp3"]);
  });

  it("falls back to walking when the playlist lists nothing playable", async () => {
    expect(await listed({ "a.mp3": "", "list.m3u": "gone.mp3\nhttp://x/a.mp3\n" })).toEqual(["a.mp3"]);
  });

  it("prefers m3u over pls", async () => {
    expect(
      await listed({ "a.mp3": "", "b.mp3": "", "x.pls": "File1=a.mp3\nFile2=b.mp3\n", "y.m3u": "b.mp3\na.mp3\n" }),
    ).toEqual(["b.mp3", "a.mp3"]);
  });

  it("tries the next playlist when the first lists nothing playable", async () => {
    expect(await listed({ "a.mp3": "", "x.m3u": "gone.mp3\n", "y.pls": "File1=a.mp3\n" })).toEqual(["a.mp3"]);
  });

  it("returns nothing for a disc that can't be read", async () => {
    const unreadable: VolumeFileSystem = {
      readDir: async () => Promise.reject(new Error("denied")),
      readFile: async () => Promise.reject(new Error("denied")),
      exists: async () => false,
    };
    expect(await listAudioFiles(root, unreadable)).toEqual([]);
  });
});
