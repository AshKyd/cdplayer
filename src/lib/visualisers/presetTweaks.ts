/** One literal text swap inside a preset. `where` is the path to the string, e.g. `shapes.1.frame_eqs_eel`. */
interface PresetEdit {
  where: string;
  find: string;
  replace: string;
}

/**
 * Presets that need adjusting to look right here, by name. Each edit swaps a literal piece of the preset's
 * equations or shader. An edit that no longer matches (the pack was updated) is reported rather than ignored.
 */
export const PRESET_TWEAKS: Record<string, PresetEdit[]> = {
  // Too bright: its 256 additive shapes pile up to pure white. The shape colour is blended toward white by
  // `w` (which rises with treble), so `w` is cut to keep the hue; the shapes are halved in opacity; and the
  // final shader's 1.5x boost is lowered.
  "Halfbreak - Light of Breakers": [
    { where: "shapes.1.frame_eqs_eel", find: "w = 1-exp(-treb_att/2-.5);", replace: "w = (1-exp(-treb_att/2-.5))*.25;" },
    { where: "shapes.1.frame_eqs_eel", find: "a = min(a0*8+.4,1);", replace: "a = min(a0*8+.4,1)*.5;" },
    { where: "comp", find: "(xlat_mutableret1 * 1.5)", replace: "(xlat_mutableret1 * 0.9)" },
  ],
};

/** Walks `path` (dot-separated keys, array indexes included) and returns the object holding the last key. */
const resolveParent = (root: object, path: string): [Record<string, unknown>, string] | null => {
  const keys = path.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root);
  return parent && typeof parent === "object" ? [parent as Record<string, unknown>, last] : null;
};

/**
 * A copy of `preset` with the edits for `name` applied (the shared pack object is never changed).
 * Presets with no edits are returned as they are.
 */
export function applyPresetTweaks<T extends object>(name: string, preset: T): T {
  const edits = PRESET_TWEAKS[name];
  if (!edits) return preset;

  const copy = structuredClone(preset);
  edits.forEach(({ where, find, replace }) => {
    const [parent, key] = resolveParent(copy, where) ?? [null, ""];
    const text = parent?.[key];
    if (!parent || typeof text !== "string" || !text.includes(find)) {
      console.warn(JSON.stringify({ message: "Preset tweak no longer matches", name, where, find }));
      return;
    }
    parent[key] = text.replace(find, replace);
  });
  return copy;
}
