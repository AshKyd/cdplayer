/**
 * Reads one audio file as a stream of 44.1 kHz `AudioBuffer`s, decoding only as far as asked.
 * `FilePlayer` depends on this interface alone, so tests use a fake. The real one is `RustFileDecoder`.
 */
export interface FileDecoder {
  durationSeconds: number;
  /** Called when a read skipped damaged parts of the file, with how many. Set by the owner. */
  onDamagedAudio?: (damagedPackets: number) => void;
  /** The next piece of audio, or `null` at the end of the file. */
  read(): Promise<AudioBuffer | null>;
  /** Moves the next `read()` to `seconds`. */
  seek(seconds: number): void;
  close(): void;
}
