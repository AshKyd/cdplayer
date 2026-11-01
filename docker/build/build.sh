#!/bin/sh
# Usage: build.sh linux|windows
# Builds the mounted /app project and copies the bundles to /out/<platform>-<arch>.
set -eu

platform="${1:?usage: build.sh linux|windows}"
cd /app

# Reinstall only when the lockfile changed (node_modules lives in a named volume)
[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund

# Short arch name used in output folders
arch_name() {
  case "$1" in
    x86_64*) echo x64 ;;
    aarch64*) echo arm64 ;;
    *) echo "$1" ;;
  esac
}

copy_bundles() {
  mkdir -p "/out/$2"
  cp -R "$1"/. "/out/$2/"
  echo "Bundles copied to build-out/$2"
}

case "$platform" in
  linux)
    npm run tauri build -- --bundles deb,rpm,appimage
    copy_bundles "$CARGO_TARGET_DIR/release/bundle" "linux-$(arch_name "$(uname -m)")"
    ;;
  windows)
    # Windows has no universal installer, so each target gets its own NSIS .exe
    for target in ${WINDOWS_TARGETS:-x86_64-pc-windows-msvc aarch64-pc-windows-msvc}; do
      npm run tauri build -- --runner cargo-xwin --target "$target" --bundles nsis
      copy_bundles "$CARGO_TARGET_DIR/$target/release/bundle" "windows-$(arch_name "$target")"
    done
    ;;
  *)
    echo "unknown platform: $platform" >&2
    exit 1
    ;;
esac
