export interface StoryTrack {
  title: string;
  artist: string;
  artistUrl: string;
  /** Where Storybook serves the audio from (see `staticDirs` in `.storybook/main.ts`). */
  url: string;
  licence: { label: string; url: string };
}

/** Creative Commons tracks to try the visualisers on. Keep `.storybook/assets/CREDITS.md` in step. */
export const STORY_TRACKS: StoryTrack[] = [
  {
    title: "Making Me Nervous",
    artist: "Brad Sucks",
    artistUrl: "https://soundcloud.com/bradsucks",
    url: "/making-me-nervous.m4a",
    licence: { label: "CC BY-SA 3.0", url: "http://creativecommons.org/licenses/by-sa/3.0/" },
  },
  {
    title: "Hope",
    artist: "Tobu",
    artistUrl: "https://soundcloud.com/7obu",
    url: "/tobu-hope.m4a",
    // The track page says only "a Creative Commons License", so the link goes to the page that states it.
    licence: { label: "Creative Commons", url: "https://soundcloud.com/7obu/tobu-hope-original-mix" },
  },
];
