import type { VisualiserFactory } from "../types";
import { waveformPoints } from "./waveformPoints";

/** Share of the previous frame wiped each frame. Lower is a longer trail (0.28 at 30 fps is roughly half a second). */
const DECAY_ERASE_ALPHA = 0.28;

/** The sound as one line across the window, in the theme's accent colour. Older lines linger and fade. */
const createWaveformVisualiser: VisualiserFactory = (canvas) => {
  const context = canvas.getContext("2d");
  let pixelRatio = 1;

  return {
    resize: ({ width, height, pixelRatio: ratio }) => {
      canvas.width = width;
      canvas.height = height;
      pixelRatio = ratio;
    },
    setTrack: () => {},
    setAlbum: (album) => album?.cover?.close(),
    renderFrame: ({ samples, accentColour }) => {
      if (!context) return;
      const { width, height } = canvas;

      // Erase a fraction of the previous frame instead of all of it, so older lines linger and fade.
      // destination-out keeps the canvas transparent, so it works on any theme background.
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = `rgba(0, 0, 0, ${DECAY_ERASE_ALPHA})`;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";

      // Paused or stopped: the analyser is frozen on its last frame, so drawing it would hold the line
      // in place. The host sends null and the erase above fades the trail out.
      if (!samples) return;

      context.lineWidth = 2 * pixelRatio;
      context.lineJoin = "round";
      context.strokeStyle = accentColour || "currentColor";
      context.beginPath();
      waveformPoints(samples, width, height).forEach(([x, y], index) =>
        index === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
      );
      context.stroke();
    },
  };
};

export default createWaveformVisualiser;
