import { CUSTOM_PRESETS } from "./customPresets";
import { applyPresetTweaks } from "./presetTweaks";
import { PRESET_NAMES } from "./visualiserCatalogue";

/** A butterchurn preset definition. The shape is internal to butterchurn, so it is passed through untouched. */
export type ButterchurnPreset = object;

type PresetPack = Record<string, ButterchurnPreset>;

let presetPack: Promise<PresetPack> | undefined;

/**
 * The base preset pack, imported on first use because it is large. It is a UMD bundle, so its preset map may
 * sit on `default` or on `default.default` depending on the bundler.
 */
const loadPresetPack = (): Promise<PresetPack> =>
  (presetPack ??= import("butterchurn-presets").then((module) => {
    const { default: pack } = module as unknown as { default: PresetPack & { default?: PresetPack } };
    return pack.default ?? pack;
  }));

/** The presets on offer (`PRESET_NAMES`). This doesn't load the pack, so the settings window stays light. */
export const listPresetNames = (): Promise<string[]> => Promise.resolve([...PRESET_NAMES]);

/** The preset called `name` (ours, or the pack's with any tweaks from `presetTweaks.ts`), or `null` if the pack has no such preset. */
export const loadButterchurnPreset = (name: string): Promise<ButterchurnPreset | null> =>
  CUSTOM_PRESETS[name]
    ? Promise.resolve(CUSTOM_PRESETS[name])
    : loadPresetPack().then((pack) => (pack[name] ? applyPresetTweaks(name, pack[name]) : null));
