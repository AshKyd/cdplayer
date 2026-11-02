import { describe, expect, it } from "vitest";
import { notifications } from "./notifications.svelte";

describe("notifications", () => {
  it("adds a timed toast with its own id for each problem, and removes one when dismissed", () => {
    notifications.notify({ variant: "error", title: "Couldn't play a", message: "unsupported file" });
    notifications.notify({ variant: "warning", title: "Damaged audio", message: "3 packets skipped" });

    const [first, second] = notifications.items;
    expect(first).toMatchObject({ variant: "error", title: "Couldn't play a", message: "unsupported file", timeout: 10000 });
    expect(first.id).not.toBe(second.id);

    notifications.dismiss(first.id);
    expect(notifications.items.map(({ id }) => id)).toEqual([second.id]);
    notifications.dismiss(second.id);
    expect(notifications.items).toEqual([]);
  });
});
