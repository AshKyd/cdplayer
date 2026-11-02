import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDecoder } from "$lib/files/FileDecoder";
import type { Problem } from "$lib/notifications/notifications.svelte";
import { FakeAudioContext } from "./FakeAudioContext.testing";
import { FilePlayer } from "./FilePlayer.svelte";
import { WebAudioHandler } from "./WebAudioHandler";

const PIECE_SECONDS = 2;
const PIECES_PER_FILE = 2;

const file = (name: string) => `/music/${name}`;

/** A decoder that hands out `PIECES_PER_FILE` pieces of silence. */
const fakeDecoder = (pieces: number): FileDecoder & { closed: boolean; seekedTo: number | null } => {
  let remaining = pieces;
  const decoder = {
    durationSeconds: PIECE_SECONDS * pieces,
    closed: false,
    seekedTo: null as number | null,
    read: async () =>
      remaining-- > 0 ? ({ length: PIECE_SECONDS * 44100, sampleRate: 44100 } as AudioBuffer) : null,
    seek: (seconds: number) => {
      decoder.seekedTo = seconds;
    },
    close: () => {
      decoder.closed = true;
    },
  };
  return decoder;
};

const setup = ({ brokenNames = [] as string[], onBeforePlay = () => {}, piecesPerFile = PIECES_PER_FILE } = {}) => {
  const problems: Problem[] = [];
  const context = new FakeAudioContext();
  const handler = new WebAudioHandler({ createContext: () => context as unknown as AudioContext });
  const decoders: ReturnType<typeof fakeDecoder>[] = [];
  const opened: string[] = [];
  const player = new FilePlayer({
    handler,
    prebufferSeconds: 0,
    onBeforePlay,
    onProblem: (problem) => problems.push(problem),
    openDecoder: async (path) => {
      const name = path.split("/").at(-1) ?? path;
      opened.push(name);
      if (brokenNames.includes(name)) throw new Error("can't be decoded here");
      const decoder = fakeDecoder(piecesPerFile);
      decoders.push(decoder);
      return decoder;
    },
  });
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { context, handler, player, decoders, opened, problems, flush };
};

describe("FilePlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("enqueue", () => {
    it("starts playing the first file when idle", async () => {
      const { player, flush } = setup();

      player.enqueue([file("a.mp3"), file("b.mp3")]);
      await flush();

      expect(player.status).toBe("playing");
      expect(player.tracks.map(({ title }) => title)).toEqual(["a", "b"]);
      expect(player.currentIndex).toBe(0);
      expect(player.durationSeconds).toBe(PIECE_SECONDS * PIECES_PER_FILE);
      player.destroy();
    });

    it("adds to the playlist while playing, and decodes the new file into the same stream", async () => {
      const { player, context, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      player.enqueue([file("b.mp3")]);
      await flush();

      expect(player.tracks).toHaveLength(2);
      expect(player.currentIndex).toBe(0);
      expect(context.sources).toHaveLength(PIECES_PER_FILE * 2);
      player.destroy();
    });

    it("ignores an empty drop", () => {
      const { player } = setup();

      player.enqueue([]);

      expect(player.status).toBe("idle");
    });
  });

  describe("decoding ahead", () => {
    it("opens the next file while the first is still playing, so there is no gap", async () => {
      const { player, opened, flush, decoders } = setup();

      player.enqueue([file("a.mp3"), file("b.mp3")]);
      await flush();

      expect(opened).toEqual(["a.mp3", "b.mp3"]);
      expect(decoders.every(({ closed }) => closed)).toBe(true);
      player.destroy();
    });

    it("skips a file that can't be decoded and reports it", async () => {
      const { player, context, problems, flush } = setup({ brokenNames: ["bad.mp3"] });

      player.enqueue([file("bad.mp3"), file("good.mp3")]);
      await flush();

      expect(problems).toEqual([{ variant: "error", title: "Couldn't play bad", message: "can't be decoded here" }]);
      expect(player.status).toBe("playing");
      expect(context.sources).toHaveLength(PIECES_PER_FILE);
      player.destroy();
    });

    it("warns once per file when part of it was damaged", async () => {
      const { player, decoders, problems, flush } = setup();
      player.enqueue([file("scratched.flac")]);
      await flush();

      decoders[0].onDamagedAudio?.(2);
      decoders[0].onDamagedAudio?.(5);

      expect(problems).toEqual([
        {
          variant: "warning",
          title: "scratched is damaged",
          message: "Some audio couldn't be decoded and was skipped (2 packets so far).",
        },
      ]);
      player.destroy();
    });

    it("goes idle when no file can be decoded", async () => {
      const { player, problems, flush } = setup({ brokenNames: ["bad.mp3"] });

      player.enqueue([file("bad.mp3")]);
      await flush();

      expect(player.status).toBe("idle");
      expect(problems).toHaveLength(1);
    });
  });

  describe("navigation", () => {
    it("next() jumps to a file that is already buffered", async () => {
      const { player, opened, flush } = setup();
      player.enqueue([file("a.mp3"), file("b.mp3")]);
      await flush();

      await player.next();

      expect(player.currentIndex).toBe(1);
      expect(player.positionSeconds).toBe(0);
      expect(opened).toEqual(["a.mp3", "b.mp3"]);
      player.destroy();
    });

    it("next() on the last file stops", async () => {
      const { player, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      await player.next();

      expect(player.status).toBe("idle");
    });

    it("previous() plays the file before when near the start", async () => {
      const { player, flush } = setup();
      player.enqueue([file("a.mp3"), file("b.mp3")]);
      await flush();
      await player.next();

      await player.previous();
      await flush();

      expect(player.currentIndex).toBe(0);
      player.destroy();
    });

    it("seek() inside the buffered audio is instant and leaves the decoder alone", async () => {
      const { player, decoders, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      await player.seek(3);

      expect(player.positionSeconds).toBe(3);
      expect(decoders).toHaveLength(1);
      expect(decoders[0].seekedTo).toBeNull();
      player.destroy();
    });

    it("seek() beyond the buffer moves the open decoder instead of reopening the file", async () => {
      // A long file, so the decode loop is still on it, waiting with a full 30 s lead.
      const { player, opened, decoders, context, flush } = setup({ piecesPerFile: 100 });
      player.enqueue([file("long.flac")]);
      await flush();
      const sourcesBefore = context.sources.length;

      await player.seek(120);
      await vi.advanceTimersByTimeAsync(300);
      await flush();

      expect(opened).toEqual(["long.flac"]);
      expect(decoders[0].seekedTo).toBe(120);
      expect(decoders[0].closed).toBe(false);
      expect(player.status).toBe("playing");
      expect(player.positionSeconds).toBe(120);
      // The old audio was stopped, and new audio from the seek point was scheduled.
      expect(context.sources.slice(0, sourcesBefore).every(({ stopped }) => stopped)).toBe(true);
      expect(context.sources.length).toBeGreaterThan(sourcesBefore);
      player.destroy();
    });

    it("keeps a pause when seeking in place", async () => {
      const { player, context, flush } = setup({ piecesPerFile: 100 });
      player.enqueue([file("long.flac")]);
      await flush();
      await player.pause();

      await player.seek(120);
      await flush();

      expect(player.status).toBe("paused");
      expect(context.state).toBe("suspended");
      player.destroy();
    });

    it("playFrom() starts at the chosen file", async () => {
      const { player, opened, flush } = setup();
      player.enqueue([file("a.mp3"), file("b.mp3")]);
      await flush();

      await player.playFrom(player.tracks[1]);
      await flush();

      expect(player.currentIndex).toBe(1);
      expect(opened.at(-1)).toBe("b.mp3");
      player.destroy();
    });
  });

  describe("transport", () => {
    it("pauses and resumes", async () => {
      const { player, context, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      await player.pause();
      expect(player.status).toBe("paused");
      expect(context.state).toBe("suspended");

      await player.resume();
      expect(player.status).toBe("playing");
      expect(context.state).toBe("running");
      player.destroy();
    });

    it("stop() goes idle but keeps the playlist", async () => {
      const { player, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      player.stop();

      expect(player.status).toBe("idle");
      expect(player.currentIndex).toBeNull();
      expect(player.tracks).toHaveLength(1);
    });

    it("clear() empties the playlist", async () => {
      const { player, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      player.clear();

      expect(player.tracks).toEqual([]);
      expect(player.status).toBe("idle");
    });

    it("goes idle once the last buffered audio has played out", async () => {
      const { player, context, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      context.sources.forEach((source) => source.finish());

      expect(player.status).toBe("idle");
    });

    it("play/pause on an idle playlist plays from the first file", async () => {
      const { player, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();
      player.stop();

      await player.playPause();
      await flush();

      expect(player.status).toBe("playing");
      expect(player.currentIndex).toBe(0);
      player.destroy();
    });
  });

  describe("sharing the handler", () => {
    it("tells the other player before it starts", async () => {
      const onBeforePlay = vi.fn();
      const { player, flush } = setup({ onBeforePlay });

      player.enqueue([file("a.mp3")]);
      await flush();

      expect(onBeforePlay).toHaveBeenCalledOnce();
      player.destroy();
    });

    it("release() goes idle without stopping the handler's audio", async () => {
      const { player, context, flush } = setup();
      player.enqueue([file("a.mp3")]);
      await flush();

      player.release();

      expect(player.status).toBe("idle");
      expect(context.sources.some(({ stopped }) => stopped)).toBe(false);
    });
  });
});
