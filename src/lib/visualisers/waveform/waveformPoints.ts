/** Byte value the analyser reports for silence. */
const SILENCE_BYTE = 128;

/**
 * Maps analyser bytes (0–255, 128 = silence) to canvas points across `width`, centred vertically in `height`.
 * Loud peaks reach the top and bottom edges; a flat line sits in the middle.
 */
export function waveformPoints(samples: Uint8Array, width: number, height: number): Array<[x: number, y: number]> {
  if (samples.length < 2) return [];
  const lastIndex = samples.length - 1;
  return Array.from(samples, (sample, index): [number, number] => {
    const amplitude = (sample - SILENCE_BYTE) / SILENCE_BYTE;
    return [(index / lastIndex) * width, height / 2 - (amplitude * height) / 2];
  });
}
