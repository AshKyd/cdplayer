import { SECTORS_PER_SECOND, type Track } from "$lib/disc/types";
import { formatClock } from "$lib/playback/format";

export interface TrackRow {
  /** Unique per row; the track number. */
  key: string;
  track: Track;
  number: number;
  title: string;
  /** `m:ss`, empty for a data track. */
  duration: string;
  playable: boolean;
}

/** One row per track, in disc order. */
export const toTrackRows = (tracks: Track[]): TrackRow[] =>
  tracks.map((track) => {
    const seconds = (track.last_sector - track.first_sector + 1) / SECTORS_PER_SECOND;
    return {
      key: String(track.number),
      track,
      number: track.number,
      title: track.is_audio ? `Track ${track.number}` : "Data track",
      duration: track.is_audio ? formatClock(Math.round(seconds)) : "",
      playable: track.is_audio,
    };
  });
