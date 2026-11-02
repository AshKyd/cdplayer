import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * The root URL of one of our custom protocols (`cd-track`, `file-track`), ending in `/`. Tauri serves a custom
 * scheme as `scheme://localhost/` on macOS and Linux but as `http://scheme.localhost/` on Windows and Android
 * (or `https://` if configured), so ask Tauri rather than hardcoding it.
 *
 * `convertFileSrc` is given an empty path because it URL-encodes the whole path, including the `/` and `?`
 * our URLs need. The root it returns for an empty path is the platform's prefix. Outside Tauri (tests, a plain
 * browser) there is no platform to ask, so it falls back to the macOS and Linux form.
 */
export const customProtocolBaseUrl = (scheme: string): string => {
  try {
    return convertFileSrc("", scheme).replace(/\/*$/, "/");
  } catch {
    return `${scheme}://localhost/`;
  }
};

export const cdTrackBaseUrl = (): string => customProtocolBaseUrl("cd-track");
