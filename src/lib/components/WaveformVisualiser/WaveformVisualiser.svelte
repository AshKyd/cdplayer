<script lang="ts">
  import { onMount } from "svelte";
  import { WAVEFORM_SAMPLES } from "$lib/playback/WebAudioHandler";
  import type { WaveformWorkerMessage } from "./waveformWorkerMessages";

  interface Props {
    /** Fills the array with the latest output samples (128 = silence); returns false when there is no audio yet. */
    readWaveform: (target: Uint8Array<ArrayBuffer>) => boolean;
    /** True while audio is sounding. When false, nothing new is drawn and the last lines fade out. */
    playing: boolean;
  }

  let { readWaveform, playing }: Props = $props();

  const TARGET_FPS = 30;
  const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
  /** Display frames land a little early or late; without slack a 60 Hz screen can drop to 20 fps. */
  const FRAME_TIMING_SLACK_MS = 2;

  let canvas: HTMLCanvasElement;

  /**
   * The AnalyserNode only exists on the main thread, so the page reads the samples each frame and hands them
   * to a worker. The worker owns the canvas and does the erasing and drawing.
   */
  onMount(() => {
    const worker = new Worker(new URL("./waveform.worker.ts", import.meta.url), { type: "module" });
    const send = (message: WaveformWorkerMessage, transfer: Transferable[] = []) =>
      worker.postMessage(message, transfer);

    const offscreen = canvas.transferControlToOffscreen();
    send({ type: "init", canvas: offscreen }, [offscreen]);

    // Draw in device pixels so the line stays sharp on retina screens.
    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      send({
        type: "resize",
        width: clientWidth * devicePixelRatio,
        height: clientHeight * devicePixelRatio,
        pixelRatio: devicePixelRatio,
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frameId = 0;
    let lastFrameTime = 0;
    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      // Skip display frames until the next 30 fps slot is due.
      if (now - lastFrameTime < FRAME_INTERVAL_MS - FRAME_TIMING_SLACK_MS) return;
      lastFrameTime = now;
      const samples = new Uint8Array(WAVEFORM_SAMPLES);
      const hasSamples = playing && readWaveform(samples);
      send(
        {
          type: "frame",
          samples: hasSamples ? samples : null,
          colour: getComputedStyle(canvas).getPropertyValue("--akui-bg-accent"),
        },
        hasSamples ? [samples.buffer] : [],
      );
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      worker.terminate();
    };
  });
</script>

<canvas bind:this={canvas} aria-label="Waveform"></canvas>

<style>
  /* A backdrop for the whole window, behind the page content and ignoring the pointer. */
  canvas {
    position: fixed;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
