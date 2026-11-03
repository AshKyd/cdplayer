<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { UIRoot } from "svelte-akui";
  import AlbumHeader from "./AlbumHeader.svelte";
  import type { DiscMetadata } from "$lib/metadata/types";

  const { Story } = defineMeta({
    title: "AlbumHeader",
    component: AlbumHeader,
  });

  const discWith = (album: string, artist = "Above & Beyond", year = "2024"): DiscMetadata => ({
    discId: album,
    releaseId: "",
    album,
    artist,
    year,
    tracks: [],
    coverUrl: null,
  });

  /** A plain square standing in for a cover. */
  const sampleCover = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3a6ea5"/><circle cx="100" cy="100" r="60" fill="#f2c14e"/></svg>',
  )}`;

  /** Album titles from short to extreme, to see the one-line, shrunk, two-line and ellipsis cases. */
  const albums: [label: string, disc: DiscMetadata][] = [
    ["Short", discWith("Group Therapy")],
    ["Fits on one line", discWith("Anjunabeats Volume 17")],
    ["Slightly long", discWith("Anjunadeep 11: Mixed by James Grant")],
    ["Wraps to two lines", discWith("Trance Nation: The Ultimate Collection of Classics")],
    ["Long single word", discWith("Supercalifragilisticexpialidocious Anthems")],
    ["Long artist", discWith("Tri-State", "Above & Beyond presented by OceanLab with Justine Suissa")],
    ["Long artist and album", discWith("Trance Nation: The Ultimate Collection of Classics", "Armin van Buuren, Ferry Corsten & Tiësto")],
    [
      "Extreme (ellipsis)",
      discWith(
        "The Complete Original Motion Picture Soundtrack and Score, Expanded Deluxe Anniversary Edition Remastered",
        "Various Artists, Philharmonia Orchestra and the London Symphony Chorus",
      ),
    ],
  ];
</script>

<Story name="Title lengths" asChild>
  <UIRoot>
    <div class="grid">
      {#each albums as [label, disc] (label)}
        <figure>
          <figcaption>{label}</figcaption>
          <!-- Same width as the `.album` block on the main page. -->
          <div class="album">
            <AlbumHeader metadata={disc} />
          </div>
        </figure>
      {/each}
    </div>
  </UIRoot>
</Story>

<Story name="Playing a track" asChild>
  <UIRoot>
    <div class="grid">
      <div class="album">
        <AlbumHeader
          metadata={{ ...discWith("Group Therapy"), coverUrl: sampleCover }}
          track={{ title: "Sirens of the Sea", artist: "Above & Beyond" }}
        />
      </div>
      <div class="album">
        <AlbumHeader
          metadata={discWith("Trance Nation: The Ultimate Collection of Classics", "Various Artists", "")}
          track={{ title: "Rapture (Original Mix) (feat. Justine Suissa)", artist: "Armin van Buuren, Ferry Corsten & Tiësto" }}
        />
      </div>
    </div>
  </UIRoot>
</Story>

<Story name="With cover art" asChild>
  <UIRoot>
    <div class="album"><AlbumHeader metadata={{ ...discWith("Group Therapy"), coverUrl: sampleCover }} /></div>
  </UIRoot>
</Story>

<!-- Starts with a cover that fails to load, so the cover's space slides away once the load fails. -->
<Story name="Cover fails to load" asChild>
  <UIRoot>
    <div class="album">
      <AlbumHeader metadata={{ ...discWith("Group Therapy"), coverUrl: "https://invalid.invalid/missing.jpg" }} />
    </div>
  </UIRoot>
</Story>

<Story name="No disc" asChild>
  <UIRoot>
    <div class="album"><AlbumHeader metadata={null} message="No disc" /></div>
  </UIRoot>
</Story>

<Story name="Reading disc" asChild>
  <UIRoot>
    <div class="album"><AlbumHeader metadata={null} message="Reading disc…" busy /></div>
  </UIRoot>
</Story>

<style>
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
  }

  figure {
    margin: 0;
  }

  figcaption {
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
    opacity: 0.6;
  }

  .album {
    width: 16rem;
    outline: 1px dashed color-mix(in srgb, currentColor 25%, transparent);
  }
</style>
