import { compileModule } from "eel-wasm";
import { describe, expect, it, vi } from "vitest";

vi.mock("butterchurn-presets", () => ({ default: { "ORB - Waaa": { pack: true } } }));

const { CUSTOM_PRESETS } = await import("./index");
const { listPresetNames, loadButterchurnPreset } = await import("../butterchurnPresets");

type Shape = { baseVals: { enabled?: number; num_inst?: number }; frame_eqs_eel: string };

describe("CUSTOM_PRESETS", () => {
  it.each(Object.entries(CUSTOM_PRESETS))("%s has the shape butterchurn expects", (_name, preset) => {
    const { shapes, waves, frame_eqs_eel } = preset as unknown as { shapes: Shape[]; waves: unknown[]; frame_eqs_eel: string };
    expect(shapes).toHaveLength(4);
    expect(waves).toHaveLength(4);
    expect(frame_eqs_eel).not.toBe("");
    shapes
      .filter(({ baseVals }) => baseVals.enabled)
      .forEach(({ baseVals, frame_eqs_eel: eqs }) => {
        expect(baseVals.num_inst).toBeGreaterThanOrEqual(1);
        expect(baseVals.num_inst).toBeLessThanOrEqual(1024);
        expect(eqs).not.toBe("");
      });
  });
});

describe("CUSTOM_PRESETS equations", () => {
  // The same compiler butterchurn uses, so a typo or an unknown function fails here instead of in the browser.
  it.each(Object.entries(CUSTOM_PRESETS))("%s compiles", (_name, preset) => {
    const { shapes, frame_eqs_eel } = preset as unknown as { shapes: Shape[]; frame_eqs_eel: string };
    [frame_eqs_eel, ...shapes.map((shape) => shape.frame_eqs_eel)].forEach((code) =>
      expect(() => compileModule({ pools: { pool: new Set() }, functions: { script: { pool: "pool", code } } })).not.toThrow(),
    );
  });
});

describe("CUSTOM_PRESETS q variables", () => {
  // A q variable a shape or the warp shader reads but the frame equations never set is 0, which silently breaks
  // the preset (for example, offsets multiplied by an unset q7 all collapse to the centre of the screen).
  it.each(Object.entries(CUSTOM_PRESETS))("%s sets every q variable its shapes and shaders read", (_name, preset) => {
    const { shapes, frame_eqs_eel, warp, comp } = preset as unknown as {
      shapes: Shape[];
      frame_eqs_eel: string;
      warp: string;
      comp: string;
    };
    const assigned = new Set([...frame_eqs_eel.matchAll(/\b(q\d+)\s*=/g)].map(([, name]) => name));
    const readers = [...shapes.map((shape) => shape.frame_eqs_eel), warp, comp];
    const read = new Set(readers.flatMap((code) => [...code.matchAll(/\b(q\d+)\b/g)].map(([, name]) => name)));
    expect([...read].filter((name) => !assigned.has(name))).toEqual([]);
  });
});

describe("preset lists", () => {
  it("lists the presets on offer, ours first", async () => {
    const names = await listPresetNames();
    expect(names[0]).toBe("Relative dimensions");
    expect(names).toHaveLength(10);
  });

  it("loads ours and the pack's, and null for an unknown name", async () => {
    expect(await loadButterchurnPreset("Relative dimensions")).toBe(CUSTOM_PRESETS["Relative dimensions"]);
    expect(await loadButterchurnPreset("ORB - Waaa")).toEqual({ pack: true });
    expect(await loadButterchurnPreset("Nope")).toBeNull();
  });
});
