import type { LastFmTrack } from "$lib/lastfm/lastFmClient";
import type { CDPlayer } from "$lib/playback/CDPlayer.svelte";
import { isPlaybackActive } from "$lib/playback/playerMachine";

/** What the tracker needs to know about the player at one moment. */
export interface PlaybackSnapshot {
  /** Sound is coming out now (not paused, stopped, or still loading). */
  isSounding: boolean;
  /** A track is queued or playing, even if paused. */
  isActive: boolean;
  trackNumber: number | null;
  title: string;
  artist: string;
  album: string;
  positionSeconds: number;
  durationSeconds: number;
}

interface Options {
  onNowPlaying: (track: LastFmTrack) => void;
  onScrobble: (track: LastFmTrack, startedAtSeconds: number) => void;
  /** Called once per track that is playing but can't be sent, with why. */
  onIgnored?: (trackNumber: number, reason: string) => void;
  /** Milliseconds since the Unix epoch. Tests pass a fake. */
  now?: () => number;
}

/** Last.fm ignores tracks of 30 s or less. */
const MIN_TRACK_SECONDS = 30;

/** A track counts as listened to after half its length, or this long, whichever comes first. */
const MAX_SECONDS_BEFORE_SCROBBLE = 240;

/**
 * Between two updates, playback moving forward by no more than this is listening; more is a seek.
 * Frames are normally 16 ms apart, so this only has to be generous enough for a stalled frame.
 */
const MAX_LISTENING_STEP_SECONDS = 2;

/** A jump back further than this means the track was started over. */
const RESTART_JUMP_SECONDS = 2;

interface Play {
  trackNumber: number;
  startedAtSeconds: number;
  lastPositionSeconds: number;
  listenedSeconds: number;
  isNowPlayingSent: boolean;
  isScrobbled: boolean;
}

/**
 * Decides when to tell Last.fm what is playing. Feed it the player's state on every change and it calls
 * `onNowPlaying` when a track starts sounding, and `onScrobble` once the track has been listened to for long
 * enough, following Last.fm's rules: the track is over 30 s long, and half of it (or 4 minutes) has played.
 *
 * Listening time is added up from forward movement in the track's position, so seeking ahead doesn't count
 * as listening and pausing doesn't count at all. Each play is scrobbled once; starting the track over after
 * it was scrobbled is a new play.
 */
export class ScrobbleTracker {
  #onNowPlaying: Options["onNowPlaying"];
  #onScrobble: Options["onScrobble"];
  #onIgnored: NonNullable<Options["onIgnored"]>;
  #now: () => number;
  #play: Play | null = null;
  /** The track already reported as ignored, so it is said once rather than every frame. */
  #ignoredTrackNumber: number | null = null;

  constructor({ onNowPlaying, onScrobble, onIgnored = () => {}, now = () => Date.now() }: Options) {
    this.#onNowPlaying = onNowPlaying;
    this.#onScrobble = onScrobble;
    this.#onIgnored = onIgnored;
    this.#now = now;
  }

  update(snapshot: PlaybackSnapshot): void {
    const { isActive, isSounding, trackNumber, artist, title, positionSeconds, durationSeconds } = snapshot;

    // Nothing active, or nothing Last.fm could use (no artist means the disc wasn't found on MusicBrainz).
    if (!isActive || trackNumber === null) {
      this.#play = null;
      this.#ignoredTrackNumber = null;
      return;
    }
    if (!artist || !title) {
      this.#play = null;
      if (this.#ignoredTrackNumber !== trackNumber) {
        this.#ignoredTrackNumber = trackNumber;
        this.#onIgnored(trackNumber, "no artist or title (the disc wasn't found on MusicBrainz, or lookups are off)");
      }
      return;
    }
    this.#ignoredTrackNumber = null;

    const track: LastFmTrack = {
      artist,
      title,
      album: snapshot.album,
      durationSeconds,
      trackNumber,
    };

    // A different track, or this one started over after it was already counted.
    const play = this.#play;
    const isRestart = play && play.isScrobbled && positionSeconds < play.lastPositionSeconds - RESTART_JUMP_SECONDS;
    if (!play || play.trackNumber !== trackNumber || isRestart) {
      this.#play = {
        trackNumber,
        startedAtSeconds: this.#now() / 1000 - positionSeconds,
        lastPositionSeconds: positionSeconds,
        listenedSeconds: 0,
        isNowPlayingSent: false,
        isScrobbled: false,
      };
    }
    const current = this.#play!;

    // Listening time: only steady forward movement while sound is coming out.
    const step = positionSeconds - current.lastPositionSeconds;
    if (isSounding && step > 0 && step <= MAX_LISTENING_STEP_SECONDS) current.listenedSeconds += step;
    current.lastPositionSeconds = positionSeconds;

    // Now playing: when the track first makes a sound, not while it is still loading.
    if (isSounding && !current.isNowPlayingSent) {
      current.isNowPlayingSent = true;
      this.#onNowPlaying(track);
    }

    const scrobbleAfterSeconds = Math.min(durationSeconds / 2, MAX_SECONDS_BEFORE_SCROBBLE);
    if (!current.isScrobbled && durationSeconds > MIN_TRACK_SECONDS && current.listenedSeconds >= scrobbleAfterSeconds) {
      current.isScrobbled = true;
      this.#onScrobble(track, current.startedAtSeconds);
    }
  }
}

/** What `ScrobbleTracker.update()` needs, read from the player. */
export const playbackSnapshot = (player: CDPlayer): PlaybackSnapshot => {
  const [current] = player.queue;
  return {
    isSounding: player.status === "playing",
    isActive: isPlaybackActive(player.status),
    trackNumber: current?.number ?? null,
    title: current ? player.trackTitle(current) : "",
    artist: (current && player.trackArtist(current)) || player.metadata?.artist || "",
    // Without metadata `trackTitle()` is "Track N"; the artist check above keeps those from being sent.
    album: player.metadata?.album ?? "",
    positionSeconds: player.positionSeconds,
    durationSeconds: player.durationSeconds,
  };
};
