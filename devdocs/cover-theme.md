# Cover theme

Re-colours the UI from the album cover. Runs entirely in the webview (JS); no Rust.

## Files

- `src/lib/theme/coverColours/pickCoverColours.ts`: pure. Picks 1–2 colours from a node-vibrant palette; `rgbToOklch`; `isCoverColours`.
- `src/lib/theme/coverColours/extractCoverColours.ts`: fetches the cover, runs `Vibrant` (`node-vibrant/browser`), returns the picked colours.
- `src/lib/components/CoverTheme/CoverTheme.svelte`: extracts the colours and saves them to `settings.coverColours`. Mounted in `src/routes/+page.svelte`.
- `src/lib/components/CoverAccent/CoverAccent.svelte`: applies `settings.coverColours` to the theme. Mounted in `src/routes/+layout.svelte`, so every window uses it.

## API

- `extractCoverColours(coverUrl)` returns `{ primary, secondary }` or `null`. Each colour is `{ hue, chroma }` (OKLCH).
- `<CoverTheme coverUrl={...} />` and `<CoverAccent />` render nothing.

## Behaviour

- The cover is fetched as a blob and given to Vibrant as an object URL, so cross-origin covers do not taint the canvas.
- Vibrant's named swatches (Vibrant, Muted…) are not used: each is the most saturated colour for its lightness whatever its area, so a small orange hand beat a large blue object. We read the raw clusters (`vibrant.result.colors`) instead.
- Grey, near-black and near-white clusters are dropped. The rest are grouped into 30° hue bands and each band is weighted by population × saturation.
- Primary is the heaviest band's most common colour.
- Secondary is the next band that is at least 40° away in hue and at least 40% of the primary's weight, else `null`.
- `CoverTheme` writes the result to `settings.coverColours` (saved and synced, see [settings.md](settings.md)). The saved colours stay (so the app opens tinted) while the disc is being read. After that they are replaced, or set to `null` when there is no cover or it is greyscale or fails.
- `CoverAccent` sets the primary as the `svelte-akui` accent (`themeStore.setAccent`, not persisted). akui's `--akui-hue` and `--akui-chroma` also tint the neutrals.
- `CoverAccent` also sets `--cover-primary` and `--cover-secondary` on `<html>`.
- When the colours change or clear, the user's own accent and the CSS variables are restored first.

## Limits

- With no disc in the drive, the saved colours are cleared once the first disc check finishes.
- akui has one hue, so the secondary colour is only available as `--cover-secondary`; nothing uses it yet.
- Lightness is fixed by akui's light or dark theme; only hue and chroma come from the cover.
