# cdplayer

Tauri v2 + SvelteKit audio CD player. See `devdocs/architecture.md` for the overall design.

## Keep it a JS app

- Rust only does what JS cannot: talk to the drive (read the TOC, read sectors, re-open the drive). Keep Rust commands thin.
- State, timing, polling, queueing and decisions live in JS (`src/lib`). When a feature can be done in either, do it in JS.
- Pass anything time-based or Tauri-specific into JS classes as options (for example `DiscWatcher`'s `loadToc`) so they can be tested without Tauri.

## Documentation rule

- Each component of the build is documented in `devdocs/{componentname}.md` (kebab-case, e.g. `devdocs/cd-bridge.md`).
- Create the doc when you add a component. Update it in the same change when the component's behaviour, API or files change.
- Keep each doc short and plain: purpose, files, API, behaviour, limits.
- List the components in `devdocs/architecture.md` and link their docs.

## Licensing

- The project is ISC. Do not add GPL/LGPL dependencies (check with `cargo deny check licenses` in `src-tauri`).
