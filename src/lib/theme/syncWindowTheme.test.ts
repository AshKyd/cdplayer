import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { syncWindowTheme } from "./syncWindowTheme";

describe("syncWindowTheme", () => {
  it("passes the scheme to the window", async () => {
    const applied: string[] = [];
    await syncWindowTheme("dark", async (scheme) => void applied.push(scheme));
    assert.deepEqual(applied, ["dark"]);
  });

  it("swallows errors when there is no Tauri window", async () => {
    await syncWindowTheme("light", () => Promise.reject(new Error("no tauri")));
  });
});
