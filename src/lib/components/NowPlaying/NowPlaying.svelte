<script lang="ts">
  import { onMount } from "svelte";
  import type { CDPlayer } from "$lib/playback/CDPlayer.svelte";
  import { NowPlayingBridge, nowPlayingControls, nowPlayingState } from "./NowPlayingBridge";

  interface Props {
    /** The player to show in the system media controls and to control from them. */
    player: CDPlayer;
  }

  let { player }: Props = $props();

  /** Made on mount, since it needs the browser's `navigator.mediaSession`. */
  let bridge = $state.raw<NowPlayingBridge>();

  onMount(() => {
    bridge = new NowPlayingBridge({ controls: nowPlayingControls(player) });
    return () => bridge?.clear();
  });

  $effect(() => bridge?.update(nowPlayingState(player)));
</script>
