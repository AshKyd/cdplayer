<script lang="ts">
  import type { Snippet } from "svelte";
  import { UIRoot } from "svelte-akui";

  let { children }: { children: Snippet } = $props();
</script>

<UIRoot>
  {@render children()}
</UIRoot>

<style>
  /* Set before akui takes over, so scrollbars and form controls match the theme on first paint. */
  :global(html) {
    color-scheme: light dark;
  }
</style>
