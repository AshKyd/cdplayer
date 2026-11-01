import { getCurrentWindow } from "@tauri-apps/api/window";

/** Puts the current native window into or out of fullscreen. */
export async function setWindowFullscreen(fullscreen: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(fullscreen);
}
