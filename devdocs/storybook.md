# Storybook

Renders components on their own, so edge cases can be checked without a disc.

## Files

- `.storybook/main.ts`: config. Telemetry and onboarding are off. Finds `src/**/*.stories.(ts|svelte)`.
- `.storybook/preview.ts`: global parameters.
- `src/lib/components/AlbumHeader/AlbumHeader.stories.svelte`: album titles from short to extreme at the main page's 16rem album width.
- `src/lib/components/AppControls/AppControls.stories.svelte`: the whole top bar in its states; `Interactive` drives it with a fake clock.
- `.storybook/assets/`: served as static files (`staticDirs`), not part of the app build. Holds `making-me-nervous.m4a` (Brad Sucks, CC BY-SA 3.0) and `tobu-hope.m4a` (Tobu, CC BY 3.0, variant unverified). `CREDITS.md` has the attribution. The playground shows title (linked to source), artist, full licence name (linked to deed) and a note of changes for the current track, from `storyTracks.ts`.
- `src/lib/components/Visualiser/Visualiser.stories.svelte`: `Random` and `Spiral artifact` stories. They play a track through an `AnalyserNode` (`VisualiserPlayground/storyAudio.ts`) into the real `Visualiser`. Controls: Play/Pause, a seek bar (the jump happens when the thumb is let go; a seek restarts the audio source at that point), a track picker and a picker of every preset. Press Play first: browsers won't start audio without a click.
- `src/lib/components/Visualiser/VisualiserPlayground/storyTracks.ts`: `STORY_TRACKS`, the tracks the picker offers, with the credit shown on screen. Add a track here and in `CREDITS.md`.

## Use

- `npm run storybook` serves on port 6006 (`--ci`, so no browser opens).
- `npm run build-storybook` builds to `storybook-static` (git-ignored).

## Notes

- Stories wrap components in `UIRoot`, as the app does. Its global text rules (such as `overflow-wrap`) affect `CopyfitText`.
- Stories that compose their own markup need `asChild` on `<Story>`. Without it the children are passed to the component and nothing renders.
- Keep the story's 16rem in step with `.album` in `src/routes/+page.svelte`.
