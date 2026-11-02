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
<Story name="Relative dimensions" asChild>
  <UIRoot><VisualiserPlayground tracks={STORY_TRACKS} initialVisualiserId="Relative dimensions" /></UIRoot>
</Story>

<Story name="Random" asChild>
  <UIRoot><VisualiserPlayground tracks={STORY_TRACKS} initialVisualiserId="random" /></UIRoot>
</Story>

<Story name="Painterly 2" asChild>
  <UIRoot>
    <VisualiserPlayground tracks={STORY_TRACKS} initialVisualiserId="Geiss - Cauldron - painterly 2 (saturation remix)" />
  </UIRoot>
</Story>
