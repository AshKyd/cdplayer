<script lang="ts">
  import { Button, InfoBox, Loader } from "svelte-akui";
  import { onMount } from "svelte";
  import AlbumHeader from "$lib/components/AlbumHeader/AlbumHeader.svelte";
  import NowPlaying from "$lib/components/NowPlaying/NowPlaying.svelte";
  import SeekBar from "$lib/components/SeekBar/SeekBar.svelte";
  import TrackTable from "$lib/components/TrackTable/TrackTable.svelte";
  import { toTrackRows } from "$lib/components/TrackTable/trackRows";
  import TransportControls from "$lib/components/TransportControls/TransportControls.svelte";
  import WaveformVisualiser from "$lib/components/WaveformVisualiser/WaveformVisualiser.svelte";
  import { CDPlayer } from "$lib/playback/CDPlayer.svelte";
  import { isDiscReady, isPlaybackActive } from "$lib/playback/playerMachine";
  import { openSettingsWindow } from "$lib/settings/openSettingsWindow";

  const player = new CDPlayer();

  onMount(() => {
    player.start();
    return () => player.destroy();
  });

  const hasPlayableTrack = $derived(player.tracks.some(({ is_audio }) => is_audio));
  const isActive = $derived(isPlaybackActive(player.status));
  /** Audio is moving (or about to), as opposed to stopped or paused. */
  const isSounding = $derived(["loading", "playing", "buffering"].includes(player.status));
  const rows = $derived(
    toTrackRows(
      player.tracks,
      (track) => player.trackTitle(track),
      (track) => player.trackArtist(track),
    ),
  );
  const noDiscMessage = $derived(
    player.discError ? `No disc: ${player.discError}` : player.checkingDisc ? "Reading disc…" : "No disc in the drive",
  );
</script>

<NowPlaying {player} />

<WaveformVisualiser readWaveform={(target) => player.readWaveform(target)} playing={isSounding} />

<main>
  <header>
    {#if player.metadata}
      <div class="album"><AlbumHeader metadata={player.metadata} /></div>
    {/if}
    <div class="controls">
      <TransportControls
        playing={isSounding}
        disabled={!hasPlayableTrack || !isDiscReady(player.status)}
        canPrevious={isActive}
        canNext={player.queue.length > 1}
        onprevious={() => void player.previous()}
        onplaypause={() => void player.playPause()}
        onnext={() => void player.next()}
      />
      <SeekBar
        positionSeconds={player.positionSeconds}
        durationSeconds={player.durationSeconds}
        disabled={!isActive}
        onseek={(seconds) => void player.seek(seconds)}
      />
      <Button
        variant="ghost"
        icon="gear"
        iconPosition="only"
        aria-label="Settings"
        onclick={() => void openSettingsWindow()}
      />
    </div>
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

  {#if player.status === "noDisc"}
    <p class="message">{noDiscMessage}</p>
  {:else if player.status === "loadingMetadata"}
    <p class="message"><Loader /> Looking up the disc…</p>
  {:else}
    {#if !player.metadata && player.metadataError}
      <p class="hint">Track names unavailable: {player.metadataError}.</p>
    {/if}
    <section>
      <TrackTable
        {rows}
        currentTrackNumber={player.trackNumber}
        playing={isSounding}
        onplay={(track) => void player.playFrom(track)}
      />
    </section>
  {/if}
</main>

<style>
  main {
    /* Above the background visualiser. */
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100vh;
    padding: 0.75rem 1rem 1rem;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 1.5rem;
    align-items: center;
    padding-block: 1rem;
  }

  /* As wide as the title or artist needs, up to the max; longer text is scaled down to fit. */
  .album {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 20rem;
  }

  .controls {
    display: flex;
    flex: 1 1 0;
    gap: 1.25rem;
    align-items: center;
    min-width: 0;
  }

  /* Narrow: the controls take the first line and the album drops below them. */
  @media (max-width: 45rem) {
    .controls {
      flex-basis: 100%;
    }

    .album {
      order: 1;
      max-width: 100%;
    }
  }

  section {
    flex: 1;
    min-height: 0;
    /* Frosted glass: blurs the waveform behind the table, with a light tint so the text stays readable. */
    background: color-mix(in srgb, var(--akui-bg) 55%, transparent);
    backdrop-filter: blur(12px);
    border-radius: var(--akui-radius-m);
  }

  .message {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    color: var(--akui-fg-secondary);
  }

  .hint {
    color: var(--akui-fg-secondary);
  }
</style>
