#!/usr/bin/env bash
# Install the Rust toolchain (MSVC host) non-interactively.
set -euo pipefail

RUSTUP_URL="https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
RUSTUP_EXE="$TEMP/rustup-init.exe"

echo "downloading rustup-init.exe ..."
curl -sSfL -o "$RUSTUP_EXE" "$RUSTUP_URL"
echo "downloaded: $(ls -la "$RUSTUP_EXE")"

"$RUSTUP_EXE" -y --no-modify-path \
  --default-host x86_64-pc-windows-msvc \
  --default-toolchain stable \
  --profile default

echo "--- versions ---"
"$USERPROFILE/.cargo/bin/rustc" --version
"$USERPROFILE/.cargo/bin/cargo" --version
