<script lang="ts">
  import { fade } from "svelte/transition";
  import { DetailsTable, Icon, type DetailsTableColumn } from "svelte-akui";
  import type { TrackRow } from "./trackRows";

  interface Props {
    /** One row per track, in order. */
    rows: TrackRow[];
    /** Number of the track being played, marked in the first column. */
    currentTrackNumber: number | null;
    /** Whether that track is playing (a speaker) rather than paused. */
    playing: boolean;
    /** Called when a playable row is double-clicked, or Enter is pressed on it. */
    onplay: (row: TrackRow) => void;
  }

  let { rows, currentTrackNumber, playing, onplay }: Props = $props();

  /** The artist column is only for compilations, where tracks have their own artist. */
  const hasTrackArtists = $derived(rows.some(({ artist }) => artist));

  // With `autoFit`, columns without a `width` fit their content; `fitFlex` columns share the spare width.
  const columns = $derived<DetailsTableColumn<TrackRow>[]>([
    { key: "number", label: "#", align: "right", cell: numberCell, hideInList: true },
    { key: "title", label: "Title", fitFlex: 2, cell: titleCell },
    ...(hasTrackArtists ? [{ key: "artist", label: "Artist", fitFlex: 1 }] : []),
    { key: "duration", label: "Time", align: "right" },
  ]);

  /** The row last clicked; the library reports clicks per row, and a double-click is two of them. */
  let clickedRow: TrackRow | null = null;

  const playRow = (row: TrackRow | null) => {
    if (row?.playable) onplay(row);
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

{#snippet numberCell(row: TrackRow)}
  <!-- Grid wrapper centres the icon; the slot is always reserved so numbers don't shift when the icon appears. -->
  <span class="number-cell">
    <span class="marker">
      {#if row.number === currentTrackNumber}
        <span class="marker-icon" transition:fade={{ duration: 150 }}>
          <Icon name={playing ? "volume-up-fill" : "pause-fill"} alt={playing ? "Playing" : "Paused"} />
        </span>
      {/if}
    </span>
    {row.number}
  </span>
{/snippet}

{#snippet titleCell(row: TrackRow)}
  <!-- The number has its own column in the table layout; the narrow list layout hides that column, so the title carries it. -->
  <span class="title-number">{row.number}.</span>
  {row.title}
{/snippet}

<!-- A double-click on a row plays it; the keyboard equivalent (Enter) is handled by the table. -->
<div class="tracks" role="presentation" ondblclick={handleDoubleClick}>
  <!-- Keyed on the rows, so a new disc clears the selection and scroll position. -->
  {#key rows}
    <DetailsTable
      {rows}
      {columns}
      autoFit
      border={false}
      showLines={false}
      listLabels={false}
      titleKey="title"
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
    /* The table is borderless and square, so this clips the header and rows to rounded corners. */
    overflow: hidden;
    border-radius: var(--akui-radius-m);
  }

  .number-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .title-number {
    display: none;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }

  .tracks :global(.akui-details-table.list .title-number) {
    display: inline;
  }

  .marker {
    display: grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
  }

  .marker-icon {
    display: grid;
    place-items: center;
  }

  /* A faint wash of the text colour, so the frosted section behind the table shows through without going muddy. */
  .tracks {
    --akui-details-head-bg: color-mix(in srgb, var(--akui-fg) 10%, transparent);
  }

  /* `showLines={false}` clears the lines between rows and columns, but not the line under the header. */
  .tracks :global(.akui-details-head) {
    border-bottom: none;
  }

  .tracks :global(.akui-details-row.current) {
    font-weight: 600;
  }

  .tracks :global(.akui-details-row.data-track) {
    opacity: 0.55;
  }
</style>
