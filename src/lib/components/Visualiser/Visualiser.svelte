<script lang="ts">
  import butterchurn from "butterchurn";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { WAVEFORM_SAMPLES } from "$lib/playback/WebAudioHandler";
  import { listPresetNames, loadButterchurnPreset } from "$lib/visualisers/butterchurnPresets";
  import { pickRandomPresetName } from "$lib/visualisers/pickRandomPresetName";
  import { RANDOM_PRESET_SECONDS, RANDOM_VISUALISER_ID, type VisualiserId } from "$lib/visualisers/visualiserCatalogue";

  interface Props {
    /** The name of the butterchurn preset to run, or `"random"` to keep changing it. */
    visualiserId: VisualiserId;
    /** Fills the array with the latest output samples (128 = silence); returns false when there is no audio yet. */
    readWaveform: (target: Uint8Array<ArrayBuffer>) => boolean;
    /** True while audio is sounding. When false, silence is fed in so the preset settles. */
    playing: boolean;
  }

  let { visualiserId, readWaveform, playing }: Props = $props();

  const TARGET_FPS = 30;
  const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
  /** Display frames land a little early or late; without slack a 60 Hz screen can drop to 20 fps. */
  const FRAME_TIMING_SLACK_MS = 2;
  /** How many other presets to try when one fails to show. */
  const RANDOM_RETRIES = 3;
  /** Seconds to crossfade when the preset changes. */
  const PRESET_BLEND_SECONDS = 1.5;
  /** Butterchurn only needs the context for its sample rate: the audio comes from `readWaveform`, not a node. */
  const SAMPLE_RATE = 44100;

  /** A canvas with more pixels than this is drawn smaller and stretched by the browser. Smaller ones are drawn 1:1. */
  const FULL_RESOLUTION_MAX_PIXELS = 1_500_000;
  /** How much smaller (each way) a canvas over `FULL_RESOLUTION_MAX_PIXELS` is drawn: 0.5 is a quarter of the pixels. */
  const BIG_CANVAS_SCALE = 0.5;
  /**
   * Most pixels to draw each frame, whatever the scale above gives. Fullscreen on a 5K display is still about 3.7
   * million at half size. The picture is soft feedback glow, so the stretch isn't noticeable.
   */
  const MAX_RENDER_PIXELS = 1920 * 1080;
  /**
   * Wait this long after the last size change before resizing the renderer. Fullscreen and the window's height
   * animation send a resize every frame for a while, and each real resize reallocates butterchurn's textures.
   */
  const RESIZE_SETTLE_MS = 120;

  /** Butterchurn's own analyser size; `updateAudio` throws if given more. */
  const BUTTERCHURN_SAMPLES = 1024;

  const FPS_REPORT_INTERVAL_MS = 5000;

  type Renderer = ReturnType<typeof butterchurn.createVisualizer>;

  let framesSinceReport = 0;
  let renderMsSinceReport = 0;
  let lastReportTime = 0;

  /**
   * Logs the average framerate and the average time `render()` took on the CPU every `FPS_REPORT_INTERVAL_MS`.
   * `renderMs` only covers building and submitting the work: a slow GPU shows as a low `fps` with a low `renderMs`.
   */
  function recordFrame(renderMs: number) {
    const now = performance.now();
    if (!lastReportTime) lastReportTime = now;
    framesSinceReport += 1;
    renderMsSinceReport += renderMs;
    const elapsedMs = now - lastReportTime;
    if (elapsedMs < FPS_REPORT_INTERVAL_MS) return;
    console.log(
      JSON.stringify({
        visualiserFps: Number(((framesSinceReport * 1000) / elapsedMs).toFixed(1)),
        renderMs: Number((renderMsSinceReport / framesSinceReport).toFixed(1)),
      }),
    );
    framesSinceReport = 0;
    renderMsSinceReport = 0;
    lastReportTime = now;
  }

  let canvas: HTMLCanvasElement;
  /** Set once butterchurn exists. The effects below wait for it. */
  let renderer = $state.raw<Renderer>();
  /** Butterchurn throws on `render` and `setRendererSize` until its first preset is loaded. */
  let presetLoaded = false;

  /**
   * Butterchurn needs `window`, `document` and WebGL2, so it runs on the main thread (not in a worker).
   * The page reads the analyser's samples each frame and gives them to butterchurn directly.
   */
  onMount(() => {
    /** The canvas size to draw at: device pixels, scaled down if the canvas is big (see the constants above). */
    const size = () => {
      const width = canvas.clientWidth * devicePixelRatio;
      const height = canvas.clientHeight * devicePixelRatio;
      const pixels = Math.max(1, width * height);
      const scale = Math.min(pixels > FULL_RESOLUTION_MAX_PIXELS ? BIG_CANVAS_SCALE : 1, Math.sqrt(MAX_RENDER_PIXELS / pixels));
      return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    };
    const initial = size();
    canvas.width = initial.width;
    canvas.height = initial.height;
    // Butterchurn sizes its textures as width x pixelRatio. The size above is already in device pixels, so the
    // ratio must be 1: passing devicePixelRatio again draws 4x the pixels on a 2x display for no gain.
    const created = butterchurn.createVisualizer(new OfflineAudioContext(2, 1, SAMPLE_RATE), canvas, {
      ...initial,
      pixelRatio: 1,
    });

    const samples = new Uint8Array(WAVEFORM_SAMPLES);
    const drawFrame = () => {
      if (!presetLoaded) return;
      const hasSamples = playing && readWaveform(samples);
      if (!hasSamples) samples.fill(128);
      // Butterchurn reads exactly `BUTTERCHURN_SAMPLES`, so it gets the newest ones. The analyser is mono;
      // both channels get the same samples.
      const latest = samples.subarray(samples.length - BUTTERCHURN_SAMPLES);
      const renderStart = performance.now();
      created.render({ audioLevels: { timeByteArray: latest, timeByteArrayL: latest, timeByteArrayR: latest } });
      recordFrame(performance.now() - renderStart);
    };

    const resize = () => {
      const { width, height } = size();
      if (width === canvas.width && height === canvas.height) return;
      // Setting the size blanks the canvas, so draw straight away rather than show nothing until the next frame.
      canvas.width = width;
      canvas.height = height;
      if (!presetLoaded) return;
      created.setRendererSize(width, height);
      drawFrame();
    };
    // Until the size settles the browser stretches the old picture to fit, which is smooth and costs nothing.
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(resize, RESIZE_SETTLE_MS);
    });
    observer.observe(canvas);

    let frameId = 0;
    let lastFrameTime = 0;
    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      // Skip display frames until the next 30 fps slot is due.
      if (now - lastFrameTime < FRAME_INTERVAL_MS - FRAME_TIMING_SLACK_MS) return;
      lastFrameTime = now;
      drawFrame();
    };
    frameId = requestAnimationFrame(tick);

    renderer = created;
    return () => {
      renderer = undefined;
      cancelAnimationFrame(frameId);
      clearTimeout(settleTimer);
      observer.disconnect();
      created.loseGLContext();
    };
  });

  /** Shows the chosen preset, or, for "random", keeps switching to a new one. */
  $effect(() => {
    const current = renderer;
    const id = visualiserId;
    if (!current) return;
    let stale = false;
    let lastName: string | undefined;

    const show = async (name: string) => {
      const preset = await loadButterchurnPreset(name);
      if (stale || !preset) return false;
      current.loadPreset(preset, PRESET_BLEND_SECONDS);
      // The canvas may have been resized while there was no preset to draw it with.
      current.setRendererSize(canvas.width, canvas.height);
      presetLoaded = true;
      lastName = name;
      return true;
    };

    /** A few presets may not compile on this GPU, so a failure just tries another one. */
    const showRandom = async (attemptsLeft = RANDOM_RETRIES): Promise<void> => {
      const name = pickRandomPresetName(await listPresetNames(), lastName);
      if (stale || !name) return;
      const shown = await show(name).catch((reason) => {
        console.error(JSON.stringify({ message: "Could not show preset", name, error: String(reason) }));
        return false;
      });
      if (!shown && attemptsLeft > 0) await showRandom(attemptsLeft - 1);
    };

    if (id !== RANDOM_VISUALISER_ID) {
      void show(id).catch((reason) =>
        console.error(JSON.stringify({ message: "Could not show preset", name: id, error: String(reason) })),
      );
      return () => {
        stale = true;
      };
    }
    void showRandom();
    const timer = setInterval(() => void showRandom(), RANDOM_PRESET_SECONDS * 1000);
    return () => {
      stale = true;
      clearInterval(timer);
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
