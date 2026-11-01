import { emit, listen } from "@tauri-apps/api/event";
import type { SettingsSync, SettingsValues } from "./settings.svelte";

const SETTINGS_CHANGED_EVENT = "settings-changed";

interface SettingsChangedPayload {
  senderId: string;
  values: Partial<SettingsValues>;
}

/** Sends settings changes to the other windows as Tauri events. Does nothing outside Tauri (plain browser, tests). */
export const tauriSettingsSync: SettingsSync = {
  publish: (values, senderId) => {
    const payload: SettingsChangedPayload = { senderId, values };
    emit(SETTINGS_CHANGED_EVENT, payload).catch(() => {});
  },
  subscribe: (handler) => {
    const stopListening = listen<SettingsChangedPayload>(SETTINGS_CHANGED_EVENT, ({ payload }) =>
      handler(payload.values, payload.senderId),
    ).catch(() => () => {});
    return () => void stopListening.then((stop) => stop());
  },
};
