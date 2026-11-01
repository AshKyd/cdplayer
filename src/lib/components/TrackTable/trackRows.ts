import { SECTORS_PER_SECOND, type Track } from "$lib/disc/types";
import { formatClock } from "$lib/playback/format";

export interface TrackRow {
  /** Unique per row; the track number. */
  key: string;
  track: Track;
  number: number;
  title: string;
  /** The track's own artist, or empty when it is the album's (so only compilations show one). */
  artist: string;
  /** `m:ss`, empty for a data track. */
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
      track,
      number: track.number,
      title: titleOf(track),
      artist: artistOf(track),
      duration: track.is_audio ? formatClock(Math.round(seconds)) : "",
      playable: track.is_audio,
    };
  });
