# Building

Build all platforms from macOS. Details: `devdocs/docker-build.md`.

## Requirements

- macOS with Node 25+, Rust (via `rustup`) and Docker.
- Rust installed with `rustup` (see below), with the macOS targets for the universal build.
- Dependencies:
  ```bash
  npm ci
  ```

## Rust setup

Use `rustup`, not Homebrew's `rust`. Homebrew's compiler ignores targets added with `rustup`, and the universal macOS build fails with `can't find crate for core`.

1. Remove any Homebrew Rust:
   ```bash
   brew uninstall rust
   ```
2. Install `rustup`:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. Open a new terminal, or load it into the current one:
   ```bash
   . "$HOME/.cargo/env"
   ```
4. Add the macOS targets:
   ```bash
   rustup target add aarch64-apple-darwin x86_64-apple-darwin
   ```
5. Check that `rustc` comes from `~/.cargo/bin` and both targets are listed:
   ```bash
   which rustc
   ```
   ```bash
   rustup target list --installed
   ```

## Build everything

```bash
npm run build:platforms
```

Runs the builds below in order and stops at the first failure.

## Build one platform

- `npm run build:mac`: universal (arm64 + x86_64) macOS bundle. Output is in `src-tauri/target/universal-apple-darwin/release/bundle`.
- `npm run docker:linux-arm64`: `.deb`, `.rpm`, `.AppImage` in `build-out/linux-arm64`.
- `npm run docker:linux-x64`: the same in `build-out/linux-x64`. Runs emulated on Apple Silicon, so it is slow.
- `npm run docker:windows`: NSIS `.exe` installers in `build-out/windows-x64` and `build-out/windows-arm64`.

To build only some Windows targets:

```bash
WINDOWS_TARGETS=aarch64-pc-windows-msvc npm run docker:windows
```

## Notes

- If a Docker build dies with `signal: 9, SIGKILL`, the Docker VM ran out of memory. Give Docker Desktop more RAM (8 GB or more; Settings > Resources). Builds use 2 parallel Cargo jobs by default. Change it with `CARGO_BUILD_JOBS=1 npm run docker:linux-arm64`.
- `build:mac` sets `CI=true` so the `.dmg` step skips its Finder AppleScript styling, which fails on recent macOS (`Finder got an error ... (-10006)`). The `.dmg` has no custom window layout.
- Windows and Linux have no universal package. Each architecture gets its own.
- The first Docker run builds the image and downloads the Windows SDK. This takes several minutes. Later runs reuse cached volumes.
- Windows installers are NSIS only and unsigned. macOS signing and notarisation are not set up.
- These are builds only. To test with a real disc, use a VM with USB passthrough.
