<script lang="ts">
  import { Button } from "svelte-akui";
  import AlbumHeader from "$lib/components/AlbumHeader/AlbumHeader.svelte";
  import SeekBar from "$lib/components/SeekBar/SeekBar.svelte";
  import TransportControls from "$lib/components/TransportControls/TransportControls.svelte";
  import type { DiscMetadata } from "$lib/metadata/types";

  interface Props {
    /** The disc's album, artist and cover. `null` when there is no disc, it is being read, it isn't known, or files are playing. */
    metadata: DiscMetadata | null;
    /** Shown in place of the album name when there is no `metadata`. */
    message?: string;
    /** Shows a spinner in the cover while the disc is being read. */
    busy?: boolean;
    /** True while the cover is shown full size elsewhere. */
    coverOpen?: boolean;
    /** The track being played, shown in place of the album's title, with its artist and year when known. */
    track?: { title: string; artist: string; year?: string } | null;
    /** The source has no cover art (audio files), so the cover's space is dropped. */
    coverless?: boolean;
    /** Whether audio is active (shows Pause) rather than stopped or paused (shows Play). */
    playing?: boolean;
    /** The transport can't start anything: no disc, no playable track or no files. */
    transportDisabled?: boolean;
    /** Whether there is a track to go back to or restart. */
    canPrevious?: boolean;
    /** Whether a track is queued after the current one. */
    canNext?: boolean;
    /** Seconds into the current track. */
    positionSeconds?: number;
    /** Length of the current track in seconds. */
    durationSeconds?: number;
    /** The seek bar can't be used: nothing to show, or nothing playing. */
    seekDisabled?: boolean;
    /** Whether the playlist is shown. The playlist button flips it. */
    playlistVisible?: boolean;
    /** The playlist button is offered. A playlist of one item has nothing to hide. */
    playlistToggleable?: boolean;
    onopencover?: () => void;
    onprevious?: () => void;
    onplaypause?: () => void;
    onnext?: () => void;
    /** Called with the chosen time when the seek thumb is released. */
    onseek?: (seconds: number) => void;
    onsettings?: () => void;
  }

  const noop = () => {};

  let {
    metadata,
    message = "",
    busy = false,
    coverOpen = false,
    track = null,
    coverless = false,
    playing = false,
    transportDisabled = false,
    canPrevious = false,
    canNext = false,
    positionSeconds = 0,
    durationSeconds = 0,
    seekDisabled = false,
    playlistVisible = $bindable(true),
    playlistToggleable = true,
    onopencover,
    onprevious = noop,
    onplaypause = noop,
    onnext = noop,
    onseek = noop,
    onsettings = noop,
  }: Props = $props();
</script>

<header>
  <!-- Always shown, and kept across discs, so the cover's space can slide in and out as the source changes. -->
  <div class="album">
    <AlbumHeader {metadata} {message} {busy} {coverOpen} {track} {coverless} {onopencover} />
  </div>
  <div class="transport">
    <TransportControls
      {playing}
      disabled={transportDisabled}
      {canPrevious}
      {canNext}
      {onprevious}
      {onplaypause}
      {onnext}
    />
  </div>
  <div class="window-buttons">
    {#if playlistToggleable}
      <Button
        variant="ghost"
        icon="music-note-list"
        iconPosition="only"
        aria-label={playlistVisible ? "Hide playlist" : "Show playlist"}
        onclick={() => (playlistVisible = !playlistVisible)}
      />
    {/if}
    <Button variant="ghost" icon="gear" iconPosition="only" aria-label="Settings" onclick={onsettings} />
  </div>
  <div class="seek">
    <SeekBar {positionSeconds} {durationSeconds} disabled={seekDisabled} {onseek} />
  </div>
</header>

<style>
  /* Equal flexible side columns keep the transport buttons in the exact centre whatever the album text length. */
  header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-areas:
      "seek seek seek"
      "album transport buttons";
    gap: 0.5rem 1.5rem;
    align-items: center;
    padding-block: 1rem;
  }

  .album {
    grid-area: album;
    min-width: 0;
    max-width: 20rem;
  }

  .transport {
    grid-area: transport;
  }

  .window-buttons {
    grid-area: buttons;
    justify-self: end;
    display: flex;
    gap: 0.125rem;
  }

  .seek {
    grid-area: seek;
    display: flex;
    min-width: 0;
  }

  /* Narrow: the transport keeps the middle column, so it stays centred; the album and buttons share the row below. */
  @media (max-width: 45rem) {
    header {
      grid-template-areas:
        "seek seek seek"
        ". transport ."
        "album album buttons";
    }

    .album {
      max-width: none;
    }
  }
</style>
