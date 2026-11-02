<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { listPresetNames } from "$lib/visualisers/butterchurnPresets";
  import { DEFAULT_VISUALISER_ID, RANDOM_VISUALISER_ID, type VisualiserId } from "$lib/visualisers/visualiserCatalogue";
  import Visualiser from "../Visualiser.svelte";
  import { createStoryPlayer } from "./storyAudio";
  import type { StoryTrack } from "./storyTracks";

  interface Props {
    /** The tracks to choose from. The first plays first. */
    tracks: StoryTrack[];
    /** Which visualiser to start on. */
    initialVisualiserId?: VisualiserId;
  }

  let { tracks, initialVisualiserId = DEFAULT_VISUALISER_ID }: Props = $props();

  let trackIndex = $state(0);
  // Read once, on purpose: the first track and the starting visualiser don't change while this is open.
  let player = $state.raw(untrack(() => createStoryPlayer(tracks[0].url)));
  let visualiserId = $state<VisualiserId>(untrack(() => initialVisualiserId));
  let playing = $state(false);
  let loading = $state(false);
  let positionSeconds = $state(0);
  let durationSeconds = $state(0);
  /** True while the seek bar is being dragged, so the playing position doesn't fight the thumb. */
  let seeking = $state(false);

  const track = $derived(tracks[trackIndex]);

  let presetNames = $state<string[]>([]);

  onDestroy(() => player.dispose());

  // Follows the playing position for the seek bar, once a frame.
  onMount(() => {
    void listPresetNames().then((names) => (presetNames = names));
    let frameId = 0;
    const tick = () => {
      frameId = requestAnimationFrame(tick);
      durationSeconds = player.readDurationSeconds();
      if (!seeking) positionSeconds = player.readPositionSeconds();
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  });

  const togglePlayback = () => {
    loading = true;
    void player
      .toggle()
      .then((isPlaying) => (playing = isPlaying))
      .catch((reason) => console.error(JSON.stringify({ message: "Story audio failed", error: String(reason) })))
      .finally(() => (loading = false));
  };

  const selectTrack = (index: number) => {
    player.dispose();
    player = createStoryPlayer(tracks[index].url);
    trackIndex = index;
    playing = false;
    positionSeconds = 0;
    durationSeconds = 0;
  };

  /** Jumps when the thumb is let go, so dragging doesn't restart the audio over and over. */
  const finishSeek = () => {
    player.seek(positionSeconds);
    seeking = false;
  };

  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
</script>

<!-- A fresh component per visualiser, matching the app. -->
{#key visualiserId}
  <Visualiser
    {visualiserId}
    readWaveform={(target) => player.readWaveform(target)}
    {playing}
    track={null}
  />
{/key}

<div class="controls">
  <button type="button" onclick={togglePlayback} disabled={loading}>
    {loading ? "Loading…" : playing ? "Pause" : "Play"}
  </button>

  <label>
    Seek: {clock(positionSeconds)} / {clock(durationSeconds)}
    <input
      type="range"
      min="0"
      max={durationSeconds || 1}
      step="0.1"
      value={positionSeconds}
      disabled={durationSeconds === 0}
      oninput={(event) => {
        seeking = true;
        positionSeconds = Number(event.currentTarget.value);
      }}
      onchange={finishSeek}
    />
  </label>

  <label>
    Track
    <select value={trackIndex} onchange={(event) => selectTrack(Number(event.currentTarget.value))}>
      {#each tracks as { title, artist }, index (title)}
        <option value={index}>{artist} - {title}</option>
      {/each}
    </select>
  </label>

  <label>
    Visualiser
    <select bind:value={visualiserId}>
      <option value={RANDOM_VISUALISER_ID}>Random</option>
      {#each presetNames as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
  </label>

  <p class="credit">
    “<a href={track.sourceUrl} target="_blank" rel="noreferrer">{track.title}</a>” by
    <a href={track.artistUrl} target="_blank" rel="noreferrer">{track.artist}</a>,
    licensed under
    <a href={track.licence.url} target="_blank" rel="noreferrer">{track.licence.label}</a>.
    {track.changes}
  </p>
</div>

<style>
  /* Sits above the fixed full-window visualiser canvas (z-index 0). */
  .controls {
    position: fixed;
    top: 1rem;
    left: 1rem;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, canvas 80%, transparent);
    font-size: 0.8rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .credit {
    margin: 0;
    font-size: 0.7rem;
    opacity: 0.7;
  }
</style>
