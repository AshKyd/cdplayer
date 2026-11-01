import { int16InterleavedToChannels } from "./pcm";

/** CD sample rate. The context is created at this rate so the browser never resamples chunk by chunk. */
const SAMPLE_RATE = 44100;

/** Small start delay so the first segment is scheduled in the future, not at a time already passed. */
const START_DELAY_SECONDS = 0.05;

/** Samples in one waveform snapshot (the analyser's FFT size). About 46 ms of audio at 44.1 kHz. */
export const WAVEFORM_SAMPLES = 2048;

interface Options {
  /** Makes the `AudioContext`. Tests pass a fake. */
  createContext?: () => AudioContext;
  /** Length in seconds of the fade when pausing and resuming, read each time so a setting can change it. 0 is no fade. */
  fadeSeconds?: () => number;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** One scheduled piece of audio. Segments are back to back, in order of `startFrame`. */
interface Segment {
  source: AudioBufferSourceNode;
  /** Kept so the segment can be scheduled again at another time (`skipTo`). */
  buffer: AudioBuffer;
  /** Frames at the start of `buffer` that are skipped. Non-zero only for the segment `skipTo` lands inside. */
  offsetFrames: number;
  /** Frames that play. */
  frames: number;
  /** Frames from the anchor (`#baseTime`) to where this segment starts. */
  startFrame: number;
}

/**
 * Schedules PCM segments back to back on a Web Audio clock. It knows nothing about where the audio
 * comes from (CD sectors, MP3 files), so any source can feed it.
 *
 * Each segment starts at `baseTime + startFrame / sampleRate`. Frames are counted as integers rather
 * than summing `buffer.duration`, which would drift and open gaps between segments.
 *
 * Times given to `dropAfter` and `skipTo` are on the "timeline": seconds of audio since the first segment,
 * continuing across underruns. It is the same clock as `playedSeconds`.
 */
export class WebAudioHandler {
  /** Called once every scheduled segment has finished playing. */
  onEnded: () => void = () => {};
  /**
   * Called with `true` when the system stops the audio without being asked (sleep, an output device
   * change) and with `false` when it runs again. The handler tries to resume by itself; if the webview
   * needs a user gesture first, the owner's `resume()` from a click does it.
   */
  onInterruption: (interrupted: boolean) => void = () => {};

  #createContext: () => AudioContext;
  #fadeSeconds: () => number;
  #context: AudioContext | null = null;
  /** Every segment plays through this, so a pause or resume can fade the whole output. */
  #gain: GainNode | null = null;
  /** Taps the output for `readWaveform()`. */
  #analyser: AnalyserNode | null = null;
  /** Bumped by `suspend()`, `resume()` and `stop()`, so a fade-out that was overtaken doesn't suspend the context. */
  #fadeToken = 0;
  #segments: Segment[] = [];
  #baseTime = 0;
  #scheduledFrames = 0;
  /** Timeline seconds at `#baseTime`: audio already played before the current anchor was set. */
  #playedBeforeBase = 0;
  /** True from `suspend()` until `resume()`/`stop()`. A suspended context is only an interruption when this is false. */
  #suspendRequested = false;
  #interrupted = false;

  constructor({
    createContext = () => new AudioContext({ sampleRate: SAMPLE_RATE }),
    fadeSeconds = () => 0,
  }: Options = {}) {
    this.#createContext = createContext;
    this.#fadeSeconds = fadeSeconds;
  }

  #getContext(): AudioContext {
    if (this.#context) return this.#context;

    const context = this.#createContext();
    this.#context = context;
    this.#gain = context.createGain();
    // The analyser passes audio through untouched; it only lets the UI read the waveform (post-fade).
    this.#analyser = context.createAnalyser();
    this.#analyser.fftSize = WAVEFORM_SAMPLES;
    this.#gain.connect(this.#analyser);
    this.#analyser.connect(context.destination);
    context.addEventListener("statechange", () => this.#handleStateChange(context));
    // Honour a pause requested before the first segment arrived; otherwise make sure it is running,
    // since a context made outside a user gesture can start suspended.
    void (this.#suspendRequested ? context.suspend() : context.resume()).catch(() => {});
    return context;
  }

  #handleStateChange({ state }: AudioContext): void {
    if (state === "running") {
      if (!this.#interrupted) return;
      this.#interrupted = false;
      this.onInterruption(false);
      return;
    }
    if (this.#suspendRequested || state === "closed") return;

    if (!this.#interrupted) {
      this.#interrupted = true;
      this.onInterruption(true);
    }
    void this.#context?.resume().catch(() => {});
  }

  /** True while at least one segment is scheduled and hasn't finished. */
  get hasQueuedAudio(): boolean {
    return this.#segments.length > 0;
  }

  /**
   * How long audio takes to get from the context to the speakers. `outputLatency` is the real figure
   * (large on Bluetooth) but not every webview has it; `baseLatency` is the fallback.
   */
  get latencySeconds(): number {
    if (!this.#context) return 0;
    const { outputLatency, baseLatency } = this.#context;
    return [outputLatency, baseLatency].find((latency) => Number.isFinite(latency) && latency > 0) ?? 0;
  }

  /** Seconds of audio scheduled but not yet played. */
  get leadSeconds(): number {
    if (!this.#context || this.#scheduledFrames === 0) return 0;
    const scheduledEnd = this.#baseTime + this.#scheduledFrames / SAMPLE_RATE;
    return Math.max(0, scheduledEnd - this.#context.currentTime);
  }

  /**
   * Seconds heard since the first segment, i.e. what has reached the speakers, so it lags the context clock
   * by the output latency. Stays put while suspended.
   */
  get playedSeconds(): number {
    if (!this.#context || this.#scheduledFrames === 0) return 0;
    const heardTime = this.#context.currentTime - this.latencySeconds;
    const played = heardTime - this.#baseTime;
    return this.#playedBeforeBase + Math.min(Math.max(0, played), this.#scheduledFrames / SAMPLE_RATE);
  }

  /**
   * Fills `target` (up to `WAVEFORM_SAMPLES` long) with the latest output samples as unsigned bytes,
   * where 128 is silence. Returns `false` before any audio has been scheduled.
   */
  readWaveform(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.#analyser) return false;
    this.#analyser.getByteTimeDomainData(target);
    return true;
  }

  /** Queues headerless 16-bit/44.1 kHz stereo PCM directly after whatever is already scheduled. */
  appendSegment(pcm: ArrayBuffer): void {
    const context = this.#getContext();
    const [left, right] = int16InterleavedToChannels(pcm);
    if (left.length === 0) return;

    const buffer = context.createBuffer(2, left.length, SAMPLE_RATE);
    buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);

    // Start fresh, or re-anchor if playback caught up with the schedule (underrun).
    const nothingQueued = this.#segments.length === 0;
    if (nothingQueued) {
      // Keep already-played time so `playedSeconds` stays continuous across a re-anchor.
      this.#playedBeforeBase += this.#scheduledFrames / SAMPLE_RATE;
      this.#baseTime = context.currentTime + START_DELAY_SECONDS;
      this.#scheduledFrames = 0;
    }

    this.#schedule(context, buffer, this.#scheduledFrames, 0);
    this.#scheduledFrames += buffer.length;
  }

  /**
   * Removes the audio that starts at or after `timelineSeconds` and rewinds, so the next `appendSegment`
   * follows on from the cut. Nothing is cut if any of that audio has already started (it can't be
   * unplayed), and `false` is returned. The cut should fall on a segment boundary, such as the start of a track.
   */
  dropAfter(timelineSeconds: number): boolean {
    const context = this.#context;
    if (!context) return true;

    const cutFrame = this.#frameAtTimeline(timelineSeconds);
    const dropped = this.#segments.filter(({ startFrame }) => startFrame >= cutFrame);
    if (dropped.length === 0) return true;
    if (dropped.some((segment) => this.#hasStarted(context, segment))) return false;

    dropped.forEach((segment) => this.#detach(segment));
    this.#segments = this.#segments.filter((segment) => !dropped.includes(segment));
    this.#scheduledFrames = dropped[0].startFrame;
    return true;
  }

  /**
   * Jumps playback to `timelineSeconds`, which must be inside audio that is still scheduled (not yet played
   * out, not past the end). The audio from there on is scheduled again to play now, from the same buffers,
   * so a skip within buffered audio is instant. Returns `false`, changing nothing, if that time is not buffered.
   */
  skipTo(timelineSeconds: number): boolean {
    const context = this.#context;
    if (!context || this.#segments.length === 0) return false;

    const cutFrame = this.#frameAtTimeline(timelineSeconds);
    if (cutFrame < this.#segments[0].startFrame || cutFrame >= this.#scheduledFrames) return false;

    const kept = this.#segments.filter(({ startFrame, frames }) => startFrame + frames > cutFrame);
    this.#segments.forEach((segment) => this.#detach(segment));
    this.#segments = [];

    // The audio at the cut now plays at the new anchor; everything after keeps its distance from it.
    this.#baseTime = context.currentTime + START_DELAY_SECONDS;
    kept.forEach(({ buffer, startFrame, offsetFrames }) => {
      const skippedFrames = Math.max(0, cutFrame - startFrame);
      this.#schedule(context, buffer, Math.max(0, startFrame - cutFrame), offsetFrames + skippedFrames);
    });
    this.#scheduledFrames -= cutFrame;
    this.#playedBeforeBase = timelineSeconds;
    return true;
  }

  /**
   * Pauses, after fading out if audible audio is playing (a hard stop clicks). Works before the first
   * segment too: the context is then created already suspended.
   */
  async suspend(): Promise<void> {
    this.#suspendRequested = true;
    const context = this.#context;
    if (!context) return;

    const token = ++this.#fadeToken;
    const fadeSeconds = this.#fadeSeconds();
    const isAudible = context.state === "running" && this.#segments.length > 0;
    if (fadeSeconds > 0 && isAudible) {
      this.#rampGain(context, 0, fadeSeconds);
      await sleep(fadeSeconds * 1000);
      // Resumed or stopped during the fade: leave the context running.
      if (token !== this.#fadeToken) return;
    }
    await context.suspend();
  }

  /** Resumes, fading in from silence so the audio doesn't start with a click. */
  resume(): Promise<void> {
    this.#suspendRequested = false;
    this.#fadeToken++;
    const context = this.#context;
    if (!context) return Promise.resolve();

    // The clock is frozen while suspended, so the ramp set now starts when the context does.
    const startGain = context.state === "suspended" ? 0 : (this.#gain?.gain.value ?? 1);
    this.#rampGain(context, 1, this.#fadeSeconds(), startGain);
    return context.resume();
  }

  /** Silences and drops everything scheduled, and resets the clock for the next `appendSegment`. */
  stop(): void {
    this.#segments.forEach((segment) => this.#detach(segment));
    this.#segments = [];
    this.#scheduledFrames = 0;
    this.#baseTime = 0;
    this.#playedBeforeBase = 0;
    // A suspended context would delay the next play; make sure it is running again.
    this.#suspendRequested = false;
    this.#fadeToken++;
    if (this.#context) this.#rampGain(this.#context, 1, 0);
    void this.#context?.resume().catch(() => {});
  }

  /** Moves the output volume to `target` over `seconds` (immediately if 0), from `from` (default: where it is now). */
  #rampGain(context: AudioContext, target: number, seconds: number, from = this.#gain?.gain.value ?? 1): void {
    const param = this.#gain?.gain;
    if (!param) return;
    param.cancelScheduledValues(context.currentTime);
    if (seconds <= 0) {
      param.setValueAtTime(target, context.currentTime);
      return;
    }
    param.setValueAtTime(from, context.currentTime);
    param.linearRampToValueAtTime(target, context.currentTime + seconds);
  }

  /** Schedules `buffer` from its `offsetFrames`-th frame to start `startFrame` frames after the anchor. */
  #schedule(context: AudioContext, buffer: AudioBuffer, startFrame: number, offsetFrames: number): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#gain ?? context.destination);

    const segment: Segment = { source, buffer, offsetFrames, frames: buffer.length - offsetFrames, startFrame };
    source.onended = () => {
      this.#segments = this.#segments.filter((other) => other !== segment);
      source.disconnect();
      if (this.#segments.length === 0) this.onEnded();
    };
    source.start(this.#baseTime + startFrame / SAMPLE_RATE, offsetFrames / SAMPLE_RATE);
    this.#segments.push(segment);
  }

  /** Stops a segment without letting it report that it ended. */
  #detach({ source }: Segment): void {
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  #hasStarted(context: AudioContext, { startFrame }: Segment): boolean {
    return this.#baseTime + startFrame / SAMPLE_RATE <= context.currentTime;
  }

  /** The frame, counted from the anchor, that a timeline time falls on. */
  #frameAtTimeline(timelineSeconds: number): number {
    return Math.round((timelineSeconds - this.#playedBeforeBase) * SAMPLE_RATE);
  }
}
