<script lang="ts">
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

<div class="seek">
  <span class="time">{formatClock(shownSeconds)}</span>
  <!-- A native range for now: akui has no slider. -->
  <input
    type="range"
    min="0"
    max={durationSeconds}
    step="1"
    value={shownSeconds}
    {disabled}
    aria-label="Seek"
    oninput={(event) => (scrubSeconds = Number(event.currentTarget.value))}
    onchange={(event) => {
      scrubSeconds = null;
      onseek(Number(event.currentTarget.value));
    }}
  />
  <span class="time">{formatClock(durationSeconds)}</span>
</div>

<style>
  .seek {
    display: flex;
    flex: 1;
    gap: 0.75rem;
    align-items: center;
    min-width: 0;
  }

  input {
    flex: 1;
    min-width: 0;
    accent-color: var(--akui-bg-accent);
  }

  .time {
    min-width: 2.75rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--akui-fg-secondary);
  }
</style>
