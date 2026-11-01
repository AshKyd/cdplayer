# cdplayer

Tauri v2 + SvelteKit audio CD player. See `devdocs/architecture.md` for the overall design.

## Documentation rule

- Each component of the build is documented in `devdocs/{componentname}.md` (kebab-case, e.g. `devdocs/cd-bridge.md`).
- Create the doc when you add a component. Update it in the same change when the component's behaviour, API or files change.
- Keep each doc short and plain: purpose, files, API, behaviour, limits.
- List the components in `devdocs/architecture.md` and link their docs.

## Licensing

- The project is ISC. Do not add GPL/LGPL dependencies (check with `cargo deny check licenses` in `src-tauri`).
