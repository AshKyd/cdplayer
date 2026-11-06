/** Replaced at build time by Vite's `define` (see `vite.config.js`). */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

export const APP_NAME = "cdplayer";
export const APP_VERSION = __APP_VERSION__;

/** Build date as a local date, e.g. "6 November 2026". */
export const BUILD_DATE = new Date(__BUILD_DATE__).toLocaleDateString(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});
