<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { SECTORS_PER_SECOND, type Toc, type Track } from "$lib/disc/types";
  import { CDPlayer } from "$lib/playback/CDPlayer.svelte";

  const player = new CDPlayer();
  /** Where `play()` starts, in seconds into the track. */
  let startAtSeconds = $state(0);

  let toc = $state<Toc | null>(null);
  let tocError = $state("");
  /** Result of the last test chunk read, keyed by track number. */
  let chunkResults = $state<Record<number, string>>({});

  const loadToc = () =>
    invoke<Toc>("get_toc")
      .then((result) => {
        toc = result;
        tocError = "";
      })
      .catch((error) => {
        toc = null;
        tocError = String(error);
      });

  const formatClock = (totalSeconds: number) =>
    `${Math.floor(totalSeconds / 60)}:${String(Math.floor(totalSeconds % 60)).padStart(2, "0")}`;

  const formatDuration = ({ first_sector, last_sector }: Track) =>
    formatClock(Math.round((last_sector - first_sector + 1) / SECTORS_PER_SECOND));

  /** Fetches the first 5 s of a track through the cd-track protocol and reports size and read time. */
  const testChunk = async ({ number }: Track) => {
    chunkResults[number] = "reading…";
    const startedAt = performance.now();
    const response = await fetch(`cd-track://localhost/track/${number}?start=0&count=375`).catch(
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

  loadToc();
</script>

<main>
  <h1>cdplayer</h1>
  <button onclick={loadToc}>Reload disc</button>

  <section class="transport">
    <button onclick={() => player.togglePause()} disabled={player.status !== "playing" && player.status !== "paused"}>
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
    <span>Up next: {player.queue.slice(1).map(({ number }) => number).join(", ") || "none"}</span>
    <button onclick={() => player.next()} disabled={player.queue.length < 2}>Next</button>
    <button onclick={() => player.clearQueue()} disabled={player.queue.length < 2}>Clear queue</button>
  </section>
  {#if player.error}
    <p class="error">{player.error}</p>
  {/if}

  {#if tocError}
    <p class="error">{tocError}</p>
  {:else if toc}
    <ol>
      {#each toc.tracks as track (track.number)}
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

  .error {
    color: #c0392b;
  }
</style>
