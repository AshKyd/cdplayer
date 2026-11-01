<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { cdTrackBaseUrl } from "$lib/disc/cdTrackUrl";
  import { DiscWatcher } from "$lib/disc/DiscWatcher.svelte";
  import { SECTORS_PER_SECOND, type Track } from "$lib/disc/types";
  import { chunkUrl } from "$lib/playback/chunks";
  import { CDPlayer } from "$lib/playback/CDPlayer.svelte";

  const player = new CDPlayer();
  /** Polls the drive for a new, swapped or ejected disc. Idle only: re-opening the drive would cut off playback. */
  const watcher = new DiscWatcher({
    isBusy: () => player.status !== "idle",
    // Whatever was playing or queued belongs to the old disc.
    onChange: () => player.stop(),
  });
  /** Where `play()` starts, in seconds into the track. */
  let startAtSeconds = $state(0);
  /** Set while the seek bar is being dragged, so the moving position doesn't fight the thumb. */
  let scrubSeconds = $state<number | null>(null);

  /** Result of the last test chunk read, keyed by track number. */
  let chunkResults = $state<Record<number, string>>({});

  onMount(() => {
    watcher.start();
    return () => watcher.stop();
  });

  // A failed read while playing usually means the disc was ejected: look at the drive straight away.
  $effect(() => {
    if (player.error) untrack(() => watcher.checkNow());
  });

  const formatClock = (totalSeconds: number) =>
    `${Math.floor(totalSeconds / 60)}:${String(Math.floor(totalSeconds % 60)).padStart(2, "0")}`;

  const formatDuration = ({ first_sector, last_sector }: Track) =>
    formatClock(Math.round((last_sector - first_sector + 1) / SECTORS_PER_SECOND));

  /** Fetches the first 5 s of a track through the cd-track protocol and reports size and read time. */
  const testChunk = async ({ number }: Track) => {
    chunkResults[number] = "reading…";
    const startedAt = performance.now();
    const response = await fetch(chunkUrl(cdTrackBaseUrl(), number, 0, 375)).catch(
      (error) => String(error),
    );
    if (typeof response === "string") {
      chunkResults[number] = `fetch failed: ${response}`;
      return;
    }
    const body = await response.arrayBuffer();
    const elapsedMs = Math.round(performance.now() - startedAt);
    chunkResults[number] = response.ok
      ? `${body.byteLength} bytes in ${elapsedMs} ms`
      : `${response.status}: ${new TextDecoder().decode(body)}`;
  };
</script>

<main>
  <h1>cdplayer</h1>
  <button onclick={() => watcher.checkNow()} disabled={watcher.checking || player.status !== "idle"}>
    Check for disc
  </button>

  <section class="transport">
    <button onclick={() => player.togglePause()} disabled={player.status === "idle"}>
      {player.status === "paused" ? "Play" : "Pause"}
    </button>
    <button onclick={() => player.stop()} disabled={player.status === "idle"}>Stop</button>
    <label>
      Start at (s)
      <input type="number" min="0" step="1" bind:value={startAtSeconds} />
    </label>
    <span>
      {#if player.status === "idle"}
        Stopped
      {:else}
        Track {player.trackNumber} · {player.status} · {formatClock(player.positionSeconds)}
      {/if}
    </span>
  </section>
  <section class="transport">
    <input
      class="seek"
      type="range"
      min="0"
      max={player.durationSeconds}
      step="1"
      value={scrubSeconds ?? player.positionSeconds}
      disabled={player.status === "idle"}
      aria-label="Seek"
      oninput={(event) => (scrubSeconds = Number(event.currentTarget.value))}
      onchange={(event) => {
        scrubSeconds = null;
        player.seek(Number(event.currentTarget.value));
      }}
    />
    <span>{formatClock(scrubSeconds ?? player.positionSeconds)} / {formatClock(player.durationSeconds)}</span>
  </section>
  <section class="transport">
    <span>Up next: {player.queue.slice(1).map(({ number }) => number).join(", ") || "none"}</span>
    <button onclick={() => player.next()} disabled={player.queue.length < 2}>Next</button>
    <button onclick={() => player.clearQueue()} disabled={player.queue.length < 2}>Clear queue</button>
  </section>
  {#if player.interrupted}
    <p class="warning">Audio output was interrupted. Press Play to continue.</p>
  {/if}
  {#if player.unreadableSectors > 0}
    <p class="warning">
      {player.unreadableSectors} unreadable sector{player.unreadableSectors === 1 ? "" : "s"} played as silence
      (the disc may be scratched or dirty)
    </p>
  {/if}
  {#if player.error}
    <p class="error">{player.error}</p>
  {/if}

  {#if watcher.error}
    <p class="error">{watcher.error}</p>
  {:else if watcher.toc}
    <ol>
      {#each watcher.toc.tracks as track (track.number)}
        <li>
          <span>Track {track.number} · {formatDuration(track)}{track.is_audio ? "" : " (data)"}</span>
          {#if track.is_audio}
            <button onclick={() => player.play(track, startAtSeconds || 0)}>Play</button>
            <button onclick={() => player.enqueue(track)}>Queue</button>
            <button onclick={() => testChunk(track)}>Test read</button>
          {/if}
          <small>{chunkResults[track.number] ?? ""}</small>
        </li>
      {/each}
    </ol>
  {:else}
    <p>Reading disc…</p>
  {/if}
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    padding: 1.5rem;
  }

  .transport {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-block: 1rem;
  }

  li {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-block: 0.25rem;
  }

  .seek {
    flex: 1;
    max-width: 24rem;
  }

  .warning {
    color: #b9770e;
  }

  .error {
    color: #c0392b;
  }
</style>
