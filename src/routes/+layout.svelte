<script lang="ts">
  import type { Snippet } from "svelte";
  import { UIRoot } from "svelte-akui";
  import CoverAccent from "$lib/components/CoverAccent/CoverAccent.svelte";
  import NativeWindowTheme from "$lib/components/NativeWindowTheme/NativeWindowTheme.svelte";

  let { children }: { children: Snippet } = $props();
</script>

<UIRoot>
  <NativeWindowTheme />
  <CoverAccent />
  {@render children()}
</UIRoot>

<style>
  /* Set before akui takes over, so scrollbars and form controls match the theme on first paint. */
  :global(html) {
    color-scheme: light dark;
  }

  /*
   * Every window fills its webview. Without a height, akui's root only grows to its content: short pages
   * leave unthemed whitespace below, and components sized `height: 100%` (like `Settings`) collapse to nothing.
   */
  :global(html),
  :global(body),
  :global(.akui-root) {
    height: 100%;
  }
</style>
