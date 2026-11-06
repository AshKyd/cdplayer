import { cdTrackBaseUrl } from "$lib/disc/cdTrackUrl";
import { DiscWatcher } from "$lib/disc/DiscWatcher.svelte";
import { SECTORS_PER_SECOND, type Toc, type Track } from "$lib/disc/types";
import { lookupDiscMetadata } from "$lib/metadata/musicBrainz";
import { revokeCoverUrl, type DiscMetadata } from "$lib/metadata/types";
import { settings } from "$lib/settings/settings.svelte";
import {
  chunkUrl,
  currentSpanIndex,
  nextChunkSectorCount,
  startSectorForTime,
  trackSectorCount,
  type TrackSpan,
} from "./chunks";
import { previousStep, tracksFrom } from "./navigation";
import { isPlaybackActive, transition, type PlayerEvent, type PlayerStatus } from "./playerMachine";
import { WebAudioHandler } from "./WebAudioHandler";

export type { PlayerStatus } from "./playerMachine";

interface Options {
  /** Does the audio scheduling. Tests pass one built on a fake `AudioContext`. */
  handler?: WebAudioHandler;
  /** Fetches one chunk by URL. Tests pass a fake. */
  fetchChunk?: (url: string) => Promise<Response>;
  /** Root of the `cd-track` protocol, which differs by platform. Defaults to what Tauri reports. */
  baseUrl?: string;
  /** Reads the disc's table of contents; defaults to the `get_toc` command. Tests pass a fake. */
  loadToc?: () => Promise<Toc>;
  /** Looks up a disc's track names and cover; defaults to MusicBrainz. Tests pass a fake. */
  loadMetadata?: (toc: Toc) => Promise<DiscMetadata>;
  /** Whether to look discs up at all; defaults to the MusicBrainz setting. Tests pass a fake. */
  isMetadataLookupEnabled?: () => boolean;
  /** Whether to play a disc as soon as it is ready; defaults to the autoplay setting. Tests pass a fake. */
  isAutoplayEnabled?: () => boolean;
  /** Time between checks for a new or removed disc, while nothing is playing. */
  discCheckIntervalMs?: number;
  /** Seconds of audio to hold back before a run starts sounding; defaults to `PREBUFFER_SECONDS`. */
  prebufferSeconds?: number;
  /** Called when a run is about to start, so another player sharing the handler can let go of it. */
  onBeforePlay?: () => void;
  /** Called when a disc is found, replaced or removed (`null`), so the page can show the disc instead of files. */
  onDiscChange?: (toc: Toc | null) => void;
}

/** Fade length for play and pause, which avoids clicks. */
const FADE_SECONDS = 0.1;

/**
 * A run doesn't make a sound until this much audio is buffered, so a slow drive read right after the
 * start can't cause a stutter.
 */
const PREBUFFER_SECONDS = 5;

/** Bytes per CD sector of raw PCM. */
const SECTOR_BYTES = 2352;

/** Keep this much audio scheduled ahead, so a slow drive read doesn't cause a dropout. */
const TARGET_LEAD_SECONDS = 30;

const LEAD_CHECK_INTERVAL_MS = 250;

/** Response header from the `cd-track` protocol: sectors in the chunk that were unreadable. */
const UNREADABLE_SECTORS_HEADER = "X-Unreadable-Sectors";

/**
 * The CD player: finds the disc, looks up its track names, and plays a queue of its tracks.
 *
 * Its life is one state machine (`status`, with the rules in `playerMachine.ts`): no disc, loading the
 * disc's metadata, ready, then loading, playing, buffering or paused. Every step goes through
 * `#dispatch()`, so it only happens when the state allows it. The tracks are not shown or playable until
 * the metadata lookup has finished, whether it found the disc or not.
 *
 * Playback reads sector chunks through the `cd-track` protocol and hands the PCM to a `WebAudioHandler`.
 * Audio scheduling lives in the handler so other sources (e.g. MP3 CDs) can reuse it.
 *
 * Gapless: the handler joins segments by frame count and doesn't care which track they came from, so the
 * next track is simply fetched into the same stream while the lead is still ~30 s ahead. The handler's
 * timeline runs across all tracks, so this class keeps a `TrackSpan` per track to translate it back into
 * "which track, how far in".
 */
export class CDPlayer {
  status = $state<PlayerStatus>("noDisc");
  /** The tracks of the disc in the drive, in disc order. Empty with no disc. */
  tracks = $state<Track[]>([]);
  /** What MusicBrainz knows about the disc, or `null` while looking, with no disc, or if it wasn't found. */
  metadata = $state<DiscMetadata | null>(null);
  /** Why the lookup found nothing (not on MusicBrainz, offline, ...). Empty otherwise. */
  metadataError = $state("");
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

  /** Why there is no disc (no drive, empty drive), as last reported by the drive. */
  get discError(): string {
    return this.#watcher.error;
  }

  /** True while the drive is taking noticeably long to say what disc it holds (a disc spinning up). */
  get readingDisc(): boolean {
    return this.#watcher.reading;
  }

  #handler: WebAudioHandler;
  #watcher: DiscWatcher;
  #fetchChunk: (url: string) => Promise<Response>;
  #loadMetadata: (toc: Toc) => Promise<DiscMetadata>;
  #isMetadataLookupEnabled: () => boolean;
  #isAutoplayEnabled: () => boolean;
  #baseUrl: string;
  /** Bumped for every disc found or removed, so a lookup for an earlier disc is ignored when it finishes. */
  #discToken = 0;
  /** Bumped when buffered tracks are dropped, so a fetch loop that was reading one of them stops. */
  #fetchGeneration = 0;
  /** True once the first chunk of this run has been scheduled. */
  #startedPlaying = false;
  /** True when `status` became `paused` because of an interruption, not because the user paused. */
  #pausedByInterruption = false;
  /** Bumped by every `playQueue()` and `stop()`; an older run sees the change and abandons its work. */
  #runId = 0;
  /** Timeline position of each fetched track. `#spans[i]` belongs to `queue[i]`. */
  #spans: TrackSpan[] = [];
  /** Index in `queue` of the track being fetched (or the next to fetch). */
  #fetchIndex = 0;
  /** True while the fetch loop has tracks left to read. */
  #fetching = false;
  /** True while a chunk is being read from the drive; the watcher must not re-open the drive then. */
  #isReadingChunk = false;
  /** Set by `resume()`: the next chunk is read even though the buffer is full, to wake the drive. */
  #wakeRead = false;
  /** Cuts short the fetch loop's current sleep. `null` when it isn't sleeping. */
  #wakeFetchLoop: (() => void) | null = null;
  /** Seconds of audio scheduled so far on the handler's timeline. */
  #scheduledSeconds = 0;
  /** True from the start of a run until `#prebufferSeconds` are buffered; the handler is held silent meanwhile. */
  #prebuffering = false;
  #prebufferSeconds: number;
  #onBeforePlay: () => void;
  #onDiscChange: (toc: Toc | null) => void;

  constructor({
    handler = new WebAudioHandler({ fadeSeconds: () => FADE_SECONDS }),
    prebufferSeconds = PREBUFFER_SECONDS,
    fetchChunk = (url) => fetch(url),
    baseUrl = cdTrackBaseUrl(),
    loadToc,
    loadMetadata = (toc) => lookupDiscMetadata(toc),
    isMetadataLookupEnabled = () => settings.musicBrainzEnabled,
    isAutoplayEnabled = () => settings.autoplayEnabled,
    discCheckIntervalMs,
    onBeforePlay = () => {},
    onDiscChange = () => {},
  }: Options = {}) {
    this.#handler = handler;
    this.#onBeforePlay = onBeforePlay;
    this.#onDiscChange = onDiscChange;
    this.#prebufferSeconds = prebufferSeconds;
    this.#fetchChunk = fetchChunk;
    this.#baseUrl = baseUrl;
    this.#loadMetadata = loadMetadata;
    this.#isMetadataLookupEnabled = isMetadataLookupEnabled;
    this.#isAutoplayEnabled = isAutoplayEnabled;

    // The drive is left alone while audio is being read: re-opening it would cut off reads. When paused
    // the fetch loop idles, so the watcher keeps polling (between chunk reads) to notice an eject.
    this.#watcher = new DiscWatcher({
      loadToc,
      intervalMs: discCheckIntervalMs,
      isBusy: () => this.#isReadingChunk || (isPlaybackActive(this.status) && this.status !== "paused"),
      onChange: (toc) => this.#handleDiscChange(toc),
    });

    this.#claimHandler();
  }

  /**
   * Points the handler's callbacks at this player. The handler may be shared with the file player, so
   * whichever player starts a run claims it.
   */
  #claimHandler(): void {
    // Segments can run dry mid-queue on a slow read: that is buffering, and only the end once everything is fetched.
    this.#handler.onEnded = () => {
      if (!this.#fetching) return this.stop();
      this.#dispatch({ type: "underrun" });
    };
    this.#handler.onInterruption = (interrupted) => this.#handleInterruption(interrupted);
  }

  /**
   * Lets go of the shared handler because another player is taking it: forgets the queue and goes back to
   * `ready`, but leaves the handler alone, since it now belongs to the other player.
   */
  release(): void {
    if (this.#dispatch({ type: "stop" })) this.#teardownPlayback({ stopHandler: false });
  }

  /** Starts watching the drive for a disc. */
  start(): void {
    this.#watcher.start();
  }

  /** Stops watching the drive and stops any audio. */
  destroy(): void {
    this.#watcher.stop();
    this.#teardownPlayback();
  }

  /** Looks at the drive now. Does nothing while audio is active. */
  checkDisc(): Promise<void> {
    return this.#watcher.checkNow();
  }

  /** The track's name from MusicBrainz, or "Track N" if the disc wasn't found. */
  trackTitle({ number, is_audio }: Track): string {
    if (!is_audio) return "Data track";
    return this.metadata?.tracks.find((track) => track.number === number)?.title || `Track ${number}`;
  }

  /** The track's own artist from MusicBrainz when it differs from the album's (a compilation), otherwise empty. */
  trackArtist({ number }: Track): string {
    const artist = this.metadata?.tracks.find((track) => track.number === number)?.artist ?? "";
    return artist === this.metadata?.artist ? "" : artist;
  }

  /** Fills `target` with the latest output samples (128 = silence) for a visualiser. `false` if there is no audio yet. */
  readWaveform(target: Uint8Array<ArrayBuffer>): boolean {
    return this.#handler.readWaveform(target);
  }

  /** Stops whatever is playing, then plays `track` alone from `timeSeconds`. */
  play(track: Track, timeSeconds = 0): Promise<void> {
    return this.playQueue([track], timeSeconds);
  }

  /** Stops whatever is playing, then plays `tracks` in order, starting the first at `timeSeconds`. Data tracks are skipped. */
  playQueue(tracks: Track[], timeSeconds = 0): Promise<void> {
    return this.#start(
      tracks.filter(({ is_audio }) => is_audio),
      timeSeconds,
    );
  }

  /** Plays `track` and every playable track after it on the disc, replacing the queue. */
  playFrom(track: Track): Promise<void> {
    return this.playQueue(tracksFrom(this.tracks, track));
  }

  /** The play/pause button: pauses or resumes if audio is active, otherwise plays the disc from the first track. */
  playPause(): Promise<void> {
    if (isPlaybackActive(this.status)) return this.togglePause();
    const first = this.tracks.find(({ is_audio }) => is_audio);
    return first ? this.playFrom(first) : Promise.resolve();
  }

  /** The previous button: restarts the track if it has been playing a while, otherwise plays the track before it. */
  previous(): Promise<void> {
    const step = previousStep({
      tracks: this.tracks,
      currentTrackNumber: this.trackNumber,
      positionSeconds: this.positionSeconds,
    });
    return step.kind === "play" ? this.playFrom(step.track) : this.seek(0);
  }

  /** Adds an audio track to the end of the queue, or starts it if nothing is playing. */
  enqueue(track: Track): void {
    if (!track.is_audio) return;
    if (this.status === "ready") {
      void this.play(track);
      return;
    }
    if (!isPlaybackActive(this.status)) return;
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
      // Nothing more is coming, so don't keep waiting for a full prebuffer.
      this.#openGateIfReady();
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

  /** Stops playback and clears the queue. The disc stays, ready to play. */
  stop(): void {
    if (this.#dispatch({ type: "stop" })) this.#teardownPlayback();
  }

  /** Pauses from any active state, including `loading`: the first chunk then waits, silent, until `resume()`. */
  async pause(): Promise<void> {
    if (!this.#dispatch({ type: "pause" })) return;
    await this.#handler.suspend();
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") return;
    // The user pressing Play takes over from an interruption.
    this.#pausedByInterruption = false;
    this.interrupted = false;
    // Still prebuffering: the handler stays held until enough is buffered.
    if (this.#prebuffering) {
      this.#dispatch({ type: "resume", to: "loading" });
      this.#wakeDrive();
      this.#openGateIfReady();
      return;
    }
    await this.#handler.resume();
    this.#dispatch({ type: "resume", to: this.#statusAfterPause() });
    this.#wakeDrive();
  }

  /**
   * Makes the fetch loop read from the disc now, even if the buffer is full. A long pause lets the drive spin
   * down, and the full buffer would otherwise hide that until it ran dry; reading at once spins it up while
   * the buffered audio is still playing.
   */
  #wakeDrive(): void {
    if (!this.#fetching) return;
    this.#wakeRead = true;
    this.#wakeFetchLoop?.();
  }

  /** Sleeps for `milliseconds`, or less if `#wakeDrive()` is called. */
  #sleepUnlessWoken(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, milliseconds);
      const wake = () => done();
      this.#wakeFetchLoop = wake;
      function done() {
        clearTimeout(timer);
        resolve();
      }
    }).finally(() => (this.#wakeFetchLoop = null));
  }

  togglePause(): Promise<void> {
    return this.status === "paused" ? this.resume() : this.pause();
  }

  /** Moves to the next state if the event is allowed in the current one. Returns whether it happened. */
  #dispatch(event: PlayerEvent): boolean {
    const next = transition(this.status, event);
    if (next === null) return false;
    this.status = next;
    return true;
  }

  /** A disc was found, replaced or removed. Whatever was playing or looked up belongs to the old disc. */
  #handleDiscChange(toc: Toc | null): void {
    this.#teardownPlayback();
    const token = ++this.#discToken;
    revokeCoverUrl(this.metadata);
    this.metadata = null;
    this.metadataError = "";
    this.error = "";
    this.unreadableSectors = 0;
    this.#onDiscChange(toc);

    if (!toc) {
      this.tracks = [];
      this.#dispatch({ type: "discRemoved" });
      return;
    }
    this.tracks = toc.tracks;
    this.#dispatch({ type: "discInserted" });
    void this.#lookUpMetadata(toc, token);
  }

  /**
   * Finds the disc's track names. Not finding them is not an error: the disc plays with "Track N".
   * When the user has turned lookups off nothing is sent, and the disc is ready straight away without an error.
   */
  async #lookUpMetadata(toc: Toc, token: number): Promise<void> {
    if (!this.#isMetadataLookupEnabled()) {
      this.#dispatch({ type: "metadataSettled" });
      this.#autoplayIfEnabled();
      return;
    }
    const result = await this.#loadMetadata(toc).then(
      (metadata) => ({ metadata, error: "" }),
      (reason) => ({ metadata: null, error: reason instanceof Error ? reason.message : String(reason) }),
    );
    if (token !== this.#discToken) {
      // The disc changed while looking up, so nothing will ever show this cover.
      revokeCoverUrl(result.metadata);
      return;
    }

    this.metadata = result.metadata;
    this.metadataError = result.error;
    this.#dispatch({ type: "metadataSettled" });
    this.#autoplayIfEnabled();
  }

  /** Plays the disc from the first track once it is ready (after the metadata lookup, so titles are in place). */
  #autoplayIfEnabled(): void {
    if (this.status !== "ready" || !this.#isAutoplayEnabled()) return;
    void this.playPause();
  }

  /** Stops the audio and forgets the queue, without changing `status` (the caller does that). */
  #teardownPlayback({ stopHandler = true } = {}): void {
    this.#runId++;
    if (stopHandler) this.#handler.stop();
    this.#spans = [];
    this.#fetchIndex = 0;
    this.#fetching = false;
    this.#wakeRead = false;
    this.#scheduledSeconds = 0;
    this.queue = [];
    this.trackNumber = null;
    this.positionSeconds = 0;
    this.interrupted = false;
    this.#startedPlaying = false;
    this.#pausedByInterruption = false;
    this.#prebuffering = false;
  }

  /** What the player was doing before a pause, worked out from the audio rather than remembered. */
  #statusAfterPause(): "loading" | "playing" | "buffering" {
    if (this.#prebuffering) return "loading";
    if (this.#handler.hasQueuedAudio) return "playing";
    return this.#startedPlaying ? "buffering" : "loading";
  }

  /**
   * Starts the sound once enough is buffered, or once the whole queue is (a short track never reaches the
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
    this.#dispatch({ type: "chunkArrived" });
  }

  /** Pauses (and later resumes) when the system stops and restarts the audio, without touching a user's own pause. */
  #handleInterruption(interrupted: boolean): void {
    this.interrupted = interrupted;

    if (interrupted) {
      if (this.status !== "playing" && this.status !== "buffering") return;
      this.#pausedByInterruption = true;
      this.#dispatch({ type: "pause" });
      return;
    }
    if (this.#pausedByInterruption && this.status === "paused") {
      this.#dispatch({ type: "resume", to: this.#statusAfterPause() });
    }
    this.#pausedByInterruption = false;
  }

  #start(tracks: Track[], timeSeconds: number): Promise<void> {
    const [first] = tracks;
    if (!first) {
      this.stop();
      return Promise.resolve();
    }
    // Not allowed until a disc is there and its metadata has settled.
    if (transition(this.status, { type: "play" }) === null) return Promise.resolve();

    this.#onBeforePlay();
    this.#claimHandler();
    this.#teardownPlayback();
    const runId = this.#runId;
    const startSector = startSectorForTime(first, timeSeconds);
    this.error = "";
    this.unreadableSectors = 0;
    this.queue = tracks;
    this.trackNumber = first.number;
    this.positionSeconds = startSector / SECTORS_PER_SECOND;
    this.#dispatch({ type: "play" });
    // Hold the audio silent until the prebuffer is full.
    this.#prebuffering = true;
    void this.#handler.suspend();
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
      // A failed read usually means the disc was ejected: look at the drive straight away.
      void this.checkDisc();
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
    if (isCancelled()) return;
    this.#fetching = false;
    this.#openGateIfReady();
  }

  /** Reads one track's chunks and schedules them, topping the lead up to `TARGET_LEAD_SECONDS`. */
  async #fetchTrack(track: Track, startSector: number, isCancelled: () => boolean): Promise<void> {
    const totalSectors = trackSectorCount(track);
    let cursorSector = startSector;
    // Only the very first chunk of a run is short; later tracks already have a lead to hide a slow read.
    let isFirstChunk = this.#spans.length === 0;

    while (cursorSector < totalSectors) {
      // Wait while the lead is full, or paused (the lead isn't shrinking then). A resume skips the full-lead wait once.
      while (this.status === "paused" || (this.#handler.leadSeconds >= TARGET_LEAD_SECONDS && !this.#wakeRead)) {
        await this.#sleepUnlessWoken(LEAD_CHECK_INTERVAL_MS);
        if (isCancelled()) return;
      }
      this.#wakeRead = false;

      const sectorCount = nextChunkSectorCount(track, cursorSector, isFirstChunk);
      this.#isReadingChunk = true;
      const { response, body } = await this.#fetchChunk(chunkUrl(this.#baseUrl, track.number, cursorSector, sectorCount))
        .then(async (response) => ({ response, body: await response.arrayBuffer() }))
        .finally(() => (this.#isReadingChunk = false));
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
      if (this.#prebuffering) this.#openGateIfReady();
      else this.#markPlaying();
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
