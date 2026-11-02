import { SECTORS_PER_SECOND, type Track } from "$lib/disc/types";
import type { FileTrack } from "$lib/files/fileTrack";
import { formatClock } from "$lib/playback/format";

export interface TrackRow {
  /** Unique per row: the track number for a disc, the file's id for a file. Finds the track again when a row is played. */
  key: string;
  /** Position in the list, from 1. */
  number: number;
  title: string;
  /** The track's own artist, or empty when it is the album's (so only compilations show one). */
  artist: string;
  /** `m:ss`, empty for a data track or a file not yet opened. */
  duration: string;
  playable: boolean;
}

/** One row per track, in disc order. `titleOf` and `artistOf` supply the names. */
export const toTrackRows = (
  tracks: Track[],
  titleOf: (track: Track) => string,
  artistOf: (track: Track) => string,
): TrackRow[] =>
  tracks.map((track) => {
    const seconds = (track.last_sector - track.first_sector + 1) / SECTORS_PER_SECOND;
    return {
      key: String(track.number),
      number: track.number,
      title: titleOf(track),
      artist: artistOf(track),
      duration: track.is_audio ? formatClock(Math.round(seconds)) : "",
      playable: track.is_audio,
    };
  });

/** One row per file, in playlist order. A file's length is only known once it has been opened. */
export const toFileTrackRows = (tracks: FileTrack[]): TrackRow[] =>
  tracks.map(({ id, title, durationSeconds }, index) => ({
    key: id,
    number: index + 1,
    title,
    artist: "",
    duration: durationSeconds > 0 ? formatClock(Math.round(durationSeconds)) : "",
    playable: true,
  }));
