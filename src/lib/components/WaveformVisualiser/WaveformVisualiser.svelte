<script lang="ts">
  import { onMount } from "svelte";
  import { WAVEFORM_SAMPLES } from "$lib/playback/WebAudioHandler";
  import { waveformPoints } from "./waveformPoints";

  interface Props {
    /** Fills the array with the latest output samples (128 = silence); returns false when there is no audio yet. */
    readWaveform: (target: Uint8Array<ArrayBuffer>) => boolean;
    /** True while audio is sounding. When false, nothing new is drawn and the last lines fade out. */
    playing: boolean;
  }

  let { readWaveform, playing }: Props = $props();

  /** Share of the previous frame wiped each frame. Lower is a longer trail (0.15 is roughly half a second). */
  const DECAY_ERASE_ALPHA = 0.15;

  let canvas: HTMLCanvasElement;
  const samples = new Uint8Array(WAVEFORM_SAMPLES);

  onMount(() => {
    const context = canvas.getContext("2d");
    if (!context) return;

    // Draw in device pixels so the line stays sharp on retina screens.
    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth * devicePixelRatio;
      canvas.height = clientHeight * devicePixelRatio;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frameId = 0;
    const draw = () => {
      frameId = requestAnimationFrame(draw);
      const { width, height } = canvas;

      // Erase a fraction of the previous frame instead of all of it, so older lines linger and fade.
      // destination-out keeps the canvas transparent, so it works on any theme background.
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = `rgba(0, 0, 0, ${DECAY_ERASE_ALPHA})`;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";

      // Paused or stopped: the analyser is frozen on its last frame, so drawing it would hold the line
      // in place. Draw nothing and let the erase above fade the trail out.
      if (!playing || !readWaveform(samples)) return;

      context.lineWidth = 2 * devicePixelRatio;
      context.lineJoin = "round";
      context.strokeStyle = getComputedStyle(canvas).getPropertyValue("--akui-bg-accent") || "currentColor";
      context.beginPath();
      waveformPoints(samples, width, height).forEach(([x, y], index) =>
        index === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
      );
      context.stroke();
    };
    draw();

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
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
