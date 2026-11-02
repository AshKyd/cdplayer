import { describe, expect, it, vi } from "vitest";
import { revealWindow } from "./revealWindow";

describe("revealWindow", () => {
  it("shows the window", async () => {
    const show = vi.fn(async () => {});

    await revealWindow(show);

    expect(show).toHaveBeenCalledOnce();
  });

  it("doesn't throw when there is no window to show", async () => {
    await expect(revealWindow(() => Promise.reject(new Error("no window")))).resolves.toBeUndefined();
  });
});
