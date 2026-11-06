import { readFileTags, type FileTag } from "$lib/files/fileMetadata";
import { applyTags, createFileTrack, type FileTrack } from "$lib/files/fileTrack";
import type { FileDecoder } from "$lib/files/FileDecoder";
import { openRustFileDecoder } from "$lib/files/RustFileDecoder";
import type { Problem } from "$lib/notifications/notifications.svelte";
import { currentSpanIndex, type TrackSpan } from "./chunks";
import { RESTART_THRESHOLD_SECONDS } from "./navigation";
import { SAMPLE_RATE, WebAudioHandler } from "./WebAudioHandler";

/**
 * - `idle`: nothing playing. The playlist may still hold files.
 * - `loading`: playing was asked for; waiting for the first audio.
 * - `playing`.
 * - `buffering`: playing, but the audio ran out before the next piece was decoded.
 * - `paused`: by the user, or by the system interrupting the audio.
 */
export type FilePlayerStatus = "idle" | "loading" | "playing" | "buffering" | "paused";

interface Options {
  /** Does the audio scheduling. Shared with the CD player in the app; tests pass one built on a fake `AudioContext`. */
  handler?: WebAudioHandler;
  /** Opens a file for streaming decode. Tests pass a fake. */
  openDecoder?: (path: string) => Promise<FileDecoder>;
  /** Reads every tag in a file (resolving to none if it can't). Tests pass a fake. */
  readTags?: (path: string) => Promise<FileTag[]>;
  /** Seconds of audio to hold back before a run starts sounding; defaults to `PREBUFFER_SECONDS`. */
  prebufferSeconds?: number;
  /** Seconds of audio to keep scheduled ahead; defaults to `TARGET_LEAD_SECONDS`. */
  leadSeconds?: number;
  /** Called when a run is about to start, so another player sharing the handler can let go of it. */
  onBeforePlay?: () => void;
  /** Called with a file that couldn't be played, or a warning about one. The page shows it as a toast. */
  onProblem?: (problem: Problem) => void;
}

/** Fade length for play and pause, which avoids clicks. */
const FADE_SECONDS = 0.1;

/** A run doesn't make a sound until this much audio is decoded, so a slow first read can't cause a stutter. */
const PREBUFFER_SECONDS = 5;

/**
 * Keep this much audio scheduled ahead, so a slow decode (or an optical drive) doesn't cause a dropout.
 * It is topped up one chunk at a time as the lead shrinks, so a disc gets a steady trickle of reads
 * rather than a burst and a long idle, and its drive doesn't spin down and up again.
 */
const TARGET_LEAD_SECONDS = 15;

const LEAD_CHECK_INTERVAL_MS = 250;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isActiveStatus = (status: FilePlayerStatus) => status !== "idle";

/**
 * Plays audio files dropped onto the app (or found on an MP3 CD), as a playlist. It is the file counterpart of `CDPlayer`: the
 * decoded audio goes through the same `WebAudioHandler`, so the visualiser and (later) gapless playback work the same way.
 *
 * Unlike the CD queue, `tracks` is the whole playlist and stays put as tracks play; `currentIndex` says
 * which is playing. Files are decoded as a stream (see `FileDecoder`), only as far ahead as `TARGET_LEAD_SECONDS`.
 * While paused the open file is closed (and reopened where it left off on resume), so the operating system
 * can unmount or eject the disc the file is on.
 * The next file is opened while the lead is still ahead, so it joins the stream without a gap. As in
 * `CDPlayer`, the handler's timeline runs across all files, so a `TrackSpan` per file (its `trackNumber` is the
 * playlist index) translates it back into "which file, how far in".
 */
export class FilePlayer {
  status = $state<FilePlayerStatus>("idle");
  /** Every file added, in play order. */
  tracks = $state<FileTrack[]>([]);
  /** Index in `tracks` of the file playing, or `null` when idle. */
  currentIndex = $state<number | null>(null);
  /** Seconds into the current file. */
  positionSeconds = $state(0);
  /** True while the system has stopped the audio without being asked; press Play to continue. */
  interrupted = $state(false);

  current = $derived(this.currentIndex === null ? null : (this.tracks[this.currentIndex] ?? null));
  /** Length of the current file in seconds, for a seek bar. */
  durationSeconds = $derived(this.current?.durationSeconds ?? 0);
  isActive = $derived(isActiveStatus(this.status));

  #handler: WebAudioHandler;
  #openDecoder: (path: string) => Promise<FileDecoder>;
  #readTags: (path: string) => Promise<FileTag[]>;
  #onBeforePlay: () => void;
  #onProblem: (problem: Problem) => void;
  #prebufferSeconds: number;
  #leadSeconds: number;
  /** Bumped by every `#start()` and stop; an older run sees the change and abandons its work. */
  #runId = 0;
  /** Timeline position of each decoded file. */
  #spans: TrackSpan[] = [];
  /** Index in `tracks` of the file being decoded (or the next to decode). */
  #fetchIndex = 0;
  /** True while the decode loop has files left to read. */
  #fetching = false;
  /** Seconds of audio scheduled so far on the handler's timeline. */
  #scheduledSeconds = 0;
  /** True from the start of a run until `#prebufferSeconds` are buffered; the handler is held silent meanwhile. */
  #prebuffering = false;
  /** True while the decode loop holds an open decoder for file `#fetchIndex`. */
  #isDecoderOpen = false;
  /** Where the decode loop should move its decoder to, set by a seek in the file it is decoding. */
  #pendingSeekSeconds: number | null = null;
  #startedPlaying = false;
  /** True when `status` became `paused` because of an interruption, not because the user paused. */
  #pausedByInterruption = false;

  constructor({
    handler = new WebAudioHandler({ fadeSeconds: () => FADE_SECONDS }),
    openDecoder = (path) => openRustFileDecoder(path),
    readTags = (path) => readFileTags(path),
    prebufferSeconds = PREBUFFER_SECONDS,
    leadSeconds = TARGET_LEAD_SECONDS,
    onBeforePlay = () => {},
    onProblem = () => {},
  }: Options = {}) {
    this.#handler = handler;
    this.#onProblem = onProblem;
    this.#openDecoder = openDecoder;
    this.#readTags = readTags;
    this.#prebufferSeconds = prebufferSeconds;
    this.#leadSeconds = leadSeconds;
    this.#onBeforePlay = onBeforePlay;
  }

  /** Stops any audio. */
  destroy(): void {
    this.#teardownPlayback();
    this.status = "idle";
  }

  /** The file's title tag, or its name without the extension when it has none. */
  trackTitle({ title }: FileTrack): string {
    return title;
  }

  /** Fills `target` with the latest output samples (128 = silence) for a visualiser. `false` if there is no audio yet. */
  readWaveform(target: Uint8Array<ArrayBuffer>): boolean {
    return this.#handler.readWaveform(target);
  }

  /**
   * Adds files to the end of the playlist, and starts playing the first of them if nothing is playing
   * (unless `play` is false, which only lists them).
   */
  enqueue(paths: string[], { play = true } = {}): void {
    if (paths.length === 0) return;
    const firstNewIndex = this.tracks.length;
    const newTracks = paths.map(createFileTrack);
    this.tracks.push(...newTracks);
    // Titles show the file names first; playback never waits on tags.
    void this.#loadTags(newTracks.map(({ id, path }) => ({ id, path })));

    if (this.status === "idle") {
      if (play) void this.#start(firstNewIndex, 0);
      return;
    }
    if (!this.#fetching) void this.#pump(this.#runId, 0);
  }

  /**
   * Reads the tags of `files` one at a time, top to bottom, and fills them into the playlist. In series on purpose:
   * on an optical drive, reading several files at once makes the laser seek back and forth between them.
   * Tracks are found again by id because the playlist may have been cleared while the tags were being read.
   */
  #loadTags(files: { id: string; path: string }[]): Promise<void> {
    return files.reduce(
      (previous, { id, path }) => previous.then(async () => this.#fillTags(id, await this.#readTags(path))),
      Promise.resolve(),
    );
  }

  #fillTags(id: string, tags: FileTag[]): void {
    const track = this.tracks.find((candidate) => candidate.id === id);
    if (!track || tags.length === 0) return;
    Object.assign(track, applyTags(track, tags));
  }

  /** Empties the playlist and stops. */
  clear(): void {
    this.stop();
    this.tracks = [];
  }

  /** Plays the playlist from `track` on. */
  playFrom(track: FileTrack): Promise<void> {
    const index = this.tracks.findIndex(({ id }) => id === track.id);
    return index === -1 ? Promise.resolve() : this.#start(index, 0);
  }

  /** The play/pause button: pauses or resumes if audio is active, otherwise plays the playlist from the start. */
  playPause(): Promise<void> {
    if (this.isActive) return this.togglePause();
    return this.tracks.length > 0 ? this.#start(0, 0) : Promise.resolve();
  }

  /** The previous button: restarts the file if it has been playing a while, otherwise plays the one before it. */
  previous(): Promise<void> {
    const index = this.currentIndex;
    if (index === null) return Promise.resolve();
    if (this.positionSeconds > RESTART_THRESHOLD_SECONDS || index === 0) return this.seek(0);
    return this.#start(index - 1, 0);
  }

  /**
   * Skips to the next file. If its start is already buffered this is instant and gapless: the buffered
   * audio is re-timed to play now. Otherwise it restarts, so there is a wait for the first audio.
   */
  next(): Promise<void> {
    const index = this.currentIndex;
    if (index === null) return Promise.resolve();
    const nextIndex = index + 1;
    if (!this.tracks[nextIndex]) return Promise.resolve(this.stop());

    const nextSpan = this.#spans.find(({ trackNumber }) => trackNumber === nextIndex);
    if (!nextSpan || !this.#handler.skipTo(nextSpan.startSeconds)) return this.#start(nextIndex, 0);

    this.currentIndex = nextIndex;
    this.positionSeconds = nextSpan.offsetSeconds;
    return Promise.resolve();
  }

  /**
   * Moves to `seconds` in the current file. Instant if that point is already buffered; otherwise the file
   * is reopened at that point and waits for its first audio. A pause is kept.
   */
  seek(seconds: number): Promise<void> {
    const index = this.currentIndex;
    if (index === null) return Promise.resolve();

    const spanIndex = this.#spans.findLastIndex(({ trackNumber }) => trackNumber === index);
    const span = this.#spans[spanIndex];
    if (span && seconds >= span.offsetSeconds) {
      const timelineSeconds = span.startSeconds + seconds - span.offsetSeconds;
      const bufferedEnd = this.#spans[spanIndex + 1]?.startSeconds ?? this.#scheduledSeconds;
      if (timelineSeconds < bufferedEnd && this.#handler.skipTo(timelineSeconds)) {
        this.positionSeconds = seconds;
        return Promise.resolve();
      }
    }

    // The decoder for this file is still open: move it rather than reopening and parsing the file again.
    if (this.#isDecoderOpen && this.#fetchIndex === index) {
      this.#seekInPlace(seconds);
      return Promise.resolve();
    }

    const wasPaused = this.status === "paused";
    const restarted = this.#start(index, seconds);
    if (wasPaused) void this.pause();
    return restarted;
  }

  /**
   * Clears what is scheduled and has the decode loop move its open decoder to `seconds`, then refill the
   * prebuffer. The loop applies it once its current `read()` has returned, since a decoder can't be moved mid-read.
   */
  #seekInPlace(seconds: number): void {
    this.#handler.stop();
    this.#spans = [];
    this.#scheduledSeconds = 0;
    this.#startedPlaying = false;
    this.#prebuffering = true;
    this.#pendingSeekSeconds = seconds;
    this.positionSeconds = seconds;
    // A pause is kept; otherwise it is loading again until the prebuffer is full.
    if (this.status !== "paused") this.status = "loading";
    void this.#handler.suspend();
  }

  /** Stops playback. The playlist stays. */
  stop(): void {
    if (!this.isActive) return;
    this.#teardownPlayback();
    this.status = "idle";
  }

  /**
   * Lets go of the shared handler because another player is taking it: stops like `stop()` but leaves the
   * handler alone, since it now belongs to the other player.
   */
  release(): void {
    if (!this.isActive) return;
    this.#teardownPlayback({ stopHandler: false });
    this.status = "idle";
  }

  /** Pauses from any active state, including `loading`: the first audio then waits, silent, until `resume()`. */
  async pause(): Promise<void> {
    if (this.status !== "loading" && this.status !== "playing" && this.status !== "buffering") return;
    this.status = "paused";
    await this.#handler.suspend();
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") return;
    // The user pressing Play takes over from an interruption.
    this.#pausedByInterruption = false;
    this.interrupted = false;
    // Still prebuffering: the handler stays held until enough is buffered.
    if (this.#prebuffering) {
      this.status = "loading";
      this.#openGateIfReady();
      return;
    }
    await this.#handler.resume();
    this.status = this.#statusAfterPause();
  }

  togglePause(): Promise<void> {
    return this.status === "paused" ? this.resume() : this.pause();
  }

  /** The handler's callbacks point at this player while it runs, since the handler may be shared. */
  #claimHandler(): void {
    // Segments can run dry mid-playlist on a slow decode: that is buffering, and only the end once everything is decoded.
    this.#handler.onEnded = () => {
      if (!this.#fetching) return this.stop();
      if (this.status === "playing") this.status = "buffering";
    };
    this.#handler.onInterruption = (interrupted) => this.#handleInterruption(interrupted);
  }

  /** Forgets the run, without changing `status` (the caller does that). */
  #teardownPlayback({ stopHandler = true } = {}): void {
    this.#runId++;
    if (stopHandler) this.#handler.stop();
    this.#spans = [];
    this.#fetchIndex = 0;
    this.#fetching = false;
    this.#scheduledSeconds = 0;
    this.currentIndex = null;
    this.positionSeconds = 0;
    this.interrupted = false;
    this.#startedPlaying = false;
    this.#pausedByInterruption = false;
    this.#prebuffering = false;
    this.#isDecoderOpen = false;
    this.#pendingSeekSeconds = null;
  }

  /** What the player was doing before a pause, worked out from the audio rather than remembered. */
  #statusAfterPause(): "loading" | "playing" | "buffering" {
    if (this.#prebuffering) return "loading";
    if (this.#handler.hasQueuedAudio) return "playing";
    return this.#startedPlaying ? "buffering" : "loading";
  }

  /**
   * Starts the sound once enough is buffered, or once the whole playlist is (a short file never reaches the
   * target). Does nothing while the user has paused: `resume()` tries again.
   */
  #openGateIfReady(): void {
    if (!this.#prebuffering || this.status === "paused" || !this.#handler.hasQueuedAudio) return;
    const isEnoughBuffered = this.#handler.leadSeconds >= this.#prebufferSeconds;
    if (!isEnoughBuffered && this.#fetching) return;

    this.#prebuffering = false;
    void this.#handler.resume();
    this.#markPlaying();
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

  /** Plays the playlist from file `index`, starting it `timeSeconds` in. */
  #start(index: number, timeSeconds: number): Promise<void> {
    if (!this.tracks[index]) return Promise.resolve();

    this.#onBeforePlay();
    this.#claimHandler();
    this.#teardownPlayback();
    const runId = this.#runId;
    this.currentIndex = index;
    this.#fetchIndex = index;
    this.positionSeconds = timeSeconds;
    this.status = "loading";
    // Hold the audio silent until the prebuffer is full.
    this.#prebuffering = true;
    void this.#handler.suspend();
    this.#trackPosition(runId);
    return this.#pump(runId, timeSeconds);
  }

  /** Decodes every file from `#fetchIndex` on, picking up files added while it runs. */
  async #pump(runId: number, firstOffsetSeconds: number): Promise<void> {
    const isCancelled = () => runId !== this.#runId;
    this.#fetching = true;
    let offsetSeconds = firstOffsetSeconds;

    while (!isCancelled() && this.tracks[this.#fetchIndex]) {
      const track = this.tracks[this.#fetchIndex];
      // One bad file is skipped; the rest of the playlist carries on.
      await this.#decodeTrack(this.#fetchIndex, offsetSeconds, isCancelled).catch((reason) => {
        if (isCancelled()) return;
        this.#onProblem({
          variant: "error",
          title: `Couldn't play ${track.title}`,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
      if (isCancelled()) return;
      this.#fetchIndex++;
      offsetSeconds = 0;
    }
    if (isCancelled()) return;

    this.#fetching = false;
    // Nothing could be decoded at all (every file failed): there is nothing to wait for.
    if (!this.#handler.hasQueuedAudio) return this.stop();
    this.#openGateIfReady();
  }

  /**
   * Decodes one file and schedules it, topping the lead up to `#leadSeconds`. While paused the file is closed,
   * so a disc it is on can be ejected; it is reopened where it left off when playing resumes.
   */
  async #decodeTrack(index: number, offsetSeconds: number, isCancelled: () => boolean): Promise<void> {
    const track = this.tracks[index];
    // Said once per file: a badly damaged one would otherwise warn on every chunk.
    let hasWarnedOfDamage = false;
    /** Seconds into the file that the next read returns; where a reopened decoder is moved to. */
    let decodedSeconds = offsetSeconds;
    let isFirstBuffer = true;
    let decoder: FileDecoder | null = null;

    /** Opens the file at `decodedSeconds`; `null` if the run was cancelled meanwhile. */
    const openDecoder = async (): Promise<FileDecoder | null> => {
      const opened = await this.#openDecoder(track.path);
      if (isCancelled()) {
        opened.close();
        return null;
      }
      track.durationSeconds = opened.durationSeconds;
      opened.onDamagedAudio = (damagedPackets) => {
        if (hasWarnedOfDamage) return;
        hasWarnedOfDamage = true;
        this.#onProblem({
          variant: "warning",
          title: `${track.title} is damaged`,
          message: `Some audio couldn't be decoded and was skipped (${damagedPackets} packet${damagedPackets === 1 ? "" : "s"} so far).`,
        });
      };
      if (decodedSeconds > 0) opened.seek(decodedSeconds);
      this.#isDecoderOpen = true;
      return opened;
    };

    try {
      decoder = await openDecoder();
      if (!decoder) return;

      while (!isCancelled()) {
        // Wait while the lead is full, or paused (the lead isn't shrinking then).
        while (this.status === "paused" || this.#handler.leadSeconds >= this.#leadSeconds) {
          // Pausing lets go of the file, so the disc it is on can be ejected.
          if (this.status === "paused" && decoder) {
            decoder.close();
            decoder = null;
            this.#isDecoderOpen = false;
          }
          await sleep(LEAD_CHECK_INTERVAL_MS);
          if (isCancelled()) return;
        }

        if (!decoder) {
          // A seek made while paused wins over where the file was left.
          if (this.#pendingSeekSeconds !== null) {
            offsetSeconds = decodedSeconds = this.#pendingSeekSeconds;
            this.#pendingSeekSeconds = null;
            isFirstBuffer = true;
          }
          decoder = await openDecoder();
          if (!decoder) return;
        }

        const buffer = await decoder.read();
        if (isCancelled()) return;

        // A seek arrived during the read: that buffer is from the old position, so drop it and move there.
        if (this.#pendingSeekSeconds !== null) {
          offsetSeconds = decodedSeconds = this.#pendingSeekSeconds;
          this.#pendingSeekSeconds = null;
          decoder.seek(offsetSeconds);
          isFirstBuffer = true;
          continue;
        }
        if (!buffer) return;

        // Record where this file starts on the timeline before its first buffer is scheduled.
        if (isFirstBuffer) {
          this.#spans.push({ trackNumber: index, startSeconds: this.#scheduledSeconds, offsetSeconds });
          isFirstBuffer = false;
        }
        this.#handler.appendBuffer(buffer);
        const bufferSeconds = buffer.length / SAMPLE_RATE;
        this.#scheduledSeconds += bufferSeconds;
        decodedSeconds += bufferSeconds;
        if (this.#prebuffering) this.#openGateIfReady();
        else this.#markPlaying();
      }
    } finally {
      // A cancelled run finishes late, after a new run may have opened its own decoder; leave that run's flag alone.
      if (!isCancelled()) this.#isDecoderOpen = false;
      decoder?.close();
    }
  }

  /** Updates the current file and `positionSeconds` each frame for the life of this run. */
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
    const span = this.#spans[currentSpanIndex(this.#spans, timelineSeconds)];
    if (!span) return;
    this.currentIndex = span.trackNumber;
    // A skip lands within a frame of a file start; don't show a position before the file's own start.
    this.positionSeconds = Math.max(span.offsetSeconds, timelineSeconds - span.startSeconds + span.offsetSeconds);
  }
}
