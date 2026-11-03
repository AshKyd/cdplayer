<script lang="ts">
  import { Button } from "svelte-akui";

  interface Props {
    /** Whether audio is active (shows Pause) rather than stopped or paused (shows Play). */
    playing: boolean;
    /** Nothing to play: there is no disc. */
    disabled: boolean;
    /** Whether there is a track to go back to or restart. */
    canPrevious: boolean;
    /** Whether a track is queued after the current one. */
    canNext: boolean;
    onprevious: () => void;
    onplaypause: () => void;
    onnext: () => void;
  }

  let { playing, disabled, canPrevious, canNext, onprevious, onplaypause, onnext }: Props = $props();
</script>

<!-- Unusable buttons fade out but keep their space, so the others don't move. Hidden also drops them from the tab order. -->
<div class="controls" role="group" aria-label="Playback">
  <span class="slot" class:hidden={disabled || !canPrevious}>
    <Button
      variant="ghost"
      icon="skip-backward-fill"
      iconPosition="only"
      aria-label="Previous track"
      disabled={disabled || !canPrevious}
      onclick={onprevious}
    />
  </span>
  <span class="slot" class:hidden={disabled}>
    <Button
      variant="accent"
      radius="full"
      size="large"
      icon={playing ? "pause-fill" : "play-fill"}
      iconPosition="only"
      aria-label={playing ? "Pause" : "Play"}
      {disabled}
      onclick={onplaypause}
    />
  </span>
  <span class="slot" class:hidden={disabled || !canNext}>
    <Button
      variant="ghost"
      icon="skip-forward-fill"
      iconPosition="only"
      aria-label="Next track"
      disabled={disabled || !canNext}
      onclick={onnext}
    />
  </span>
</div>

<style>
  .controls {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .slot {
    display: inline-flex;
    transition:
      opacity 0.2s,
      visibility 0.2s;
  }

  .slot.hidden {
    opacity: 0;
    visibility: hidden;
  }

  @media (prefers-reduced-motion: reduce) {
    .slot {
      transition: none;
    }
  }
</style>
