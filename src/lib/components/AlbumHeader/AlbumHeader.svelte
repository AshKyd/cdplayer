<script lang="ts">
  import { Icon } from "svelte-akui";
  import { cubicInOut } from "svelte/easing";
  import { wipeIn, wipeOut } from "$lib/transitions/wipe";
  import { fade, slide } from "svelte/transition";
  import DiscSpinner from "$lib/components/DiscSpinner/DiscSpinner.svelte";
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
    /** The track being played. When set, its title replaces the album's; artist and year are shown when known. */
    track?: { title: string; artist: string; year?: string } | null;
    /** The source can't have a cover (audio files, such as an MP3 CD), so no space is kept for one. */
    coverless?: boolean;
  }

  let {
    metadata,
    message = "",
    busy = false,
    onopencover,
    coverOpen = false,
    track = null,
    coverless = false,
  }: Props = $props();

  /** The cover URL that has finished loading. The icon stays until then, so the image fades in rather than pops in. */
  let loadedCoverUrl = $state("");

  /** The cover URL that failed to load (offline, removed). */
  let failedCoverUrl = $state("");

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
    image.onerror = () => {
      console.log(`[cover] ${JSON.stringify({ imageFailedToLoad: coverUrl })}`);
      if (!stale) failedCoverUrl = coverUrl;
    };
    image.src = coverUrl;
    return () => {
      stale = true;
    };
  });

  const showCover = $derived(Boolean(metadata?.coverUrl) && loadedCoverUrl === metadata?.coverUrl);

  /**
   * Whether the cover's space is kept. Without a disc, or while one is being read or looked up, the disc icon
   * holds the space so the header doesn't change shape. Once the disc is known and has no cover (none listed,
   * or it failed to load) the space goes and the text gets the whole width. A cover that is still loading keeps it.
   */
  const hasCoverSpace = $derived(
    !coverless && (!metadata || (Boolean(metadata.coverUrl) && failedCoverUrl !== metadata.coverUrl)),
  );

  /** The playing track's title, otherwise the album's (or the placeholder message). */
  const heading = $derived(track?.title || (metadata ? metadata.album : message));

  /** Whatever of artist and year is known, under the heading. A track falls back to the disc's artist and year. */
  const details = $derived(
    [track ? track.artist || metadata?.artist : metadata?.artist, track ? track.year || metadata?.year : metadata?.year]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<div class="album">
  {#if hasCoverSpace}
    <button
      type="button"
      class="cover"
      disabled={!showCover || !onopencover}
      aria-label="View cover art"
      onclick={onopencover}
      style:view-transition-name={showCover && !coverOpen ? "album-cover" : null}
      transition:slide={{ axis: "x", duration: 300, easing: cubicInOut }}
    >
      <!-- Both share one grid cell, so the icon fades out while the cover fades in. -->
      {#if metadata && showCover}
        <img transition:fade src={metadata.coverUrl} alt="Cover of {metadata.album}" />
      {:else}
        <div class="icon" transition:fade>
          {#if busy}<DiscSpinner />{:else}<Icon name="disc" size="2rem" />{/if}
        </div>
      {/if}
    </button>
  {/if}
  <!-- The old and new text sit in the same box, so the new text wipes in over the old as the track changes. -->
  <div class="text">
    {#key `${heading}\n${details}`}
      <div class="text-slot" in:wipeIn out:wipeOut>
        <CopyfitText
          tag="h1"
          text={heading}
          style="font-size: 1.25rem; font-weight: 600;{metadata || track ? '' : ' color: var(--akui-fg-secondary);'}"
        />
        {#if details}
          <CopyfitText tag="p" text={details} style="color: var(--akui-fg-secondary);" />
        {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  .album {
    display: flex;
    align-items: center;
    /* The cover's height, so the controls bar doesn't change height when the cover goes. */
    min-height: 4.5rem;
  }

  .cover {
    display: grid;
    flex: none;
    /* A margin rather than a flex gap, so the slide transition animates the space with the cover. */
    margin-right: 1rem;
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
    position: relative;
    flex: 1;
    min-width: 0;
    /* A fixed height, because the slots are out of flow: it matches the cover, so the header never changes height. */
    align-self: stretch;
    min-height: 4.5rem;
  }

  /*
   * Each slot fills the box and centres its own text, so the outgoing and incoming text sit in the same
   * place while they wipe and nothing moves vertically when the old one is removed.
   */
  .text-slot {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    min-width: 0;
  }
</style>
