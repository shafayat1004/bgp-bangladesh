/**
 * RIPEstat API Client
 * Fetches BGP data from RIPEstat with retry logic, rate limiting, and progress feedback.
 * Includes "What's My ASN?" detection and country info for ASNs.
 */

const RIPESTAT_BASE = 'https://stat.ripe.net/data';

/**
 * Convert 2-letter country code to flag emoji
 */
export function countryToFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  const upper = cc.toUpperCase();
  const offset = 0x1F1E6 - 65; // 'A' = 65
  return String.fromCodePoint(
    upper.charCodeAt(0) + offset,
    upper.charCodeAt(1) + offset
  );
}

/**
 * Token bucket rate limiter
 */
class RateLimiter {
  constructor(requestsPerSecond = 4) {
    this.tokens = requestsPerSecond;
    this.maxTokens = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
    this.paused = false;
    this.pauseUntil = 0;
  }

  async acquire() {
    if (this.paused && Date.now() < this.pauseUntil) {
      const waitMs = this.pauseUntil - Date.now();
      await sleep(waitMs);
      this.paused = false;
    }

    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
      await sleep(waitMs);
      this.tokens = 0;
      this.lastRefill = Date.now();
    } else {
      this.tokens -= 1;
    }
  }

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
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        if (rateLimiter) rateLimiter.backoff(retryAfter);
        if (onRetry) onRetry(attempt + 1, maxRetries, `Rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + Math.random() * 500;
        if (onRetry) onRetry(attempt + 1, maxRetries, `Server error ${response.status}, retrying in ${(delay / 1000).toFixed(1)}s`);
        await sleep(delay);
        continue;
      }

      throw new Error(`HTTP ${response.status} after ${maxRetries + 1} attempts`);

    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + Math.random() * 500;
        if (onRetry) onRetry(attempt + 1, maxRetries, `${err.message}, retrying in ${(delay / 1000).toFixed(1)}s`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

function combineAbortSignals(signal1, signal2) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal1.addEventListener('abort', onAbort);
  signal2.addEventListener('abort', onAbort);
  return controller.signal;
}

/**
 * Chunk prefixes into batches that fit URL length limits.
 */
function chunkPrefixes(prefixes, maxLen = 1800) {
  const chunks = [];
  let chunk = [];
  let currentLen = 0;

  for (const prefix of prefixes) {
    const addLen = prefix.length + (chunk.length > 0 ? 1 : 0);
    if (currentLen + addLen > maxLen && chunk.length > 0) {
      chunks.push(chunk);
      chunk = [prefix];
      currentLen = prefix.length;
    } else {
      chunk.push(prefix);
      currentLen += addLen;
    }
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/**
 * Try to extract country code from ASN holder name.
 * Common pattern: "COMPANYNAME-CC Description" where CC is a 2-letter country code.
 */
function parseCountryFromHolder(holder) {
  // Invalid region codes that should not be treated as countries
  const INVALID_REGIONS = new Set(['AP', 'EU', 'AS', 'AF', 'LA', 'NA', 'OC', 'AN']);
  
  if (!holder) return '';
  const parts = holder.split(/[\s,]+/);
  if (parts.length > 0) {
    const first = parts[0];
    if (first.includes('-')) {
      const suffix = first.split('-').pop().toUpperCase();
      if (suffix.length === 2 && /^[A-Z]{2}$/.test(suffix) && !INVALID_REGIONS.has(suffix)) {
        return suffix;
      }
    }
  }
  return '';
}

/**
 * Fetch geolocation for a single ASN using MaxMind GeoLite data via RIPEstat.
 * Returns a geo data object with full breakdown:
 *   { dominant_country, breakdown: [{country, city, percentage}], bd_percentage }
 */
async function fetchGeoCountrySingle(asn, rateLimiter) {
  const fallback = { dominant_country: 'BD', breakdown: [], bd_percentage: 100 };
  try {
    const url = `${RIPESTAT_BASE}/maxmind-geo-lite-announced-by-as/data.json?resource=AS${asn}`;
    const data = await fetchWithRetry(url, {
      rateLimiter,
      maxRetries: 2,
      timeout: 30000,
    });

    if (data.status !== 'ok') return fallback;

    let totalPct = 0;
    let bdPct = 0;
    const countryPcts = {};
    const breakdown = [];

    for (const resource of (data.data?.located_resources || [])) {
      for (const loc of (resource.locations || [])) {
        const pct = loc.covered_percentage || 0;
        const cc = loc.country || '';
        const city = loc.city || '';
        if (!cc) continue;
        totalPct += pct;
        if (cc === 'BD') {
          bdPct += pct;
        } else {
          countryPcts[cc] = (countryPcts[cc] || 0) + pct;
        }
        breakdown.push({ country: cc, city, percentage: pct });
      }
    }

    if (totalPct <= 0) return fallback;

    // Determine dominant country
    let dominant;
    if ((bdPct / totalPct) > 0.8) {
      dominant = 'BD';
    } else {
      const entries = Object.entries(countryPcts);
      dominant = entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : 'BD';
    }

    // Sort breakdown by percentage descending
    breakdown.sort((a, b) => b.percentage - a.percentage);

    return {
      dominant_country: dominant,
      breakdown,
      bd_percentage: Math.round(bdPct * 100) / 100,
    };
  } catch {
    return fallback;
  }
}

/**
 * Main RIPEStatClient class
 */
export class RIPEStatClient {
  constructor() {
    this.rateLimiter = new RateLimiter(4);
    this.abortController = null;
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Detect user's ASN.
   * Uses multiple fallback strategies for IP detection (CORS-safe).
   * Returns { ip, asn, holder, prefix, country }
   */
  async getMyASN() {
    // Step 1: Get user's IP via a CORS-friendly service
    let ip = null;

    // Try ipify (CORS-friendly, returns plain IP)
    try {
      const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        ip = data.ip;
      }
    } catch { /* fallback below */ }

    // Fallback: try cloudflare
    if (!ip) {
      try {
        const res = await fetch('https://1.1.1.1/cdn-cgi/trace', { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const text = await res.text();
          const match = text.match(/ip=(.+)/);
          if (match) ip = match[1].trim();
        }
      } catch { /* give up on IP */ }
    }

    if (!ip) throw new Error('Could not detect your IP address. Try disabling ad blockers.');

    // Step 2: Get network info from RIPEstat (CORS-safe, no custom headers)
    const netData = await fetchWithRetry(`${RIPESTAT_BASE}/network-info/data.json?resource=${ip}`, {
      timeout: 15000,
      rateLimiter: this.rateLimiter,
    });
    const asns = netData?.data?.asns || [];
    const prefix = netData?.data?.prefix || '';
    const asn = asns.length > 0 ? String(asns[0]) : null;

    if (!asn) throw new Error(`Could not determine ASN for IP ${ip}`);

    // Step 3: Get ASN details
    const asnData = await fetchWithRetry(`${RIPESTAT_BASE}/as-overview/data.json?resource=AS${asn}`, {
      timeout: 15000,
      rateLimiter: this.rateLimiter,
    });
    const holder = asnData?.data?.holder || `AS${asn}`;
    
    // Step 4: Determine country - check if it's a BD ASN first
    let country = '';
    
    // First check if this ASN is in Bangladesh by querying country resources
    try {
      const bdCheck = await fetchWithRetry(`${RIPESTAT_BASE}/country-resource-list/data.json?resource=bd&v4_format=prefix`, {
        timeout: 10000,
        rateLimiter: this.rateLimiter,
      });
      const bdASNs = (bdCheck?.data?.resources?.asn || []).map(a => String(a));
      if (bdASNs.includes(asn)) {
        country = 'BD';
      }
    } catch {
      // Fallback to parsing holder name
      country = parseCountryFromHolder(holder);
    }
    
    if (!country) {
      country = parseCountryFromHolder(holder);
    }

    return { ip, asn, holder, prefix, country };
  }

  /**
   * Fetch country resources (ASNs and prefixes).
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
   * Fetch BGP routes in parallel batches for better performance.
   */
  async fetchBGPRoutes(prefixes, onProgress) {
    this.abortController = new AbortController();
    const batches = chunkPrefixes(prefixes);
    const totalBatches = batches.length;
    const allRoutes = [];
    let completed = 0;
    let failed = 0;
    const startTime = Date.now();
    const concurrency = 5; // Fetch 5 batches in parallel

    if (onProgress) {
      onProgress({
        step: 2, totalSteps: 4,
        message: `Fetching BGP routes (0/${totalBatches} batches)...`,
        progress: 0, completed: 0, failed: 0, total: totalBatches,
      });
    }

    // Process batches in parallel waves with real-time progress updates
    for (let i = 0; i < batches.length; i += concurrency) {
      if (this.abortController.signal.aborted) break;

      const batchGroup = batches.slice(i, i + concurrency);
      const promises = batchGroup.map(async (batch, idx) => {
        const batchNum = i + idx + 1;
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
                  message: `Batch ${batchNum}/${totalBatches}: ${reason} (retry ${attempt}/${max})`,
                  progress: completed / totalBatches,
                  completed, failed, total: totalBatches,
                  warning: true,
                });
              }
            },
          });

          const routes = data.data?.bgp_state || [];
          
          // Update progress immediately when this batch completes
          allRoutes.push(...routes);
          completed++;
          
          const elapsed = (Date.now() - startTime) / 1000;
          const avgPerBatch = elapsed / (completed + failed);
          const remaining = (totalBatches - completed - failed) * avgPerBatch;
          
          if (onProgress) {
            onProgress({
              step: 2, totalSteps: 4,
              message: `Fetching BGP routes (${completed}/${totalBatches} batches, ${concurrency} parallel)...`,
              progress: (completed + failed) / totalBatches,
              completed, failed, total: totalBatches,
              eta: Math.ceil(remaining),
            });
          }
          
          return { success: true };
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          console.warn(`Batch ${batchNum} permanently failed:`, err.message);
          
          // Update progress immediately when this batch fails
          failed++;
          
          const elapsed = (Date.now() - startTime) / 1000;
          const avgPerBatch = elapsed / (completed + failed);
          const remaining = (totalBatches - completed - failed) * avgPerBatch;
          
          if (onProgress) {
            onProgress({
              step: 2, totalSteps: 4,
              message: `Fetching BGP routes (${completed}/${totalBatches} batches, ${concurrency} parallel)...`,
              progress: (completed + failed) / totalBatches,
              completed, failed, total: totalBatches,
              eta: Math.ceil(remaining),
            });
          }
          
          return { success: false };
        }
      });

      // Wait for all promises in this wave to complete (but progress updates happen individually)
      await Promise.all(promises);
    }

    if (onProgress) {
      onProgress({
        step: 2, totalSteps: 4,
        message: `BGP routes fetched: ${allRoutes.length.toLocaleString()} routes from ${completed} batches` +
          (failed > 0 ? ` (${failed} batches failed)` : ''),
        progress: 1, complete: true,
      });
    }

    return allRoutes;
  }

  /**
   * Fetch ASN info in parallel batches. Includes country extraction.
   */
  async fetchASNInfo(asnList, countryASNs, onProgress) {
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
            let country = '';
            if (countryASNs && countryASNs.has(asn)) {
              country = 'BD';
            } else {
              country = parseCountryFromHolder(holder);
            }
            
            // Apply well-known ASN country overrides if country is still empty or invalid
            const WELL_KNOWN_COUNTRIES = {
              '174': 'US', '6939': 'US', '6461': 'US', '3356': 'US', '1299': 'SE',
              '2914': 'US', '3257': 'DE', '3491': 'US', '5511': 'FR', '6762': 'IT',
              '9002': 'EU', '9498': 'IN', '4637': 'HK', '2516': 'JP', '4826': 'AU',
              '7922': 'US', '20473': 'US', '13335': 'US', '16509': 'US', '15169': 'US',
              '8075': 'US', '32934': 'US', '36351': 'US', '46489': 'US', '397143': 'US',
            };
            if (!country && WELL_KNOWN_COUNTRIES[asn]) {
              country = WELL_KNOWN_COUNTRIES[asn];
            }

            results[asn] = {
              asn,
              name: holder,
              holder,
              announced: info.announced || false,
              country,
            };
          } else {
            results[asn] = { asn, name: `AS${asn}`, holder: '', announced: false, country: countryASNs?.has(asn) ? 'BD' : '' };
          }
          completed++;
        } catch {
          results[asn] = { asn, name: `AS${asn}`, holder: '', announced: false, country: countryASNs?.has(asn) ? 'BD' : '' };
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

  /**
   * Fetch geolocation for multiple ASNs to detect offshore peers.
   * Returns an object of ASN → geo data { dominant_country, breakdown, bd_percentage }.
   */
  async fetchGeoCountries(asnList, onProgress) {
    const results = {};
    const total = asnList.length;
    let completed = 0;
    const concurrency = 10;

    if (onProgress) {
      onProgress({
        step: 3, totalSteps: 4,
        message: `Checking geolocation for ${total} ASNs (offshore detection)...`,
        progress: 0.85,
      });
    }

    for (let i = 0; i < asnList.length; i += concurrency) {
      if (this.abortController?.signal.aborted) break;

      const batch = asnList.slice(i, i + concurrency);
      const promises = batch.map(async (asn) => {
        const geo = await fetchGeoCountrySingle(asn, this.rateLimiter);
        results[asn] = geo;
        completed++;
      });

      await Promise.all(promises);
    }

    const nonBD = Object.entries(results).filter(([, geo]) => geo.dominant_country !== 'BD');
    if (nonBD.length > 0) {
      console.log(`Geolocation: ${nonBD.length} ASNs with non-BD infrastructure:`,
        nonBD.map(([asn, geo]) => `AS${asn}=${geo.dominant_country}`).join(', '));
    }

    return results;
  }

  /**
   * Fetch PeeringDB peering locations for offshore ASNs.
   * Uses batch queries to minimize API calls.
   * @param {Object} offshoreASNs - { asn: geo_dominant_country }
   * @param {Object} directPeersMap - { asn: [upstream_asn, ...] }
   * @param {Function} onProgress - Progress callback
   * @returns {Object} { asn: { country, details: [], source } }
   */
  async fetchPeeringDBLocations(offshoreASNs, directPeersMap, onProgress) {
    const offshoreList = Object.keys(offshoreASNs);
    if (offshoreList.length === 0) return {};

    if (onProgress) {
      onProgress({
        step: 4, totalSteps: 5,
        message: `Fetching PeeringDB locations for ${offshoreList.length} offshore ASNs...`,
        progress: 0,
      });
    }

    // Collect all ASNs needed: targets + upstreams
    const allNeeded = new Set(offshoreList);
    for (const asn of offshoreList) {
      for (const up of (directPeersMap[asn] || [])) {
        allNeeded.add(up);
      }
    }

    // Step 1: Batch fetch network records from PeeringDB
    if (onProgress) {
      onProgress({
        step: 4, totalSteps: 5,
        message: `Querying PeeringDB for ${allNeeded.size} ASNs (batch)...`,
        progress: 0.2,
      });
    }

    const pdbCache = {};
    const asnArray = [...allNeeded];
    for (let i = 0; i < asnArray.length; i += 100) {
      const batch = asnArray.slice(i, i + 100);
      try {
        const url = `https://www.peeringdb.com/api/net?asn__in=${batch.join(',')}&depth=2`;
        const resp = await fetch(url, {
          signal: this.abortController?.signal,
          headers: { 'Accept': 'application/json' },
        });
        if (resp.ok) {
          const data = await resp.json();
          for (const net of (data.data || [])) {
            pdbCache[String(net.asn)] = net;
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn('PeeringDB batch fetch failed:', err.message);
      }
    }

    // Step 2: Collect IX IDs and fetch their countries
    if (onProgress) {
      onProgress({
        step: 4, totalSteps: 5,
        message: 'Resolving IXP countries from PeeringDB...',
        progress: 0.5,
      });
    }

    const allIxIds = new Set();
    for (const net of Object.values(pdbCache)) {
      for (const ix of (net.netixlan_set || [])) {
        if (ix.ix_id) allIxIds.add(ix.ix_id);
      }
    }

    const ixCache = {};
    if (allIxIds.size > 0) {
      const ixArray = [...allIxIds];
      for (let i = 0; i < ixArray.length; i += 100) {
        const batch = ixArray.slice(i, i + 100);
        try {
          const url = `https://www.peeringdb.com/api/ix?id__in=${batch.join(',')}`;
          const resp = await fetch(url, {
            signal: this.abortController?.signal,
            headers: { 'Accept': 'application/json' },
          });
          if (resp.ok) {
            const data = await resp.json();
            for (const ix of (data.data || [])) {
              ixCache[ix.id] = { country: ix.country || '', name: ix.name || '', city: ix.city || '' };
            }
          }
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          console.warn('PeeringDB IX fetch failed:', err.message);
        }
      }
    }

    // Step 3: Determine peering location per offshore ASN
    if (onProgress) {
      onProgress({
        step: 4, totalSteps: 5,
        message: 'Analyzing peering locations...',
        progress: 0.8,
      });
    }

    const results = {};
    for (const asn of offshoreList) {
      const peering = this._determinePeeringLocation(
        asn, directPeersMap[asn] || [], offshoreASNs[asn], pdbCache, ixCache
      );
      if (peering) results[asn] = peering;
    }

    const found = Object.keys(results).length;
    if (onProgress) {
      onProgress({
        step: 4, totalSteps: 5,
        message: `PeeringDB: resolved ${found}/${offshoreList.length} offshore peering locations`,
        progress: 1, complete: true,
      });
    }

    console.log('PeeringDB results:', Object.entries(results).map(
      ([asn, p]) => `AS${asn}=${p.country} (${p.source})`
    ).join(', '));

    return results;
  }

  /**
   * Analyze PeeringDB data to extract peering countries for a network.
   * @private
   */
  _analyzePeeringCountries(net, ixCache) {
    const countries = {};

    // Facilities (have country directly)
    for (const fac of (net.netfac_set || [])) {
      const cc = fac.country || '';
      const facName = fac.name || '';
      const city = fac.city || '';
      if (!cc) continue;
      if (!countries[cc]) countries[cc] = { weight: 0, details: [] };
      countries[cc].weight += 1000;
      if (facName) {
        countries[cc].details.push(city ? `${facName} (${city})` : facName);
      }
    }

    // IXPs (country from ixCache)
    for (const ix of (net.netixlan_set || [])) {
      const ixInfo = ixCache[ix.ix_id] || {};
      const cc = ixInfo.country || '';
      const ixName = ix.name || ixInfo.name || '';
      const speed = ix.speed || 0;
      if (!cc) continue;
      if (!countries[cc]) countries[cc] = { weight: 0, details: [] };
      countries[cc].weight += Math.max(speed, 1);
      if (ixName && !countries[cc].details.includes(ixName)) {
        countries[cc].details.push(ixName);
      }
    }

    return countries;
  }

  /**
   * Determine peering location for a single offshore ASN.
   * @private
   */
  _determinePeeringLocation(asn, upstreamASNs, geoDominant, pdbCache, ixCache) {
    // Step 1: Direct PeeringDB data
    const targetNet = pdbCache[asn];
    if (targetNet) {
      const countries = this._analyzePeeringCountries(targetNet, ixCache);
      const nonBD = Object.entries(countries).filter(([cc]) => cc !== 'BD');
      if (nonBD.length > 0) {
        nonBD.sort((a, b) => b[1].weight - a[1].weight);
        const [cc, data] = nonBD[0];
        return { country: cc, details: [...new Set(data.details)].slice(0, 5), source: 'peeringdb' };
      }
    }

    // Step 2: Upstream intersection
    if (upstreamASNs.length > 0) {
      const upCountrySets = [];
      const upCountryDetails = {};
      for (const upAsn of upstreamASNs) {
        const upNet = pdbCache[upAsn];
        if (!upNet) continue;
        const upCountries = this._analyzePeeringCountries(upNet, ixCache);
        const nonBDUp = new Set(Object.keys(upCountries).filter(cc => cc !== 'BD'));
        upCountrySets.push(nonBDUp);
        for (const [cc, data] of Object.entries(upCountries)) {
          if (cc === 'BD') continue;
          if (!upCountryDetails[cc]) upCountryDetails[cc] = { weight: 0, details: [] };
          upCountryDetails[cc].weight += data.weight;
          upCountryDetails[cc].details.push(...data.details);
        }
      }

      if (upCountrySets.length >= 2) {
        let common = upCountrySets[0];
        for (const s of upCountrySets.slice(1)) {
          common = new Set([...common].filter(x => s.has(x)));
        }
        if (common.size > 0) {
          const sorted = [...common].sort((a, b) =>
            (upCountryDetails[b]?.weight || 0) - (upCountryDetails[a]?.weight || 0)
          );
          const cc = sorted[0];
          return {
            country: cc,
            details: [...new Set(upCountryDetails[cc]?.details || [])].slice(0, 5),
            source: 'peeringdb-upstream',
          };
        }
      }

      const topCountries = Object.entries(upCountryDetails).sort((a, b) => b[1].weight - a[1].weight);
      if (topCountries.length > 0) {
        const [cc, data] = topCountries[0];
        return {
          country: cc,
          details: [...new Set(data.details)].slice(0, 5),
          source: 'peeringdb-upstream',
        };
      }
    }

    // Step 3: Fallback to geo
    if (geoDominant && geoDominant !== 'BD') {
      return { country: geoDominant, details: [], source: 'fallback-geo' };
    }

    return null;
  }
}

/**
 * Shared TYPE_LABELS map for all visualizations
 */
export const SHARED_TYPE_LABELS = {
  'outside': 'Outside BD (Intl Feeder)',
  'iig': 'IIG (Licensed Gateway)',
  'detected-iig': 'Detected Gateway',
  'offshore-enterprise': 'Offshore Enterprise',
  'offshore-gateway': 'Offshore Gateway',
  'local-company': 'Local Company',
  'inside': 'Inside BD (Gateway)',
  'offshore-peer': 'BD Offshore Peer',
  'local-isp': 'Local ISP',
};

/**
 * Build enriched tooltip HTML for a BGP node.
 * Shows geo location, registration country, classification info.
 *
 * @param {Object} d - Node data object with asn, name, type, country, geo_country, etc.
 * @param {Object} [typeLabels] - Optional type label overrides
 * @returns {string} HTML string for tooltip content
 */
export function buildNodeTooltipHtml(d, typeLabels = SHARED_TYPE_LABELS) {
  const regFlag = d.country ? countryToFlag(d.country) : '';
  const licenseBadge = d.licensed ? ' <span style="color:#51cf66;font-size:9px">[BTRC Licensed]</span>' : '';
  const typeLabel = typeLabels[d.type] || d.type || '';

  // Determine if geo differs from registration
  const geoKnown = d.geo_country && d.geo_country !== '';
  const geoDiffers = geoKnown && d.geo_country !== d.country;

  let html = `<div class="tooltip-title">${regFlag} ${d.name || `AS${d.asn}`}${licenseBadge}</div>`;
  html += `<div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${d.asn}</span></div>`;

  if (d.description && d.description !== d.name) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Org:</span><span class="tooltip-value">${d.description}</span></div>`;
  }

  if (d.country) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Registered:</span><span class="tooltip-value">${regFlag} ${d.country}</span></div>`;
  }

  // Show IP geolocation — full breakdown if multiple locations, single line otherwise
  if (d.geo_breakdown && d.geo_breakdown.length > 0) {
    if (d.geo_breakdown.length === 1) {
      const loc = d.geo_breakdown[0];
      const flag = countryToFlag(loc.country);
      const cityInfo = loc.city ? ` (${loc.city})` : '';
      const style = loc.country !== d.country ? 'color:#fcc419;font-weight:bold' : '';
      html += `<div class="tooltip-row"><span class="tooltip-label">IP Location:</span><span class="tooltip-value" style="${style}">${flag} ${loc.country}${cityInfo}${loc.country !== d.country ? ' ⚠' : ''}</span></div>`;
    } else {
      html += `<div class="tooltip-row"><span class="tooltip-label">IP Distribution:</span></div>`;
      for (const loc of d.geo_breakdown) {
        const flag = countryToFlag(loc.country);
        const cityInfo = loc.city ? ` (${loc.city})` : '';
        html += `<div class="tooltip-detail">&nbsp;&nbsp;${flag} ${loc.percentage.toFixed(0)}% ${loc.country}${cityInfo}</div>`;
      }
    }
  } else if (geoKnown) {
    // Fallback to simple geo_country if no breakdown available
    const geoFlag = countryToFlag(d.geo_country);
    const geoStyle = geoDiffers ? 'color:#fcc419;font-weight:bold' : '';
    html += `<div class="tooltip-row"><span class="tooltip-label">IP Location:</span><span class="tooltip-value" style="${geoStyle}">${geoFlag} ${d.geo_country}${geoDiffers ? ' ⚠' : ''}</span></div>`;
  }

  // Show BGP peering location for offshore ASNs
  if (d.peering_country) {
    const peerFlag = countryToFlag(d.peering_country);
    html += `<div class="tooltip-row"><span class="tooltip-label">BGP Peering:</span><span class="tooltip-value">${peerFlag} ${d.peering_country}</span></div>`;
    if (d.peering_details && d.peering_details.length > 0) {
      html += `<div class="tooltip-detail">&nbsp;&nbsp;Peers at: ${d.peering_details.slice(0, 2).join(', ')}</div>`;
    }
  }

  html += `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${typeLabel}</span></div>`;

  if (d.traffic !== undefined) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${d.traffic.toLocaleString()}</span></div>`;
  }
  if (d.rank) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Rank:</span><span class="tooltip-value">#${d.rank}</span></div>`;
  }
  if (d.percentage !== undefined) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(d.percentage || 0).toFixed(1)}%</span></div>`;
  }

  // Classification insight for offshore types
  if (d.type === 'offshore-enterprise') {
    const peerLoc = d.peering_country || d.geo_country;
    html += `<div class="tooltip-insight">Registered in ${d.country || 'BD'} but physically peers in ${peerLoc}. No downstream BD customers — classified as harmless offshore presence.</div>`;
  } else if (d.type === 'offshore-gateway') {
    const peerLoc = d.peering_country || d.geo_country;
    html += `<div class="tooltip-insight" style="color:#e64980">Registered in ${d.country || 'BD'} but physically peers in ${peerLoc}. Has downstream BD customers — potential unlicensed IIG.</div>`;
  } else if (d.type === 'detected-iig') {
    html += `<div class="tooltip-insight" style="color:#fcc419">Not in my datasets BTRC license list but has downstream BD customers — potentially acting as an unlicensed gateway.</div>`;
  }

  return html;
}

/**
 * Build tooltip HTML for an edge (link between two nodes).
 *
 * @param {Object} srcNode - Source node data
 * @param {Object} tgtNode - Target node data
 * @param {number} count - Route count
 * @param {string} [edgeType] - Edge type (international/domestic)
 * @returns {string} HTML string
 */
export function buildEdgeTooltipHtml(srcNode, tgtNode, count, edgeType) {
  const sf = srcNode?.country ? countryToFlag(srcNode.country) + ' ' : '';
  const tf = tgtNode?.country ? countryToFlag(tgtNode.country) + ' ' : '';
  const sn = srcNode?.name || '?';
  const tn = tgtNode?.name || '?';

  let html = `<div class="tooltip-title">${sf}${sn} &rarr; ${tf}${tn}</div>`;
  html += `<div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${count.toLocaleString()}</span></div>`;
  if (edgeType) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${edgeType}</span></div>`;
  }
  return html;
}
