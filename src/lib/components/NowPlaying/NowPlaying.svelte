<script lang="ts">
  import { onMount } from "svelte";
  import { NowPlayingBridge, type NowPlayingControls, type NowPlayingState } from "./NowPlayingBridge";

  interface Props {
    /** What to show in the system media controls. */
    nowPlaying: NowPlayingState;
    /** What the media keys do. Called at the moment of the key press, so it can pick the player then. */
    controls: NowPlayingControls;
  }

  let { nowPlaying, controls }: Props = $props();

  /** Made on mount, since it needs the browser's `navigator.mediaSession`. */
  let bridge = $state.raw<NowPlayingBridge>();

  onMount(() => {
    bridge = new NowPlayingBridge({ controls });
    return () => bridge?.clear();
  });

  $effect(() => bridge?.update(nowPlaying));
</script>
