import { getCurrentWindow } from "@tauri-apps/api/window";

export type ColourScheme = "light" | "dark";

/**
 * Sets the native titlebar (and window frame) to the scheme the app is showing.
 * The titlebar follows the OS by default, which is wrong once the user picks a theme in the app
 * that differs from the OS. Does nothing outside Tauri (plain browser, tests).
 */
export const syncWindowTheme = (
  scheme: ColourScheme,
  setWindowTheme: (scheme: ColourScheme) => Promise<void> = (value) => getCurrentWindow().setTheme(value),
): Promise<void> => {
  return Promise.resolve()
    .then(() => setWindowTheme(scheme))
    .catch(() => {});
};
