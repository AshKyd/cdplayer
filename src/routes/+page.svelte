<script lang="ts">
  import { InfoBox } from "svelte-akui";
  import { onMount, untrack } from "svelte";
  import SeekBar from "$lib/components/SeekBar/SeekBar.svelte";
  import TrackTable from "$lib/components/TrackTable/TrackTable.svelte";
  import TransportControls from "$lib/components/TransportControls/TransportControls.svelte";
  import { DiscWatcher } from "$lib/disc/DiscWatcher.svelte";
  import type { Track } from "$lib/disc/types";
  import { CDPlayer } from "$lib/playback/CDPlayer.svelte";
  import { previousStep, tracksFrom } from "$lib/playback/navigation";

  const player = new CDPlayer();
  /** Polls the drive for a new, swapped or ejected disc. Idle only: re-opening the drive would cut off playback. */
  const watcher = new DiscWatcher({
    isBusy: () => player.status !== "idle",
    // Whatever was playing or queued belongs to the old disc.
    onChange: () => player.stop(),
  });

  /** Empty when there is no disc, which clears the table. */
  const tracks = $derived(watcher.toc?.tracks ?? []);
  const firstPlayable = $derived(tracks.find(({ is_audio }) => is_audio));
  /** Audio is active, as opposed to stopped or paused. */
  const isActive = $derived(["loading", "playing", "buffering"].includes(player.status));
  const emptyMessage = $derived(
    watcher.error ? `No disc: ${watcher.error}` : watcher.checking ? "Reading disc…" : "No disc in the drive",
  );

  onMount(() => {
    watcher.start();
    return () => watcher.stop();
  });

  // A failed read while playing usually means the disc was ejected: look at the drive straight away.
  $effect(() => {
    if (player.error) untrack(() => watcher.checkNow());
  });

  /** Plays `track` and everything after it on the disc, replacing whatever was queued. */
  const playFrom = (track: Track) => void player.playQueue(tracksFrom(tracks, track));

  const handlePlayPause = () => {
    if (player.status !== "idle") return void player.togglePause();
    if (firstPlayable) playFrom(firstPlayable);
  };

  const handlePrevious = () => {
    const step = previousStep({
      tracks,
      currentTrackNumber: player.trackNumber,
      positionSeconds: player.positionSeconds,
    });
    if (step.kind === "play") playFrom(step.track);
    else void player.seek(0);
  };
</script>

<main>
  <header>
    <TransportControls
      playing={isActive}
      disabled={!firstPlayable}
      canPrevious={player.status !== "idle"}
      canNext={player.queue.length > 1}
      onprevious={handlePrevious}
      onplaypause={handlePlayPause}
      onnext={() => void player.next()}
    />
    <SeekBar
      positionSeconds={player.positionSeconds}
      durationSeconds={player.durationSeconds}
      disabled={player.status === "idle"}
      onseek={(seconds) => void player.seek(seconds)}
    />
  </header>

  {#if player.interrupted}
    <InfoBox variant="warning" title="Audio output was interrupted">Press Play to continue.</InfoBox>
  {/if}
  {#if player.unreadableSectors > 0}
    <InfoBox variant="warning" title="Unreadable sectors">
      {player.unreadableSectors} sector{player.unreadableSectors === 1 ? "" : "s"} played as silence. The disc may
      be scratched or dirty.
    </InfoBox>
  {/if}
  {#if player.error}
    <InfoBox variant="error" title="Playback stopped">{player.error}</InfoBox>
  {/if}

  <section>
    <TrackTable
      {tracks}
      currentTrackNumber={player.trackNumber}
      playing={isActive}
      onplay={playFrom}
      {emptyMessage}
    />
  </section>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100vh;
    padding: 0.75rem 1rem 1rem;
  }

  header {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    padding-block: 1rem;
  }

  section {
    flex: 1;
    min-height: 0;
  }
</style>
