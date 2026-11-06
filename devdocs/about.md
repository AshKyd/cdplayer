# About

The "About" section of the settings window: app icon, name, version, build date, and one paragraph crediting the direct dependencies. No Rust.

## Files

- `src/lib/components/AboutSettings/AboutSettings.svelte`: the section.
- `src/lib/about/attributions.ts`: `ATTRIBUTIONS` (package names and copyright holders) and `attributionParagraph()`.
- `src/lib/about/buildInfo.ts`: `APP_NAME`, `APP_VERSION`, `BUILD_DATE`.
- `static/cd.svg`: the app icon source, shown on the page. The files in `src-tauri/icons` are rendered from it: the disc is scaled to 840 px inside a 1024 px transparent canvas (macOS icon grid, about 100 px margin), then `tauri icon` makes the sizes. Redo this if `cd.svg` changes.

## Behaviour

- `APP_VERSION` is the `package.json` version and `BUILD_DATE` is when the Vite build started, both set by `define` in `vite.config.js`.
- Only direct dependencies are credited (`package.json`, `src-tauri/Cargo.toml`), including `devDependencies` that are bundled into the app (`svelte`, `@sveltejs/kit`). `svelte-akui` is left out. Packages from one project share an entry.
- Holders come from each package's LICENSE file, or the `Cargo.toml` authors where there is no notice. Edit `ATTRIBUTIONS` when a dependency is added or removed.

## Limits

- No licence names or texts are shown.
- `cargo deny check licenses` (in `src-tauri`) is still the check for the whole tree.
