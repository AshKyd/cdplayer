import { SECTORS_PER_SECOND, type Track } from "$lib/disc/types";
import { chunkUrl, nextChunkSectorCount, startSectorForTime, trackSectorCount } from "./chunks";
import { WebAudioHandler } from "./WebAudioHandler";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

/** Bytes per CD sector of raw PCM. */
const SECTOR_BYTES = 2352;

/** Keep this much audio scheduled ahead, so a slow drive read doesn't cause a dropout. */
const TARGET_LEAD_SECONDS = 30;

const LEAD_CHECK_INTERVAL_MS = 250;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Plays one CD track: reads sector chunks through the `cd-track` protocol and hands the PCM to a
 * `WebAudioHandler`. Holds playback state for the UI. Audio scheduling lives in the handler so other
 * sources (e.g. MP3 CDs) can reuse it.
 */
export class CDPlayer {
  status = $state<PlayerStatus>("idle");
  trackNumber = $state<number | null>(null);
  /** Seconds into the track. */
  positionSeconds = $state(0);
  error = $state("");

  #handler = new WebAudioHandler();
  /** Bumped by every `play()`/`stop()`; an older run sees the change and abandons its work. */
  #runId = 0;
  /** True once the last chunk of the track has been scheduled. */
  #allChunksScheduled = false;
  #startOffsetSeconds = 0;

  constructor() {
    // Segments can run dry mid-track on a slow read, so only treat it as the end once everything is fetched.
    this.#handler.onEnded = () => {
      if (this.#allChunksScheduled) this.#finish();
    };
  }

  /** Stops whatever is playing, then plays `track` from `timeSeconds`. */
  async play(track: Track, timeSeconds = 0): Promise<void> {
    this.stop();
    const runId = this.#runId;
    const startSector = startSectorForTime(track, timeSeconds);

    this.error = "";
    this.trackNumber = track.number;
    this.#startOffsetSeconds = startSector / SECTORS_PER_SECOND;
    this.positionSeconds = this.#startOffsetSeconds;
    this.status = "loading";
    this.#trackPosition(runId);

    await this.#fetchChunks(track, startSector, runId).catch((reason) => {
      if (runId !== this.#runId) return;
      this.error = String(reason);
      this.stop();
    });
  }

  stop(): void {
    this.#runId++;
    this.#handler.stop();
    this.#allChunksScheduled = false;
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

  #finish(): void {
    this.#runId++;
    this.status = "idle";
    this.trackNumber = null;
    this.positionSeconds = 0;
    this.#allChunksScheduled = false;
  }

  /** Reads chunks in order and schedules them, topping the lead up to `TARGET_LEAD_SECONDS`. */
  async #fetchChunks(track: Track, startSector: number, runId: number): Promise<void> {
    const totalSectors = trackSectorCount(track);
    let cursorSector = startSector;
    let isFirstChunk = true;

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

      this.#handler.appendSegment(body);
      cursorSector += sectorsRead;
      if (isFirstChunk) this.status = "playing";
      isFirstChunk = false;
    }

    this.#allChunksScheduled = true;
  }

  /** Updates `positionSeconds` each frame for the life of this run. */
  #trackPosition(runId: number): void {
    const tick = () => {
      if (runId !== this.#runId) return;
      if (this.status === "playing") {
        this.positionSeconds = this.#startOffsetSeconds + this.#handler.playedSeconds;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
