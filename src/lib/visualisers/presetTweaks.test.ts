import { describe, expect, it, vi } from "vitest";
import { applyPresetTweaks, PRESET_TWEAKS } from "./presetTweaks";

const NAME = "Halfbreak - Light of Breakers";

const makePreset = () => ({
  shapes: [{ frame_eqs_eel: "" }, { frame_eqs_eel: "w = 1-exp(-treb_att/2-.5);\na = min(a0*8+.4,1);" }],
  comp: "tmpvar_4.xyz = (xlat_mutableret1 * 1.5);",
});

describe("applyPresetTweaks", () => {
  it("returns other presets untouched", () => {
    const preset = makePreset();
    expect(applyPresetTweaks("Other", preset)).toBe(preset);
  });

  it("edits a copy and leaves the pack's preset alone", () => {
    const preset = makePreset();
    const tweaked = applyPresetTweaks(NAME, preset);
    expect(tweaked.shapes[1].frame_eqs_eel).toContain("*.25");
    expect(tweaked.shapes[1].frame_eqs_eel).toContain("*.5;");
    expect(tweaked.comp).toContain("* 0.9");
    expect(preset).toEqual(makePreset());
    expect(PRESET_TWEAKS[NAME]).toHaveLength(3);
  });

  it("warns when an edit no longer matches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyPresetTweaks(NAME, { shapes: [{}, { frame_eqs_eel: "changed" }], comp: "changed" });
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
