import { isAudioPath } from "$lib/files/audioFiles";
import { cleanPath, isAbsolutePath, isInside } from "./paths";

/** Playlist types, in the order they're preferred when a disc has more than one. */
export const PLAYLIST_EXTENSIONS = ["m3u", "m3u8", "pls"];

/** UTF-8 (M3U8, and most M3U), else Windows-1252, which is what older plain `.m3u` files were written in. */
export const decodePlaylistBytes = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

/** One path per line; `#` lines are comments or extended info (`#EXTINF`). */
export const parseM3u = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

/** `FileN=path` lines, in the order of `N` (the file may list them out of order). */
export const parsePls = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .flatMap((line) => {
      const [, number, entry] = line.trim().match(/^file(\d+)\s*=(.*)$/i) ?? [];
      return number === undefined ? [] : [{ number: Number(number), entry: entry.trim() }];
    })
    .sort((a, b) => a.number - b.number)
    .map(({ entry }) => entry);

export const parsePlaylist = (text: string, extension: string): string[] =>
  extension === "pls" ? parsePls(text) : parseM3u(text);

/**
 * Turns a playlist entry into the path of an audio file inside `root`, or `null`. It doesn't check that the file exists.
 * Entries are relative to the playlist's folder; URLs, other file types and anything that climbs out of `root` are dropped.
 */
export const resolvePlaylistEntry = (entry: string, playlistFolder: string, root: string): string | null => {
  // Discs are often burned from Windows, where playlists use backslashes.
  const slashed = entry.replaceAll("\\", "/");
  if (slashed.includes("://")) return null;
  const resolved = cleanPath(isAbsolutePath(slashed) ? slashed : `${playlistFolder}/${slashed}`);
  return isInside(resolved, root) && isAudioPath(resolved) ? resolved : null;
};
