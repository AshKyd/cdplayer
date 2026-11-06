<script lang="ts">
  import { Slider } from "svelte-akui";
  import { formatClock } from "$lib/playback/format";

  interface Props {
    /** Seconds into the current track. */
    positionSeconds: number;
    /** Length of the current track in seconds. */
    durationSeconds: number;
    /** True when nothing is playing. */
    disabled: boolean;
    /** Called with the chosen time when the thumb is released. */
    onseek: (seconds: number) => void;
  }

  let { positionSeconds, durationSeconds, disabled, onseek }: Props = $props();

  /** Set while the thumb is being dragged, so the moving position doesn't fight it. */
  let scrubSeconds = $state<number | null>(null);

  const shownSeconds = $derived(scrubSeconds ?? positionSeconds);
</script>

<!-- Fades out when disabled but keeps its space, so the layout doesn't jump. -->
<div class="seek" class:hidden={disabled}>
  <span class="time">{formatClock(shownSeconds)}</span>
  <!-- Unfilled (an empty track with only the scrubber) and a rectangular scrubber in the accent colour. -->
  <div class="slider">
    <Slider
      min={0}
      max={durationSeconds}
      step={1}
      value={shownSeconds}
      colour="none"
      afterColour="none"
      thumbShape="rect"
      {disabled}
      label="Seek"
      valueText="{formatClock(shownSeconds)} of {formatClock(durationSeconds)}"
      oninput={(event) => (scrubSeconds = Number(event.currentTarget.value))}
      onchange={(event) => {
        scrubSeconds = null;
        onseek(Number(event.currentTarget.value));
      }}
    />
  </div>
  <span class="time">{formatClock(durationSeconds)}</span>
</div>

<style>
  .seek {
    display: flex;
    flex: 1;
    gap: 1rem;
    align-items: center;
    min-width: 0;
    transition:
      opacity 0.2s,
      visibility 0.2s;
  }

  .seek.hidden {
    opacity: 0;
    visibility: hidden;
  }

  @media (prefers-reduced-motion: reduce) {
    .seek {
      transition: none;
    }
  }

  .slider {
    flex: 1;
    min-width: 0;
  }

  /* As wide as the album art (4.5rem) so the times line up with the cover below. */
  .time {
    flex: none;
    width: 4.5rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--akui-fg-secondary);
  }
</style>
