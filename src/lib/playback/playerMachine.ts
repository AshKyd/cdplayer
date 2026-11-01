/**
 * Where the player is in its life, from "no disc" to playing a track. One state at a time; `transition()`
 * says which events are allowed in which state, so a step can only happen when the state allows it
 * (you can't play before the disc's track names are looked up, or after it is ejected).
 *
 * - `noDisc`: nothing in the drive (or not looked at yet).
 * - `loadingMetadata`: a disc was found and its track names are being looked up.
 * - `ready`: a disc is there, with names or the generic "Track N" if the lookup failed. Nothing playing.
 * - `loading`: playing was asked for; waiting for the first audio.
 * - `playing`.
 * - `buffering`: playing, but the audio ran out before the next chunk arrived.
 * - `paused`: by the user, or by the system interrupting the audio.
 */
export type PlayerStatus = "noDisc" | "loadingMetadata" | "ready" | "loading" | "playing" | "buffering" | "paused";

export type PlayerEvent =
  /** The drive is empty, or the disc was taken out. */
  | { type: "discRemoved" }
  /** A disc was found: the first, or a different one replacing what was there. */
  | { type: "discInserted" }
  /** The metadata lookup finished, whether it found the disc or not. */
  | { type: "metadataSettled" }
  /** Start playing a queue. */
  | { type: "play" }
  /** Audio is scheduled: the first chunk, or the next after running dry. */
  | { type: "chunkArrived" }
  /** The scheduled audio ran out while more is still to come. */
  | { type: "underrun" }
  | { type: "pause" }
  /** Carry on after a pause, to whatever the audio is doing now. */
  | { type: "resume"; to: "loading" | "playing" | "buffering" }
  /** Stop: the user did, the queue ended, or playback failed. */
  | { type: "stop" };

/** Playback has been asked for, in any form. */
const PLAYBACK_STATES: readonly PlayerStatus[] = ["loading", "playing", "buffering", "paused"];

/** Whether the drive is in use, so nothing else should touch it. */
export const isPlaybackActive = (status: PlayerStatus): boolean => PLAYBACK_STATES.includes(status);

/** Whether a disc is in the drive and its names are settled, so its tracks can be shown and played. */
export const isDiscReady = (status: PlayerStatus): boolean => status === "ready" || isPlaybackActive(status);

/** The state after `event`, or `null` if the event isn't allowed in `status` (and should be ignored). */
export const transition = (status: PlayerStatus, event: PlayerEvent): PlayerStatus | null => {
  switch (event.type) {
    case "discRemoved":
      return status === "noDisc" ? null : "noDisc";
    case "discInserted":
      return "loadingMetadata";
    case "metadataSettled":
      return status === "loadingMetadata" ? "ready" : null;
    case "play":
      return isDiscReady(status) ? "loading" : null;
    case "chunkArrived":
      return status === "loading" || status === "buffering" ? "playing" : null;
    case "underrun":
      return status === "playing" ? "buffering" : null;
    case "pause":
      return status === "loading" || status === "playing" || status === "buffering" ? "paused" : null;
    case "resume":
      return status === "paused" ? event.to : null;
    case "stop":
      return isPlaybackActive(status) ? "ready" : null;
  }
};
