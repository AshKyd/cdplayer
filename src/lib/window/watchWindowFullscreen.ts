import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Calls `onChange` whenever the native window enters or leaves fullscreen, however that happened (our
 * button, the macOS green button, Ctrl+Cmd+F, a swipe to another Space). The page's own fullscreen state
 * can't be trusted alone, because the OS can change the window without telling the page.
 *
 * Fullscreen has no dedicated event, but entering and leaving it always resizes the window.
 * Returns a function that stops watching.
 */
export async function watchWindowFullscreen(onChange: (fullscreen: boolean) => void): Promise<() => void> {
  const appWindow = getCurrentWindow();
  let lastKnown = await appWindow.isFullscreen();

  return appWindow.onResized(async () => {
    const fullscreen = await appWindow.isFullscreen();
    if (fullscreen === lastKnown) return;
    lastKnown = fullscreen;
    onChange(fullscreen);
  });
}
