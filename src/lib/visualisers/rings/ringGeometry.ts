/** Byte value the analyser reports for silence. */
const SILENCE_BYTE = 128;

/**
 * Maps analyser bytes (0–255, 128 = silence) to a closed ring around `centre`. Each sample is one angle
 * round the circle; silence sits at `baseRadius` and a full-scale peak moves the point `swing` in or out.
 */
export function ringPoints(
  samples: Uint8Array,
  centre: { x: number; y: number },
  baseRadius: number,
  swing: number,
): Array<[x: number, y: number]> {
  return Array.from(samples, (sample, index): [number, number] => {
    const amplitude = (sample - SILENCE_BYTE) / SILENCE_BYTE;
    const angle = (index / samples.length) * 2 * Math.PI;
    const radius = baseRadius + amplitude * swing;
    return [centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius];
  });
}

/** Degrees of hue that pass each second, so the whole rainbow takes `360 / HUE_DEGREES_PER_SECOND` seconds. */
export const HUE_DEGREES_PER_SECOND = 50;

/** A fully saturated rainbow colour that cycles with time. */
export const rainbowColour = (timeMs: number): string =>
  `hsl(${Math.round(((timeMs / 1000) * HUE_DEGREES_PER_SECOND) % 360)} 95% 58%)`;
