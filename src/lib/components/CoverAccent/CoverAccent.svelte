<script lang="ts">
  import { untrack } from "svelte";
  import { getThemeStore } from "svelte-akui";
  import { settings } from "$lib/settings/settings.svelte";
  import type { CoverColour } from "$lib/theme/coverColours/pickCoverColours";

  const themeStore = getThemeStore();

  const toCss = ({ hue, chroma }: CoverColour) => `oklch(0.65 ${chroma} ${hue})`;

  // Lives in the layout so every window, including settings, matches the cover. akui themes from one hue and chroma,
  // which tints the neutrals as well as the accent. So only the primary colour can drive the theme. The secondary is
  // exposed as `--cover-secondary` for anything that wants a contrasting colour.
  //
  // `$effect.pre`, not `$effect`: it runs while the component is created, before the DOM exists, so the first paint
  // already has the saved colour. A plain `$effect` runs after mount and the default blue shows (and fades) first.
  $effect.pre(() => {
    const colours = settings.coverColours;
    if (!colours) return;
    const { primary, secondary } = colours;
    const userAccent = untrack(() => themeStore.accent);
    const rootStyle = document.documentElement.style;

    // Not persisted: the cover colours are temporary, and the user's chosen accent must come back afterwards.
    themeStore.setAccent({ hue: primary.hue, chroma: primary.chroma }, { persist: false });
    rootStyle.setProperty("--cover-primary", toCss(primary));
    if (secondary) rootStyle.setProperty("--cover-secondary", toCss(secondary));

    return () => {
      themeStore.setAccent(userAccent, { persist: false });
      rootStyle.removeProperty("--cover-primary");
      rootStyle.removeProperty("--cover-secondary");
    };
  });
</script>
