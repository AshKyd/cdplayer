<script lang="ts">
  import type { Snippet } from "svelte";
  import { UIRoot } from "svelte-akui";
  import { syncWindowTheme } from "$lib/theme/syncWindowTheme";

  let { children }: { children: Snippet } = $props();

  /** The scheme akui is showing, after resolving the user's pick and the OS setting. */
  let resolvedMode = $state<"light" | "dark">("light");

  // Keeps the native titlebar in step with the app, including when the user overrides the OS scheme.
  $effect(() => void syncWindowTheme(resolvedMode));
</script>

<UIRoot bind:resolvedMode>
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
