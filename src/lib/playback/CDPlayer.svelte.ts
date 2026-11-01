import { cdTrackBaseUrl } from "$lib/disc/cdTrackUrl";
import { SECTORS_PER_SECOND, type Track } from "$lib/disc/types";
import {
  chunkUrl,
  currentSpanIndex,
  nextChunkSectorCount,
  startSectorForTime,
  trackSectorCount,
  type TrackSpan,
} from "./chunks";
import { WebAudioHandler } from "./WebAudioHandler";

/**
 * `loading`: waiting for the first chunk. `buffering`: playing, but the audio ran out before the next
 * chunk arrived. `paused`: by the user, or by the system interrupting the audio (see `interrupted`).
 */
export type PlayerStatus = "idle" | "loading" | "playing" | "buffering" | "paused";

interface Options {
  /** Does the audio scheduling. Tests pass one built on a fake `AudioContext`. */
  handler?: WebAudioHandler;
  /** Fetches one chunk by URL. Tests pass a fake. */
  fetchChunk?: (url: string) => Promise<Response>;
  /** Root of the `cd-track` protocol, which differs by platform. Defaults to what Tauri reports. */
  baseUrl?: string;
}

/** Bytes per CD sector of raw PCM. */
const SECTOR_BYTES = 2352;

/** Keep this much audio scheduled ahead, so a slow drive read doesn't cause a dropout. */
const TARGET_LEAD_SECONDS = 30;

const LEAD_CHECK_INTERVAL_MS = 250;

/** Response header from the `cd-track` protocol: sectors in the chunk that were unreadable. */
const UNREADABLE_SECTORS_HEADER = "X-Unreadable-Sectors";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Plays a queue of CD tracks: reads sector chunks through the `cd-track` protocol and hands the PCM to a
 * `WebAudioHandler`. Holds playback state for the UI. Audio scheduling lives in the handler so other
 * sources (e.g. MP3 CDs) can reuse it.
 *
 * Gapless: the handler joins segments by frame count and doesn't care which track they came from, so the
 * next track is simply fetched into the same stream while the lead is still ~30 s ahead. The handler's
 * timeline runs across all tracks, so this class keeps a `TrackSpan` per track to translate it back into
 * "which track, how far in".
 */
export class CDPlayer {
  status = $state<PlayerStatus>("idle");
  trackNumber = $state<number | null>(null);
  /** Seconds into the current track. */
  positionSeconds = $state(0);
  error = $state("");
  /** Sectors in this run the drive couldn't read; they were played as silence (75 sectors = 1 s). */
  unreadableSectors = $state(0);
  /**
   * The playing track first, then those after it. Tracks after the first may already be fetched
   * (buffered ahead for gapless playback); `clearQueue()` and `next()` take those back out.
   */
  queue = $state<Track[]>([]);
  /** Length of the current track in seconds, for a seek bar. */
  durationSeconds = $derived(this.queue[0] ? trackSectorCount(this.queue[0]) / SECTORS_PER_SECOND : 0);
  /** True while the system has stopped the audio without being asked; press Play to continue. */
  interrupted = $state(false);

  #handler: WebAudioHandler;
  #fetchChunk: (url: string) => Promise<Response>;
  #baseUrl: string;
  /** Bumped when buffered tracks are dropped, so a fetch loop that was reading one of them stops. */
  #fetchGeneration = 0;
  /** True once the first chunk of this run has been scheduled. */
  #startedPlaying = false;
  /** True when `status` became `paused` because of an interruption, not because the user paused. */
  #pausedByInterruption = false;
  /** Bumped by every `play()`/`stop()`; an older run sees the change and abandons its work. */
  #runId = 0;
  /** Timeline position of each fetched track. `#spans[i]` belongs to `queue[i]`. */
  #spans: TrackSpan[] = [];
  /** Index in `queue` of the track being fetched (or the next to fetch). */
  #fetchIndex = 0;
  /** True while the fetch loop has tracks left to read. */
  #fetching = false;
  /** Seconds of audio scheduled so far on the handler's timeline. */
  #scheduledSeconds = 0;

  constructor({
    handler = new WebAudioHandler(),
    fetchChunk = (url) => fetch(url),
    baseUrl = cdTrackBaseUrl(),
  }: Options = {}) {
    this.#handler = handler;
    this.#fetchChunk = fetchChunk;
    this.#baseUrl = baseUrl;

    // Segments can run dry mid-queue on a slow read: that is buffering, and only the end once everything is fetched.
    this.#handler.onEnded = () => {
      if (!this.#fetching) return this.stop();
      if (this.status === "playing") this.status = "buffering";
    };
    this.#handler.onInterruption = (interrupted) => this.#handleInterruption(interrupted);
  }

  /** Stops whatever is playing, then plays `track` from `timeSeconds`. */
  play(track: Track, timeSeconds = 0): Promise<void> {
    return this.#start([track], timeSeconds);
  }

  /** Adds an audio track to the end of the queue, or starts it if nothing is playing. */
  enqueue(track: Track): void {
    if (!track.is_audio) return;
    if (this.status === "idle") {
      void this.play(track);
      return;
    }
    this.queue.push(track);
    if (!this.#fetching) void this.#pump(this.#runId);
  }

  /**
   * Removes every track after the current one. Tracks already buffered are taken back out of the audio,
   * unless the next one has already started playing (then it can't be unplayed and stays).
   */
  clearQueue(): void {
    const [, nextSpan] = this.#spans;
    if (nextSpan && this.#handler.dropAfter(nextSpan.startSeconds)) {
      // The fetch loop may be partway through a buffered track; make it stop.
      this.#fetchGeneration++;
      this.#fetching = false;
      this.#spans.splice(1);
      this.queue.splice(1);
      this.#fetchIndex = this.queue.length;
      this.#scheduledSeconds = nextSpan.startSeconds;
      return;
    }
    this.queue.splice(this.#fetchIndex + 1);
  }

  /**
   * Skips to the next queued track. If its start is already buffered this is instant and gapless: the
   * buffered audio is re-timed to play now. Otherwise it flushes and restarts, so there is a wait for the first chunk.
   */
  next(): Promise<void> {
    const [, ...upcoming] = this.queue;
    if (upcoming.length === 0) return Promise.resolve(this.stop());

    const [, nextSpan] = this.#spans;
    if (!nextSpan || !this.#handler.skipTo(nextSpan.startSeconds)) return this.#start(upcoming, 0);

    this.#spans.shift();
    this.queue.shift();
    this.#fetchIndex--;
    this.trackNumber = nextSpan.trackNumber;
    this.positionSeconds = nextSpan.offsetSeconds;
    return Promise.resolve();
  }

  /**
   * Moves to `seconds` in the current track, keeping the rest of the queue. Instant if that point is
   * already buffered; otherwise the track restarts from there and waits for its first chunk.
   * A pause is kept.
   */
  seek(seconds: number): Promise<void> {
    const [current] = this.queue;
    if (!current) return Promise.resolve();

    const [span] = this.#spans;
    const targetSeconds = startSectorForTime(current, seconds) / SECTORS_PER_SECOND;
    if (span && targetSeconds >= span.offsetSeconds) {
      const timelineSeconds = span.startSeconds + targetSeconds - span.offsetSeconds;
      const bufferedEnd = this.#spans[1]?.startSeconds ?? this.#scheduledSeconds;
      if (timelineSeconds < bufferedEnd && this.#handler.skipTo(timelineSeconds)) {
        this.positionSeconds = targetSeconds;
        return Promise.resolve();
      }
    }

    const wasPaused = this.status === "paused";
    const restarted = this.#start(this.queue.slice(), seconds);
    if (wasPaused) void this.pause();
    return restarted;
  }

  stop(): void {
    this.#runId++;
    this.#handler.stop();
    this.#spans = [];
    this.#fetchIndex = 0;
    this.#fetching = false;
    this.#scheduledSeconds = 0;
    this.queue = [];
    this.status = "idle";
    this.trackNumber = null;
    this.positionSeconds = 0;
    this.interrupted = false;
    this.#startedPlaying = false;
    this.#pausedByInterruption = false;
  }

  /** Pauses from any active state, including `loading`: the first chunk then waits, silent, until `resume()`. */
  async pause(): Promise<void> {
    if (this.status !== "loading" && this.status !== "buffering" && this.status !== "playing") return;
    this.status = "paused";
    await this.#handler.suspend();
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") return;
    // The user pressing Play takes over from an interruption.
    this.#pausedByInterruption = false;
    this.interrupted = false;
    await this.#handler.resume();
    if (this.status === "paused") this.status = this.#statusAfterPause();
  }

  togglePause(): Promise<void> {
    return this.status === "paused" ? this.resume() : this.pause();
  }

  /** What the player was doing before a pause, worked out from the audio rather than remembered. */
  #statusAfterPause(): PlayerStatus {
    if (this.#handler.hasQueuedAudio) return "playing";
    return this.#startedPlaying ? "buffering" : "loading";
  }

  #markPlaying(): void {
    this.#startedPlaying = true;
    if (this.status === "loading" || this.status === "buffering") this.status = "playing";
  }

  /** Pauses (and later resumes) when the system stops and restarts the audio, without touching a user's own pause. */
  #handleInterruption(interrupted: boolean): void {
    this.interrupted = interrupted;

    if (interrupted) {
      if (this.status !== "playing" && this.status !== "buffering") return;
      this.#pausedByInterruption = true;
      this.status = "paused";
      return;
    }
    if (this.#pausedByInterruption && this.status === "paused") this.status = this.#statusAfterPause();
    this.#pausedByInterruption = false;
  }

  #start(tracks: Track[], timeSeconds: number): Promise<void> {
    this.stop();
    const [first] = tracks;
    if (!first) return Promise.resolve();

    const runId = this.#runId;
    const startSector = startSectorForTime(first, timeSeconds);
    this.error = "";
    this.unreadableSectors = 0;
    this.queue = tracks;
    this.trackNumber = first.number;
    this.positionSeconds = startSector / SECTORS_PER_SECOND;
    this.status = "loading";
    this.#trackPosition(runId);
    return this.#pump(runId, startSector);
  }

  /** Fetches every queued track in order, picking up tracks added while it runs. Reports failures in `error`. */
  #pump(runId: number, firstStartSector = 0): Promise<void> {
    // The loop is abandoned if the run ends or buffered tracks are dropped under it.
    const generation = this.#fetchGeneration;
    const isCancelled = () => runId !== this.#runId || generation !== this.#fetchGeneration;

    return this.#fetchQueue(isCancelled, firstStartSector).catch((reason) => {
      if (isCancelled()) return;
      this.error = String(reason);
      this.stop();
    });
  }

  async #fetchQueue(isCancelled: () => boolean, firstStartSector: number): Promise<void> {
    this.#fetching = true;
    let startSector = firstStartSector;

    while (!isCancelled() && this.queue[this.#fetchIndex]) {
      await this.#fetchTrack(this.queue[this.#fetchIndex], startSector, isCancelled);
      if (isCancelled()) return;
      this.#fetchIndex++;
      startSector = 0;
    }
    if (!isCancelled()) this.#fetching = false;
  }

  /** Reads one track's chunks and schedules them, topping the lead up to `TARGET_LEAD_SECONDS`. */
  async #fetchTrack(track: Track, startSector: number, isCancelled: () => boolean): Promise<void> {
    const totalSectors = trackSectorCount(track);
    let cursorSector = startSector;
    // Only the very first chunk of a run is short; later tracks already have a lead to hide a slow read.
    let isFirstChunk = this.#spans.length === 0;

    while (cursorSector < totalSectors) {
      // Wait while the lead is full, or paused (the lead isn't shrinking then).
      while (this.status === "paused" || this.#handler.leadSeconds >= TARGET_LEAD_SECONDS) {
        await sleep(LEAD_CHECK_INTERVAL_MS);
        if (isCancelled()) return;
      }

      const sectorCount = nextChunkSectorCount(track, cursorSector, isFirstChunk);
      const response = await this.#fetchChunk(chunkUrl(this.#baseUrl, track.number, cursorSector, sectorCount));
      const body = await response.arrayBuffer();
      if (isCancelled()) return;
      if (!response.ok) throw new Error(`${response.status}: ${new TextDecoder().decode(body)}`);

      const sectorsRead = Math.floor(body.byteLength / SECTOR_BYTES);
      if (sectorsRead === 0) throw new Error("drive returned no audio");
      // The bridge has already swapped sectors it couldn't read for silence, so playback carries on.
      this.unreadableSectors += Number(response.headers.get(UNREADABLE_SECTORS_HEADER)) || 0;

      // Record where this track starts on the timeline before its first chunk is scheduled.
      if (cursorSector === startSector) {
        this.#spans.push({
          trackNumber: track.number,
          startSeconds: this.#scheduledSeconds,
          offsetSeconds: startSector / SECTORS_PER_SECOND,
        });
      }
      this.#handler.appendSegment(body);
      this.#scheduledSeconds += sectorsRead / SECTORS_PER_SECOND;
      cursorSector += sectorsRead;
      this.#markPlaying();
      isFirstChunk = false;
    }
  }

  /** Updates the current track and `positionSeconds` each frame for the life of this run. */
  #trackPosition(runId: number): void {
    const tick = () => {
      if (runId !== this.#runId) return;
      if (this.status === "playing" || this.status === "buffering") this.#syncPosition();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  #syncPosition(): void {
    const timelineSeconds = this.#handler.playedSeconds;

    // Drop tracks that have finished playing so `queue[0]` is always the current one.
    const finishedCount = currentSpanIndex(this.#spans, timelineSeconds);
    if (finishedCount > 0) {
      this.#spans.splice(0, finishedCount);
      this.queue.splice(0, finishedCount);
      this.#fetchIndex -= finishedCount;
    }

    const [span] = this.#spans;
    if (!span) return;
    this.trackNumber = span.trackNumber;
    // A skip lands within a frame of a track start; don't show a position before the track's own start.
    this.positionSeconds = Math.max(span.offsetSeconds, timelineSeconds - span.startSeconds + span.offsetSeconds);
  }
}
