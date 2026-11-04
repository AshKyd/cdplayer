import { invoke } from "@tauri-apps/api/core";

/** One tag as Rust reads it from the file (`get_metadata`). Nothing is picked or renamed on the Rust side. */
export interface FileTag {
  /** The tag's own key, which differs by format: `TIT2` (ID3), `TITLE` (Vorbis), `©nam` (MP4). */
  key: string;
  value: string | number | boolean | string[];
  /** Rust's format-independent name for the tag (`TrackTitle`, `Artist`...), when it knows one. */
  standard: string | null;
}

/** What the player uses from a file's tags. A field is `undefined` when the file doesn't have it. */
export interface FileTrackInfo {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  /** Position on the album (1-based). */
  trackNumber?: number;
  /** Four-digit year. */
  year?: string;
}

interface Options {
  /** Calls a Tauri command. Tests pass a fake. */
  invokeCommand?: <T>(command: string, args: Record<string, unknown>) => Promise<T>;
}

/** Every tag in the file at `path`, or none if it has none or can't be read (the file name is the fallback title). */
export const readFileTags = (
  path: string,
  { invokeCommand = (command, args) => invoke(command, args) }: Options = {},
): Promise<FileTag[]> => invokeCommand<FileTag[]>("get_metadata", { path }).catch(() => []);

/** The tag's value as trimmed text, or `""` for anything that isn't text or a number. */
const textOf = ({ value }: FileTag): string => {
  if (Array.isArray(value)) return value.join(", ").trim();
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
};

/**
 * The first non-empty value among tags whose standard name is `standard`, or else whose raw key is one of
 * `rawKeys` (compared case-insensitively). Tags come oldest first, so a leading ID3v2 tag beats a trailing ID3v1 one.
 */
const firstValue = (tags: FileTag[], standard: string, rawKeys: string[]): string | undefined => {
  const wanted = rawKeys.map((key) => key.toLowerCase());
  const matching = tags.filter((tag) => tag.standard === standard || wanted.includes(tag.key.toLowerCase()));
  return matching.map(textOf).find((text) => text !== "");
};

/** "3/12" or "3" as 3; anything that isn't a positive number is `undefined`. */
const parseTrackNumber = (text: string | undefined): number | undefined => {
  const number = Number(text?.split("/")[0]);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

/** The four-digit year at the start of a date such as `2004-05-01`, or `undefined`. */
const parseYear = (text: string | undefined): string | undefined => text?.match(/^\d{4}/)?.[0];

/** Picks the fields the player shows from a file's tags, using the standard name first and common raw keys as a fallback. */
export const pickTrackInfo = (tags: FileTag[]): FileTrackInfo => ({
  title: firstValue(tags, "TrackTitle", ["TIT2", "TITLE", "©nam", "INAM"]),
  artist: firstValue(tags, "Artist", ["TPE1", "ARTIST", "©ART", "IART"]),
  album: firstValue(tags, "Album", ["TALB", "ALBUM", "©alb", "IPRD"]),
  albumArtist: firstValue(tags, "AlbumArtist", ["TPE2", "ALBUMARTIST", "aART"]),
  trackNumber: parseTrackNumber(firstValue(tags, "TrackNumber", ["TRCK", "TRACKNUMBER", "trkn", "ITRK"])),
  year: parseYear(
    firstValue(tags, "ReleaseDate", ["TDRC", "TYER", "DATE", "©day", "ICRD"]) ??
      firstValue(tags, "RecordingDate", []) ??
      firstValue(tags, "OriginalRecordingDate", []),
  ),
});
