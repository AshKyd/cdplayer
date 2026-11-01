<script lang="ts">
  import { Button } from "svelte-akui";

  interface Props {
    coverUrl: string;
    /** Describes the cover for screen readers. */
    alt: string;
    onclose: () => void;
  }

  let { coverUrl, alt, onclose }: Props = $props();
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} />

<!-- Keyboard users have Escape and the back button; the click is a mouse shortcut. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="viewer"
  role="presentation"
  onclick={(event) => {
    // Only the empty space closes it; the cover and the back button do their own thing.
    if (!(event.target as Element).closest(".cover, .back")) onclose();
  }}
>
  <!-- The cover, blurred and enlarged, fills whatever the contained cover leaves empty. -->
  <img class="backdrop" src={coverUrl} alt="" aria-hidden="true" />
  <img class="cover" src={coverUrl} {alt} />
  <div class="back">
    <Button icon="arrow-left" iconPosition="only" aria-label="Back" onclick={onclose} />
  </div>
</div>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 32px;
    overflow: hidden;
    background: var(--akui-bg);
  }

  .backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(40px) brightness(0.7);
    /* Blur fades the edges to transparent; scaling up pushes that off screen. */
    transform: scale(1.2);
  }

  .cover {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 5px;
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.5);
    /* Matches the name on the album header's cover, so the two morph into each other. */
    view-transition-name: album-cover;
  }

  .back {
    position: absolute;
    top: 32px;
    left: 32px;
  }
</style>
