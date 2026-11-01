<script lang="ts">
  import { copyfitScale } from "./copyfitScale";

  interface Props {
    /** The text to show. */
    text: string;
    /** Element that holds the visible text. */
    tag?: "h1" | "p" | "span";
    /** Most lines the text may wrap across before it shrinks. */
    maxLines?: number;
    /** Smallest fraction of the full size the text shrinks to on one line, before it wraps instead. */
    minSingleLineScale?: number;
    /** Smallest fraction of the full size the text shrinks to when wrapped, before it is clipped with an ellipsis. */
    minScale?: number;
    /** Inline style for the full-size look (`font-size`, `font-weight`, `color`). */
    style?: string;
  }

  let { text, tag = "span", maxLines = 2, minSingleLineScale = 0.75, minScale = 0.6, style = "" }: Props = $props();

  let container: HTMLElement;

  // The container has a fixed width from its parent. A single line is preferred, shrunk a little if needed;
  // only when that is too small does the text wrap, at the largest scale that fits within `maxLines`.
  // line-clamp clips the rest, so any overflow means it didn't fit.
  $effect(() => {
    void text;
    const measure = () => {
      const visible = container.firstElementChild as HTMLElement | null;
      if (!visible) return;
      const fitsAt = (candidateLines: number) => (candidate: number) => {
        visible.style.webkitLineClamp = String(candidateLines);
        visible.style.fontSize = `${candidate}em`;
        return visible.scrollHeight <= visible.clientHeight + 1 && visible.scrollWidth <= visible.clientWidth + 1;
      };
      const singleLineScale = copyfitScale(fitsAt(1), minSingleLineScale);
      const fitsOneLine = fitsAt(1)(singleLineScale);
      // Set directly (not via style: directives), which skip the write when the value hasn't changed
      // and so would leave the last trial value in place.
      const finalLines = fitsOneLine || maxLines <= 1 ? 1 : maxLines;
      const finalScale = fitsOneLine ? singleLineScale : copyfitScale(fitsAt(maxLines), minScale);
      fitsAt(finalLines)(finalScale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  });
</script>

<div class="copyfit" bind:this={container} {style}>
  <svelte:element this={tag}>{text}</svelte:element>
</div>

<style>
  .copyfit {
    min-width: 0;
  }

  .copyfit > :global(*) {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    /* svelte-akui's root sets `break-word`, which would split a long word instead of shrinking it. */
    overflow-wrap: normal;
    font-weight: inherit;
    line-height: 1.15;
    -webkit-box-orient: vertical;
  }
</style>
