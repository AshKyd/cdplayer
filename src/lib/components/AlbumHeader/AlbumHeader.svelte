<script lang="ts">
  import { Icon } from "svelte-akui";
  import CopyfitText from "$lib/components/CopyfitText/CopyfitText.svelte";
  import type { DiscMetadata } from "$lib/metadata/types";

  interface Props {
    /** The disc's album, artist and cover. */
    metadata: DiscMetadata;
  }

  let { metadata }: Props = $props();

  /** A cover that fails to load (offline, removed) falls back to the disc icon. */
  let coverFailed = $state(false);

  const details = $derived([metadata.artist, metadata.year].filter(Boolean).join(" · "));
</script>

<div class="album">
  <div class="cover">
    {#if metadata.coverUrl && !coverFailed}
      <img src={metadata.coverUrl} alt="Cover of {metadata.album}" onerror={() => {
          console.log(`[cover] ${JSON.stringify({ imageFailedToLoad: metadata.coverUrl })}`);
          coverFailed = true;
        }}
        onload={() => console.log(`[cover] ${JSON.stringify({ imageLoaded: metadata.coverUrl })}`)}
      />
    {:else}
      <Icon name="disc" size="2rem" />
    {/if}
  </div>
  <div class="text">
    <CopyfitText tag="h1" text={metadata.album} style="font-size: 1.25rem; font-weight: 600;" />
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
    overflow: hidden;
    border-radius: 0.375rem;
    background: var(--akui-bg-secondary);
    color: var(--akui-fg-secondary);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .text {
    min-width: 0;
  }
</style>
