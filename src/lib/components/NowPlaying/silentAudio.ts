const SAMPLE_RATE = 8000;
const DATA_BYTES = SAMPLE_RATE * 2;

/** One second of silent 16-bit mono WAV as a data URL. Small enough to inline, so there is no asset to ship. */
export const silentWavUrl = (): string => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset: number, text: string) =>
    [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));

  writeText(0, "RIFF");
  view.setUint32(4, 36 + DATA_BYTES, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, DATA_BYTES, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, DATA_BYTES, true);

  const samples = new Uint8Array(DATA_BYTES);
  const bytes = [...new Uint8Array(header), ...samples];
  return `data:audio/wav;base64,${btoa(bytes.map((byte) => String.fromCharCode(byte)).join(""))}`;
};

/**
 * A looping silent `<audio>` element. WebKit only lists a page in the macOS menubar's Now Playing when
 * an HTML media element is playing; Web Audio on its own doesn't count, so this stands in for it.
 */
export const createSilentAudio = (): HTMLAudioElement => {
  const audio = new Audio(silentWavUrl());
  audio.loop = true;
  return audio;
};
