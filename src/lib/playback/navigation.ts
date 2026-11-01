import type { Track } from "$lib/disc/types";

/** Past this far into a track, "previous" restarts it instead of going back a track. */
export const RESTART_THRESHOLD_SECONDS = 3;

/** The playable tracks from `track` to the end of the disc, in disc order. */
export const tracksFrom = (tracks: Track[], track: Track): Track[] =>
  tracks.filter(({ is_audio, number }) => is_audio && number >= track.number);

export type PreviousStep = { kind: "restart" } | { kind: "play"; track: Track };

/**
 * What "previous" does: restart the track if it has been playing a while (or it is the first),
 * otherwise go back to the track before it on the disc.
 */
export const previousStep = ({
  tracks,
  currentTrackNumber,
  positionSeconds,
}: {
  tracks: Track[];
  currentTrackNumber: number | null;
  positionSeconds: number;
}): PreviousStep => {
  if (positionSeconds > RESTART_THRESHOLD_SECONDS) return { kind: "restart" };

  const playable = tracks.filter(({ is_audio }) => is_audio);
  const index = playable.findIndex(({ number }) => number === currentTrackNumber);
  return index > 0 ? { kind: "play", track: playable[index - 1] } : { kind: "restart" };
};
