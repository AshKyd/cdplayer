import { WAVEFORM_SAMPLES } from "$lib/playback/WebAudioHandler";

export interface StoryPlayer {
  /** Starts the track on first call, then pauses and resumes it. Resolves to whether it is now playing. */
  toggle(): Promise<boolean>;
  /** Same contract as the app's `readWaveform`: fills `target` with analyser bytes. */
  readWaveform(target: Uint8Array<ArrayBuffer>): boolean;
  /** Seconds into the track. 0 before it has loaded, or the place a `seek()` asked to start from. */
  readPositionSeconds(): number;
  /** Length of the track in seconds. 0 until it has loaded. */
  readDurationSeconds(): number;
  /** Jumps to `seconds` into the track. Before the first `toggle()` it sets where playback will start. */
  seek(seconds: number): void;
  /** Stops the sound and frees the audio context. */
  dispose(): void;
}

/**
 * Plays an audio file through the same graph shape as the app (source -> AnalyserNode -> speakers), so the
 * visualisers can be tried in Storybook without a disc. The context is made on the first `toggle()`, which
 * is a click, because browsers won't start audio before one.
 */
export function createStoryPlayer(url: string): StoryPlayer {
  let context: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let track: AudioBuffer | undefined;
  let source: AudioBufferSourceNode | undefined;
  /** Context time when the current source started, and how far into the track it started. */
  let startedAtSeconds = 0;
  let startOffsetSeconds = 0;

  /**
   * Plays from `offsetSeconds`. A buffer source can't be moved once it has started, so a seek replaces it.
   * Loops so there is always something to look at.
   */
  const playFrom = (offsetSeconds: number) => {
    if (!context || !analyser || !track) return;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    source = context.createBufferSource();
    source.buffer = track;
    source.loop = true;
    source.connect(analyser);
    source.start(0, offsetSeconds);
    startedAtSeconds = context.currentTime;
    startOffsetSeconds = offsetSeconds;
  };

  const start = async () => {
    const newContext = new AudioContext();
    const newAnalyser = newContext.createAnalyser();
    newAnalyser.fftSize = WAVEFORM_SAMPLES;
    newAnalyser.connect(newContext.destination);
    track = await fetch(url)
      .then((response) => response.arrayBuffer())
      .then((bytes) => newContext.decodeAudioData(bytes));
    context = newContext;
    analyser = newAnalyser;
    playFrom(startOffsetSeconds);
  };

  return {
    toggle: async () => {
      if (!context) return start().then(() => true);
      if (context.state === "running") return context.suspend().then(() => false);
      return context.resume().then(() => true);
    },
    readWaveform: (target) => {
      if (!analyser) return false;
      analyser.getByteTimeDomainData(target);
      return true;
    },
    readPositionSeconds: () => {
      if (!context || !track) return startOffsetSeconds;
      return (startOffsetSeconds + context.currentTime - startedAtSeconds) % track.duration;
    },
    readDurationSeconds: () => track?.duration ?? 0,
    seek: (seconds) => {
      startOffsetSeconds = seconds;
      playFrom(seconds);
    },
    dispose: () => void context?.close(),
  };
}
