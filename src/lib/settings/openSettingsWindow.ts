import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const SETTINGS_WINDOW_LABEL = "settings";

/** Opens the settings window, or brings it to the front if it is already open. */
export async function openSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(SETTINGS_WINDOW_LABEL, {
    url: "/settings",
    title: "Settings",
    width: 560,
    height: 420,
    minWidth: 400,
    minHeight: 300,
  });
}
