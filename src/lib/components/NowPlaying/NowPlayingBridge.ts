import type { CDPlayer } from "$lib/playback/CDPlayer.svelte";
import type { FilePlayer } from "$lib/playback/FilePlayer.svelte";
import { isPlaybackActive, type PlayerStatus } from "$lib/playback/playerMachine";
import { createSilentAudio } from "./silentAudio";

/** What the system's Now Playing display should show. */
export interface NowPlayingState {
  status: PlayerStatus;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  positionSeconds: number;
  durationSeconds: number;
  /** Whether a track is queued after this one, which enables the Next button. */
  canNext: boolean;
}

/** What the media keys and Now Playing buttons can ask for. */
export interface NowPlayingControls {
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  stop: () => void;
}

interface Options {
  controls: NowPlayingControls;
  /** Defaults to `navigator.mediaSession`. Tests pass a fake. */
  mediaSession?: MediaSession;
  /** The element that makes the page eligible for Now Playing. Defaults to a silent loop. */
  audio?: Pick<HTMLAudioElement, "play" | "pause" | "paused">;
  createMetadata?: (init: MediaMetadataInit) => MediaMetadata;
  /** Milliseconds, only used to tell a seek from normal playback. */
  now?: () => number;
}

/** A position further than this from where playback should be is a jump, and is reported again. */
const POSITION_DRIFT_SECONDS = 1;

/**
 * Shows the player in the OS media controls (the macOS menubar's Now Playing, media keys, and the
 * equivalents elsewhere) using the Media Session API.
 *
 * The OS only shows pages with an HTML media element playing, and our sound comes from Web Audio, so a
 * silent `<audio>` element plays alongside as a stand-in. It carries no sound and is never used for timing.
 *
 * The OS extrapolates the position itself, so it is only reported when something changes (play state,
 * track, or a seek), not on every frame.
 */
export class NowPlayingBridge {
  #controls: NowPlayingControls;
  #session: MediaSession;
  #audio: Pick<HTMLAudioElement, "play" | "pause" | "paused">;
  #createMetadata: (init: MediaMetadataInit) => MediaMetadata;
  #now: () => number;
  #metadataKey = "";
  #canNext = false;
  /** What the OS was last told, so its own extrapolation can be compared with the real position. */
  #reported: { positionSeconds: number; durationSeconds: number; playing: boolean; at: number } | null = null;

  constructor({
    controls,
    mediaSession = navigator.mediaSession,
    audio = createSilentAudio(),
    createMetadata = (init) => new MediaMetadata(init),
    now = () => performance.now(),
  }: Options) {
    this.#controls = controls;
    this.#session = mediaSession;
    this.#audio = audio;
    this.#createMetadata = createMetadata;
    this.#now = now;

    this.#setHandler("play", controls.play);
    this.#setHandler("pause", controls.pause);
    this.#setHandler("stop", controls.stop);
    this.#setHandler("previoustrack", controls.previous);
    this.#setHandler("seekto", ({ seekTime }) => {
      if (seekTime !== undefined && seekTime !== null) controls.seek(seekTime);
    });
  }

  /** Brings the OS display in line with the player. Cheap enough to call on every position change. */
  update({ status, title, artist, album, coverUrl, positionSeconds, durationSeconds, canNext }: NowPlayingState): void {
    if (!isPlaybackActive(status)) return this.clear();

    // Metadata
    const metadataKey = JSON.stringify([title, artist, album, coverUrl]);
    if (metadataKey !== this.#metadataKey) {
      this.#metadataKey = metadataKey;
      this.#session.metadata = this.#createMetadata({
        title,
        artist,
        album,
        artwork: coverUrl ? [{ src: coverUrl }] : [],
      });
    }

    // Play state
    const playing = status !== "paused";
    this.#session.playbackState = playing ? "playing" : "paused";
    // A refused play() (no user gesture yet) is retried on the next update, so it is safe to ignore.
    if (playing && this.#audio.paused) void this.#audio.play().catch(() => {});
    if (!playing && !this.#audio.paused) this.#audio.pause();

    // Next is only offered when something is queued
    if (canNext !== this.#canNext) {
      this.#canNext = canNext;
      this.#setHandler("nexttrack", canNext ? this.#controls.next : null);
    }

    this.#reportPosition({ positionSeconds, durationSeconds, playing });
  }

  /** Removes the player from the OS display, for when nothing is playing. */
  clear(): void {
    if (!this.#audio.paused) this.#audio.pause();
    this.#session.playbackState = "none";
    this.#session.metadata = null;
    this.#metadataKey = "";
    this.#reported = null;
    if (this.#canNext) this.#setHandler("nexttrack", null);
    this.#canNext = false;
  }

  /** Reports the position when it first appears, when play state or length changes, or after a jump. */
  #reportPosition({ positionSeconds, durationSeconds, playing }: { positionSeconds: number; durationSeconds: number; playing: boolean }): void {
    if (durationSeconds <= 0) return;
    const now = this.#now();
    const last = this.#reported;
    const expectedSeconds = last ? last.positionSeconds + (last.playing ? (now - last.at) / 1000 : 0) : 0;
    const unchanged =
      last && last.playing === playing && last.durationSeconds === durationSeconds && Math.abs(positionSeconds - expectedSeconds) < POSITION_DRIFT_SECONDS;
    if (unchanged) return;

    this.#reported = { positionSeconds, durationSeconds, playing, at: now };
    // The API throws for a position outside the duration, which a frame of rounding can cause at a track's end.
    const position = Math.min(Math.max(positionSeconds, 0), durationSeconds);
    try {
      this.#session.setPositionState({ duration: durationSeconds, playbackRate: 1, position });
    } catch {
      this.#reported = null;
    }
  }

  /** Some browsers throw for actions they don't support; the others still work, so ignore those. */
  #setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
    try {
      this.#session.setActionHandler(action, handler);
    } catch {
      // Unsupported action.
    }
  }
}

/** What `NowPlayingBridge.update()` needs, read from the player. */
export const nowPlayingState = (player: CDPlayer): NowPlayingState => {
  const [current] = player.queue;
  return {
    status: player.status,
    title: current ? player.trackTitle(current) : "",
    artist: (current && player.trackArtist(current)) || player.metadata?.artist || "",
    album: player.metadata?.album ?? "",
    coverUrl: player.metadata?.coverUrl ?? null,
    positionSeconds: player.positionSeconds,
    durationSeconds: player.durationSeconds,
    canNext: player.queue.length > 1,
  };
};

/** What `NowPlayingBridge.update()` needs, read from the file player. There are no tags yet, so no artist, album or cover. */
export const fileNowPlayingState = (player: FilePlayer): NowPlayingState => ({
  status: player.status === "idle" ? "ready" : player.status,
  title: player.current?.title ?? "",
  artist: "",
  album: "",
  coverUrl: null,
  positionSeconds: player.positionSeconds,
  durationSeconds: player.durationSeconds,
  canNext: player.currentIndex !== null && player.currentIndex < player.tracks.length - 1,
});

/** The media keys, wired to a player: either one, since they share these methods. */
export const nowPlayingControls = (
  player: Pick<CDPlayer, "resume" | "pause" | "previous" | "next" | "seek" | "stop">,
): NowPlayingControls => ({
  play: () => void player.resume(),
  pause: () => void player.pause(),
  previous: () => void player.previous(),
  next: () => void player.next(),
  seek: (seconds) => void player.seek(seconds),
  stop: () => player.stop(),
});
