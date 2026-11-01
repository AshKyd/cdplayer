import type { VisualiserFactory } from "../types";
import { rainbowColour, ringPoints } from "./ringGeometry";

/** How much the previous frame is enlarged each frame. This is the speed of the flight. */
const ZOOM_PER_FRAME = 1.05;
/** How much of the previous frame survives each frame; the rest fades, so rings dim as they near the edge. */
const KEEP_ALPHA = 0.92;
/** New rings are born this fraction of the window's shorter side from the centre... */
const BASE_RADIUS_RATIO = 0.16;
/** ...and the sound pushes their points in and out by up to this fraction. */
const SWING_RATIO = 0.12;
/**
 * Rings of sound, painted in rainbow colours. Each frame the previous frame is enlarged about the centre and
 * repainted a little dimmer, then a fresh ring is drawn in the middle, so the rings seem to rush outward
 * past you like flying down a tunnel.
 */
const createRingsVisualiser: VisualiserFactory = (canvas) => {
  const context = canvas.getContext("2d");
  let pixelRatio = 1;

  /** Redraws the canvas into itself, bigger and dimmer. "copy" replaces the pixels, so the canvas stays transparent. */
  const flyForward = (context: OffscreenCanvasRenderingContext2D) => {
    const { width, height } = canvas;
    const scaledWidth = width * ZOOM_PER_FRAME;
    const scaledHeight = height * ZOOM_PER_FRAME;
    context.globalCompositeOperation = "copy";
    context.globalAlpha = KEEP_ALPHA;
    context.drawImage(canvas, (width - scaledWidth) / 2, (height - scaledHeight) / 2, scaledWidth, scaledHeight);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  };

  return {
    resize: ({ width, height, pixelRatio: ratio }) => {
      canvas.width = width;
      canvas.height = height;
      pixelRatio = ratio;
    },
    setTrack: () => {},
    setAlbum: (album) => album?.cover?.close(),
    renderFrame: ({ samples, timeMs }) => {
      if (!context) return;
      flyForward(context);

      // Paused or stopped: no new ring, so the tunnel keeps flying outward and dissolves.
      if (!samples) return;

      const { width, height } = canvas;
      const shorterSide = Math.min(width, height);
      const points = ringPoints(
        samples,
        { x: width / 2, y: height / 2 },
        shorterSide * BASE_RADIUS_RATIO,
        shorterSide * SWING_RATIO,
      );

      context.lineWidth = 2 * pixelRatio;
      context.lineJoin = "round";
      context.strokeStyle = rainbowColour(timeMs);
      context.beginPath();
      points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
      context.closePath();
      context.stroke();
    },
  };
};

export default createRingsVisualiser;
