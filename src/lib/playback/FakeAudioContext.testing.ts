/** A stand-in for `AudioBufferSourceNode`. The test calls `finish()` when the audio would have played out. */
export class FakeSource {
  buffer: { length: number } | null = null;
  startedAt: number | null = null;
  stopped = false;
  onended: (() => void) | null = null;

  connect() {}
  disconnect() {}
  start(when: number) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
  finish() {
    this.onended?.();
  }
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

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

/** Headerless stereo PCM of silence lasting `seconds`. */
export const silence = (seconds: number) => new ArrayBuffer(Math.round(seconds * 44100) * 4);
