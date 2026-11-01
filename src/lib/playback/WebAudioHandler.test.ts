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
