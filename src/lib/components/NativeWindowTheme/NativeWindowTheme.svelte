<script lang="ts">
  import { getThemeStore } from "svelte-akui";

  const themeStore = getThemeStore();

  // The macOS title bar is drawn from the webview's CSS `color-scheme`, not from the window API (`setTheme` is
  // reported as applied but the title bar ignores it). A theme picked in the app is pinned; under "System" both
  // are allowed so the OS decides. Pinning the OS scheme here instead would feed back, since the store reads the
  // OS scheme from the same place.
  const colourScheme = $derived(themeStore.selected === null ? "light dark" : themeStore.selected.scheme);

  $effect(() => {
    document.documentElement.style.colorScheme = colourScheme;
    return () => document.documentElement.style.removeProperty("color-scheme");
  });
</script>
