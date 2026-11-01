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

<div class="controls" role="group" aria-label="Playback">
  <Button
    variant="ghost"
    icon="skip-backward-fill"
    iconPosition="only"
    aria-label="Previous track"
    disabled={disabled || !canPrevious}
    onclick={onprevious}
  />
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
  <Button
    variant="ghost"
    icon="skip-forward-fill"
    iconPosition="only"
    aria-label="Next track"
    disabled={disabled || !canNext}
    onclick={onnext}
  />
</div>

<style>
  .controls {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }
</style>
