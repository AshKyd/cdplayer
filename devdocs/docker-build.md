# Docker build

`npm run build:platforms` builds every platform and architecture from macOS. Linux and Windows build in containers; macOS builds on the host.

Step-by-step instructions are in `BUILDING.md`.

## Files

- `docker/build/Dockerfile`: Node 25 + Rust + Tauri's Linux deps + NSIS, LLVM and `cargo-xwin`. Runs as the `node` user.
- `docker/build/build.sh`: runs `npm ci` (only if the lockfile changed), the Tauri build, then copies the bundles to `/out`.
- `docker-compose.build.yml`: services `build-linux-arm64`, `build-linux-x64` and `build-windows`.

## Scripts

- `npm run build:mac`: one universal (arm64 + x86_64) macOS bundle, on the host. Needs `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
- `npm run docker:linux-arm64`: `.deb`, `.rpm`, `.AppImage` in `build-out/linux-arm64`.
- `npm run docker:linux-x64`: the same in `build-out/linux-x64`.
- `npm run docker:windows`: NSIS `.exe` in `build-out/windows-x64` and `build-out/windows-arm64`.
- `npm run build:platforms`: all of the above, in that order.
- `WINDOWS_TARGETS=aarch64-pc-windows-msvc npm run docker:windows` builds only the listed targets.

## Behaviour

- Only macOS has a universal bundle. Windows and Linux get one package per architecture.
- The project is bind-mounted at `/app`. Each service has its own named volumes for `node_modules`, the Cargo target dir (`/cache/target`) and the Cargo registry, because they hold native binaries. The Windows SDK cache (`xwin`) is also a volume. The host's macOS `node_modules` and `src-tauri/target` are untouched.
- Linux bundles are built natively per architecture, because Tauri links the system webkit2gtk. On Apple Silicon, `linux-x64` runs emulated and is slow.
- Windows is cross-compiled with `cargo-xwin` (MSVC targets) in the arm64 container. The first run downloads the Windows SDK.

## Limits

- Windows output is NSIS only (no MSI) and is not signed. `cargo-xwin` cross-compiling is experimental in Tauri.
- macOS signing and notarisation are not set up.
- Builds only. Testing against a real disc needs a VM with USB passthrough.
