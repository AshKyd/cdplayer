import { int16InterleavedToChannels } from "./pcm";

/** CD sample rate. The context is created at this rate so the browser never resamples chunk by chunk. */
const SAMPLE_RATE = 44100;

/** Small start delay so the first segment is scheduled in the future, not at a time already passed. */
const START_DELAY_SECONDS = 0.05;

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

  #context: AudioContext | null = null;
  #sources = new Set<AudioBufferSourceNode>();
  #baseTime = 0;
  #scheduledFrames = 0;
  #playedBeforeBase = 0;

  #getContext(): AudioContext {
    this.#context ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    return this.#context;
  }

  /** Seconds of audio scheduled but not yet played. */
  get leadSeconds(): number {
    if (!this.#context || this.#scheduledFrames === 0) return 0;
    const scheduledEnd = this.#baseTime + this.#scheduledFrames / SAMPLE_RATE;
    return Math.max(0, scheduledEnd - this.#context.currentTime);
  }

  /** Seconds played since the first segment. Stays put while suspended. */
  get playedSeconds(): number {
    if (!this.#context || this.#scheduledFrames === 0) return 0;
    const played = this.#context.currentTime - this.#baseTime;
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

  suspend(): Promise<void> {
    return this.#context?.suspend() ?? Promise.resolve();
  }

  resume(): Promise<void> {
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
    this.#context?.resume();
  }
}
