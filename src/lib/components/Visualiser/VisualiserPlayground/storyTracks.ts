export interface StoryTrack {
  title: string;
  artist: string;
  artistUrl: string;
  /** Where the original track is published. The title links here. */
  sourceUrl: string;
  /** Where Storybook serves the audio from (see `staticDirs` in `.storybook/main.ts`). */
  url: string;
  /** Full licence name and the link to its deed. CC licences require both. */
  licence: { label: string; url: string };
  /** Indicates what we did to the audio. CC licences require a note of changes. */
  changes: string;
}

const CHANGES = "Converted to AAC (.m4a) for playback in Storybook.";

/** Creative Commons tracks to try the visualisers on. Keep `.storybook/assets/CREDITS.md` in step. */
export const STORY_TRACKS: StoryTrack[] = [
  {
    title: "Making Me Nervous",
    artist: "Brad Sucks",
    artistUrl: "https://soundcloud.com/bradsucks",
    sourceUrl: "https://soundcloud.com/bradsucks/01-brad-sucks-making-me-nervous",
    url: "/making-me-nervous.m4a",
    licence: {
      label: "Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)",
      url: "https://creativecommons.org/licenses/by-sa/3.0/",
    },
    changes: CHANGES,
  },
  {
    title: "Hope (Original Mix)",
    artist: "Tobu",
    artistUrl: "https://soundcloud.com/7obu",
    sourceUrl: "https://soundcloud.com/7obu/tobu-hope-original-mix",
    url: "/tobu-hope.m4a",
    // Unverified: the track page only says "a Creative Commons License". Confirm the variant against the source.
    licence: {
      label: "Creative Commons Attribution 3.0 (CC BY 3.0)",
      url: "https://creativecommons.org/licenses/by/3.0/",
    },
    changes: CHANGES,
  },
];
