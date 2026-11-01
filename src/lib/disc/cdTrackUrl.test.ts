import { afterEach, describe, expect, it, vi } from "vitest";
import { cdTrackBaseUrl } from "./cdTrackUrl";

/** Behaves like Tauri's `convertFileSrc` for the given platform: the whole path is URL-encoded. */
const tauriOn = (platform: "macos" | "windows") => {
  const convertFileSrc = (path: string, protocol: string) => {
    const encoded = encodeURIComponent(path);
    return platform === "windows" ? `http://${protocol}.localhost/${encoded}` : `${protocol}://localhost/${encoded}`;
  };
  vi.stubGlobal("window", { __TAURI_INTERNALS__: { convertFileSrc } });
};

describe("cdTrackBaseUrl", () => {
  afterEach(() => void vi.unstubAllGlobals());

  it("uses the custom scheme on macOS and Linux", () => {
    tauriOn("macos");
    expect(cdTrackBaseUrl()).toBe("cd-track://localhost/");
  });

  it("uses http on the .localhost host on Windows and Android", () => {
    tauriOn("windows");
    expect(cdTrackBaseUrl()).toBe("http://cd-track.localhost/");
  });

  it("falls back to the custom scheme outside Tauri", () => {
    expect(cdTrackBaseUrl()).toBe("cd-track://localhost/");
  });
});
