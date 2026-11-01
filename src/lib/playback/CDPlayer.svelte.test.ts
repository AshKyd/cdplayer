import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Toc, Track } from "$lib/disc/types";
import type { DiscMetadata } from "$lib/metadata/types";
import { CDPlayer } from "./CDPlayer.svelte";
import { FakeAudioContext } from "./FakeAudioContext.testing";
import { WebAudioHandler } from "./WebAudioHandler";

/** 3000 sectors: 40 s. The player fetches 1 s, then 5 s chunks. */
const track: Track = { number: 1, first_sector: 0, last_sector: 2999, is_audio: true };
const SECTOR_BYTES = 2352;

/** 50 sectors: 0.67 s, fetched in one chunk. */
const shortTrack = (number: number): Track => ({ number, first_sector: 0, last_sector: 49, is_audio: true });

/** The disc in the drive: a long track, two short ones and a data track. */
const discTracks: Track[] = [track, shortTrack(2), shortTrack(3), { ...shortTrack(4), is_audio: false }];
const toc: Toc = { tracks: discTracks, leadout_sector: 3000 };

const metadataFor = (album: string): DiscMetadata => ({
  discId: "disc-id",
  releaseId: "release-id",
  album,
  artist: "The Band",
  year: "1997",
  tracks: [
    { number: 1, title: "One", artist: "The Band" },
    { number: 2, title: "Two", artist: "The Band" },
    { number: 3, title: "Three", artist: "Guest" },
  ],
  coverUrl: null,
});

/**
 * A player on a fake audio context, a fake drive and a fake MusicBrainz. Each chunk request waits until
 * `deliverChunk()`, so a test decides when the drive answers. `disc.toc` is the disc in the drive (`null` is
 * an empty drive) and `lookups.loadMetadata` is what the metadata lookup does.
 */
const setup = () => {
  const context = new FakeAudioContext();
  const handler = new WebAudioHandler({ createContext: () => context as unknown as AudioContext });
  const waiting: Array<() => void> = [];
  const requestedUrls: string[] = [];
  const drive = { chunkStatus: 200 };

  const fetchChunk = async (url: string) => {
    requestedUrls.push(url);
    await new Promise<void>((resolve) => waiting.push(resolve));
    if (drive.chunkStatus !== 200) return new Response("the disc has gone", { status: drive.chunkStatus });
    const sectors = Number(/count=(\d+)/.exec(url)?.[1]);
    return new Response(new ArrayBuffer(sectors * SECTOR_BYTES), { headers: { "X-Unreadable-Sectors": "0" } });
  };

  /** Answers every request the player is currently waiting on, and lets it carry on. */
  const deliverChunk = () => {
    waiting.splice(0).forEach((resolve) => resolve());
    return vi.advanceTimersByTimeAsync(0);
  };

  const disc: { toc: Toc | null } = { toc };
  const lookups = { loadMetadata: async (_toc: Toc): Promise<DiscMetadata> => metadataFor("First Album") };

  const player = new CDPlayer({
    handler,
    fetchChunk,
    loadToc: async () => {
      if (!disc.toc) throw "no usable audio CD drive found";
      return disc.toc;
    },
    loadMetadata: (found) => lookups.loadMetadata(found),
  });

  /** Looks at the drive and lets the metadata lookup finish, so the player is ready to play. */
  const ready = async () => {
    await player.checkDisc();
    await vi.advanceTimersByTimeAsync(0);
  };

  return { player, context, requestedUrls, deliverChunk, drive, disc, lookups, ready };
};

describe("CDPlayer", () => {
  let current: ReturnType<typeof setup>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    current = setup();
    await current.ready();
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

    it("is ready again, not buffering, when the last chunk finishes", async () => {
      const { player, context, deliverChunk } = current;
      const shortTrack: Track = { ...track, last_sector: 49 };
      void player.play(shortTrack);
      await deliverChunk();

      context.sources[0].finish();
      expect(player.status).toBe("ready");
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

  /** Plays short track 1 with short track 2 queued, and delivers both, so track 2 is buffered behind track 1. */
  const withNextTrackBuffered = async () => {
    const parts = current;
    void parts.player.play(shortTrack(1));
    parts.player.enqueue(shortTrack(2));
    await parts.deliverChunk();
    await parts.deliverChunk();
    return parts;
  };

  describe("playQueue", () => {
    it("replaces the queue and plays the tracks in order, skipping data tracks", async () => {
      const { player, requestedUrls, deliverChunk } = current;
      void player.play(shortTrack(9));
      await deliverChunk();

      const dataTrack: Track = { ...shortTrack(3), is_audio: false };
      void player.playQueue([shortTrack(2), dataTrack, shortTrack(4)]);

      expect(player.queue.map(({ number }) => number)).toEqual([2, 4]);
      expect(player.status).toBe("loading");
      expect(requestedUrls.at(-1)).toContain("/track/2?start=0");
    });

    it("stops when there is nothing playable", () => {
      void current.player.play(shortTrack(1));

      void current.player.playQueue([{ ...shortTrack(2), is_audio: false }]);

      expect(current.player.status).toBe("ready");
    });
  });

  describe("clearQueue", () => {
    it("takes a buffered next track back out of the audio", async () => {
      const { player, context } = await withNextTrackBuffered();
      expect(context.sources).toHaveLength(2);

      player.clearQueue();

      expect(context.sources[1].stopped).toBe(true);
      expect(player.queue.map(({ number }) => number)).toEqual([1]);
      // Nothing follows, so the player ends with the current track.
      context.sources[0].finish();
      expect(player.status).toBe("ready");
    });

    it("stops reading a buffered track that is only partly fetched", async () => {
      const { player, context, requestedUrls, deliverChunk } = current;
      void player.play(shortTrack(1));
      player.enqueue(track);
      await deliverChunk();
      await deliverChunk();
      const requestsBefore = requestedUrls.length;

      player.clearQueue();
      await deliverChunk();
      await vi.advanceTimersByTimeAsync(1000);

      expect(requestedUrls.length).toBe(requestsBefore);
      expect(context.sources).toHaveLength(2);
      expect(player.queue).toHaveLength(1);
    });

    it("keeps a next track that has already started playing", async () => {
      const { player, context } = await withNextTrackBuffered();
      context.currentTime = 1;

      player.clearQueue();

      expect(context.sources[1].stopped).toBe(false);
      expect(player.queue).toHaveLength(2);
    });

    it("drops tracks that haven't been fetched yet", async () => {
      const { player } = current;
      void player.play(track);
      player.enqueue(shortTrack(2));
      player.enqueue(shortTrack(3));

      player.clearQueue();

      expect(player.queue.map(({ number }) => number)).toEqual([1]);
    });
  });

  describe("next", () => {
    it("moves straight into a buffered next track, without fetching or restarting", async () => {
      const { player, context, requestedUrls } = await withNextTrackBuffered();
      context.currentTime = 0.2;

      await player.next();

      expect(context.sources[0].stopped).toBe(true);
      const replayed = context.sources.at(-1)!;
      expect(replayed.startedAt).toBeCloseTo(0.25, 5);
      expect(replayed.offset).toBe(0);
      expect(requestedUrls).toHaveLength(2);
      expect(player.queue.map(({ number }) => number)).toEqual([2]);
      expect(player.trackNumber).toBe(2);
      expect(player.positionSeconds).toBe(0);
      expect(player.status).toBe("playing");
    });

    it("then plays out the skipped-to track and ends", async () => {
      const { player, context } = await withNextTrackBuffered();
      await player.next();

      context.sources.at(-1)!.finish();

      expect(player.status).toBe("ready");
    });

    it("restarts at the next track when it isn't buffered yet", async () => {
      const { player, requestedUrls, deliverChunk } = current;
      void player.play(track);
      player.enqueue(shortTrack(2));
      await deliverChunk();

      void player.next();

      expect(player.status).toBe("loading");
      expect(requestedUrls.at(-1)).toContain("/track/2?start=0");
      expect(player.queue.map(({ number }) => number)).toEqual([2]);
    });

    it("stops when nothing is queued", async () => {
      const { player } = current;
      void player.play(track);

      await player.next();

      expect(player.status).toBe("ready");
    });
  });

  describe("seek", () => {
    /** Plays the long track with its first 6 s (a 1 s chunk, then a 5 s chunk) buffered. */
    const withSixSecondsBuffered = async () => {
      const parts = current;
      void parts.player.play(track);
      await parts.deliverChunk();
      await parts.deliverChunk();
      return parts;
    };

    it("is instant inside buffered audio", async () => {
      const { player, context, requestedUrls } = await withSixSecondsBuffered();
      const requestsBefore = requestedUrls.length;

      await player.seek(3);

      expect(player.positionSeconds).toBe(3);
      expect(requestedUrls).toHaveLength(requestsBefore);
      // 3 s falls 2 s into the second chunk.
      expect(context.sources.at(-1)!.offset).toBeCloseTo(2, 5);
      expect(player.status).toBe("playing");
    });

    it("restarts from the new point when it isn't buffered, keeping the queue", async () => {
      const { player, requestedUrls } = await withSixSecondsBuffered();
      player.enqueue(shortTrack(2));

      void player.seek(20);

      expect(player.status).toBe("loading");
      expect(requestedUrls.at(-1)).toContain("/track/1?start=1500");
      expect(player.queue.map(({ number }) => number)).toEqual([1, 2]);
    });

    it("restarts when seeking back to audio that has already played out", async () => {
      const { player, context, requestedUrls } = await withSixSecondsBuffered();
      context.sources[0].finish();

      void player.seek(0);

      expect(requestedUrls.at(-1)).toContain("/track/1?start=0");
      expect(player.status).toBe("loading");
    });

    it("stays paused", async () => {
      const { player } = await withSixSecondsBuffered();
      await player.pause();

      void player.seek(20);

      expect(player.status).toBe("paused");
    });

    it("does nothing when nothing is playing", async () => {
      await current.player.seek(5);
      expect(current.player.status).toBe("ready");
    });

    it("reports the length of the current track", () => {
      void current.player.play(track);
      expect(current.player.durationSeconds).toBe(40);
    });
  });

  describe("the disc", () => {
    /** A lookup the test finishes itself, with the order they were started in. */
    const heldLookups = (parts: ReturnType<typeof setup>) => {
      const pending: Array<{ toc: Toc; finish: (metadata: DiscMetadata) => void; fail: (error: Error) => void }> = [];
      parts.lookups.loadMetadata = (found) =>
        new Promise<DiscMetadata>((finish, fail) => pending.push({ toc: found, finish, fail }));
      return pending;
    };

    it("starts with no disc, and no tracks", () => {
      const { player } = setup();

      expect(player.status).toBe("noDisc");
      expect(player.tracks).toEqual([]);
    });

    it("loads the disc's metadata before it is ready, and can't be played until then", async () => {
      const parts = setup();
      const pending = heldLookups(parts);

      await parts.player.checkDisc();
      await vi.advanceTimersByTimeAsync(0);
      expect(parts.player.status).toBe("loadingMetadata");
      expect(parts.player.tracks).toEqual(discTracks);

      void parts.player.playFrom(discTracks[0]);
      expect(parts.player.status).toBe("loadingMetadata");
      expect(parts.requestedUrls).toEqual([]);

      pending[0].finish(metadataFor("First Album"));
      await vi.advanceTimersByTimeAsync(0);
      expect(parts.player.status).toBe("ready");
      expect(parts.player.metadata?.album).toBe("First Album");
      expect(parts.player.trackTitle(discTracks[0])).toBe("One");
      expect(parts.player.trackArtist(discTracks[2])).toBe("Guest");
    });

    it("is ready with generic names when the lookup finds nothing", async () => {
      const parts = setup();
      parts.lookups.loadMetadata = async () => {
        throw new Error("this disc is not on MusicBrainz");
      };

      await parts.ready();

      expect(parts.player.status).toBe("ready");
      expect(parts.player.metadata).toBeNull();
      expect(parts.player.metadataError).toBe("this disc is not on MusicBrainz");
      expect(parts.player.trackTitle(discTracks[0])).toBe("Track 1");
      expect(parts.player.trackTitle(discTracks[3])).toBe("Data track");
    });

    it("ignores a lookup that finishes after the disc was swapped", async () => {
      const parts = setup();
      const pending = heldLookups(parts);
      await parts.player.checkDisc();
      await vi.advanceTimersByTimeAsync(0);

      parts.disc.toc = { tracks: [shortTrack(1)], leadout_sector: 50 };
      await parts.player.checkDisc();
      await vi.advanceTimersByTimeAsync(0);
      expect(pending).toHaveLength(2);

      pending[1].finish(metadataFor("Second Album"));
      await vi.advanceTimersByTimeAsync(0);
      pending[0].finish(metadataFor("First Album"));
      await vi.advanceTimersByTimeAsync(0);

      expect(parts.player.status).toBe("ready");
      expect(parts.player.metadata?.album).toBe("Second Album");
      expect(parts.player.tracks).toHaveLength(1);
    });

    it("clears the tracks and metadata when the disc is ejected", async () => {
      const { player, disc } = current;
      expect(player.tracks).toHaveLength(4);

      disc.toc = null;
      await player.checkDisc();

      expect(player.status).toBe("noDisc");
      expect(player.tracks).toEqual([]);
      expect(player.metadata).toBeNull();
      expect(player.discError).toBe("no usable audio CD drive found");
    });

    it("finds a disc put in after an eject", async () => {
      const { player, disc, ready } = current;
      disc.toc = null;
      await player.checkDisc();

      disc.toc = toc;
      await ready();

      expect(player.status).toBe("ready");
      expect(player.tracks).toHaveLength(4);
    });

    it("can't play with no disc", async () => {
      const parts = setup();

      void parts.player.playQueue([track]);
      void parts.player.playPause();

      expect(parts.player.status).toBe("noDisc");
      expect(parts.requestedUrls).toEqual([]);
    });

    it("leaves the drive alone while audio is active", async () => {
      const { player, disc, deliverChunk } = current;
      void player.playFrom(discTracks[0]);
      await deliverChunk();

      disc.toc = null;
      await player.checkDisc();

      expect(player.status).toBe("playing");
      expect(player.tracks).toHaveLength(4);
    });

    it("stops and looks at the drive when a read fails, which finds the disc gone", async () => {
      const { player, disc, drive, deliverChunk } = current;
      drive.chunkStatus = 500;
      void player.playFrom(discTracks[0]);
      disc.toc = null;

      await deliverChunk();
      await vi.advanceTimersByTimeAsync(0);

      expect(player.status).toBe("noDisc");
      expect(player.tracks).toEqual([]);
      expect(player.queue).toEqual([]);
    });

    it("stays on the disc when a read fails but the disc is still there", async () => {
      const { player, drive, deliverChunk } = current;
      drive.chunkStatus = 500;
      void player.playFrom(discTracks[0]);

      await deliverChunk();
      await vi.advanceTimersByTimeAsync(0);

      expect(player.status).toBe("ready");
      expect(player.error).toContain("500");
      expect(player.tracks).toHaveLength(4);
    });

    it("can be stopped from watching the drive", async () => {
      const parts = setup();
      parts.player.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(parts.player.status).toBe("ready");

      parts.player.destroy();
      parts.disc.toc = null;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(parts.player.status).toBe("ready");
    });
  });

  describe("the transport", () => {
    it("play/pause on a ready disc plays from the first track and queues the rest", async () => {
      const { player, requestedUrls } = current;

      void player.playPause();

      expect(player.status).toBe("loading");
      expect(player.queue.map(({ number }) => number)).toEqual([1, 2, 3]);
      expect(requestedUrls[0]).toContain("/track/1?");
    });

    it("play/pause toggles a pause once audio is active", async () => {
      const { player, deliverChunk } = current;
      void player.playPause();
      await deliverChunk();

      await player.playPause();
      expect(player.status).toBe("paused");
      await player.playPause();
      expect(player.status).toBe("playing");
    });

    it("playFrom plays that track and every playable one after it, not the data track", () => {
      const { player } = current;

      void player.playFrom(discTracks[1]);

      expect(player.queue.map(({ number }) => number)).toEqual([2, 3]);
    });

    it("previous goes back a track near the start of one", async () => {
      const { player, requestedUrls } = current;
      void player.playFrom(discTracks[1]);

      void player.previous();

      expect(player.queue.map(({ number }) => number)).toEqual([1, 2, 3]);
      expect(requestedUrls.at(-1)).toContain("/track/1?");
    });

    it("previous restarts a track that has been playing a while", async () => {
      const { player, requestedUrls } = current;
      void player.playQueue([track], 10);
      expect(player.positionSeconds).toBe(10);

      void player.previous();

      expect(requestedUrls.at(-1)).toContain("/track/1?start=0");
      expect(player.queue.map(({ number }) => number)).toEqual([1]);
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

      expect(player.status).toBe("ready");
      expect(player.interrupted).toBe(false);
      expect(player.queue).toEqual([]);
      expect(player.trackNumber).toBeNull();
    });
  });
});
