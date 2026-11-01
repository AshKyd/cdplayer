# Linux build image that produces both Linux bundles and (via cargo-xwin) Windows NSIS installers.
FROM node:25-trixie

ENV DEBIAN_FRONTEND=noninteractive

# Tauri's Linux deps, plus NSIS + LLVM for cross-compiling the Windows installer
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl wget file git ca-certificates xz-utils \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    nsis clang lld llvm \
  && rm -rf /var/lib/apt/lists/*

# Everything below runs as the unprivileged `node` user. Cache directories are created
# here so the named volumes mounted over them inherit this ownership.
RUN mkdir -p /app/node_modules /out /cache/target /cache/xwin /home/node/.cargo/registry \
  && chown -R node:node /app /out /cache /home/node
USER node

ENV CARGO_HOME=/home/node/.cargo \
    RUSTUP_HOME=/home/node/.rustup \
    PATH=/home/node/.cargo/bin:$PATH \
    CARGO_TARGET_DIR=/cache/target \
    XWIN_CACHE_DIR=/cache/xwin \
    # AppImage tooling can't use FUSE inside a container
    APPIMAGE_EXTRACT_AND_RUN=1 \
    # linuxdeploy's bundled strip fails on newer toolchains' binaries
    NO_STRIP=true

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal \
  && rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc \
  && cargo install --locked cargo-xwin

COPY --chown=node:node build.sh /usr/local/bin/build.sh
RUN chmod +x /usr/local/bin/build.sh

WORKDIR /app
ENTRYPOINT ["build.sh"]
