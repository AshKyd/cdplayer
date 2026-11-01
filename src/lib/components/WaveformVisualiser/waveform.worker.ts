import { waveformPoints } from "./waveformPoints";
import type { WaveformWorkerMessage } from "./waveformWorkerMessages";

/** Share of the previous frame wiped each frame. Lower is a longer trail (0.28 at 30 fps is roughly half a second). */
const DECAY_ERASE_ALPHA = 0.28;

const FPS_REPORT_INTERVAL_MS = 5000;

let framesSinceReport = 0;
let lastReportTime = 0;

/** Counts drawn frames and logs the average framerate every `FPS_REPORT_INTERVAL_MS`. */
function recordFrame() {
  const now = performance.now();
  if (!lastReportTime) lastReportTime = now;
  framesSinceReport += 1;
  const elapsedMs = now - lastReportTime;
  if (elapsedMs < FPS_REPORT_INTERVAL_MS) return;
  console.log(JSON.stringify({ waveformFps: Number(((framesSinceReport * 1000) / elapsedMs).toFixed(1)) }));
  framesSinceReport = 0;
  lastReportTime = now;
}

let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null = null;
let pixelRatio = 1;

function drawFrame(samples: Uint8Array<ArrayBuffer> | null, colour: string) {
  if (!canvas || !context) return;
  const { width, height } = canvas;

  // Erase a fraction of the previous frame instead of all of it, so older lines linger and fade.
  // destination-out keeps the canvas transparent, so it works on any theme background.
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = `rgba(0, 0, 0, ${DECAY_ERASE_ALPHA})`;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";

  // Paused or stopped: the analyser is frozen on its last frame, so drawing it would hold the line
  // in place. The page sends null and the erase above fades the trail out.
  if (!samples) return;

  context.lineWidth = 2 * pixelRatio;
  context.lineJoin = "round";
  context.strokeStyle = colour || "currentColor";
  context.beginPath();
  waveformPoints(samples, width, height).forEach(([x, y], index) =>
    index === 0 ? context?.moveTo(x, y) : context?.lineTo(x, y),
  );
  context.stroke();
}

self.onmessage = ({ data }: MessageEvent<WaveformWorkerMessage>) => {
  if (data.type === "init") {
    canvas = data.canvas;
    context = canvas.getContext("2d");
    return;
  }
  if (data.type === "resize") {
    if (!canvas) return;
    canvas.width = data.width;
    canvas.height = data.height;
    pixelRatio = data.pixelRatio;
    return;
  }
  drawFrame(data.samples, data.colour);
  recordFrame();
};
