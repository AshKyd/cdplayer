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

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

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
   * The playing track first, then those after it. Tracks near the front may already be fetched
   * (buffered ahead for gapless playback) and can't be removed.
   */
  queue = $state<Track[]>([]);

  #handler = new WebAudioHandler();
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

  constructor() {
    // Segments can run dry mid-queue on a slow read, so only treat it as the end once everything is fetched.
    this.#handler.onEnded = () => {
      if (!this.#fetching) this.stop();
    };
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

  /** Drops tracks that haven't been fetched yet. Anything already buffered still plays. */
  clearQueue(): void {
    this.queue.splice(this.#fetchIndex + 1);
  }

  /** Skips to the next queued track. Not gapless: it flushes the buffer and restarts. */
  next(): Promise<void> {
    const [, ...upcoming] = this.queue;
    return upcoming.length > 0 ? this.#start(upcoming, 0) : Promise.resolve(this.stop());
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
  }

  async pause(): Promise<void> {
    if (this.status !== "playing") return;
    this.status = "paused";
    await this.#handler.suspend();
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") return;
    await this.#handler.resume();
    this.status = "playing";
  }

  togglePause(): Promise<void> {
    return this.status === "paused" ? this.resume() : this.pause();
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
    return this.#fetchQueue(runId, firstStartSector).catch((reason) => {
      if (runId !== this.#runId) return;
      this.error = String(reason);
      this.stop();
    });
  }

  async #fetchQueue(runId: number, firstStartSector: number): Promise<void> {
    this.#fetching = true;
    let startSector = firstStartSector;

    while (runId === this.#runId && this.queue[this.#fetchIndex]) {
      await this.#fetchTrack(this.queue[this.#fetchIndex], startSector, runId);
      if (runId !== this.#runId) return;
      this.#fetchIndex++;
      startSector = 0;
    }
    this.#fetching = false;
  }

  /** Reads one track's chunks and schedules them, topping the lead up to `TARGET_LEAD_SECONDS`. */
  async #fetchTrack(track: Track, startSector: number, runId: number): Promise<void> {
    const totalSectors = trackSectorCount(track);
    let cursorSector = startSector;
    // Only the very first chunk of a run is short; later tracks already have a lead to hide a slow read.
    let isFirstChunk = this.#spans.length === 0;

    while (cursorSector < totalSectors) {
      // Wait while the lead is full, or paused (the lead isn't shrinking then).
      while (this.status === "paused" || this.#handler.leadSeconds >= TARGET_LEAD_SECONDS) {
        await sleep(LEAD_CHECK_INTERVAL_MS);
        if (runId !== this.#runId) return;
      }

      const sectorCount = nextChunkSectorCount(track, cursorSector, isFirstChunk);
      const response = await fetch(chunkUrl(track.number, cursorSector, sectorCount));
      const body = await response.arrayBuffer();
      if (runId !== this.#runId) return;
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
      if (this.status === "loading") this.status = "playing";
      isFirstChunk = false;
    }
  }

  /** Updates the current track and `positionSeconds` each frame for the life of this run. */
  #trackPosition(runId: number): void {
    const tick = () => {
      if (runId !== this.#runId) return;
      if (this.status === "playing") this.#syncPosition();
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
    this.positionSeconds = timelineSeconds - span.startSeconds + span.offsetSeconds;
  }
}
