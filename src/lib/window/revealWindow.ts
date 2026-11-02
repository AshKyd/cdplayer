import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { tick } from "svelte";

/**
 * Shows the window once the page has rendered. Windows are created hidden (`visible: false`), so the user never
 * sees a blank webview or the page in the wrong colours before the theme is applied.
 *
 * `tick()` waits for the state changes of the first render to be applied, not `requestAnimationFrame`, which
 * WebKit pauses while the window is hidden. Does nothing outside Tauri (plain browser, tests).
 */
export const revealWindow = async (show: () => Promise<void> = () => getCurrentWebviewWindow().show()): Promise<void> => {
  await tick();
  await show().catch(() => {});
};
