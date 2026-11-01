import type { Visualiser } from "./types";
import { VISUALISER_LOADERS } from "./visualiserLoaders";
import type { VisualiserWorkerMessage } from "./visualiserMessages";

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
  console.log(JSON.stringify({ visualiserFps: Number(((framesSinceReport * 1000) / elapsedMs).toFixed(1)) }));
  framesSinceReport = 0;
  lastReportTime = now;
}

/**
 * Resolves once the chosen visualiser's code has loaded. Every later message waits on it, so a message that
 * arrives while the module is still loading is not lost, and they still run in the order they were sent.
 */
let visualiser: Promise<Visualiser | null> = Promise.resolve(null);

self.onmessage = ({ data }: MessageEvent<VisualiserWorkerMessage>) => {
  if (data.type === "init") {
    const { canvas, visualiserId } = data;
    visualiser = VISUALISER_LOADERS[visualiserId]()
      .then(({ default: createVisualiser }) => createVisualiser(canvas))
      .catch((reason) => {
        console.error(JSON.stringify({ message: "Could not load visualiser", visualiserId, error: String(reason) }));
        return null;
      });
    return;
  }

  visualiser = visualiser.then((current) => {
    if (!current) return current;
    switch (data.type) {
      case "resize":
        current.resize(data);
        break;
      case "track":
        current.setTrack(data.track);
        break;
      case "album":
        current.setAlbum(data.album);
        break;
      case "frame":
        current.renderFrame(data);
        recordFrame();
        break;
    }
    return current;
  });
};
