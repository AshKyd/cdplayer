import type { NotificationItem } from "svelte-akui";

/** Something worth telling the user about, which doesn't stop the app. */
export interface Problem {
  variant: "error" | "warning";
  title: string;
  message: string;
}

/** How long a toast stays: long enough to read, short enough not to pile up. */
const TOAST_SECONDS = 10;

/** The toasts shown in the bottom right corner (by `NotificationArea`), oldest first. */
class Notifications {
  items = $state<NotificationItem[]>([]);
  #counter = 0;

  notify({ variant, title, message }: Problem): void {
    this.items.push({ id: `notification-${++this.#counter}`, variant, title, message, timeout: TOAST_SECONDS * 1000 });
  }

  dismiss(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
  }
}

export const notifications = new Notifications();
