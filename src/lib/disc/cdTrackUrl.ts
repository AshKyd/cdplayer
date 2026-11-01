import { convertFileSrc } from "@tauri-apps/api/core";

/** macOS and Linux. Used outside Tauri too (tests, a plain browser), where there is no platform to ask. */
const DEFAULT_BASE_URL = "cd-track://localhost/";

/**
 * The root URL of the `cd-track` protocol, ending in `/`. Tauri serves a custom scheme as
 * `cd-track://localhost/` on macOS and Linux but as `http://cd-track.localhost/` on Windows and Android
 * (or `https://` if configured), so ask Tauri rather than hardcoding it.
 *
 * `convertFileSrc` is given an empty path because it URL-encodes the whole path, including the `/` and `?`
 * our URLs need. The root it returns for an empty path is the platform's prefix.
 */
export const cdTrackBaseUrl = (): string => {
  try {
    return convertFileSrc("", "cd-track").replace(/\/*$/, "/");
  } catch {
    return DEFAULT_BASE_URL;
  }
};
