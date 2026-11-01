# DiscSpinner

A rotating disc icon, shown while a disc is being read or looked up.

## Files

- `src/lib/components/DiscSpinner/DiscSpinner.svelte`: inline SVG rotated by a CSS `@keyframes spin`.
- `src/lib/components/DiscSpinner/DiscSpinner.stories.svelte`: Storybook story.

## API

- No props. It is 2rem square and uses `currentColor`.

## Behaviour

- `AlbumHeader` shows it in place of the disc icon when `busy` is true (see [ui.md](ui.md)).
- With `prefers-reduced-motion: reduce` it does not rotate.

## Limits

- Fixed size.
