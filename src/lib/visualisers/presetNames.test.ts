import { describe, expect, it } from "vitest";
import { CUSTOM_PRESETS } from "./customPresets";
import { PRESET_NAMES } from "./visualiserCatalogue";

// The real pack, not a mock: a misspelt name here would otherwise only show up as a blank screen.
describe("PRESET_NAMES", () => {
  it("are all either ours or in the butterchurn-presets base pack, spelt exactly", async () => {
    // The pack's UMD wrapper reads `self`, which only exists in a browser.
    Object.assign(globalThis, { self: globalThis });
    const module = (await import("butterchurn-presets")) as unknown as {
      default: Record<string, object> & { default?: Record<string, object> };
    };
    const pack = module.default.default ?? module.default;
    const missing = PRESET_NAMES.filter((name) => !(name in CUSTOM_PRESETS) && !(name in pack));
    expect(missing).toEqual([]);
  });

  it("has no repeats", () => {
    expect(new Set(PRESET_NAMES).size).toBe(PRESET_NAMES.length);
  });
});
