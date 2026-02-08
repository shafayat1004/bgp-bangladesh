/**
 * WASM Bridge — Feature detection and graceful fallback for WASM-accelerated modules.
 *
 * Provides:
 *   - wasmSupported: boolean — whether WebAssembly is available
 *   - initWasm(): Promise — loads WASM module on main thread (for force graph)
 *   - createAnalysisWorker(): Promise<AnalysisWorker> — creates a Web Worker for route analysis
 *   - ForceSimulation class from WASM (or null if unavailable)
 */

let wasmModule = null;
let wasmReady = false;
let wasmInitPromise = null;

/**
 * Check if WebAssembly is supported in this browser
 */
export const wasmSupported = typeof WebAssembly !== 'undefined' &&
  typeof WebAssembly.instantiate === 'function';

/**
 * Initialize WASM on the main thread (for force graph simulation).
 * Idempotent — safe to call multiple times.
 * @returns {Promise<object|null>} The WASM module, or null on failure
 */
export async function initWasm() {
  if (!wasmSupported) return null;
  if (wasmReady) return wasmModule;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const wasm = await import('../../wasm/bgp-wasm/pkg/bgp_wasm.js');
      await wasm.default();
      wasmModule = wasm;
      wasmReady = true;
      console.log('[WASM] Main-thread module loaded');
      return wasmModule;
    } catch (err) {
      console.warn('[WASM] Failed to load main-thread module:', err);
      wasmModule = null;
      wasmReady = false;
      return null;
    }
  })();

  return wasmInitPromise;
}

/**
 * Get the loaded WASM module (null if not yet loaded or failed)
 */
export function getWasmModule() {
  return wasmModule;
}

/**
 * Create a route analysis worker backed by WASM.
 * Returns a promise-based wrapper around the Web Worker.
 *
 * @returns {Promise<AnalysisWorker>} Worker wrapper with init/processBatch/finalize/reset
 */
export function createAnalysisWorker() {
  if (!wasmSupported) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(
        new URL('./workers/route-analyzer.worker.js', import.meta.url),
        { type: 'module' }
      );

      let readyResolver = null;
      const readyPromise = new Promise(r => { readyResolver = r; });

      // Track pending operations queue to handle concurrent requests
      const pendingOps = [];

      worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'ready':
            readyResolver(true);
            break;
          case 'initialized':
          case 'progress':
          case 'results':
          case 'reset-done':
            const op = pendingOps.shift();
            if (op) {
              op.resolve(msg);
            }
            break;
          case 'error':
            console.warn('[WASM Worker]', msg.message);
            const errOp = pendingOps.shift();
            if (errOp) {
              errOp.reject(new Error(msg.message));
            }
            break;
        }
      };

      worker.onerror = (err) => {
        console.warn('[WASM Worker] Worker error:', err);
        // Reject all pending operations on worker error
        while (pendingOps.length > 0) {
          const op = pendingOps.shift();
          op.reject(err);
        }
        reject(err);
      };

      function sendAndWait(message) {
        return new Promise((res, rej) => {
          pendingOps.push({ resolve: res, reject: rej });
          worker.postMessage(message);
        });
      }

      // Wait for WASM to load in the worker, then resolve with the wrapper
      const WORKER_TIMEOUT = 10000;
      const timeoutId = setTimeout(() => {
        reject(new Error('WASM Worker timed out'));
        worker.terminate();
      }, WORKER_TIMEOUT);

      readyPromise.then(() => {
        clearTimeout(timeoutId);

        /** @type {AnalysisWorker} */
        const wrapper = {
          /**
           * Initialize the analyzer with country ASNs
           * @param {string[]} bdAsns
           */
          async init(bdAsns) {
            return sendAndWait({ type: 'init', bdAsns: [...bdAsns] });
          },

          /**
           * Process a batch of routes
           * @param {object[]} routes
           * @returns {Promise<{type: string, processed: number, valid: number}>}
           */
          async processBatch(routes) {
            return sendAndWait({ type: 'batch', routes });
          },

          /**
           * Finalize and get results
           * @returns {Promise<{type: string, data: object}>}
           */
          async finalize() {
            return sendAndWait({ type: 'finalize' });
          },

          /** Reset state */
          async reset() {
            return sendAndWait({ type: 'reset' });
          },

          /** Terminate the worker */
          terminate() {
            worker.terminate();
          },
        };

        resolve(wrapper);
      });
    } catch (err) {
      console.warn('[WASM] Failed to create analysis worker:', err);
      resolve(null);
    }
  });
}
