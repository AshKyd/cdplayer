import { invoke } from "@tauri-apps/api/core";
import { customProtocolBaseUrl } from "$lib/disc/cdTrackUrl";
import type { FileDecoder } from "./FileDecoder";

/** What Rust decodes to, whatever the file: stereo `f32` at this rate (the Web Audio context's rate). */
const SAMPLE_RATE = 44100;
const BYTES_PER_FRAME = 2 * Float32Array.BYTES_PER_ELEMENT;

/** Response header from the `file-track` protocol: damaged packets Rust skipped in the chunk. */
const DECODE_ERRORS_HEADER = "X-Decode-Errors";

/** Frames asked for in each read: 2 s, so a read is quick but there are few round trips. */
const CHUNK_FRAMES = 2 * SAMPLE_RATE;

interface Options {
  /** Calls a Tauri command. Tests pass a fake. */
  invokeCommand?: <T>(command: string, args: Record<string, unknown>) => Promise<T>;
  /** Fetches one chunk by URL. Tests pass a fake. */
  fetchChunk?: (url: string) => Promise<Response>;
  /** Root of the `file-track` protocol, which differs by platform. Defaults to what Tauri reports. */
  baseUrl?: string;
}

/** Splits headerless interleaved stereo `f32` bytes into a left and a right channel. */
export const splitStereoChunk = (body: ArrayBuffer): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] => {
  const frames = Math.floor(body.byteLength / BYTES_PER_FRAME);
  const interleaved = new Float32Array(body, 0, frames * 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    left[frame] = interleaved[frame * 2];
    right[frame] = interleaved[frame * 2 + 1];
  }
  return [left, right];
};

/**
 * Opens an audio file in Rust (`open_audio_file`) and reads it a chunk at a time over the `file-track`
 * protocol. Rust does the decoding, resampling and seeking, so this only copies samples into an `AudioBuffer`.
 */
export const openRustFileDecoder = async (
  path: string,
  {
    invokeCommand = (command, args) => invoke(command, args),
    fetchChunk = (url) => fetch(url),
    baseUrl = customProtocolBaseUrl("file-track"),
  }: Options = {},
): Promise<FileDecoder> => {
  const { id, duration_seconds } = await invokeCommand<{ id: number; duration_seconds: number }>("open_audio_file", { path });
  /** The output frame the next read starts at. Rust carries on cheaply when it is where the last read ended. */
  let nextFrame = 0;

  const decoder: FileDecoder = {
    durationSeconds: duration_seconds,
    read: async () => {
      const response = await fetchChunk(`${baseUrl}${id}?start=${nextFrame}&count=${CHUNK_FRAMES}`);
      const body = await response.arrayBuffer();
      if (!response.ok) throw new Error(`${response.status}: ${new TextDecoder().decode(body)}`);

      const damagedPackets = Number(response.headers.get(DECODE_ERRORS_HEADER)) || 0;
      if (damagedPackets > 0) decoder.onDamagedAudio?.(damagedPackets);

      const [left, right] = splitStereoChunk(body);
      if (left.length === 0) return null;

      const buffer = new AudioBuffer({ numberOfChannels: 2, length: left.length, sampleRate: SAMPLE_RATE });
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      nextFrame += left.length;
      return buffer;
    },
    seek: (seconds) => {
      nextFrame = Math.round(seconds * SAMPLE_RATE);
    },
    close: () => {
      void invokeCommand("close_audio_file", { id }).catch(() => {});
    },
  };
  return decoder;
};
