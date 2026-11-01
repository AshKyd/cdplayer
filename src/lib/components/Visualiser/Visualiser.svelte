<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { WAVEFORM_SAMPLES } from "$lib/playback/WebAudioHandler";
  import { loadCoverBitmap } from "$lib/visualisers/loadCoverBitmap";
  import type { VisualiserTrackInfo } from "$lib/visualisers/types";
  import type { VisualiserId } from "$lib/visualisers/visualiserCatalogue";
  import type { VisualiserWorkerMessage } from "$lib/visualisers/visualiserMessages";

  interface Props {
    /** Which visualiser to run. Changing it needs a fresh canvas, so the parent re-creates this component. */
    visualiserId: VisualiserId;
    /** Fills the array with the latest output samples (128 = silence); returns false when there is no audio yet. */
    readWaveform: (target: Uint8Array<ArrayBuffer>) => boolean;
    /** True while audio is sounding. When false, frames carry no samples and trails fade out. */
    playing: boolean;
    /** The current track, or `null` with no disc. */
    track: VisualiserTrackInfo | null;
    /** The disc's album, or `null` with no disc. `coverUrl` is fetched and decoded here before it is sent. */
    album: { title: string; artist: string; year: string; coverUrl: string | null } | null;
  }

  let { visualiserId, readWaveform, playing, track, album }: Props = $props();

  const TARGET_FPS = 30;
  const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
  /** Display frames land a little early or late; without slack a 60 Hz screen can drop to 20 fps. */
  const FRAME_TIMING_SLACK_MS = 2;

  type Send = (message: VisualiserWorkerMessage, transfer?: Transferable[]) => void;

  let canvas: HTMLCanvasElement;
  /** Set once the worker exists. The effects below wait for it, so the first track and album are sent on load. */
  let send = $state<Send>();

  /**
   * The AnalyserNode only exists on the main thread, so the page reads the samples each frame and hands them
   * to a worker. The worker owns the canvas and runs the chosen visualiser.
   */
  onMount(() => {
    const worker = new Worker(new URL("../../visualisers/visualiser.worker.ts", import.meta.url), { type: "module" });
    const post: Send = (message, transfer = []) => worker.postMessage(message, transfer);

    const offscreen = canvas.transferControlToOffscreen();
    post({ type: "init", canvas: offscreen, visualiserId }, [offscreen]);

    // Draw in device pixels so the line stays sharp on retina screens.
    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      post({
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
      post(
        {
          type: "frame",
          samples: hasSamples ? samples : null,
          accentColour: getComputedStyle(canvas).getPropertyValue("--akui-bg-accent"),
          timeMs: now,
        },
        hasSamples ? [samples.buffer] : [],
      );
    };
    frameId = requestAnimationFrame(tick);

    send = post;
    return () => {
      send = undefined;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      worker.terminate();
    };
  });

  $effect(() => {
    send?.({ type: "track", track: track && { ...track } });
  });

  // The text goes first so it isn't held up by the cover download; the cover follows when it has decoded.
  $effect(() => {
    const post = send;
    const current = album && { title: album.title, artist: album.artist, year: album.year };
    const coverUrl = album?.coverUrl;
    if (!post) return;
    post({ type: "album", album: current && { ...current, cover: null } });
    if (!current || !coverUrl) return;

    let stale = false;
    void loadCoverBitmap(coverUrl).then((cover) => {
      if (stale || !cover) return cover?.close();
      post({ type: "album", album: { ...current, cover } }, [cover]);
    });
    return () => {
      stale = true;
    };
  });
</script>

<!-- `global`: the page's {#if}/{#key} creates and removes this component, not a block inside it. -->
<canvas bind:this={canvas} aria-label="Visualiser" transition:fade|global={{ duration: 300 }}></canvas>

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
