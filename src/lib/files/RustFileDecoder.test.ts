import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRustFileDecoder, splitStereoChunk } from "./RustFileDecoder";

/** Interleaved stereo bytes where the left channel counts up from `first` and the right is the negative. */
const stereoBytes = (first: number, frames: number): ArrayBuffer => {
  const samples = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    samples[frame * 2] = first + frame;
    samples[frame * 2 + 1] = -(first + frame);
  }
  return samples.buffer;
};

/** A stand-in for `AudioBuffer` that keeps the channels it is given. */
class FakeAudioBuffer {
  channels: Float32Array[] = [];
  length: number;
  constructor({ length }: { length: number }) {
    this.length = length;
  }
  copyToChannel(source: Float32Array, channel: number) {
    this.channels[channel] = source;
  }
}

const setup = (chunks: ArrayBuffer[]) => {
  const requestedUrls: string[] = [];
  const commands: Array<{ command: string; args: Record<string, unknown> }> = [];
  const remaining = [...chunks];
  const invokeCommand = async (command: string, args: Record<string, unknown>) => {
    commands.push({ command, args });
    return { id: 7, duration_seconds: 215.5 } as never;
  };
  const fetchChunk = async (url: string) => {
    requestedUrls.push(url);
    const body = remaining.shift() ?? new ArrayBuffer(0);
    return new Response(body, { status: 200 });
  };
  return { requestedUrls, commands, open: () => openRustFileDecoder("/Music/a.flac", { invokeCommand, fetchChunk, baseUrl: "file-track://localhost/" }) };
};

describe("splitStereoChunk", () => {
  it("separates the left and right channels", () => {
    const [left, right] = splitStereoChunk(stereoBytes(1, 3));

    expect([...left]).toEqual([1, 2, 3]);
    expect([...right]).toEqual([-1, -2, -3]);
  });

  it("ignores a trailing part of a frame", () => {
    const bytes = new ArrayBuffer(8 * 2 + 4);
    expect(splitStereoChunk(bytes)[0]).toHaveLength(2);
  });
});

describe("openRustFileDecoder", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the file by path and reports its length", async () => {
    const { open, commands } = setup([]);

    const decoder = await open();

    expect(commands).toEqual([{ command: "open_audio_file", args: { path: "/Music/a.flac" } }]);
    expect(decoder.durationSeconds).toBe(215.5);
  });

  it("asks for each chunk where the last one ended", async () => {
    const { open, requestedUrls } = setup([stereoBytes(1, 100), stereoBytes(101, 100)]);
    const decoder = await open();

    const first = (await decoder.read()) as unknown as FakeAudioBuffer;
    await decoder.read();

    expect(requestedUrls).toEqual([
      "file-track://localhost/7?start=0&count=88200",
      "file-track://localhost/7?start=100&count=88200",
    ]);
    expect(first.length).toBe(100);
    expect([...first.channels[0].slice(0, 2)]).toEqual([1, 2]);
    expect([...first.channels[1].slice(0, 2)]).toEqual([-1, -2]);
  });

  it("returns null at the end of the file", async () => {
    const { open } = setup([]);
    const decoder = await open();

    expect(await decoder.read()).toBeNull();
  });

  it("asks from the new position after a seek", async () => {
    const { open, requestedUrls } = setup([stereoBytes(0, 10)]);
    const decoder = await open();

    decoder.seek(83);
    await decoder.read();

    expect(requestedUrls[0]).toBe("file-track://localhost/7?start=3660300&count=88200");
  });

  it("reports damaged packets that Rust skipped", async () => {
    const invokeCommand = async () => ({ id: 1, duration_seconds: 1 }) as never;
    const fetchChunk = async () => new Response(stereoBytes(1, 10), { headers: { "X-Decode-Errors": "3" } });
    const decoder = await openRustFileDecoder("/a.flac", { invokeCommand, fetchChunk, baseUrl: "x/" });
    const damaged: number[] = [];
    decoder.onDamagedAudio = (packets) => damaged.push(packets);

    await decoder.read();

    expect(damaged).toEqual([3]);
  });

  it("stays quiet when nothing was damaged", async () => {
    const invokeCommand = async () => ({ id: 1, duration_seconds: 1 }) as never;
    const fetchChunk = async () => new Response(stereoBytes(1, 10), { headers: { "X-Decode-Errors": "0" } });
    const decoder = await openRustFileDecoder("/a.flac", { invokeCommand, fetchChunk, baseUrl: "x/" });
    const damaged: number[] = [];
    decoder.onDamagedAudio = (packets) => damaged.push(packets);

    await decoder.read();

    expect(damaged).toEqual([]);
  });

  it("throws the error Rust gave for a failed chunk", async () => {
    const invokeCommand = async () => ({ id: 1, duration_seconds: 1 }) as never;
    const fetchChunk = async () => new Response("can't decode the file", { status: 500 });
    const decoder = await openRustFileDecoder("/a.flac", { invokeCommand, fetchChunk, baseUrl: "x/" });

    await expect(decoder.read()).rejects.toThrow("500: can't decode the file");
  });

  it("closes the file in Rust", async () => {
    const { open, commands } = setup([]);
    const decoder = await open();

    decoder.close();

    expect(commands.at(-1)).toEqual({ command: "close_audio_file", args: { id: 7 } });
  });
});
