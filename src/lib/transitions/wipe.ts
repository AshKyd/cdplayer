import { cubicInOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

interface WipeOptions {
  duration?: number;
}

/** Extra clip room above and below, so content that overflows the element vertically (such as wrapped text) isn't cut. */
const VERTICAL_BLEED = "-1rem";

/**
 * Reveals an element from left to right with a clip path. Pair it with `wipeOut` and put the outgoing and
 * incoming elements in the same grid cell, so the new one wipes over the old.
 */
export function wipeIn(_node: Element, { duration = 450 }: WipeOptions = {}): TransitionConfig {
  return {
    duration,
    easing: cubicInOut,
    css: (progress) => `clip-path: inset(${VERTICAL_BLEED} ${(1 - progress) * 100}% ${VERTICAL_BLEED} 0);`,
  };
}

/**
 * Removes an element from left to right, the same direction as `wipeIn`, and with the same duration and
 * a symmetrical easing, so its remaining part starts exactly where the incoming element's revealed part ends.
 * (A reversed `wipeIn` would erase from right to left instead, against the incoming wipe.)
 */
export function wipeOut(_node: Element, { duration = 450 }: WipeOptions = {}): TransitionConfig {
  return {
    duration,
    easing: cubicInOut,
    css: (progress) => `clip-path: inset(${VERTICAL_BLEED} 0 ${VERTICAL_BLEED} ${(1 - progress) * 100}%);`,
  };
}
