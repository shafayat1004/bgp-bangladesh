/**
 * Web Worker for WASM-accelerated BGP route analysis.
 * Runs RouteAnalyzer in a separate thread to avoid blocking the UI.
 *
 * Messages IN:
 *   { type: 'init', bdAsns: string[] }     — Initialize with country ASN list
 *   { type: 'batch', routes: object[] }     — Process a batch of routes
 *   { type: 'finalize' }                    — Return accumulated results
 *   { type: 'reset' }                       — Clear state for new analysis
 *
 * Messages OUT:
 *   { type: 'ready' }                       — WASM loaded and ready
 *   { type: 'initialized' }                 — Analyzer created with BD ASNs
 *   { type: 'progress', processed, valid }  — Batch processing progress
 *   { type: 'results', data }               — Final analysis results
 *   { type: 'error', message }              — Error occurred
 */

let wasmModule = null;
let analyzer = null;

// Dynamic import of WASM module (relative to worker location)
async function loadWasm() {
  try {
    // Worker is at assets/js/workers/route-analyzer.worker.js
    // WASM is at wasm/bgp-wasm/pkg/bgp_wasm.js
    const wasm = await import('../../../wasm/bgp-wasm/pkg/bgp_wasm.js');
    await wasm.default();  // Initialize WASM
    wasmModule = wasm;
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'error', message: `WASM load failed: ${err.message}` });
  }
}

self.onmessage = async function (e) {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'init': {
        if (!wasmModule) {
          self.postMessage({ type: 'error', message: 'WASM not loaded yet' });
          return;
        }
        const bdAsnsJson = JSON.stringify(msg.bdAsns);
        analyzer = new wasmModule.RouteAnalyzer(bdAsnsJson);
        self.postMessage({ type: 'initialized' });
        break;
      }

      case 'batch': {
        if (!analyzer) {
          self.postMessage({ type: 'error', message: 'Analyzer not initialized' });
          return;
        }
        const routesJson = JSON.stringify(msg.routes);
        const progressJson = analyzer.processBatch(routesJson);
        const progress = JSON.parse(progressJson);
        self.postMessage({
          type: 'progress',
          processed: progress.processed,
          valid: progress.valid,
        });
        break;
      }

      case 'finalize': {
        if (!analyzer) {
          self.postMessage({ type: 'error', message: 'Analyzer not initialized' });
          return;
        }
        const resultsJson = analyzer.finalize();
        const results = JSON.parse(resultsJson);

        // Convert results back to the format expected by JS (Map-like entries)
        // The JS side expects: { outsideCounts: Map, iigCounts: Map, ... edgeIntl: Map, ... }
        const data = {
          outsideCounts: results.outside_counts,   // [[key, val], ...]
          iigCounts: results.iig_counts,
          localISPCounts: results.local_isp_counts,
          edgeIntl: results.edge_intl,             // [["src|tgt", count], ...]
          edgeDomestic: results.edge_domestic,
          directPeers: results.direct_peers,
          validObservations: results.valid_observations,
        };
        self.postMessage({ type: 'results', data });
        break;
      }

      case 'reset': {
        if (analyzer) {
          analyzer.reset();
        }
        self.postMessage({ type: 'reset-done' });
        break;
      }

      default:
        self.postMessage({ type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};

// Start loading WASM immediately
loadWasm();
