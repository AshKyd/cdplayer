<script lang="ts">
  import { getThemeStore } from "svelte-akui";
  import { currentSystemScheme } from "$lib/theme/systemScheme";

  const themeStore = getThemeStore();

  // akui reads the OS scheme in an effect, after the first paint, so under "System" a dark OS would show light
  // first. This runs while the page is first built, before `UIRoot` sets its `data-theme`, so the first paint is right.
  themeStore.systemScheme = currentSystemScheme();

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
