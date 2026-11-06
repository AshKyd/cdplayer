<script lang="ts">
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { onMount } from "svelte";
  import { audioPathsFrom } from "$lib/files/audioFiles";

  interface Props {
    /** Called with the paths of the audio files dropped anywhere on the window, in the order given. Not called if there are none. */
    onfiles: (paths: string[]) => void;
  }

  let { onfiles }: Props = $props();

  let isDragging = $state(false);

  // Tauri takes file drops from the OS itself and reports their paths, which Rust needs to open the files.
  // Outside Tauri (a plain browser) there is no webview to ask, so drops are simply not handled.
  onMount(() => {
    const stopListening = getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        switch (payload.type) {
          case "enter":
            isDragging = audioPathsFrom(payload.paths).length > 0;
            break;
          case "leave":
            isDragging = false;
            break;
          case "drop": {
            isDragging = false;
            const paths = audioPathsFrom(payload.paths);
            if (paths.length > 0) onfiles(paths);
            break;
          }
        }
      })
      .catch(() => () => {});
    return () => void stopListening.then((stop) => stop());
  });
</script>

{#if isDragging}
  <div class="overlay" aria-hidden="true">Drop audio files to play them</div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0.5rem;
    z-index: 10;
    display: grid;
    place-items: center;
    /* The drop is handled by the window, not by this. */
    pointer-events: none;
    border: 2px dashed var(--akui-fg-secondary);
    border-radius: var(--akui-radius-m);
    background: color-mix(in srgb, var(--akui-bg) 70%, transparent);
    backdrop-filter: blur(6px);
    font-size: 1.25rem;
  }
</style>
