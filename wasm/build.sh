#!/bin/bash
# Build script for the bgp-wasm WASM module.
# Prerequisites: Rust toolchain + wasm-pack
#   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
#   cargo install wasm-pack
#   rustup target add wasm32-unknown-unknown

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$SCRIPT_DIR/bgp-wasm"

echo "Building bgp-wasm (release)..."
cd "$CRATE_DIR"
wasm-pack build --target web --out-dir pkg --release

# Remove the .gitignore that wasm-pack generates inside pkg/
# (we want to commit the built artifacts)
rm -f pkg/.gitignore

echo ""
echo "Build complete! Artifacts in wasm/bgp-wasm/pkg/"
ls -lh pkg/bgp_wasm_bg.wasm pkg/bgp_wasm.js
