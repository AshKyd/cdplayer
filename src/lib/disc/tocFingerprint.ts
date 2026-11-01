import type { Toc } from "./types";

/**
 * A string that is equal for two reads of the same disc and different for different discs.
 * Used to tell whether the disc in the drive changed, so it covers every track's sectors and the lead-out.
 * `null` (no disc) gets its own value.
 */
export const tocFingerprint = (toc: Toc | null): string =>
  toc
    ? [...toc.tracks.map(({ first_sector, last_sector, is_audio }) => `${first_sector}-${last_sector}${is_audio ? "a" : "d"}`), toc.leadout_sector].join(",")
    : "none";
