import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "$lib/disc/types";
import { CDPlayer } from "./CDPlayer.svelte";
import { FakeAudioContext } from "./FakeAudioContext.testing";
import { WebAudioHandler } from "./WebAudioHandler";

/** 3000 sectors: 40 s. The player fetches 1 s, then 5 s chunks. */
const track: Track = { number: 1, first_sector: 0, last_sector: 2999, is_audio: true };
const SECTOR_BYTES = 2352;

/**
 * A player on a fake audio context and a fake drive. Each chunk request waits until `deliverChunk()`,
 * so a test decides when the drive answers.
 */
const setup = () => {
  const context = new FakeAudioContext();
  const handler = new WebAudioHandler({ createContext: () => context as unknown as AudioContext });
  const waiting: Array<() => void> = [];
  const requestedUrls: string[] = [];

  const fetchChunk = async (url: string) => {
    requestedUrls.push(url);
    await new Promise<void>((resolve) => waiting.push(resolve));
    const sectors = Number(/count=(\d+)/.exec(url)?.[1]);
    return new Response(new ArrayBuffer(sectors * SECTOR_BYTES), { headers: { "X-Unreadable-Sectors": "0" } });
  };

  /** Answers every request the player is currently waiting on, and lets it carry on. */
  const deliverChunk = () => {
    waiting.splice(0).forEach((resolve) => resolve());
    return vi.advanceTimersByTimeAsync(0);
  };

  const player = new CDPlayer({ handler, fetchChunk });
  return { player, context, requestedUrls, deliverChunk };
};

describe("CDPlayer", () => {
  let current: ReturnType<typeof setup>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    current = setup();
  });

  afterEach(() => {
    current.player.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("loading, playing and buffering", () => {
    it("is loading until the first chunk arrives, then playing", async () => {
      const { player, deliverChunk } = current;

      void player.play(track);
      expect(player.status).toBe("loading");

      await deliverChunk();
      expect(player.status).toBe("playing");
    });

    it("is buffering when the audio runs out before the next chunk, then playing again", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();

      // The 1 s chunk has played out and the drive hasn't answered the next request yet.
      context.sources[0].finish();
      expect(player.status).toBe("buffering");

      await deliverChunk();
      expect(player.status).toBe("playing");
    });

    it("is idle, not buffering, when the last chunk finishes", async () => {
      const { player, context, deliverChunk } = current;
      const shortTrack: Track = { ...track, last_sector: 49 };
      void player.play(shortTrack);
      await deliverChunk();

      context.sources[0].finish();
      expect(player.status).toBe("idle");
    });
  });

  describe("pausing", () => {
    it("can pause while loading, and the first chunk stays silent until Play", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);

      await player.pause();
      expect(player.status).toBe("paused");

      await deliverChunk();
      expect(player.status).toBe("paused");
      expect(context.state).toBe("suspended");

      await player.resume();
      expect(player.status).toBe("playing");
      expect(context.state).toBe("running");
    });

    it("goes back to loading if Play is pressed before any chunk has arrived", async () => {
      const { player } = current;
      void player.play(track);

      await player.pause();
      await player.resume();

      expect(player.status).toBe("loading");
    });

    it("doesn't fetch more while paused", async () => {
      const { player, requestedUrls, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();
      await player.pause();
      const requestsBefore = requestedUrls.length;

      await vi.advanceTimersByTimeAsync(2000);
      await deliverChunk();
      expect(requestedUrls.length).toBe(requestsBefore);
    });

    it("can pause while buffering and comes back to buffering", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();
      context.sources[0].finish();
      expect(player.status).toBe("buffering");

      await player.pause();
      expect(player.status).toBe("paused");
      await player.resume();
      expect(player.status).toBe("buffering");
    });
  });

  describe("interruptions", () => {
    it("pauses when the system stops the audio, and carries on when it recovers", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();
      context.resumeShouldFail = true;

      context.setState("suspended");
      await vi.advanceTimersByTimeAsync(0);
      expect(player.interrupted).toBe(true);
      expect(player.status).toBe("paused");

      // The webview lets the context run again (for example the device came back).
      context.resumeShouldFail = false;
      await context.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(player.interrupted).toBe(false);
      expect(player.status).toBe("playing");
    });

    it("recovers by itself when the context can be resumed", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();

      context.setState("suspended");
      await vi.advanceTimersByTimeAsync(0);

      expect(player.interrupted).toBe(false);
      expect(player.status).toBe("playing");
    });

    it("needs Play when automatic recovery fails", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();
      context.resumeShouldFail = true;
      context.setState("interrupted");
      await vi.advanceTimersByTimeAsync(0);

      context.resumeShouldFail = false;
      await player.resume();

      expect(player.interrupted).toBe(false);
      expect(player.status).toBe("playing");
      expect(context.state).toBe("running");
    });

    it("never resumes a pause the user made", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();

      await player.pause();
      expect(player.interrupted).toBe(false);

      // The system resumes the context while the user's pause is still on.
      context.setState("running");
      await vi.advanceTimersByTimeAsync(0);
      expect(player.status).toBe("paused");
    });
  });

  describe("position", () => {
    it("lags the context clock by the output latency", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();
      context.baseLatency = 0;
      context.outputLatency = 0.25;

      // 0.5 s into the audio on the context clock (it starts 0.05 s after being scheduled).
      context.currentTime = 0.55;
      await vi.advanceTimersByTimeAsync(20);

      expect(player.positionSeconds).toBeCloseTo(0.25, 5);
    });
  });

  describe("stop", () => {
    it("resets the state, including an interruption", async () => {
      const { player, context, deliverChunk } = current;
      void player.play(track);
      await deliverChunk();
      context.resumeShouldFail = true;
      context.setState("suspended");
      await vi.advanceTimersByTimeAsync(0);

      player.stop();

      expect(player.status).toBe("idle");
      expect(player.interrupted).toBe(false);
      expect(player.queue).toEqual([]);
      expect(player.trackNumber).toBeNull();
    });
  });
});
