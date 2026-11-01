<script lang="ts">
  import { copyfitScale } from "./copyfitScale";

  interface Props {
    /** The single line of text to show. */
    text: string;
    /** Element that holds the visible text. */
    tag?: "h1" | "p" | "span";
    /** Smallest fraction of the full size the text shrinks to before it is clipped with an ellipsis. */
    minScale?: number;
    /** Inline style for the full-size look (`font-size`, `font-weight`, `color`). */
    style?: string;
  }

  let { text, tag = "span", minScale = 0.6, style = "" }: Props = $props();

  let container: HTMLElement;
  let sizer: HTMLElement;
  let scale = $state(1);

  // The hidden sizer holds the text at full size, so the container is as wide as the full text (up to
  // any max-width on a parent) however small the visible text gets. Fitting to that width can't shrink
  // the container and set off a resize loop.
  $effect(() => {
    void text;
    const measure = () => {
      scale = copyfitScale(container.clientWidth, sizer.scrollWidth, minScale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  });
</script>

<div class="copyfit" bind:this={container} {style}>
  <span class="sizer" bind:this={sizer} aria-hidden="true">{text}</span>
  <svelte:element this={tag} style:font-size="{scale}em">{text}</svelte:element>
</div>

<style>
  .copyfit {
    min-width: 0;
  }

  /* Takes up width but no height. */
  .sizer {
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    white-space: nowrap;
  }

  .copyfit > :global(:not(.sizer)) {
    margin: 0;
    overflow: hidden;
    font-weight: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
