<script lang="ts">
  import { untrack } from "svelte";
  import { settings } from "$lib/settings/settings.svelte";
  import { extractCoverColours } from "$lib/theme/coverColours/extractCoverColours";

  interface Props {
    /** The cover to take colours from. With none, or a greyscale cover, the colours are cleared. */
    coverUrl?: string | null;
    /** True while the disc is being read. The saved colours are left alone until it finishes. */
    reading?: boolean;
  }

  let { coverUrl = null, reading = false }: Props = $props();

  // The colours are saved so the app opens already tinted, instead of flashing the default theme until the cover
  // loads. They are only replaced (or cleared) once the disc has been read, so the last disc's colours stay
  // until we know what is in the drive now. `CoverAccent` applies whatever is in the settings.
  // Written with `untrack`: the setter reads the settings state, which would otherwise re-run this on every setting change.
  $effect(() => {
    if (reading) return;
    if (!coverUrl) {
      untrack(() => (settings.coverColours = null));
      return;
    }
    let stale = false;
    extractCoverColours(coverUrl).then((colours) => {
      if (!stale) settings.coverColours = colours;
    });
    return () => {
      stale = true;
    };
  });
</script>
