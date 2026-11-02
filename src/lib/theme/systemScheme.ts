export type SystemScheme = "light" | "dark";

/**
 * The OS colour scheme right now, read synchronously. akui's theme store starts at `light` and only reads the
 * OS in an effect after the first render, so under "System" a dark OS paints light first and then flashes to
 * dark. Reading it up front avoids that. Falls back to `light` with no browser (prerendering).
 */
export const currentSystemScheme = (
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis),
): SystemScheme => (matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
