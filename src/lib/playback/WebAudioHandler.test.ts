import { describe, expect, it } from "vitest";
import { FakeAudioContext, silence } from "./FakeAudioContext.testing";
import { WebAudioHandler } from "./WebAudioHandler";

const setup = () => {
  const context = new FakeAudioContext();
  const handler = new WebAudioHandler({ createContext: () => context as unknown as AudioContext });
  const interruptions: boolean[] = [];
  handler.onInterruption = (interrupted) => interruptions.push(interrupted);
  return { context, handler, interruptions };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WebAudioHandler", () => {
  describe("appendBuffer", () => {
    const decodedBuffer = (seconds: number, sampleRate = 44100) =>
      ({ length: Math.round(seconds * sampleRate), sampleRate }) as AudioBuffer;

    it("schedules decoded buffers back to back", () => {
      const { handler } = setup();

      handler.appendBuffer(decodedBuffer(2));
      handler.appendBuffer(decodedBuffer(3));

      expect(handler.hasQueuedAudio).toBe(true);
      expect(handler.leadSeconds).toBeCloseTo(5.05, 2);
    });

    it("ignores an empty buffer", () => {
      const { handler } = setup();

      handler.appendBuffer(decodedBuffer(0));

      expect(handler.hasQueuedAudio).toBe(false);
    });

    it("rejects audio that isn't 44.1 kHz", () => {
      const { handler } = setup();

      expect(() => handler.appendBuffer(decodedBuffer(1, 48000))).toThrow("44100");
    });
  });

  describe("pausing before the first segment", () => {
    it("creates the context suspended, and runs it again on resume", async () => {
      const { context, handler } = setup();

      await handler.suspend();
      handler.appendSegment(silence(1));
      expect(context.state).toBe("suspended");

      await handler.resume();
      expect(context.state).toBe("running");
    });

    it("doesn't treat a requested pause as an interruption", async () => {
      const { handler, interruptions } = setup();
      handler.appendSegment(silence(1));

      await handler.suspend();
      await handler.resume();

      expect(interruptions).toEqual([]);
    });
  });

  describe("interruptions", () => {
    it("reports an unrequested stop, tries to resume, and reports recovery", async () => {
      const { context, handler, interruptions } = setup();
      handler.appendSegment(silence(1));
      const resumeCallsBefore = context.resumeCalls;

      context.setState("suspended");
      await flush();

      expect(context.resumeCalls).toBeGreaterThan(resumeCallsBefore);
      expect(interruptions).toEqual([true, false]);
    });

    it("stays interrupted if the webview needs a gesture, until resume() is called", async () => {
      const { context, handler, interruptions } = setup();
      handler.appendSegment(silence(1));
      context.resumeShouldFail = true;

      context.setState("interrupted");
      await flush();
      expect(interruptions).toEqual([true]);

      context.resumeShouldFail = false;
      await handler.resume();
      expect(interruptions).toEqual([true, false]);
    });

    it("reports an interruption once, not on every state change", async () => {
      const { context, handler, interruptions } = setup();
      handler.appendSegment(silence(1));
      context.resumeShouldFail = true;

      context.setState("suspended");
      context.setState("interrupted");
      context.setState("suspended");
      await flush();

      expect(interruptions).toEqual([true]);
    });
  });

  describe("output latency", () => {
    // The first segment starts 0.05 s after the context time at which it was appended.
    it("reports what has reached the speakers, not the context clock", () => {
      const { context, handler } = setup();
      handler.appendSegment(silence(2));
      context.baseLatency = 0;

      context.currentTime = 1.05;
      expect(handler.playedSeconds).toBeCloseTo(1, 5);

      context.outputLatency = 0.2;
      expect(handler.playedSeconds).toBeCloseTo(0.8, 5);
    });

    it("falls back to baseLatency when outputLatency is missing", () => {
      const { context, handler } = setup();
      handler.appendSegment(silence(2));
      context.outputLatency = undefined;
      context.baseLatency = 0.01;

      context.currentTime = 1.05;
      expect(handler.latencySeconds).toBe(0.01);
      expect(handler.playedSeconds).toBeCloseTo(0.99, 5);
    });

    it("never goes below zero or past the scheduled audio", () => {
      const { context, handler } = setup();
      handler.appendSegment(silence(1));
      context.outputLatency = 0.3;

      context.currentTime = 0.1;
      expect(handler.playedSeconds).toBe(0);

      context.currentTime = 99;
      expect(handler.playedSeconds).toBeCloseTo(1, 5);
    });

    it("is zero before there is a context", () => {
      expect(new WebAudioHandler().latencySeconds).toBe(0);
    });
  });

  describe("readWaveform", () => {
    /** Reads one frame with the analyser at `level` and the clock at `time`. */
    const readAt = (
      { context, handler }: ReturnType<typeof setup>,
      time: number,
      level: number,
    ): number => {
      context.currentTime = time;
      context.analysers[0].level = level;
      const target = new Uint8Array(4);
      handler.readWaveform(target);
      return target[0];
    };

    it("shows the audio from `latencySeconds` ago, with silence until then", () => {
      const parts = setup();
      parts.handler.appendSegment(silence(5));
      parts.context.baseLatency = 0;
      // Times are exact binary fractions so the comparison against `now - latency` has no rounding error.
      parts.context.outputLatency = 0.25;

      expect(readAt(parts, 0, 200)).toBe(128);
      expect(readAt(parts, 0.125, 210)).toBe(128);
      expect(readAt(parts, 0.25, 220)).toBe(200);
      expect(readAt(parts, 0.375, 230)).toBe(210);
      expect(readAt(parts, 0.5, 240)).toBe(220);
    });

    it("is immediate when there is no latency", () => {
      const parts = setup();
      parts.handler.appendSegment(silence(5));
      parts.context.baseLatency = 0;

      expect(readAt(parts, 0, 200)).toBe(200);
      expect(readAt(parts, 0.1, 210)).toBe(210);
    });

    it("forgets old audio on stop()", () => {
      const parts = setup();
      parts.handler.appendSegment(silence(5));
      parts.context.baseLatency = 0;
      parts.context.outputLatency = 0.25;
      readAt(parts, 0, 200);

      parts.handler.stop();

      expect(readAt(parts, 0.25, 128)).toBe(128);
    });

    it("returns false before there is a context", () => {
      expect(new WebAudioHandler().readWaveform(new Uint8Array(4))).toBe(false);
    });
  });

  /** Three 1 s segments, starting 0.05 s, 1.05 s and 2.05 s on the context clock. Latency is zero. */
  const withThreeSeconds = () => {
    const parts = setup();
    parts.context.baseLatency = 0;
    [1, 2, 3].forEach(() => parts.handler.appendSegment(silence(1)));
    return parts;
  };

  describe("dropAfter", () => {
    it("removes audio from the cut on, and the next segment follows on from the cut", () => {
      const { context, handler } = withThreeSeconds();

      expect(handler.dropAfter(1)).toBe(true);
      expect(context.sources.map((source) => source.stopped)).toEqual([false, true, true]);
      expect(handler.leadSeconds).toBeCloseTo(1.05, 5);

      handler.appendSegment(silence(1));
      expect(context.sources[3].startedAt).toBeCloseTo(1.05, 5);
    });

    it("doesn't report the dropped audio as ended, but does when the rest finishes", () => {
      const { context, handler } = withThreeSeconds();
      let ended = 0;
      handler.onEnded = () => ended++;

      handler.dropAfter(1);
      context.sources[1].finish();
      context.sources[2].finish();
      expect(ended).toBe(0);

      context.sources[0].finish();
      expect(ended).toBe(1);
    });

    it("cuts nothing if any of that audio has already started", () => {
      const { context, handler } = withThreeSeconds();
      context.currentTime = 1.5;

      expect(handler.dropAfter(1)).toBe(false);
      expect(context.sources.every((source) => !source.stopped)).toBe(true);
    });

    it("is a no-op past the end", () => {
      const { context, handler } = withThreeSeconds();

      expect(handler.dropAfter(3)).toBe(true);
      expect(context.sources.every((source) => !source.stopped)).toBe(true);
    });
  });

  describe("skipTo", () => {
    it("plays the audio at the time now, with what follows right after it", () => {
      const { context, handler } = withThreeSeconds();
      context.currentTime = 0.2;

      expect(handler.skipTo(1)).toBe(true);

      expect(context.sources.slice(0, 3).every((source) => source.stopped)).toBe(true);
      const [second, third] = context.sources.slice(3);
      expect(second.startedAt).toBeCloseTo(0.25, 5);
      expect(second.offset).toBe(0);
      expect(third.startedAt).toBeCloseTo(1.25, 5);
    });

    it("reports the new position straight away and follows the clock from there", () => {
      const { context, handler } = withThreeSeconds();
      context.currentTime = 0.2;
      handler.skipTo(1);

      context.currentTime = 0.25;
      expect(handler.playedSeconds).toBeCloseTo(1, 5);
      context.currentTime = 0.75;
      expect(handler.playedSeconds).toBeCloseTo(1.5, 5);
      // 2 s remain after the skip, starting at 0.25 s: they end at 2.25 s, 1.5 s from now.
      expect(handler.leadSeconds).toBeCloseTo(1.5, 5);
    });

    it("can land inside a segment", () => {
      const { context, handler } = withThreeSeconds();
      context.currentTime = 0.2;

      expect(handler.skipTo(1.5)).toBe(true);

      const [first, second] = context.sources.slice(3);
      expect(first.startedAt).toBeCloseTo(0.25, 5);
      expect(first.offset).toBeCloseTo(0.5, 5);
      expect(second.startedAt).toBeCloseTo(0.75, 5);
      // 1.5 s remain after the cut, starting at 0.25 s, with the clock at 0.2 s.
      expect(handler.leadSeconds).toBeCloseTo(1.55, 5);
    });

    it("lets the next segment follow on from the end after a skip", () => {
      const { context, handler } = withThreeSeconds();
      context.currentTime = 0.2;
      handler.skipTo(1);

      handler.appendSegment(silence(1));

      // Two seconds were left after the skip, so the new segment starts 2 s after the new anchor.
      expect(context.sources.at(-1)!.startedAt).toBeCloseTo(0.25 + 2, 5);
    });

    it("can skip twice, and drop audio after a skip", () => {
      const { context, handler } = withThreeSeconds();
      context.currentTime = 0.2;
      handler.skipTo(1);
      handler.skipTo(2);

      expect(handler.playedSeconds).toBeCloseTo(2, 5);
      expect(handler.dropAfter(3)).toBe(true);
      expect(handler.leadSeconds).toBeCloseTo(1.05, 5);
    });

    it("refuses a time that isn't buffered, and changes nothing", () => {
      const { context, handler } = withThreeSeconds();

      expect(handler.skipTo(3)).toBe(false);
      expect(handler.skipTo(99)).toBe(false);
      expect(context.sources.every((source) => !source.stopped)).toBe(true);

      context.sources[0].finish();
      expect(handler.skipTo(0.5)).toBe(false);
    });

    it("refuses when nothing has been scheduled", () => {
      expect(setup().handler.skipTo(0)).toBe(false);
    });
  });

  describe("queued audio", () => {
    it("is true while segments are scheduled and calls onEnded when the last finishes", () => {
      const { context, handler } = setup();
      let ended = 0;
      handler.onEnded = () => ended++;
      expect(handler.hasQueuedAudio).toBe(false);

      handler.appendSegment(silence(1));
      handler.appendSegment(silence(1));
      expect(handler.hasQueuedAudio).toBe(true);

      context.sources[0].finish();
      expect(handler.hasQueuedAudio).toBe(true);
      expect(ended).toBe(0);

      context.sources[1].finish();
      expect(handler.hasQueuedAudio).toBe(false);
      expect(ended).toBe(1);
    });

    it("joins segments by frame count", () => {
      const { context, handler } = setup();
      handler.appendSegment(silence(1));
      handler.appendSegment(silence(2));

      expect(context.sources[1].startedAt! - context.sources[0].startedAt!).toBeCloseTo(1, 9);
    });

    it("stop() drops everything and clears a requested pause", async () => {
      const { context, handler } = setup();
      handler.appendSegment(silence(1));
      await handler.suspend();

      handler.stop();
      await flush();

      expect(context.sources[0].stopped).toBe(true);
      expect(handler.hasQueuedAudio).toBe(false);
      expect(context.state).toBe("running");
    });
  });
});
