# WASM Acceleration Module

Pre-compiled WebAssembly modules that accelerate two performance-critical paths:

## What gets accelerated

| Module | What it does | Speedup |
|--------|-------------|---------|
| **Route Analyzer** | Processes 3.3M+ BGP route observations (dedup, edge detection, classification) | ~3-5x via compiled tight loops + FxHashSet |
| **Force Layout** | Barnes-Hut many-body repulsion + collision + link forces for 1,600+ nodes | ~2-3x via compiled force math + batch edge paths |

## Architecture

```
wasm/
├── build.sh                    # Build script
├── README.md                   # This file
└── bgp-wasm/
    ├── Cargo.toml              # Rust crate config
    ├── src/
    │   ├── lib.rs              # Crate root
    │   ├── route_analyzer.rs   # BGP route analysis (runs in Web Worker)
    │   └── force_layout.rs     # Force-directed graph simulation
    └── pkg/                    # Built artifacts (committed to repo)
        ├── bgp_wasm.js         # JS glue (ES module)
        ├── bgp_wasm_bg.wasm    # Compiled WASM binary (~170KB)
        └── bgp_wasm.d.ts       # TypeScript definitions
```

## How it integrates

- **Route Analyzer**: Runs inside `assets/js/workers/route-analyzer.worker.js` (Web Worker), keeping the UI responsive during live fetch
- **Force Layout**: Loaded on the main thread via `assets/js/wasm-bridge.js`, replaces D3's force simulation loop
- **Graceful fallback**: If WASM fails to load (old browser, ad blocker, etc.), the app falls back to the original JS implementations

## Building

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### Build

```bash
cd wasm
./build.sh
```

### Tests

```bash
cd wasm/bgp-wasm
cargo test
```

## GitHub Pages Compatibility

- The `.wasm` file is served with `application/wasm` MIME type by default on GitHub Pages
- No `SharedArrayBuffer` is used (would require COOP/COEP headers)
- Web Workers use `{ type: 'module' }` which is supported in all modern browsers
- All WASM is loaded via `fetch()` + `WebAssembly.instantiate()` (no special server requirements)
