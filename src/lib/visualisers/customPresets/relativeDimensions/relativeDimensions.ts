import type { ButterchurnPreset } from "../../butterchurnPresets";
import { unusedShape, unusedWave } from "../unusedParts";
import { FRAME_EQS } from "./frameEquations";
import { PATH_EQS } from "./pathEquations";
import { WARP_SHADER } from "./warpShader";

/**
 * "Relative dimensions": complementary-colour particles flying into a spiral. The picture is fed back on itself with a slight zoom
 * and twist (`zoom`, `rot`, `decay`), so every particle is dragged inward along a spiral and fades.
 */
export const RELATIVE_DIMENSIONS: ButterchurnPreset = {
  version: 2,
  baseVals: {
    zoom: 1.025,
    rot: 0.012,
    decay: 0.93,
    gammaadj: 1.2,
    wrap: 0,
    warp: 0,
    wave_a: 0,
    ob_a: 0,
    ib_a: 0,
    mv_a: 0,
  },
  shapes: [
    {
      baseVals: { enabled: 1, sides: 8, additive: 1, num_inst: 192, border_a: 0 },
      init_eqs_eel: "",
      frame_eqs_eel: PATH_EQS,
    },
    unusedShape,
    unusedShape,
    unusedShape,
  ],
  waves: [unusedWave, unusedWave, unusedWave, unusedWave],
  init_eqs_eel: "",
  frame_eqs_eel: FRAME_EQS,
  pixel_eqs_eel: "",
  warp: WARP_SHADER,
  comp: "",
};
