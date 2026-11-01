import { int16InterleavedToChannels } from "./pcm";

/** CD sample rate. The context is created at this rate so the browser never resamples chunk by chunk. */
const SAMPLE_RATE = 44100;

/** Small start delay so the first segment is scheduled in the future, not at a time already passed. */
const START_DELAY_SECONDS = 0.05;

interface Options {
  /** Makes the `AudioContext`. Tests pass a fake. */
  createContext?: () => AudioContext;
}

/**
 * Schedules PCM segments back to back on a Web Audio clock. It knows nothing about where the audio
 * comes from (CD sectors, MP3 files), so any source can feed it.
 *
 * Each segment starts at `baseTime + scheduledFrames / sampleRate`. Frames are counted as integers rather
 * than summing `buffer.duration`, which would drift and open gaps between segments.
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
  #context: AudioContext | null = null;
  #sources = new Set<AudioBufferSourceNode>();
  #baseTime = 0;
  #scheduledFrames = 0;
  #playedBeforeBase = 0;
  /** True from `suspend()` until `resume()`/`stop()`. A suspended context is only an interruption when this is false. */
  #suspendRequested = false;
  #interrupted = false;

  constructor({ createContext = () => new AudioContext({ sampleRate: SAMPLE_RATE }) }: Options = {}) {
    this.#createContext = createContext;
  }

  #getContext(): AudioContext {
    if (this.#context) return this.#context;

    const context = this.#createContext();
    this.#context = context;
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
    return this.#sources.size > 0;
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

  /** Queues headerless 16-bit/44.1 kHz stereo PCM directly after whatever is already scheduled. */
  appendSegment(pcm: ArrayBuffer): void {
    const context = this.#getContext();
    const [left, right] = int16InterleavedToChannels(pcm);
    if (left.length === 0) return;

    const buffer = context.createBuffer(2, left.length, SAMPLE_RATE);
    buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);

    // Start fresh, or re-anchor if playback caught up with the schedule (underrun).
    const nothingQueued = this.#sources.size === 0;
    if (nothingQueued) {
      // Keep already-played time so `playedSeconds` stays continuous across a re-anchor.
      this.#playedBeforeBase += this.#scheduledFrames / SAMPLE_RATE;
      this.#baseTime = context.currentTime + START_DELAY_SECONDS;
      this.#scheduledFrames = 0;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      this.#sources.delete(source);
      source.disconnect();
      if (this.#sources.size === 0) this.onEnded();
    };
    source.start(this.#baseTime + this.#scheduledFrames / SAMPLE_RATE);

    this.#sources.add(source);
    this.#scheduledFrames += buffer.length;
  }

  /** Pauses. Works before the first segment too: the context is then created already suspended. */
  suspend(): Promise<void> {
    this.#suspendRequested = true;
    return this.#context?.suspend() ?? Promise.resolve();
  }

  resume(): Promise<void> {
    this.#suspendRequested = false;
    return this.#context?.resume() ?? Promise.resolve();
  }

  /** Silences and drops everything scheduled, and resets the clock for the next `appendSegment`. */
  stop(): void {
    const sources = [...this.#sources];
    this.#sources.clear();
    sources.forEach((source) => {
      source.onended = null;
      source.stop();
      source.disconnect();
    });
    this.#scheduledFrames = 0;
    this.#baseTime = 0;
    this.#playedBeforeBase = 0;
    // A suspended context would delay the next play; make sure it is running again.
    this.#suspendRequested = false;
    void this.#context?.resume().catch(() => {});
  }
}
