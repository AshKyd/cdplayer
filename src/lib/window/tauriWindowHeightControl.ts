import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NumberStore, WindowHeightControl } from "./AnimatedWindowHeight";

const VIEWPORT_SETTLE_MS = 150;

/** A number in `localStorage`; storage that is missing or blocked just means it is found again next launch. */
export const localStorageNumberStore = (key: string): NumberStore => ({
  load: () => {
    try {
      const stored = localStorage.getItem(key);
      const value = stored === null ? NaN : Number(stored);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  },
  save: (value) => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Not kept; it is worked out again next time.
    }
  },
});

/** Resizes the current Tauri window's height, keeping its width. Needs the `core:window:allow-set-size` and `core:window:allow-set-min-size` capabilities. */
export const tauriWindowHeightControl = (): WindowHeightControl => {
  const appWindow = getCurrentWindow();

  const getLogicalSize = async () => {
    const [physical, scaleFactor] = await Promise.all([appWindow.innerSize(), appWindow.scaleFactor()]);
    return physical.toLogical(scaleFactor);
  };

  return {
    getHeight: async () => (await getLogicalSize()).height,
    setHeight: async (height) => appWindow.setSize(new LogicalSize((await getLogicalSize()).width, height)),
    // The width limit is 1 px, i.e. none: only the height is limited.
    setMinimumHeight: async (height) => appWindow.setMinSize(new LogicalSize(1, height)),
    // The webview's size lags the native window by a moment, so let it settle before reading.
    getViewportHeight: async () => {
      await new Promise((resolve) => setTimeout(resolve, VIEWPORT_SETTLE_MS));
      return Math.round(window.innerHeight);
    },
    canResize: async () => {
      const [isFullscreen, isMaximised] = await Promise.all([appWindow.isFullscreen(), appWindow.isMaximized()]);
      return !isFullscreen && !isMaximised;
    },
    onResized: (callback) => appWindow.onResized(callback),
  };
};
