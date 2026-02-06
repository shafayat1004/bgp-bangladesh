/**
 * RIPEstat API Client
 * Fetches BGP data from RIPEstat with retry logic, rate limiting, and progress feedback.
 * Ported from country_gateways_outside.py and fetch_asn_names_parallel.py
 */

const RIPESTAT_BASE = 'https://stat.ripe.net/data';
const USER_AGENT = 'bgp-bangladesh-viz/1.0 (https://github.com/bgp-bangladesh)';

/**
 * Token bucket rate limiter
 */
class RateLimiter {
  constructor(requestsPerSecond = 4) {
    this.tokens = requestsPerSecond;
    this.maxTokens = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
    this.queue = [];
    this.paused = false;
    this.pauseUntil = 0;
  }

  async acquire() {
    // Wait if paused (rate limited by server)
    if (this.paused && Date.now() < this.pauseUntil) {
      const waitMs = this.pauseUntil - Date.now();
      await sleep(waitMs);
      this.paused = false;
    }

    // Refill tokens
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    // Wait for a token
    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
      await sleep(waitMs);
      this.tokens = 0;
      this.lastRefill = Date.now();
    } else {
      this.tokens -= 1;
    }
  }

  /**
   * Back off after a 429 response
   */
  backoff(retryAfterSeconds = 60) {
    this.paused = true;
    this.pauseUntil = Date.now() + retryAfterSeconds * 1000;
    this.refillRate = Math.max(1, this.refillRate / 2);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry, timeout, and abort support
 */
async function fetchWithRetry(url, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    timeout = 120000,
    rateLimiter = null,
    signal = null,
    onRetry = null,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Fetch cancelled', 'AbortError');
    }

    if (rateLimiter) {
      await rateLimiter.acquire();
    }

    try {
      const controller = new AbortController();
      const combinedSignal = signal
        ? combineAbortSignals(signal, controller.signal)
        : controller.signal;

      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: combinedSignal,
        headers: { 'User-Agent': USER_AGENT },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        if (rateLimiter) {
          rateLimiter.backoff(retryAfter);
        }
        if (onRetry) {
          onRetry(attempt + 1, maxRetries, `Rate limited, waiting ${retryAfter}s`);
        }
        await sleep(retryAfter * 1000);
        continue;
      }

      // Client errors - don't retry
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Server errors - retry
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + Math.random() * 500;
        if (onRetry) {
          onRetry(attempt + 1, maxRetries, `Server error ${response.status}, retrying in ${(delay / 1000).toFixed(1)}s`);
        }
        await sleep(delay);
        continue;
      }

      throw new Error(`HTTP ${response.status} after ${maxRetries + 1} attempts`);

    } catch (err) {
      if (err.name === 'AbortError') {
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + Math.random() * 500;
        if (onRetry) {
          onRetry(attempt + 1, maxRetries, `${err.message}, retrying in ${(delay / 1000).toFixed(1)}s`);
        }
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }
}

/**
 * Combine two AbortSignals
 */
function combineAbortSignals(signal1, signal2) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal1.addEventListener('abort', onAbort);
  signal2.addEventListener('abort', onAbort);
  return controller.signal;
}

/**
 * Chunk prefixes into batches that fit URL length limits.
 * Ported from chunk_by_url_length() in Python.
 */
function chunkPrefixes(prefixes, maxLen = 1800) {
  const chunks = [];
  let chunk = [];
  let currentLen = 0;

  for (const prefix of prefixes) {
    const addLen = prefix.length + (chunk.length > 0 ? 1 : 0); // +1 for comma
    if (currentLen + addLen > maxLen && chunk.length > 0) {
      chunks.push(chunk);
      chunk = [prefix];
      currentLen = prefix.length;
    } else {
      chunk.push(prefix);
      currentLen += addLen;
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Main RIPEStatClient class
 */
export class RIPEStatClient {
  constructor() {
    this.rateLimiter = new RateLimiter(4);
    this.abortController = null;
  }

  /**
   * Cancel any ongoing fetch
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Fetch country resources (ASNs and prefixes).
   * Ported from get_country_resources() in Python.
   */
  async getCountryResources(countryCode, onProgress) {
    if (onProgress) onProgress({ step: 1, totalSteps: 4, message: `Fetching country resources for ${countryCode}...` });

    const url = `${RIPESTAT_BASE}/country-resource-list/data.json?resource=${countryCode.toLowerCase()}&v4_format=prefix`;

    const data = await fetchWithRetry(url, {
      rateLimiter: this.rateLimiter,
      signal: this.abortController?.signal,
      timeout: 60000,
    });

    const resources = data.data.resources;
    const countryASNs = new Set((resources.asn || []).map(a => String(a)));
    const prefixes = [...(resources.ipv4 || []), ...(resources.ipv6 || [])];

    if (onProgress) {
      onProgress({
        step: 1, totalSteps: 4,
        message: `Found ${countryASNs.size} ASNs and ${prefixes.length} prefixes for ${countryCode}`,
        complete: true,
      });
    }

    return { countryASNs, prefixes };
  }

  /**
   * Fetch BGP routes in batches.
   * Ported from fetch_bgp_routes() in Python.
   */
  async fetchBGPRoutes(prefixes, onProgress) {
    this.abortController = new AbortController();
    const batches = chunkPrefixes(prefixes);
    const totalBatches = batches.length;
    const allRoutes = [];
    let completed = 0;
    let failed = 0;
    const startTime = Date.now();

    if (onProgress) {
      onProgress({
        step: 2, totalSteps: 4,
        message: `Fetching BGP routes (0/${totalBatches} batches)...`,
        progress: 0, completed: 0, failed: 0, total: totalBatches,
      });
    }

    for (let i = 0; i < batches.length; i++) {
      if (this.abortController.signal.aborted) break;

      const batch = batches[i];
      const params = new URLSearchParams({ resource: batch.join(',') });
      const url = `${RIPESTAT_BASE}/bgp-state/data.json?${params}`;

      try {
        const data = await fetchWithRetry(url, {
          rateLimiter: this.rateLimiter,
          signal: this.abortController.signal,
          timeout: 120000,
          onRetry: (attempt, max, reason) => {
            if (onProgress) {
              onProgress({
                step: 2, totalSteps: 4,
                message: `Batch ${i + 1}/${totalBatches}: ${reason} (attempt ${attempt}/${max})`,
                progress: completed / totalBatches,
                completed, failed, total: totalBatches,
                warning: true,
              });
            }
          },
        });

        const routes = data.data?.bgp_state || [];
        allRoutes.push(...routes);
        completed++;
      } catch (err) {
        if (err.name === 'AbortError') break;
        failed++;
        console.warn(`Batch ${i + 1} permanently failed:`, err.message);
      }

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const avgPerBatch = elapsed / (completed + failed);
      const remaining = (totalBatches - completed - failed) * avgPerBatch;

      if (onProgress) {
        onProgress({
          step: 2, totalSteps: 4,
          message: `Fetching BGP routes (${completed}/${totalBatches} batches)...`,
          progress: (completed + failed) / totalBatches,
          completed, failed, total: totalBatches,
          eta: Math.ceil(remaining),
        });
      }
    }

    if (onProgress) {
      onProgress({
        step: 2, totalSteps: 4,
        message: `BGP routes fetched: ${allRoutes.length.toLocaleString()} routes from ${completed} batches` +
          (failed > 0 ? ` (${failed} batches failed)` : ''),
        progress: 1, complete: true,
        completed, failed, total: totalBatches,
      });
    }

    return allRoutes;
  }

  /**
   * Fetch ASN info in parallel batches.
   * Ported from fetch_asn_names_parallel.py
   */
  async fetchASNInfo(asnList, onProgress) {
    const results = {};
    const total = asnList.length;
    let completed = 0;
    let failed = 0;
    const concurrency = 20;
    const startTime = Date.now();

    if (onProgress) {
      onProgress({
        step: 3, totalSteps: 4,
        message: `Resolving ASN names (0/${total})...`,
        progress: 0, completed: 0, failed: 0, total,
      });
    }

    // Process in concurrent batches
    for (let i = 0; i < asnList.length; i += concurrency) {
      if (this.abortController?.signal.aborted) break;

      const batch = asnList.slice(i, i + concurrency);
      const promises = batch.map(async (asn) => {
        const url = `${RIPESTAT_BASE}/as-overview/data.json?resource=AS${asn}`;
        try {
          const data = await fetchWithRetry(url, {
            rateLimiter: this.rateLimiter,
            signal: this.abortController?.signal,
            maxRetries: 2,
            timeout: 15000,
          });

          if (data.status === 'ok') {
            const info = data.data || {};
            const holder = info.holder || `AS${asn}`;
            results[asn] = {
              asn,
              name: holder,
              holder,
              announced: info.announced || false,
            };
          } else {
            results[asn] = { asn, name: `AS${asn}`, holder: '', announced: false };
          }
          completed++;
        } catch {
          results[asn] = { asn, name: `AS${asn}`, holder: '', announced: false };
          failed++;
        }
      });

      await Promise.all(promises);

      const elapsed = (Date.now() - startTime) / 1000;
      const avgPerItem = elapsed / (completed + failed);
      const remaining = (total - completed - failed) * avgPerItem;

      if (onProgress) {
        onProgress({
          step: 3, totalSteps: 4,
          message: `Resolving ASN names (${completed}/${total})...`,
          progress: (completed + failed) / total,
          completed, failed, total,
          eta: Math.ceil(remaining),
        });
      }
    }

    if (onProgress) {
      onProgress({
        step: 3, totalSteps: 4,
        message: `ASN names resolved: ${completed} succeeded` + (failed > 0 ? `, ${failed} failed` : ''),
        progress: 1, complete: true,
      });
    }

    return results;
  }
}
