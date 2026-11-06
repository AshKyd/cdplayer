<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { UIRoot } from "svelte-akui";
  import AppControls from "./AppControls.svelte";
  import type { DiscMetadata } from "$lib/metadata/types";

  const { Story } = defineMeta({
    title: "AppControls",
    component: AppControls,
  });

  const disc: DiscMetadata = {
    discId: "group-therapy",
    releaseId: "",
    album: "Group Therapy",
    artist: "Above & Beyond",
    year: "2011",
    tracks: [],
    coverUrl: null,
  };

  const TRACK_SECONDS = 245;

  /** A plain square standing in for a cover. */
  const sampleCover = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3a6ea5"/><circle cx="100" cy="100" r="60" fill="#f2c14e"/></svg>',
  )}`;

  const scenarios = ["No disc", "Disc with cover", "Disc without cover", "Files"] as const;
</script>

<script lang="ts">
  /** A fake player: a clock that ticks while "playing", so the buttons and seek bar can be tried. */
  let playing = $state(false);
  let positionSeconds = $state(0);
  let coverOpen = $state(false);
  let playlistVisible = $state(true);
  let lastEvent = $state("");
  let scenario = $state<(typeof scenarios)[number]>("Disc with cover");

  const scenarioMetadata = $derived(
    scenario === "Disc with cover" ? { ...disc, coverUrl: sampleCover } : scenario === "Disc without cover" ? disc : null,
  );
  const scenarioMessage = $derived(scenario === "Files" ? "02 - Sirens of the Sea.flac" : "No disc");

  $effect(() => {
    if (!playing) return;
    const timer = setInterval(() => (positionSeconds = Math.min(positionSeconds + 1, TRACK_SECONDS)), 1000);
    return () => clearInterval(timer);
  });
</script>

<Story name="Interactive" asChild>
  <UIRoot>
    <p class="scenarios">
      {#each scenarios as name (name)}
        <button type="button" aria-pressed={scenario === name} onclick={() => (scenario = name)}>{name}</button>
      {/each}
    </p>
    <AppControls
      metadata={scenarioMetadata}
      message={scenarioMessage}
      coverless={scenario === "Files"}
      {playing}
      {positionSeconds}
      durationSeconds={TRACK_SECONDS}
      canPrevious
      canNext
      {coverOpen}
      bind:playlistVisible
      onopencover={() => (coverOpen = !coverOpen)}
      onplaypause={() => (playing = !playing)}
      onprevious={() => ((positionSeconds = 0), (lastEvent = "previous"))}
      onnext={() => ((positionSeconds = 0), (lastEvent = "next"))}
      onseek={(seconds) => ((positionSeconds = seconds), (lastEvent = `seek ${seconds}`))}
      onsettings={() => (lastEvent = "settings")}
    />
    <p class="event">Last event: {lastEvent || "none"} · Playlist {playlistVisible ? "shown" : "hidden"}</p>
  </UIRoot>
</Story>

<Story name="No disc" asChild>
  <UIRoot>
    <AppControls metadata={null} message="No disc" transportDisabled seekDisabled playlistToggleable={false} />
  </UIRoot>
</Story>

<Story name="Reading disc" asChild>
  <UIRoot>
    <AppControls metadata={null} message="Reading disc…" busy transportDisabled seekDisabled playlistToggleable={false} />
  </UIRoot>
</Story>

<Story name="Paused mid-track" asChild>
  <UIRoot>
    <AppControls metadata={disc} positionSeconds={92} durationSeconds={TRACK_SECONDS} canPrevious canNext />
  </UIRoot>
</Story>

<Story name="Last track" asChild>
  <UIRoot>
    <AppControls metadata={disc} playing positionSeconds={30} durationSeconds={TRACK_SECONDS} canPrevious />
  </UIRoot>
</Story>

<Story name="Playing files" asChild>
  <UIRoot>
    <AppControls
      metadata={null}
      message="02 - Sirens of the Sea.flac"
      coverless
      playing
      positionSeconds={12}
      durationSeconds={TRACK_SECONDS}
      canPrevious
      canNext
    />
  </UIRoot>
</Story>

<style>
  .scenarios {
    display: flex;
    gap: 0.5rem;
  }

  .scenarios button[aria-pressed="true"] {
    font-weight: 600;
  }

  .event {
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>
