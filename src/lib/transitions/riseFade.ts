import { cubicInOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

interface RiseFadeOptions {
  duration?: number;
  /** How far below its resting place the element starts (and ends, when leaving), in pixels. */
  distance?: number;
}

/**
 * Fades an element in while it rises a short way from below, so it seems to come up from the bottom of the
 * screen (and, played backwards, fades out while sinking back down). The layout doesn't change while it runs.
 */
export function riseFade(_node: Element, { duration = 300, distance = 100 }: RiseFadeOptions = {}): TransitionConfig {
  return {
    duration,
    // Svelte applies this to the progress itself (it samples `css` along the eased curve). An ease-out like
    // `cubicOut` covers 16% of the distance in the first 60 fps frame, so the element seems to start mid-move;
    // an ease-in-out starts from rest at both ends.
    easing: cubicInOut,
    css: (progress, remaining) => `opacity: ${progress}; transform: translateY(${remaining * distance}px);`,
  };
}
