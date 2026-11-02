/**
 * Path helpers for files on a mounted disc. Paths are handled with `/` separators throughout (Windows accepts
 * them too), so a playlist written on any system resolves the same way.
 */

/** The path with `/` separators and no trailing slash (except for the root `/`). */
export const normalisePath = (path: string): string => {
  const slashed = path.replaceAll("\\", "/");
  return slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
};

/** Removes `.` and empty parts and resolves `..` without touching the disc, so `../` can't climb out of a folder. */
export const cleanPath = (path: string): string => {
  const segments = path.split("/").reduce<string[]>((kept, segment) => {
    if (segment === "" || segment === ".") return kept;
    return segment === ".." ? kept.slice(0, -1) : [...kept, segment];
  }, []);
  return (path.startsWith("/") ? "/" : "") + segments.join("/");
};

/** True for a path that starts at the top of a drive (`/music`, `D:/music`) rather than in a folder. */
export const isAbsolutePath = (path: string): boolean => /^\/|^[a-z]:\//i.test(path);

/** True when `path` is `root` or something inside it. */
export const isInside = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

export const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

export const extensionOf = (path: string): string => {
  const name = path.split("/").at(-1) ?? "";
  return name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";
};

export const isHidden = (name: string): boolean => name.startsWith(".");

/** Splits into runs of digits and runs of anything else, lower-cased: "Track 10" → ["track ", "10"]. */
const chunksOf = (text: string): string[] => text.toLowerCase().match(/\d+|\D+/g) ?? [];

const compareChunks = (left: string, right: string): number => {
  if (/^\d/.test(left) && /^\d/.test(right)) return Number(left) - Number(right);
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Case-insensitive, with runs of digits compared as numbers: `2.mp3` sorts before `10.mp3`. */
export const naturalCompare = (left: string, right: string): number => {
  const [leftChunks, rightChunks] = [chunksOf(left), chunksOf(right)];
  const firstDifference = leftChunks
    .slice(0, rightChunks.length)
    .map((chunk, index) => compareChunks(chunk, rightChunks[index]))
    .find((difference) => difference !== 0);
  return firstDifference ?? leftChunks.length - rightChunks.length;
};

/** Compares folder by folder, so `Disc 2/` sorts after `Disc 1/` and before `Disc 10/`. */
export const comparePaths = (left: string, right: string): number => {
  const [leftParts, rightParts] = [left.split("/"), right.split("/")];
  const firstDifference = leftParts
    .slice(0, rightParts.length)
    .map((part, index) => naturalCompare(part, rightParts[index]))
    .find((difference) => difference !== 0);
  return firstDifference ?? leftParts.length - rightParts.length;
};
