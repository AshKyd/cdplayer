<script lang="ts">
  import { onMount } from "svelte";
  import { revealWindow } from "$lib/window/revealWindow";

  // Placed after the theme components in the layout, so by the time this mounts the colour scheme is applied.
  onMount(() => {
    void revealWindow();
  });
</script>
