/** A stand-in for `AudioBufferSourceNode`. The test calls `finish()` when the audio would have played out. */
export class FakeSource {
  buffer: { length: number } | null = null;
  startedAt: number | null = null;
  /** Seconds into the buffer that playback starts from. */
  offset = 0;
  stopped = false;
  onended: (() => void) | null = null;

  connect() {}
  disconnect() {}
  start(when: number, offset = 0) {
    this.startedAt = when;
    this.offset = offset;
  }
  stop() {
    this.stopped = true;
  }
  finish() {
    this.onended?.();
  }
}

/** A stand-in for `AudioParam` that records the ramps set on it. A ramp takes effect at once. */
export class FakeParam {
  value = 1;
  events: Array<{ type: "set" | "ramp"; value: number; time: number }> = [];

  cancelScheduledValues() {}
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: "set", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: "ramp", value, time });
  }
}

/** A stand-in for `GainNode`. */
export class FakeGain {
  gain = new FakeParam();
  connect() {}
  disconnect() {}
}

/**
 * A stand-in for `AudioContext` with a clock and state the test controls, so the handler and player can
 * be exercised without audio hardware. Cast to `AudioContext` where the code under test expects one.
 */
export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "running";
  outputLatency: number | undefined = 0;
  baseLatency = 0.01;
  destination = {};
  sources: FakeSource[] = [];
  suspendCalls = 0;
  resumeCalls = 0;
  /** Makes `resume()` fail, like a webview that needs a user gesture first. */
  resumeShouldFail = false;

  #listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void) {
    if (type === "statechange") this.#listeners.add(listener);
  }

  /** Changes the state the way the system would, and fires `statechange`. */
  setState(state: AudioContextState) {
    if (state === this.state) return;
    this.state = state;
    this.#listeners.forEach((listener) => listener());
  }

  async suspend() {
    this.suspendCalls++;
    this.setState("suspended");
  }

  async resume() {
    this.resumeCalls++;
    if (this.resumeShouldFail) throw new Error("resume needs a user gesture");
    this.setState("running");
  }

  createBuffer(_channels: number, length: number) {
    return { length, copyToChannel() {} };
  }

  gains: FakeGain[] = [];

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

/** Headerless stereo PCM of silence lasting `seconds`. */
export const silence = (seconds: number) => new ArrayBuffer(Math.round(seconds * 44100) * 4);
