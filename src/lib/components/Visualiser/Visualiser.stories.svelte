<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { UIRoot } from "svelte-akui";
  import VisualiserPlayground from "./VisualiserPlayground/VisualiserPlayground.svelte";
  import { STORY_TRACKS } from "./VisualiserPlayground/storyTracks";

  const { Story } = defineMeta({
    title: "Visualiser",
    parameters: { layout: "fullscreen" },
  });
</script>

<!--
  Plays Creative Commons tracks (see `.storybook/assets/CREDITS.md`) so the visualisers can be tried on real music,
  with a seek bar. Press Play: browsers won't start audio before a click.
-->
<Story name="Waveform" asChild>
  <UIRoot><VisualiserPlayground tracks={STORY_TRACKS} initialVisualiserId="waveform" /></UIRoot>
</Story>

<Story name="Rainbow tunnel" asChild>
  <UIRoot><VisualiserPlayground tracks={STORY_TRACKS} initialVisualiserId="rings" /></UIRoot>
</Story>
