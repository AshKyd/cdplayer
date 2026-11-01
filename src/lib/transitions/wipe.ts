import { cubicInOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

interface WipeOptions {
  duration?: number;
}

/**
 * Reveals an element from left to right with a clip path (and, played backwards, wipes it away the same way).
 * Put the outgoing and incoming elements in the same grid cell so one wipes over the other.
 */
export function wipe(_node: Element, { duration = 450 }: WipeOptions = {}): TransitionConfig {
  return {
    duration,
    easing: cubicInOut,
    css: (progress) => `clip-path: inset(0 ${(1 - progress) * 100}% 0 0);`,
  };
}
