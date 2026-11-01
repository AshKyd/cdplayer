<script lang="ts">
  import { Icon, Loader } from "svelte-akui";
  import { fade } from "svelte/transition";
  import CopyfitText from "$lib/components/CopyfitText/CopyfitText.svelte";
  import type { DiscMetadata } from "$lib/metadata/types";

  interface Props {
    /** The disc's album, artist and cover. `null` when there is no disc, it is being read, or it isn't known. */
    metadata: DiscMetadata | null;
    /** Shown in place of the album name when there is no `metadata`, so the header keeps its size. */
    message?: string;
    /** Shows a spinner instead of the disc icon while the disc is being read. */
    busy?: boolean;
    /** Called when the loaded cover is clicked. */
    onopencover?: () => void;
    /** True while the cover is shown full size elsewhere, which holds the view transition name instead. */
    coverOpen?: boolean;
  }

  let { metadata, message = "", busy = false, onopencover, coverOpen = false }: Props = $props();

  /** The cover URL that has finished loading. The icon stays until then, so the image fades in rather than pops in. */
  let loadedCoverUrl = $state("");

  /** A cover that fails to load (offline, removed) leaves the disc icon showing. */
  $effect(() => {
    const coverUrl = metadata?.coverUrl;
    if (!coverUrl) {
      loadedCoverUrl = "";
      return;
    }
    let stale = false;
    const image = new Image();
    image.onload = () => {
      if (!stale) loadedCoverUrl = coverUrl;
    };
    image.onerror = () => console.log(`[cover] ${JSON.stringify({ imageFailedToLoad: coverUrl })}`);
    image.src = coverUrl;
    return () => {
      stale = true;
    };
  });

  const showCover = $derived(Boolean(metadata?.coverUrl) && loadedCoverUrl === metadata?.coverUrl);

  const details = $derived(metadata ? [metadata.artist, metadata.year].filter(Boolean).join(" · ") : "");
</script>

<div class="album">
  <button
    type="button"
    class="cover"
    disabled={!showCover || !onopencover}
    aria-label="View cover art"
    onclick={onopencover}
    style:view-transition-name={showCover && !coverOpen ? "album-cover" : null}
  >
    <!-- Both share one grid cell, so the icon fades out while the cover fades in. -->
    {#if metadata && showCover}
      <img transition:fade src={metadata.coverUrl} alt="Cover of {metadata.album}" />
    {:else}
      <div class="icon" transition:fade>
        {#if busy}<Loader />{:else}<Icon name="disc" size="2rem" />{/if}
      </div>
    {/if}
  </button>
  <div class="text" class:placeholder={!metadata}>
    <CopyfitText
      tag="h1"
      text={metadata ? metadata.album : message}
      style="font-size: 1.25rem; font-weight: 600;{metadata ? '' : ' color: var(--akui-fg-secondary);'}"
    />
    {#if details}
      <CopyfitText tag="p" text={details} style="color: var(--akui-fg-secondary);" />
    {/if}
  </div>
</div>

<style>
  .album {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .cover {
    display: grid;
    flex: none;
    place-items: center;
    width: 4.5rem;
    height: 4.5rem;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
    background: var(--akui-bg-secondary);
    color: var(--akui-fg-secondary);
  }

  .cover:disabled {
    cursor: default;
  }

  img,
  .icon {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
  }

  .icon {
    display: grid;
    place-items: center;
  }

  img {
    object-fit: cover;
  }

  /* Fills the fixed-width album block, so the text is fitted to the same width for every disc. */
  .text {
    flex: 1;
    min-width: 0;
  }
</style>
