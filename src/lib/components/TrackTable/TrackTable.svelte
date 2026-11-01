<script lang="ts">
  import { DetailsTable, Icon, type DetailsTableColumn } from "svelte-akui";
  import type { Track } from "$lib/disc/types";
  import type { TrackRow } from "./trackRows";

  interface Props {
    /** One row per track of the disc, in disc order. */
    rows: TrackRow[];
    /** Number of the track being played, marked in the first column. */
    currentTrackNumber: number | null;
    /** Whether that track is playing (a speaker) rather than paused. */
    playing: boolean;
    /** Called when a playable track is double-clicked, or Enter is pressed on it. */
    onplay: (track: Track) => void;
  }

  let { rows, currentTrackNumber, playing, onplay }: Props = $props();

  /** The artist column is only for compilations, where tracks have their own artist. */
  const hasTrackArtists = $derived(rows.some(({ artist }) => artist));

  const columns = $derived<DetailsTableColumn<TrackRow>[]>([
    { key: "marker", label: "", width: "2.5rem", align: "center", cell: markerCell },
    { key: "number", label: "#", width: "3.5rem", align: "right" },
    { key: "title", label: "Title", width: "minmax(10rem, 2fr)" },
    ...(hasTrackArtists ? [{ key: "artist", label: "Artist", width: "minmax(8rem, 1fr)" }] : []),
    { key: "duration", label: "Time", width: "6rem", align: "right" },
  ]);

  /** The row last clicked; the library reports clicks per row, and a double-click is two of them. */
  let clickedRow: TrackRow | null = null;

  const playRow = (row: TrackRow | null) => {
    if (row?.playable) onplay(row.track);
  };

  const handleRowClick = (row: TrackRow, event: MouseEvent | KeyboardEvent) => {
    clickedRow = row;
    if (event instanceof KeyboardEvent && event.key === "Enter") playRow(row);
  };

  const handleDoubleClick = (event: MouseEvent) => {
    // Only rows play; a double-click on the header (or a resize handle) does nothing.
    if (!(event.target as HTMLElement).closest(".akui-details-row")) return;
    playRow(clickedRow);
  };
</script>

{#snippet markerCell(row: TrackRow)}
  {#if row.number === currentTrackNumber}
    <Icon name={playing ? "volume-up-fill" : "pause-fill"} alt={playing ? "Playing" : "Paused"} />
  {/if}
{/snippet}

<!-- A double-click on a row plays it; the keyboard equivalent (Enter) is handled by the table. -->
<div class="tracks" role="presentation" ondblclick={handleDoubleClick}>
  <!-- Keyed on the rows, so a new disc clears the selection and scroll position. -->
  {#key rows}
    <DetailsTable
      {rows}
      {columns}
      rowKey={(row) => row.key}
      rowClass={(row) => [row.number === currentTrackNumber && "current", !row.playable && "data-track"].filter(Boolean).join(" ")}
      onrowclick={handleRowClick}
      aria-label="Tracks"
    />
  {/key}
</div>

<style>
  .tracks {
    height: 100%;
    min-height: 0;
  }

  .tracks :global(.akui-details-row.current) {
    font-weight: 600;
  }

  .tracks :global(.akui-details-row.data-track) {
    opacity: 0.55;
  }
</style>
