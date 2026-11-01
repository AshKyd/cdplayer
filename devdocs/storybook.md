# Storybook

Renders components on their own, so edge cases can be checked without a disc.

## Files

- `.storybook/main.ts`: config. Telemetry and onboarding are off. Finds `src/**/*.stories.(ts|svelte)`.
- `.storybook/preview.ts`: global parameters.
- `src/lib/components/AlbumHeader/AlbumHeader.stories.svelte`: album titles from short to extreme at the main page's 16rem album width.

## Use

- `npm run storybook` serves on port 6006 (`--ci`, so no browser opens).
- `npm run build-storybook` builds to `storybook-static` (git-ignored).

## Notes

- Stories wrap components in `UIRoot`, as the app does. Its global text rules (such as `overflow-wrap`) affect `CopyfitText`.
- Stories that compose their own markup need `asChild` on `<Story>`. Without it the children are passed to the component and nothing renders.
- Keep the story's 16rem in step with `.album` in `src/routes/+page.svelte`.
