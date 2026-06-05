#!/usr/bin/env python3
"""
Update BGP data for Bangladesh - All-in-one script.
Fetches live BGP routes from RIPEstat and processes them into visualization data.

This script combines the functionality of:
- fetch_bgp_routes.py (fetches raw BGP routes in parallel)
- reprocess into license-aware 6-category classification model

Categories:
  - outside: International transit providers
  - iig: BTRC-licensed border gateways (https://github.com/shafayat1004/bgp-bangladesh/blob/main/docs/List%20of%20IIG%20Service%20Providers%20License.pdf)
  - detected-iig: Acting as gateway but not in BTRC list (see above PDF for license source)
  - offshore-enterprise: BD-registered, abroad, no downstream BD customers (harmless)
  - offshore-gateway: BD-registered, abroad, has downstream BD customers (potential rogue)
  - local-company: Domestic origin networks

Usage:
    python3 scripts/update_bgp_data.py
    python3 scripts/update_bgp_data.py --country BD
"""

import json
import collections
import sys
import os
import time
import ipaddress
import argparse
import requests
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed, wait

# Use orjson for 10-50x faster JSON serialization when available
try:
    import orjson
    def fast_json_dumps(obj):
        return orjson.dumps(obj)
    def fast_json_loads(data):
        return orjson.loads(data)
    JSON_ENGINE = "orjson"
except ImportError:
    def fast_json_dumps(obj):
        return json.dumps(obj, separators=(',', ':')).encode('utf-8')
    def fast_json_loads(data):
        return json.loads(data)
    JSON_ENGINE = "stdlib json"

BASE = "https://stat.ripe.net/data"
UA = {"User-Agent": "bgp-bangladesh-viz/1.0 (https://github.com/bgp-bangladesh)"}
CONCURRENCY = 8  # RIPEstat allows 8 concurrent requests per IP

# Transient HTTP status codes worth retrying (rate limiting + upstream errors).
TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}

# Delegated RIR statistics — fallback source for country resources when the
# RIPEstat country-resource-list endpoint is unavailable. RIPEstat itself derives
# that endpoint from these files. APNIC is the RIR for Bangladesh.
RIR_STATS_URLS = [
    "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest",
    # Enable for non-BD countries in the future:
    # "https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-latest",
    # "https://ftp.arin.net/pub/stats/arin/delegated-arin-latest",
    # "https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-latest",
    # "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-latest",
]

# BGPKIT broker — discovers latest MRT RIB dumps for the bgp-state fallback.
BGPKIT_BROKER_LATEST = "https://api.bgpkit.com/v3/broker/latest"

# Skip collectors whose latest dump is older than this (drops dead collectors).
MRT_MAX_DELAY_SECONDS = 6 * 3600

# If RIS MRT parsing yields fewer than this many records, also pull RouteViews
# (independent of RIPE infrastructure) to broaden coverage.
MRT_MIN_RIS_ROUTES = 1000

# Globally-stable, always-announced control prefixes used to probe RIPEstat
# bgp-state health. This lets us tell two very different situations apart:
#   - control healthy + BD sparse/empty  -> BD routes REALLY dropped (e.g. a
#     national connectivity shutdown). This is a real signal: commit it.
#   - control also empty/failing          -> RIPEstat itself is down. This is an
#     upstream artifact: do NOT overwrite good committed data.
CONTROL_PREFIXES = ["1.1.1.0/24", "8.8.8.0/24", "193.0.0.0/21"]

# Healthy bgp-state returns ~350 observations per control prefix (~1000+ total).
# Well below that signals an upstream outage rather than a real BD change.
CONTROL_MIN_OBSERVATIONS = 100

# How many days of per-run snapshots to retain for the history time-slider.
# Snapshots older than this are pruned on each successful run.
RETENTION_DAYS = 7


# ═══════════════════════════════════════════════════════════════════════════
# Rate Limiter (matches website implementation)
# ═══════════════════════════════════════════════════════════════════════════

class RateLimiter:
    """Token bucket rate limiter - 4 requests per second by default."""
    def __init__(self, requests_per_second=4):
        self.tokens = requests_per_second
        self.max_tokens = requests_per_second
        self.refill_rate = requests_per_second
        self.last_refill = time.time()
    
    def acquire(self):
        """Acquire a token, waiting if necessary."""
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.max_tokens, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
        
        if self.tokens < 1:
            wait_time = (1 - self.tokens) / self.refill_rate
            time.sleep(wait_time)
            self.tokens = 0
            self.last_refill = time.time()
        else:
            self.tokens -= 1


# ═══════════════════════════════════════════════════════════════════════════
# HTTP helper with retries (shared by RIPEstat, APNIC, and BGPKIT broker)
# ═══════════════════════════════════════════════════════════════════════════

def get_with_retries(url, *, params=None, headers=None, timeout=60, attempts=4,
                     rate_limiter=None):
    """GET with retry/backoff on transient HTTP codes and network errors.

    Honors Retry-After on 429/5xx. Optionally gated by a RateLimiter so we
    respect upstream rate limits (matches the rest of the pipeline's politeness).
    """
    last_error = None
    for attempt in range(attempts):
        try:
            if rate_limiter is not None:
                rate_limiter.acquire()
            response = requests.get(url, params=params, headers=headers, timeout=timeout)

            if response.status_code in TRANSIENT_STATUS_CODES:
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait_seconds = int(retry_after)
                else:
                    wait_seconds = min(30, 2 ** attempt)
                last_error = requests.HTTPError(
                    f"{response.status_code} transient error for {response.url}"
                )
                if attempt < attempts - 1:
                    print(f"      Transient HTTP {response.status_code}; retrying in {wait_seconds}s...")
                    time.sleep(wait_seconds)
                    continue

            response.raise_for_status()
            return response

        except requests.RequestException as exc:
            last_error = exc
            if attempt < attempts - 1:
                wait_seconds = min(30, 2 ** attempt)
                print(f"      Request failed: {type(exc).__name__}; retrying in {wait_seconds}s...")
                time.sleep(wait_seconds)

    raise last_error


def ipv4_range_to_prefixes(start_ip, address_count):
    """Convert an IPv4 range (start address + count) into CIDR prefix strings."""
    start = ipaddress.IPv4Address(start_ip)
    end = ipaddress.IPv4Address(int(start) + int(address_count) - 1)
    return [str(prefix) for prefix in ipaddress.summarize_address_range(start, end)]


def get_country_resources_from_rir_stats(country_code, rate_limiter=None):
    """Fallback for RIPEstat country-resource-list using delegated RIR stats.

    Format: registry|cc|type|start|value|date|status[|extensions]
      asn : start=first ASN,      value=ASN count
      ipv4: start=first address,  value=address count
      ipv6: start=prefix,         value=prefix length
    """
    cc = country_code.upper()
    asns = set()
    prefixes = set()

    print(f"      Falling back to delegated RIR stats for {cc}...")
    for url in RIR_STATS_URLS:
        print(f"      Loading {url}")
        response = get_with_retries(url, headers=UA, timeout=90, rate_limiter=rate_limiter)
        for line in response.text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if len(parts) < 7:
                continue
            registry, cc_field, resource_type, start, value, date, status = parts[:7]
            if cc_field.upper() != cc or status not in {"allocated", "assigned"}:
                continue
            if resource_type == "asn":
                first_asn = int(start)
                for asn in range(first_asn, first_asn + int(value)):
                    asns.add(str(asn))
            elif resource_type == "ipv4":
                for prefix in ipv4_range_to_prefixes(start, int(value)):
                    prefixes.add(prefix)
            elif resource_type == "ipv6":
                prefixes.add(f"{start}/{value}")

    if not asns and not prefixes:
        raise RuntimeError(f"No delegated RIR resources found for {cc}")

    print(f"      RIR fallback found {len(asns)} ASNs and {len(prefixes)} prefixes")
    return asns, sorted(prefixes)


def _country_resources_cache_path(country_code):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    return os.path.join(project_dir, "data", country_code.upper(), "country_resources.json")


def _save_country_resources_cache(country_code, asns, prefixes):
    """Persist a last-good snapshot so a future total outage can still proceed."""
    path = _country_resources_cache_path(country_code)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "country": country_code.upper(),
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "asns": sorted(asns, key=lambda a: int(a) if str(a).isdigit() else 0),
        "prefixes": sorted(prefixes),
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"      Cached country resources to {path}")


def _load_country_resources_cache(country_code):
    path = _country_resources_cache_path(country_code)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        payload = json.load(f)
    asns = set(str(a) for a in payload.get("asns", []))
    prefixes = list(payload.get("prefixes", []))
    if not asns and not prefixes:
        return None
    print(f"      Loaded {len(asns)} ASNs and {len(prefixes)} prefixes from cache {path}")
    return asns, prefixes


# ═══════════════════════════════════════════════════════════════════════════
# History snapshots (powers the 7-day time-slider in the UI)
# ═══════════════════════════════════════════════════════════════════════════

def _history_dir(country_code):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    return os.path.join(project_dir, "data", country_code.upper(), "history")


def _snapshot_filename(ts):
    """Convert an ISO-8601 UTC timestamp to a colon-free snapshot filename.

    "2026-06-04T14:00:48Z" -> "20260604T140048Z.json" (safe on Windows/macOS/Linux).
    """
    safe = ts.replace("-", "").replace(":", "")
    return f"{safe}.json"


def archive_snapshot(country_code, viz_data, metadata):
    """Write a copy of this run's viz_data into the history directory.

    Only the viz_data is stored per snapshot (the only payload the UI renders);
    the timestamp, source and stats live in the manifest written separately.
    """
    history_dir = _history_dir(country_code)
    os.makedirs(history_dir, exist_ok=True)
    ts = metadata.get("last_updated") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    path = os.path.join(history_dir, _snapshot_filename(ts))
    with open(path, "w") as f:
        json.dump(viz_data, f, indent=2)
    print(f"      Archived snapshot to {path}")
    return path


def _parse_snapshot_ts(filename):
    """Recover a timezone-aware datetime from a snapshot filename.

    "20260604T140048Z.json" -> datetime(2026, 6, 4, 14, 0, 48, tzinfo=UTC).
    Returns None if the name does not match the expected pattern.
    """
    stem = filename[:-5] if filename.endswith(".json") else filename
    try:
        return datetime.strptime(stem, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def prune_history(country_code, retention_days=RETENTION_DAYS):
    """Delete snapshot files older than the retention window."""
    history_dir = _history_dir(country_code)
    if not os.path.isdir(history_dir):
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    removed = 0
    for name in os.listdir(history_dir):
        if not name.endswith(".json") or name == "index.json":
            continue
        snap_dt = _parse_snapshot_ts(name)
        if snap_dt is not None and snap_dt < cutoff:
            os.remove(os.path.join(history_dir, name))
            removed += 1
    if removed:
        print(f"      Pruned {removed} snapshot(s) older than {retention_days} days")


def write_history_index(country_code, retention_days=RETENTION_DAYS):
    """Rebuild history/index.json from the snapshot files currently on disk.

    Each entry carries the ISO timestamp, filename, source label and a minimal
    stats subset so the slider can render labels without fetching every snapshot.
    """
    history_dir = _history_dir(country_code)
    if not os.path.isdir(history_dir):
        return
    snapshots = []
    for name in sorted(os.listdir(history_dir)):
        if not name.endswith(".json") or name == "index.json":
            continue
        snap_dt = _parse_snapshot_ts(name)
        if snap_dt is None:
            continue
        entry = {
            "ts": snap_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "file": name,
        }
        try:
            with open(os.path.join(history_dir, name)) as f:
                snap = json.load(f)
            stats = snap.get("stats", {})
            entry["stats"] = {
                "valid_observations": stats.get("valid_observations"),
                "total_edges": stats.get("total_edges"),
            }
        except (OSError, ValueError, json.JSONDecodeError):
            entry["stats"] = {}
        snapshots.append(entry)

    snapshots.sort(key=lambda s: s["ts"])
    index = {
        "country": country_code.upper(),
        "retention_days": retention_days,
        "snapshots": snapshots,
    }
    path = os.path.join(history_dir, "index.json")
    with open(path, "w") as f:
        json.dump(index, f, indent=2)
    print(f"      Wrote history index with {len(snapshots)} snapshot(s) to {path}")


def update_history(country_code, viz_data, metadata, retention_days=RETENTION_DAYS):
    """Archive the current run, prune old snapshots, and rebuild the manifest."""
    archive_snapshot(country_code, viz_data, metadata)
    prune_history(country_code, retention_days)
    write_history_index(country_code, retention_days)


# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Fetch Country Resources
# ═══════════════════════════════════════════════════════════════════════════

def get_country_resources(country_code, rate_limiter=None):
    """Fetch ASNs and prefixes for a country, resilient to RIPEstat outages.

    Order: RIPEstat country-resource-list -> APNIC delegated RIR stats -> cache.
    On any live success the result is cached so a future total outage can still
    proceed from the last-good snapshot.
    """
    print(f"[1/4] Fetching country resources for {country_code.upper()}...")

    # Primary: RIPEstat
    try:
        r = get_with_retries(
            f"{BASE}/country-resource-list/data.json",
            params={"resource": country_code.lower(), "v4_format": "prefix"},
            headers=UA, timeout=60, attempts=4, rate_limiter=rate_limiter,
        )
        data = r.json()["data"]["resources"]
        asns = set(str(a) for a in data.get("asn", []))
        alloc_prefixes = data.get("ipv4", []) + data.get("ipv6", [])
        if asns and alloc_prefixes:
            print(f"      Found {len(asns)} ASNs and {len(alloc_prefixes)} allocation prefixes")
            _save_country_resources_cache(country_code, asns, alloc_prefixes)
            return asns, alloc_prefixes
        print("      RIPEstat returned empty country resources; trying RIR fallback...")
    except Exception as e:
        print(f"      RIPEstat country-resource-list failed: {e}")
        print("      Recoverable: RIPEstat derives this data from RIR stats.")

    # Fallback: delegated RIR stats (APNIC for BD)
    try:
        asns, prefixes = get_country_resources_from_rir_stats(country_code, rate_limiter=rate_limiter)
        _save_country_resources_cache(country_code, asns, prefixes)
        return asns, prefixes
    except Exception as e:
        print(f"      Delegated RIR stats fallback failed: {e}")

    # Last resort: committed cache from a previous successful run
    cached = _load_country_resources_cache(country_code)
    if cached:
        print("      Using committed country_resources.json cache.")
        return cached

    print("ERROR: Failed to fetch country resources from all sources (RIPEstat, RIR stats, cache).")
    sys.exit(1)


def fetch_announced_prefixes(asns, rate_limiter):
    """Fetch actually-announced prefixes for ALL country ASNs in parallel.
    
    The country-resource-list API returns allocated IP blocks, but ASNs may announce
    more-specific subnets (e.g. /24 out of a /23 allocation). Querying the
    announced-prefixes API per ASN captures these.
    """
    asn_list = list(asns)
    total = len(asn_list)
    all_prefixes = set()
    completed = 0
    failed = 0
    concurrency = CONCURRENCY
    
    print(f"\n[1b/4] Fetching announced prefixes for ALL {total} ASNs ({concurrency} parallel)...")
    print("       This captures more-specific subnets not in allocation list.")
    start_time = time.time()
    
    def fetch_one(asn, max_retries=2):
        """Fetch announced prefixes for a single ASN with retries."""
        for attempt in range(max_retries + 1):
            try:
                rate_limiter.acquire()
                resp = requests.get(
                    f"{BASE}/announced-prefixes/data.json",
                    params={"resource": f"AS{asn}"},
                    headers=UA,
                    timeout=30
                )
                
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get('Retry-After', 30))
                    if attempt < max_retries:
                        time.sleep(retry_after)
                        continue
                    return {"success": False, "prefixes": [], "asn": asn}
                
                resp.raise_for_status()
                asn_data = resp.json().get("data", {})
                pfxs = [p["prefix"] for p in asn_data.get("prefixes", []) if p.get("prefix")]
                return {"success": True, "prefixes": pfxs, "asn": asn}
                
            except requests.RequestException:
                if attempt < max_retries:
                    time.sleep(2 ** attempt)
                    continue
                return {"success": False, "prefixes": [], "asn": asn}
        
        return {"success": False, "prefixes": [], "asn": asn}
    
    # Process in parallel waves
    for i in range(0, total, concurrency):
        batch = asn_list[i:i + concurrency]
        
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {executor.submit(fetch_one, asn): asn for asn in batch}
            
            for future in as_completed(futures):
                result = future.result()
                if result["success"]:
                    all_prefixes.update(result["prefixes"])
                    completed += 1
                else:
                    failed += 1
        
        # Progress update every wave
        elapsed = time.time() - start_time
        done = completed + failed
        if done > 0:
            eta = (total - done) * (elapsed / done)
            print(f"      Progress: {done}/{total} ASNs ({completed} ok, {failed} failed) - ETA {eta:.0f}s")
    
    elapsed = time.time() - start_time
    print(f"      Done: {len(all_prefixes)} announced prefixes from {completed} ASNs in {elapsed:.1f}s")
    if failed > 0:
        print(f"      WARNING: {failed} ASNs failed to fetch announced prefixes")
    
    return all_prefixes


# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Fetch BGP Routes (Parallel)
# ═══════════════════════════════════════════════════════════════════════════

def chunk_prefixes(prefixes, max_len=1800):
    """Chunk prefixes to fit URL length limits (~2000 chars)."""
    chunks = []
    chunk = []
    current_len = 0
    
    for prefix in prefixes:
        add_len = len(prefix) + (1 if chunk else 0)  # +1 for comma
        if current_len + add_len > max_len and chunk:
            chunks.append(chunk)
            chunk = [prefix]
            current_len = len(prefix)
        else:
            chunk.append(prefix)
            current_len += add_len
    
    if chunk:
        chunks.append(chunk)
    
    return chunks


def fetch_bgp_routes(prefixes, rate_limiter):
    """Fetch BGP routes for all prefixes from RIPEstat in parallel."""
    batches = chunk_prefixes(prefixes)
    total_batches = len(batches)
    all_routes = []
    
    concurrency = CONCURRENCY
    print(f"\n[2/4] Fetching BGP routes in {total_batches} batches ({concurrency} parallel)...")
    print("      This will take 3-10 minutes depending on API speed.")
    print("      Press Ctrl+C to abort.\n")
    
    start_time = time.time()
    completed = 0
    failed = 0
    
    def fetch_batch_with_retry(batch_idx, batch, max_retries=3):
        """Fetch a single batch with rate limiting and retry logic."""
        for attempt in range(max_retries + 1):
            try:
                rate_limiter.acquire()
                params = {"resource": ",".join(batch)}
                url = f"{BASE}/bgp-state/data.json"
                
                r = requests.get(url, params=params, headers=UA, timeout=120)
                
                # Handle rate limiting
                if r.status_code == 429:
                    retry_after = int(r.headers.get('Retry-After', 60))
                    if attempt < max_retries:
                        print(f"      Batch {batch_idx}: Rate limited, waiting {retry_after}s (attempt {attempt + 1}/{max_retries})...")
                        time.sleep(retry_after)
                        continue
                
                r.raise_for_status()
                data = r.json()
                routes = data.get("data", {}).get("bgp_state", [])
                
                # Strip community field — never used in analysis, saves ~40% memory/disk
                for rt in routes:
                    rt.pop("community", None)
                
                # Success - log if this was after retries
                if attempt > 0:
                    print(f"      Batch {batch_idx}: Success after {attempt + 1} attempts")
                
                return {"success": True, "routes": routes, "batch_idx": batch_idx}
                
            except requests.RequestException as e:
                if attempt < max_retries:
                    # Exponential backoff: 2s, 4s, 8s
                    wait_time = 2 ** attempt
                    print(f"      Batch {batch_idx}: {type(e).__name__} - retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})...")
                    time.sleep(wait_time)
                else:
                    print(f"      WARNING: Batch {batch_idx} failed after {max_retries + 1} attempts: {e}")
                    return {"success": False, "routes": [], "batch_idx": batch_idx}
        
        return {"success": False, "routes": [], "batch_idx": batch_idx}
    
    # Process batches in parallel waves
    for i in range(0, total_batches, concurrency):
        batch_group = batches[i:i + concurrency]
        
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {
                executor.submit(fetch_batch_with_retry, i + idx + 1, batch): i + idx + 1 
                for idx, batch in enumerate(batch_group)
            }
            
            for future in as_completed(futures):
                result = future.result()
                if result["success"]:
                    all_routes.extend(result["routes"])
                    completed += 1
                else:
                    failed += 1
                
                # Progress update
                elapsed = time.time() - start_time
                avg_per_batch = elapsed / (completed + failed) if (completed + failed) > 0 else 0
                remaining = (total_batches - completed - failed) * avg_per_batch
                
                if (completed + failed) % 5 == 0 or (completed + failed) == total_batches:
                    print(f"      Progress: {completed}/{total_batches} batches ({len(all_routes):,} routes, ETA: {remaining/60:.1f} min)...")
    
    elapsed = time.time() - start_time
    print(f"\n      Fetch complete! {len(all_routes):,} routes in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    if failed > 0:
        print(f"      WARNING: {failed} batches failed even after retries")
    
    return all_routes


# ═══════════════════════════════════════════════════════════════════════════
# Step 2 health probe (distinguishes upstream outage from real BD route changes)
# ═══════════════════════════════════════════════════════════════════════════

def probe_bgp_state_health(rate_limiter=None):
    """Probe RIPEstat bgp-state with globally-stable control prefixes.

    Returns the total observation count across CONTROL_PREFIXES. A healthy probe
    (~1000+) means RIPEstat is serving real data, so a sparse/empty BD result is
    a genuine routing change worth committing. A near-zero probe means RIPEstat
    itself is unhealthy, so BD results cannot be trusted.
    """
    total = 0
    for prefix in CONTROL_PREFIXES:
        try:
            r = get_with_retries(
                f"{BASE}/bgp-state/data.json",
                params={"resource": prefix}, headers=UA, timeout=60,
                attempts=3, rate_limiter=rate_limiter,
            )
            total += len(r.json().get("data", {}).get("bgp_state", []))
        except Exception as e:
            print(f"      Control probe for {prefix} failed: {e}")
    return total


# ═══════════════════════════════════════════════════════════════════════════
# Step 2 (fallback): Fetch AS paths from MRT dumps (RIPE RIS / RouteViews)
# ═══════════════════════════════════════════════════════════════════════════
#
# Used only when RIPEstat bgp-state is unavailable AND --use-mrt-fallback is set.
# Produces records identical in shape to fetch_bgp_routes(), so the rest of the
# pipeline (dedup -> analyze_routes -> build_viz_data) is unchanged and the
# output files stay schema-identical regardless of the data source.

def mrt_elem_to_route(elem, collector):
    """Adapt a pybgpkit/mrtparse-style BGP element into the canonical record.

    Accepts either an object with attributes (pybgpkit Elem) or a dict. Returns
    {"target_prefix", "source_id", "path"} matching the bgp-state output, where
    source_id is unique per vantage point so (target_prefix, source_id) dedup
    behaves exactly like the RIPEstat path.
    """
    def field(name):
        if isinstance(elem, dict):
            return elem.get(name)
        return getattr(elem, name, None)

    as_path_raw = field("as_path") or ""
    if isinstance(as_path_raw, (list, tuple)):
        path = [str(x) for x in as_path_raw]
    else:
        path = str(as_path_raw).split()

    return {
        "target_prefix": field("prefix"),
        "source_id": f"{collector}:{field('peer_ip')}",
        "path": path,
    }


def discover_latest_rib_dumps(project="riperis", rate_limiter=None,
                              max_delay_seconds=MRT_MAX_DELAY_SECONDS):
    """Discover the latest RIB MRT dumps via the BGPKIT broker.

    project: 'riperis' (collector id starts with 'rrc') or 'routeviews'.
    Drops stale collectors (delay > max_delay_seconds) so dead collectors are
    excluded. Returns [{"collector", "url", "size"}] sorted by size ascending.
    The /latest endpoint ignores query params, so we filter client-side.
    """
    r = get_with_retries(BGPKIT_BROKER_LATEST, headers=UA, timeout=60,
                         rate_limiter=rate_limiter)
    items = r.json().get("data", [])
    dumps = []
    for it in items:
        if it.get("data_type") != "rib":
            continue
        cid = it.get("collector_id", "")
        is_ris = cid.startswith("rrc")
        if project == "riperis" and not is_ris:
            continue
        if project == "routeviews" and is_ris:
            continue
        if it.get("delay", 1 << 62) > max_delay_seconds:
            continue
        dumps.append({"collector": cid, "url": it["url"], "size": it.get("rough_size", 0)})
    dumps.sort(key=lambda d: d["size"])
    return dumps


def _bd_as_path_regex(country_asns):
    """Build an AS-path regex matching any country ASN as a whole path token.

    Pushed into the pybgpkit (Rust) parser to cut Python-side work dramatically.
    """
    if not country_asns:
        return None
    alternation = "|".join(sorted(country_asns, key=lambda a: int(a) if str(a).isdigit() else 0))
    return rf"(?:^| )(?:{alternation})(?: |$)"


def _parse_rib_dump(url, collector, country_asns, prefix_set, as_path_regex):
    """Parse one MRT RIB dump with pybgpkit-parser into canonical records."""
    from pybgpkit_parser import Parser  # lazy: Linux/macOS wheels only

    filters = {}
    if as_path_regex:
        filters["as_path"] = as_path_regex

    parser = Parser(url=url, filters=filters)
    records = []
    for elem in parser:
        origin_asns = getattr(elem, "origin_asns", None) or []
        origin = str(origin_asns[-1]) if origin_asns else None
        prefix = getattr(elem, "prefix", None)
        if (origin and origin in country_asns) or (prefix in prefix_set):
            records.append(mrt_elem_to_route(elem, collector))
    return records


# Print a "still working" heartbeat at most this often while dumps parse, so CI
# logs show progress even when a single big dump takes many minutes.
MRT_HEARTBEAT_SECONDS = 30


def _parse_rib_dumps(dumps, country_asns, prefix_set, as_path_regex,
                     rate_limiter, concurrency):
    """Parse multiple RIB dumps in bounded parallel waves (polite to archives).

    Emits a start line per dump and a periodic heartbeat while dumps are still
    in flight, so long downloads/parses produce visible progress in CI logs.
    """
    routes = []
    total = len(dumps)
    completed = 0
    for i in range(0, total, concurrency):
        wave = dumps[i:i + concurrency]
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {}
            for d in wave:
                if rate_limiter is not None:
                    rate_limiter.acquire()  # gate each download start
                print(f"      [start] {d['collector']}: downloading + parsing "
                      f"(~{d['size'] / 1e6:.0f} MB)...", flush=True)
                futures[executor.submit(
                    _parse_rib_dump, d["url"], d["collector"],
                    country_asns, prefix_set, as_path_regex
                )] = d

            pending = set(futures)
            wave_start = time.time()
            while pending:
                done, pending = wait(pending, timeout=MRT_HEARTBEAT_SECONDS)
                for future in done:
                    d = futures[future]
                    completed += 1
                    try:
                        recs = future.result()
                        routes.extend(recs)
                        print(f"      [{completed}/{total}] {d['collector']}: "
                              f"{len(recs):,} BD records ({d['size'] / 1e6:.0f} MB)",
                              flush=True)
                    except Exception as e:
                        print(f"      [{completed}/{total}] {d['collector']}: "
                              f"FAILED ({type(e).__name__}: {e})", flush=True)
                if pending:
                    still = ", ".join(sorted(futures[f]["collector"] for f in pending))
                    print(f"      ... still parsing [{still}] "
                          f"({time.time() - wave_start:.0f}s elapsed, "
                          f"{len(routes):,} records so far)", flush=True)
    return routes


def fetch_bgp_routes_mrt(prefixes, country_asns, rate_limiter=None,
                         collectors=None, concurrency=2):
    """Fallback AS-path source: parse MRT RIB dumps from RIPE RIS / RouteViews.

    Returns records identical in shape to fetch_bgp_routes(). RIS is preferred
    (closest to RIPEstat's own data); RouteViews is added if RIS yields too
    little and is independent of RIPE infrastructure.
    """
    prefix_set = set(prefixes)
    as_path_regex = _bd_as_path_regex(country_asns)

    print(f"\n[2/4] (FALLBACK) Fetching AS paths from MRT dumps "
          f"(concurrency {concurrency})...")

    routes = []
    try:
        ris = discover_latest_rib_dumps("riperis", rate_limiter=rate_limiter)
        if collectors:
            ris = [d for d in ris if d["collector"] in collectors]
        print(f"      Discovered {len(ris)} fresh RIPE RIS RIB dumps")
        routes.extend(_parse_rib_dumps(ris, country_asns, prefix_set,
                                       as_path_regex, rate_limiter, concurrency))
    except Exception as e:
        print(f"      RIS discovery/parse failed: {e}")

    if len(routes) < MRT_MIN_RIS_ROUTES:
        print(f"      RIS yielded {len(routes)} routes; adding RouteViews "
              f"(independent of RIPE infra)...")
        try:
            rv = discover_latest_rib_dumps("routeviews", rate_limiter=rate_limiter)
            if collectors:
                rv = [d for d in rv if d["collector"] in collectors]
            routes.extend(_parse_rib_dumps(rv, country_asns, prefix_set,
                                           as_path_regex, rate_limiter, concurrency))
        except Exception as e:
            print(f"      RouteViews discovery/parse failed: {e}")

    print(f"      MRT fallback collected {len(routes):,} route records")
    return routes


# ═══════════════════════════════════════════════════════════════════════════
# Step 3: Analyze Routes (Gateway Detection)
# ═══════════════════════════════════════════════════════════════════════════

def _process_single_route(rt, country_asns, seen, outside_counts, iig_counts,
                          local_isp_counts, edge_intl, edge_domestic, direct_peers):
    """Process a single route record. Shared by both list-based and streaming analysis."""
    target = rt.get("target_prefix")
    source_id = rt.get("source_id")
    path_raw = rt.get("path") or []
    
    # Clean path: deduplicate consecutive ASNs (AS prepending), convert to string
    path = []
    for x in path_raw:
        s = str(x).strip()
        if s.isdigit() and (not path or path[-1] != s):
            path.append(s)
    
    if not target or not source_id or len(path) < 2:
        return False
    
    key = (target, source_id)
    if key in seen:
        return False
    seen.add(key)
    
    # Walk backwards from origin
    i = len(path) - 1
    while i >= 0 and path[i] in country_asns:
        i -= 1
    
    outside = path[i] if i >= 0 else None
    iig = path[i + 1] if (i + 1) < len(path) else None
    origin = path[-1]
    
    # Track direct adjacency for all BD ASNs in the path
    for pi in range(len(path) - 1):
        a, b = path[pi], path[pi + 1]
        if a in country_asns or b in country_asns:
            direct_peers[(a, b)] += 1

    if outside and iig:
        outside_counts[outside] += 1
        iig_counts[iig] += 1
        edge_intl[(outside, iig)] += 1
        
        # Domestic edge: origin → IIG
        if origin != iig and origin in country_asns:
            local_isp_counts[origin] += 1
            edge_domestic[(origin, iig)] += 1
        elif origin == iig:
            local_isp_counts[origin] += 1
    
    return True


def _finalize_analysis(outside_counts, iig_counts, local_isp_counts,
                       edge_intl, edge_domestic, direct_peers, valid_obs, country_asns):
    """Build the final analysis result dict from accumulated counters."""
    print(f"      Valid observations: {valid_obs:,}")
    print(f"      Outside ASNs: {len(outside_counts)}")
    print(f"      IIG ASNs: {len(iig_counts)}")
    print(f"      Local Company ASNs: {len(local_isp_counts)}")
    print(f"      International edges: {len(edge_intl)}")
    print(f"      Domestic edges: {len(edge_domestic)}")
    
    # Build direct peers map: for each BD ASN, list its non-BD upstream neighbors
    direct_peers_map = {}
    for (a, b), count in direct_peers.items():
        if b in country_asns and a not in country_asns:
            if b not in direct_peers_map:
                direct_peers_map[b] = []
            direct_peers_map[b].append(a)
        if a in country_asns and b not in country_asns:
            if a not in direct_peers_map:
                direct_peers_map[a] = []
            direct_peers_map[a].append(b)

    for asn in direct_peers_map:
        direct_peers_map[asn] = list(set(direct_peers_map[asn]))

    print(f"      Direct peer adjacencies tracked: {len(direct_peers):,}")
    print(f"      BD ASNs with international peers: {len(direct_peers_map)}")

    return {
        "outside_counts": outside_counts,
        "iig_counts": iig_counts,
        "local_isp_counts": local_isp_counts,
        "edge_intl": edge_intl,
        "edge_domestic": edge_domestic,
        "direct_peers_map": direct_peers_map,
        "valid_obs": valid_obs,
    }


def analyze_routes(routes, country_asns):
    """
    Analyze BGP routes from an in-memory list.
    Extracts gateway structure: Local Company → Gateway → Outside ASN.
    """
    print(f"\n[3/4] Analyzing {len(routes):,} routes for gateway structure...")
    
    seen = set()
    outside_counts = collections.Counter()
    iig_counts = collections.Counter()
    local_isp_counts = collections.Counter()
    edge_intl = collections.Counter()
    edge_domestic = collections.Counter()
    direct_peers = collections.Counter()
    valid_obs = 0
    total = len(routes)
    
    for idx, rt in enumerate(routes):
        if idx % 100000 == 0 and idx > 0:
            print(f"      Processing route {idx:,}/{total:,}...")
        
        if _process_single_route(rt, country_asns, seen, outside_counts,
                                 iig_counts, local_isp_counts, edge_intl,
                                 edge_domestic, direct_peers):
            valid_obs += 1
    
    return _finalize_analysis(outside_counts, iig_counts, local_isp_counts,
                              edge_intl, edge_domestic, direct_peers, valid_obs, country_asns)


def analyze_routes_streaming(jsonl_path, country_asns):
    """
    Analyze BGP routes by streaming from a JSONL file line-by-line.
    Avoids loading the entire file into memory (~2GB savings).
    """
    # Count lines first for progress reporting
    print(f"\n[3/4] Streaming analysis from {jsonl_path}...")
    line_count = 0
    with open(jsonl_path, 'rb') as f:
        for _ in f:
            line_count += 1
    print(f"      {line_count:,} route records to process...")
    
    seen = set()
    outside_counts = collections.Counter()
    iig_counts = collections.Counter()
    local_isp_counts = collections.Counter()
    edge_intl = collections.Counter()
    edge_domestic = collections.Counter()
    direct_peers = collections.Counter()
    valid_obs = 0
    
    with open(jsonl_path, 'rb') as f:
        for idx, line in enumerate(f):
            if idx % 100000 == 0 and idx > 0:
                print(f"      Processing route {idx:,}/{line_count:,}...")
            
            line = line.strip()
            if not line:
                continue
            
            try:
                rt = fast_json_loads(line)
            except (json.JSONDecodeError, Exception):
                continue
            
            if _process_single_route(rt, country_asns, seen, outside_counts,
                                     iig_counts, local_isp_counts, edge_intl,
                                     edge_domestic, direct_peers):
                valid_obs += 1
    
    return _finalize_analysis(outside_counts, iig_counts, local_isp_counts,
                              edge_intl, edge_domestic, direct_peers, valid_obs, country_asns)


# ═══════════════════════════════════════════════════════════════════════════
# Step 4: Fetch ASN Info (Parallel)
# ═══════════════════════════════════════════════════════════════════════════

def fetch_asn_info(asn_list, country_asns, rate_limiter, existing_asn_names=None):
    """Fetch ASN info in parallel with rate limiting. Includes country extraction."""
    if existing_asn_names is None:
        existing_asn_names = {}
    
    # Determine which ASNs need country info
    need_fetch = [a for a in asn_list if a not in existing_asn_names or "country" not in existing_asn_names.get(a, {})]
    
    if not need_fetch:
        print(f"      All ASN info already cached.")
        return existing_asn_names
    
    concurrency = CONCURRENCY
    print(f"\n[4/4] Fetching ASN info for {len(need_fetch):,} ASNs ({concurrency} parallel)...")
    
    results = dict(existing_asn_names)  # Start with existing data
    completed = 0
    failed = 0
    start_time = time.time()
    
    # Invalid region codes that should not be treated as countries
    INVALID_REGIONS = {"AP", "EU", "AS", "AF", "LA", "NA", "OC", "AN"}
    
    def fetch_asn(asn):
        """Fetch ASN overview and extract country from holder name or RIR data."""
        max_retries = 2  # Match website behavior
        
        for attempt in range(max_retries + 1):
            try:
                rate_limiter.acquire()
                r = requests.get(f"{BASE}/as-overview/data.json",
                                 params={"resource": f"AS{asn}"},
                                 headers=UA, timeout=15)
                r.raise_for_status()
                data = r.json()
                
                if data.get("status") == "ok":
                    info = data.get("data", {})
                    holder = info.get("holder", "")
                    announced = info.get("announced", False)
                    
                    # Try to parse country from holder name
                    country = ""
                    if asn in country_asns:
                        country = "BD"
                    else:
                        # Try to extract from holder - pattern like "NAME-CC"
                        parts = holder.split()
                        if parts:
                            first = parts[0]
                            if "-" in first:
                                suffix = first.split("-")[-1].upper()
                                if len(suffix) == 2 and suffix.isalpha() and suffix not in INVALID_REGIONS:
                                    country = suffix
                    
                    return asn, {
                        "asn": asn,
                        "name": holder or f"AS{asn}",
                        "holder": holder or f"AS{asn}",
                        "announced": announced,
                        "country": country,
                    }
                return asn, {"asn": asn, "name": f"AS{asn}", "holder": "", "announced": False, "country": "BD" if asn in country_asns else ""}
                
            except requests.RequestException as e:
                if attempt < max_retries:
                    time.sleep(1)  # Brief wait before retry
                    continue
                # Final failure - return fallback
                return asn, {"asn": asn, "name": f"AS{asn}", "holder": "", "announced": False, "country": "BD" if asn in country_asns else ""}
            except Exception:
                # Unexpected error - return fallback
                return asn, {"asn": asn, "name": f"AS{asn}", "holder": "", "announced": False, "country": "BD" if asn in country_asns else ""}
    
    # Fetch in parallel batches
    for i in range(0, len(need_fetch), concurrency):
        batch = need_fetch[i:i + concurrency]
        
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(fetch_asn, asn) for asn in batch]
            
            for future in as_completed(futures):
                try:
                    asn, result = future.result()
                    results[asn] = result
                    completed += 1
                except Exception:
                    failed += 1
        
        if completed % 100 == 0:
            elapsed = time.time() - start_time
            avg_per_item = elapsed / completed if completed > 0 else 0
            remaining = (len(need_fetch) - completed) * avg_per_item
            print(f"      Fetched {completed}/{len(need_fetch)} ASNs (ETA: {remaining:.0f}s)...")
    
    # Set country for all BD ASNs
    for asn in country_asns:
        if asn in results:
            results[asn]["country"] = "BD"
    
    # Apply well-known ASN country overrides
    WELL_KNOWN_COUNTRIES = {
        "174": "US", "6939": "US", "6461": "US", "3356": "US", "1299": "SE",
        "2914": "US", "3257": "DE", "3491": "US", "5511": "FR", "6762": "IT",
        "9002": "EU", "9498": "IN", "4637": "HK", "2516": "JP", "4826": "AU",
        "7922": "US", "20473": "US", "13335": "US", "16509": "US", "15169": "US",
        "8075": "US", "32934": "US", "36351": "US", "46489": "US", "397143": "US",
    }
    for asn, cc in WELL_KNOWN_COUNTRIES.items():
        if asn in results:
            current = results[asn].get("country", "")
            if not current or current in INVALID_REGIONS:
                results[asn]["country"] = cc
    
    print(f"      ASN info complete: {len(results):,} total entries")
    with_country = sum(1 for v in results.values() if v.get("country"))
    print(f"      ASNs with country: {with_country:,}/{len(results):,}")
    
    return results


# ═══════════════════════════════════════════════════════════════════════════
# Step 4b: Fetch Geolocation for Offshore Peer Detection
# ═══════════════════════════════════════════════════════════════════════════

def fetch_geo_country(asn, rate_limiter):
    """
    Query RIPEstat MaxMind GeoLite to determine the physical location of an ASN's prefixes.
    Returns a dict with full breakdown:
      {
        'dominant_country': 'IN' or 'BD',
        'breakdown': [{'country': 'IN', 'city': 'Chennai', 'percentage': 50.0, 'prefixes': [...]}],
        'bd_percentage': 50.0
      }
    """
    fallback = {"dominant_country": "BD", "breakdown": [], "bd_percentage": 100.0}
    try:
        rate_limiter.acquire()
        r = requests.get(
            f"{BASE}/maxmind-geo-lite-announced-by-as/data.json",
            params={"resource": f"AS{asn}"},
            headers=UA, timeout=30
        )
        r.raise_for_status()
        data = r.json()

        if data.get("status") != "ok":
            return fallback

        total_pct = 0
        bd_pct = 0
        country_pcts = {}
        breakdown = []

        for resource in data.get("data", {}).get("located_resources", []):
            for loc in resource.get("locations", []):
                pct = loc.get("covered_percentage", 0)
                cc = loc.get("country", "")
                city = loc.get("city", "")
                prefixes = loc.get("resources", [])
                if not cc:
                    continue
                total_pct += pct
                if cc == "BD":
                    bd_pct += pct
                else:
                    country_pcts[cc] = country_pcts.get(cc, 0) + pct
                breakdown.append({
                    "country": cc,
                    "city": city,
                    "percentage": pct,
                    "prefixes": prefixes[:3],  # Keep max 3 examples
                })

        if total_pct <= 0:
            return fallback

        # Determine dominant country
        bd_ratio = bd_pct / total_pct
        if bd_ratio > 0.8:
            dominant = "BD"
        elif country_pcts:
            dominant = max(country_pcts, key=country_pcts.get)
        else:
            dominant = "BD"

        # Sort breakdown by percentage descending
        breakdown.sort(key=lambda x: x["percentage"], reverse=True)

        return {
            "dominant_country": dominant,
            "breakdown": breakdown,
            "bd_percentage": round(bd_pct, 2),
        }

    except Exception as e:
        print(f"      Warning: Geo fetch failed for AS{asn}: {e}")
        return fallback


def fetch_geo_countries(asn_list, rate_limiter, concurrency=CONCURRENCY):
    """Fetch geolocation for multiple ASNs in parallel. Returns dict of ASN → geo data."""
    print(f"\n[4b] Fetching geolocation for {len(asn_list)} ASNs (offshore peer detection)...")
    results = {}
    completed = 0

    for i in range(0, len(asn_list), concurrency):
        batch = asn_list[i:i + concurrency]

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {executor.submit(fetch_geo_country, asn, rate_limiter): asn for asn in batch}

            for future in as_completed(futures):
                asn = futures[future]
                try:
                    results[asn] = future.result()
                    completed += 1
                except Exception:
                    results[asn] = {"dominant_country": "BD", "breakdown": [], "bd_percentage": 100.0}
                    completed += 1

    non_bd = {asn: geo for asn, geo in results.items() if geo["dominant_country"] != "BD"}
    print(f"      Geolocation complete: {len(results)} ASNs checked, {len(non_bd)} with non-BD infrastructure")
    for asn, geo in non_bd.items():
        locs = ", ".join(f"{b['country']}({b['percentage']:.0f}%)" for b in geo["breakdown"])
        print(f"        AS{asn}: {locs}")

    return results


# ═══════════════════════════════════════════════════════════════════════════
# Step 4c: PeeringDB Integration (Physical Peering Location Detection)
# ═══════════════════════════════════════════════════════════════════════════

PEERINGDB_BASE = "https://www.peeringdb.com/api"
PEERINGDB_UA = {"User-Agent": "bgp-bangladesh-viz/1.0"}
PEERINGDB_DELAY = 3  # Seconds between queries (conservative: 20/min anonymous limit)


def peeringdb_batch_fetch_nets(asn_list):
    """
    Batch-fetch PeeringDB network records for multiple ASNs in one API call.
    Uses asn__in parameter (max ~150 ASNs per request).
    Returns dict of ASN (str) → network record.
    """
    results = {}
    # PeeringDB supports up to ~150 ASNs in a batch
    for i in range(0, len(asn_list), 100):
        batch = asn_list[i:i + 100]
        asn_str = ",".join(str(a) for a in batch)
        try:
            time.sleep(PEERINGDB_DELAY)
            r = requests.get(
                f"{PEERINGDB_BASE}/net",
                params={"asn__in": asn_str, "depth": 2},
                headers=PEERINGDB_UA,
                timeout=30,
            )
            if r.status_code == 429:
                print(f"      PeeringDB rate limited, waiting 60s...")
                time.sleep(60)
                r = requests.get(
                    f"{PEERINGDB_BASE}/net",
                    params={"asn__in": asn_str, "depth": 2},
                    headers=PEERINGDB_UA,
                    timeout=30,
                )
            r.raise_for_status()
            data = r.json()
            for net in data.get("data", []):
                results[str(net.get("asn", ""))] = net
            print(f"      PeeringDB batch: requested {len(batch)} ASNs, got {len(data.get('data', []))} records")
        except Exception as e:
            print(f"      Warning: PeeringDB batch fetch failed: {e}")

    return results


def peeringdb_batch_fetch_ixs(ix_ids):
    """
    Batch-fetch IX records to get their countries.
    Returns dict of ix_id → {'country': '..', 'name': '..', 'city': '..'}.
    """
    results = {}
    ix_list = list(set(ix_ids))
    if not ix_list:
        return results

    for i in range(0, len(ix_list), 100):
        batch = ix_list[i:i + 100]
        id_str = ",".join(str(x) for x in batch)
        try:
            time.sleep(PEERINGDB_DELAY)
            r = requests.get(
                f"{PEERINGDB_BASE}/ix",
                params={"id__in": id_str},
                headers=PEERINGDB_UA,
                timeout=30,
            )
            if r.status_code == 429:
                print(f"      PeeringDB rate limited (IX fetch), waiting 60s...")
                time.sleep(60)
                r = requests.get(
                    f"{PEERINGDB_BASE}/ix",
                    params={"id__in": id_str},
                    headers=PEERINGDB_UA,
                    timeout=30,
                )
            r.raise_for_status()
            data = r.json()
            for ix in data.get("data", []):
                results[ix["id"]] = {
                    "country": ix.get("country", ""),
                    "name": ix.get("name", ""),
                    "city": ix.get("city", ""),
                }
            print(f"      PeeringDB IX batch: requested {len(batch)}, got {len(data.get('data', []))} records")
        except Exception as e:
            print(f"      Warning: PeeringDB IX batch fetch failed: {e}")

    return results


def analyze_peering_from_peeringdb(net_record, ix_cache):
    """
    Extract peering country info from a PeeringDB network record.
    Uses facility data (has country directly) and IXP data (via ix_cache).
    Returns: {'countries': {cc: {'weight': N, 'details': [...]}}, ...}
    """
    countries = {}

    # Facilities: country is directly on the record
    for fac in net_record.get("netfac_set", []):
        cc = fac.get("country", "")
        fac_name = fac.get("name", "")
        city = fac.get("city", "")
        if not cc:
            continue
        if cc not in countries:
            countries[cc] = {"weight": 0, "details": []}
        countries[cc]["weight"] += 1000  # Facilities are strong signal
        if fac_name:
            detail = fac_name
            if city:
                detail += f" ({city})"
            countries[cc]["details"].append(detail)

    # IXPs: look up country via ix_cache
    for ix_entry in net_record.get("netixlan_set", []):
        ix_id = ix_entry.get("ix_id")
        ix_name = ix_entry.get("name", "")
        speed = ix_entry.get("speed", 0) or 0
        ix_info = ix_cache.get(ix_id, {})
        cc = ix_info.get("country", "")
        if not cc:
            continue
        if cc not in countries:
            countries[cc] = {"weight": 0, "details": []}
        countries[cc]["weight"] += max(speed, 1)
        if ix_name and ix_name not in countries[cc]["details"]:
            countries[cc]["details"].append(ix_name)

    return countries


def determine_peering_location(target_asn, upstream_asns, geo_dominant, pdb_cache, ix_cache):
    """
    Determine physical peering location for an offshore ASN.
    Uses pre-fetched PeeringDB data (batch-queried).
    Strategy:
      1. Check target ASN's PeeringDB record (facilities + IXPs)
      2. If no clear non-BD location, check upstream intersection
      3. Fallback to geo_dominant country
    Returns dict or None.
    """
    target_net = pdb_cache.get(target_asn)

    # Step 1: Direct PeeringDB data for target ASN
    if target_net:
        countries = analyze_peering_from_peeringdb(target_net, ix_cache)
        # Filter out home country (BD) — we want non-BD peering locations
        non_bd = {cc: data for cc, data in countries.items() if cc != "BD"}
        if non_bd:
            dominant = max(non_bd, key=lambda c: non_bd[c]["weight"])
            details = list(dict.fromkeys(non_bd[dominant]["details"]))
            return {
                "country": dominant,
                "details": details[:5],
                "source": "peeringdb",
            }

    # Step 2: Upstream intersection — find common non-BD peering countries
    if upstream_asns:
        upstream_country_sets = []
        upstream_country_details = {}
        for up_asn in upstream_asns:
            up_net = pdb_cache.get(up_asn)
            if not up_net:
                continue
            up_countries = analyze_peering_from_peeringdb(up_net, ix_cache)
            non_bd_up = {cc for cc in up_countries if cc != "BD"}
            upstream_country_sets.append(non_bd_up)
            for cc, data in up_countries.items():
                if cc != "BD":
                    if cc not in upstream_country_details:
                        upstream_country_details[cc] = {"weight": 0, "details": []}
                    upstream_country_details[cc]["weight"] += data["weight"]
                    upstream_country_details[cc]["details"].extend(data["details"])

        if len(upstream_country_sets) >= 2:
            # Find countries where multiple upstreams co-exist
            common = upstream_country_sets[0]
            for s in upstream_country_sets[1:]:
                common = common & s
            if common:
                # Rank common countries by combined weight
                dominant = max(common, key=lambda c: upstream_country_details.get(c, {}).get("weight", 0))
                details = list(dict.fromkeys(upstream_country_details.get(dominant, {}).get("details", [])))
                return {
                    "country": dominant,
                    "details": details[:5],
                    "source": "peeringdb-upstream",
                }

        # If no intersection, use highest-weighted upstream country
        if upstream_country_details:
            dominant = max(upstream_country_details, key=lambda c: upstream_country_details[c]["weight"])
            details = list(dict.fromkeys(upstream_country_details[dominant]["details"]))
            return {
                "country": dominant,
                "details": details[:5],
                "source": "peeringdb-upstream",
            }

    # Step 3: Fallback to geo_dominant
    if geo_dominant and geo_dominant != "BD":
        return {
            "country": geo_dominant,
            "details": [],
            "source": "fallback-geo",
        }

    return None


def fetch_peering_locations(offshore_asns, direct_peers_map, rate_limiter):
    """
    Fetch peering locations for offshore ASNs using PeeringDB batch queries.
    Uses 2-3 API calls total (not one per ASN), avoiding rate limits.
    Returns dict of ASN → peering location info.
    """
    if not offshore_asns:
        return {}

    print(f"\n[4c] Fetching PeeringDB peering locations for {len(offshore_asns)} offshore ASNs...")

    # Collect ALL ASNs we need: targets + their upstream peers
    all_needed_asns = set()
    for asn in offshore_asns:
        all_needed_asns.add(asn)
        for up_asn in direct_peers_map.get(asn, []):
            all_needed_asns.add(up_asn)

    print(f"      Querying PeeringDB for {len(all_needed_asns)} ASNs (targets + upstreams) in batch...")

    # Step 1: Batch fetch all network records (1-2 API calls)
    pdb_cache = peeringdb_batch_fetch_nets(list(all_needed_asns))

    # Step 2: Collect unique IX IDs from all fetched records, then batch-fetch IX info
    all_ix_ids = set()
    for net in pdb_cache.values():
        for ix_entry in net.get("netixlan_set", []):
            ix_id = ix_entry.get("ix_id")
            if ix_id:
                all_ix_ids.add(ix_id)

    ix_cache = {}
    if all_ix_ids:
        print(f"      Fetching country info for {len(all_ix_ids)} IXPs...")
        ix_cache = peeringdb_batch_fetch_ixs(list(all_ix_ids))

    # Step 3: Determine peering location for each offshore ASN
    results = {}
    for asn in offshore_asns:
        upstream = direct_peers_map.get(asn, [])
        geo_dominant = offshore_asns[asn] if isinstance(offshore_asns, dict) else None
        peering = determine_peering_location(asn, upstream, geo_dominant, pdb_cache, ix_cache)
        if peering:
            results[asn] = peering
            src = peering["source"]
            details_str = ", ".join(peering["details"][:2]) if peering["details"] else "no specific details"
            print(f"        AS{asn}: peers in {peering['country']} ({details_str}) [source: {src}]")
        else:
            print(f"        AS{asn}: no peering location found")

    return results


# ═══════════════════════════════════════════════════════════════════════════
# Build Visualization Data
# ═══════════════════════════════════════════════════════════════════════════

def classify_tentative_iig_type(asn, is_bd_registered, geo_country, btrc_licensed_asns,
                                iigs_with_domestic, direct_peers_map):
    """Classify a tentative gateway ASN into final node type."""
    if asn in btrc_licensed_asns:
        return "iig"
    if is_bd_registered and geo_country and geo_country != "BD":
        if asn in iigs_with_domestic:
            return "offshore-gateway"
        return "offshore-enterprise"
    if asn in iigs_with_domestic:
        return "detected-iig"
    if is_bd_registered and direct_peers_map.get(asn):
        return "detected-iig"
    return "local-company"


def build_viz_data(analysis, asn_info, country_asns, btrc_licensed_asns=None, peering_locations=None):
    """Build visualization data with license-aware 6-category classification."""
    if btrc_licensed_asns is None:
        btrc_licensed_asns = set()
    if peering_locations is None:
        peering_locations = {}
    
    print(f"\nBuilding visualization data (license-aware, 6-category)...")
    print(f"      Known IIG ASNs from BTRC list: {len(btrc_licensed_asns)}")
    
    # Top edges (international: 1500, domestic: 2000)
    top_intl_edges = analysis["edge_intl"].most_common(1500)
    top_domestic_edges = analysis["edge_domestic"].most_common(2000)
    
    # Pre-compute which tentative IIGs have domestic customers
    iigs_with_domestic = set()
    for (local_company, iig), count in top_domestic_edges:
        iigs_with_domestic.add(iig)

    # BD ASNs with direct international peers should remain visible as detected gateways.
    direct_peers_map = analysis.get("direct_peers_map", {})
    
    node_map = {}
    
    def ensure_node(asn, node_type):
        if asn not in node_map:
            info = asn_info.get(asn, {})
            geo_data = info.get("geo_country_data", {})
            geo_country = geo_data.get("dominant_country", "") if isinstance(geo_data, dict) else info.get("geo_country", "")
            geo_breakdown = geo_data.get("breakdown", []) if isinstance(geo_data, dict) else []
            is_bd_registered = asn in country_asns
            
            # Reclassify tentative IIGs based on license list + geolocation.
            if node_type == "iig":
                node_type = classify_tentative_iig_type(
                    asn, is_bd_registered, geo_country, btrc_licensed_asns,
                    iigs_with_domestic, direct_peers_map
                )
            
            # Get peering location data if available
            peering = peering_locations.get(asn, {})
            
            node_map[asn] = {
                "asn": asn,
                "type": node_type,
                "licensed": asn in btrc_licensed_asns,
                "name": info.get("name", f"AS{asn}"),
                "description": info.get("holder", info.get("name", "")),
                "country": info.get("country", "BD" if asn in country_asns else ""),
                "geo_country": geo_country,
                "geo_breakdown": geo_breakdown,
                "peering_country": peering.get("country", ""),
                "peering_details": peering.get("details", []),
                "peering_source": peering.get("source", ""),
                "announced": info.get("announced", False),
                "traffic": 0,
            }
    
    edges = []
    
    # International edges
    for (outside, iig), count in top_intl_edges:
        ensure_node(outside, "outside")
        ensure_node(iig, "iig")
        edges.append({"source": outside, "target": iig, "count": count, "type": "international"})
    
    # Domestic edges
    for (local_company, iig), count in top_domestic_edges:
        ensure_node(local_company, "local-company")
        ensure_node(iig, "iig")
        edges.append({"source": local_company, "target": iig, "count": count, "type": "domestic"})
    
    # Calculate traffic per node
    for edge in edges:
        if edge["source"] in node_map:
            node_map[edge["source"]]["traffic"] += edge["count"]
        if edge["target"] in node_map:
            node_map[edge["target"]]["traffic"] += edge["count"]
    
    # Calculate rankings per type
    total_intl_traffic = sum(c for (_, _), c in top_intl_edges) or 1
    
    for ntype in ["outside", "iig", "detected-iig", "offshore-enterprise", "offshore-gateway", "local-company"]:
        typed_nodes = sorted(
            [n for n in node_map.values() if n["type"] == ntype],
            key=lambda n: n["traffic"], reverse=True
        )
        for rank, n in enumerate(typed_nodes, 1):
            n["rank"] = rank
            n["percentage"] = (n["traffic"] / total_intl_traffic) * 100
    
    nodes = list(node_map.values())
    
    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "total_outside": len([n for n in nodes if n["type"] == "outside"]),
            "total_iig": len([n for n in nodes if n["type"] == "iig"]),
            "total_detected_iig": len([n for n in nodes if n["type"] == "detected-iig"]),
            "total_offshore_enterprise": len([n for n in nodes if n["type"] == "offshore-enterprise"]),
            "total_offshore_gateway": len([n for n in nodes if n["type"] == "offshore-gateway"]),
            "total_local_company": len([n for n in nodes if n["type"] == "local-company"]),
            "total_edges": len(edges),
            "total_intl_edges": len([e for e in edges if e["type"] == "international"]),
            "total_domestic_edges": len([e for e in edges if e["type"] == "domestic"]),
            "total_traffic": total_intl_traffic,
            "valid_observations": analysis["valid_obs"],
        },
    }


# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Update BGP data - fetch and process in one go")
    parser.add_argument("--country", default="BD", help="Country code (default: BD)")
    parser.add_argument("--reprocess", action="store_true", help="Skip BGP fetching, reprocess from cached raw routes")
    parser.add_argument("--use-mrt-fallback", action="store_true",
                        help="If RIPEstat bgp-state is down/empty, fetch AS paths from "
                             "RIPE RIS / RouteViews MRT dumps instead (slow; opt-in)")
    parser.add_argument("--mrt-collectors", default="",
                        help="Comma-separated collector IDs to restrict the MRT fallback to "
                             "(default: all fresh RIS collectors)")
    args = parser.parse_args()
    mrt_collectors = {c.strip() for c in args.mrt_collectors.split(",") if c.strip()} or None
    
    country = args.country.upper()
    
    # Setup paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    data_dir = os.path.join(project_dir, "data", country)
    os.makedirs(data_dir, exist_ok=True)
    
    out_raw = os.path.join(data_dir, "bgp_routes_raw.jsonl")  # JSONL format
    out_raw_legacy = os.path.join(data_dir, "bgp_routes_raw.json")  # Legacy JSON
    out_viz = os.path.join(data_dir, "viz_data.json")
    out_asn = os.path.join(data_dir, "asn_names.json")
    out_meta = os.path.join(data_dir, "metadata.json")
    
    print("═" * 70)
    print(f"BGP Data Update - {country}")
    print(f"  JSON engine: {JSON_ENGINE} | Concurrency: {CONCURRENCY}")
    print("═" * 70)
    
    # Load BTRC IIG license list
    license_file = os.path.join(project_dir, "data", "btrc_iig_licenses.json")
    btrc_licensed_asns = set()
    if os.path.exists(license_file):
        print(f"Loading BTRC IIG license list from {license_file}...")
        with open(license_file) as f:
            raw_licenses = json.load(f)
            btrc_licensed_asns = set(k for k in raw_licenses.keys() if not k.startswith("_"))
        print(f"      Loaded {len(btrc_licensed_asns)} licensed IIG ASNs")
    else:
        print(f"WARNING: BTRC license file not found at {license_file}")
        print(f"         All gateway ASNs will be classified as 'detected-iig'")
    
    # Load existing ASN names if available (for caching)
    existing_asn_names = {}
    if os.path.exists(out_asn):
        print(f"Loading existing ASN names from {out_asn}...")
        with open(out_asn) as f:
            existing_asn_names = json.load(f)
        print(f"      Loaded {len(existing_asn_names):,} cached ASN entries")
    
    # Initialize rate limiter (4 requests per second, matching website)
    rate_limiter = RateLimiter(requests_per_second=4)

    # Records the data source actually used (reflected in metadata.json).
    data_source = ("RIPEstat BGP State API", "https://stat.ripe.net/data/bgp-state/data.json")
    data_is_mrt = False        # True when AS paths came from the MRT fallback
    ripestat_healthy = True    # re-evaluated only when fetching live from RIPEstat
    control_obs = None         # control-probe observation count (when fetched)

    if args.reprocess:
        # Reprocess mode: stream from cached JSONL (or fallback to legacy JSON)
        print(f"\n[REPROCESS] Loading cached data (skipping BGP route fetching)...")
        
        # Still need country resources for classification
        country_asns, alloc_prefixes = get_country_resources(args.country, rate_limiter)
        
        if os.path.exists(out_raw):
            # Stream analysis from JSONL -- no need to load entire file into memory
            analysis = analyze_routes_streaming(out_raw, country_asns)
        elif os.path.exists(out_raw_legacy):
            # Fallback to legacy JSON array format
            print(f"Loading raw routes from legacy format: {out_raw_legacy}")
            with open(out_raw_legacy) as f:
                routes = json.load(f)
            print(f"      Loaded {len(routes):,} routes")
            analysis = analyze_routes(routes, country_asns)
            del routes  # Free memory
        else:
            print(f"ERROR: No cached raw routes found at {out_raw} or {out_raw_legacy}")
            print(f"       Run without --reprocess first to fetch data.")
            sys.exit(1)
    else:
        # Step 1: Get country resources (allocation blocks + ASN list)
        country_asns, alloc_prefixes = get_country_resources(args.country, rate_limiter)
        
        # Step 1b: Fetch actually-announced prefixes for ALL country ASNs
        # This catches more-specific subnets (e.g. /24 from /23 allocation)
        announced = fetch_announced_prefixes(country_asns, rate_limiter)
        
        # Merge allocation prefixes + announced prefixes for complete coverage
        all_prefixes = set(alloc_prefixes) | announced
        added = len(all_prefixes) - len(alloc_prefixes)
        print(f"\n      Merged prefix list: {len(all_prefixes)} total ({len(alloc_prefixes)} allocations + {added} additional announced)")
        
        if args.use_mrt_fallback:
            # Opt-in manual recovery run: the operator explicitly wants AS paths
            # from MRT dumps (used when RIPEstat is down). Records are the same
            # shape, so everything downstream is unchanged.
            print(f"\n      --use-mrt-fallback set -> using MRT data source.")
            routes = fetch_bgp_routes_mrt(list(all_prefixes), country_asns,
                                          rate_limiter=rate_limiter,
                                          collectors=mrt_collectors)
            data_source = ("RIPE RIS / RouteViews MRT via BGPKIT (fallback)",
                           "https://bgpkit.com")
            data_is_mrt = True
        else:
            # Step 2a: Probe upstream health with stable control prefixes. This
            # tells a real BD route change (control healthy, BD sparse) apart
            # from a RIPEstat outage (control also dead).
            control_obs = probe_bgp_state_health(rate_limiter)
            ripestat_healthy = control_obs >= CONTROL_MIN_OBSERVATIONS
            print(f"\n      RIPEstat bgp-state health probe: {control_obs} control "
                  f"observations -> {'HEALTHY' if ripestat_healthy else 'UNHEALTHY (likely upstream outage)'}")

            # Step 2b: Fetch BGP routes in parallel from RIPEstat bgp-state.
            routes = fetch_bgp_routes(list(all_prefixes), rate_limiter)
        
        # Deduplicate routes by (target_prefix, cleaned_path) before saving
        print(f"\nDeduplicating {len(routes):,} routes by (prefix, path)...")
        dedup_map = {}  # (target_prefix, path_tuple) → route
        dedup_counts = {}  # Same key → observation count
        for rt in routes:
            target = rt.get("target_prefix", "")
            path_raw = rt.get("path") or []
            # Clean path for dedup key
            path = []
            for x in path_raw:
                s = str(x).strip()
                if s.isdigit() and (not path or path[-1] != s):
                    path.append(s)
            key = (target, tuple(path))
            if key in dedup_map:
                dedup_counts[key] += 1
            else:
                dedup_map[key] = rt
                dedup_counts[key] = 1
        
        deduped_routes = []
        for key, rt in dedup_map.items():
            rt["_count"] = dedup_counts[key]
            deduped_routes.append(rt)
        
        saved = len(routes) - len(deduped_routes)
        print(f"      {len(routes):,} → {len(deduped_routes):,} unique routes ({saved:,} duplicates removed, {saved * 100 // max(len(routes), 1)}% reduction)")
        
        # Save raw routes as JSONL (one JSON object per line) for streaming read/write
        print(f"\nSaving raw routes as JSONL to: {out_raw}")
        save_start = time.time()
        with open(out_raw, "wb") as f:
            for rt in deduped_routes:
                f.write(fast_json_dumps(rt))
                f.write(b"\n")
        file_size_mb = os.path.getsize(out_raw) / (1024 * 1024)
        save_elapsed = time.time() - save_start
        print(f"      File size: {file_size_mb:.1f} MB (saved in {save_elapsed:.1f}s via {JSON_ENGINE})")
        
        # Remove legacy JSON file if it exists to avoid confusion
        if os.path.exists(out_raw_legacy):
            os.remove(out_raw_legacy)
            print(f"      Removed legacy {out_raw_legacy}")
        
        # Step 3: Analyze routes from the in-memory list
        analysis = analyze_routes(deduped_routes, country_asns)
        del routes, deduped_routes, dedup_map, dedup_counts  # Free memory
    
    # Safety guard: only block when OUR upstream is the problem — never when BD
    # routing genuinely changed. We intentionally commit a real, large drop in BD
    # routes (e.g. a national connectivity shutdown), because the control probe
    # confirms RIPEstat is healthy. Raising here fails the run (exit 1) before any
    # output file is written, so the previous viz_data.json is preserved.
    if not args.reprocess:
        if not data_is_mrt and not ripestat_healthy:
            # RIPEstat unhealthy and no MRT fallback data -> cannot trust results.
            raise RuntimeError(
                f"RIPEstat bgp-state control probe returned only {control_obs} "
                f"observations (< {CONTROL_MIN_OBSERVATIONS}); upstream looks down, "
                f"refusing to overwrite committed data. Re-run with "
                f"--use-mrt-fallback to fetch AS paths from MRT dumps instead."
            )
        if data_is_mrt and analysis["valid_obs"] == 0:
            # MRT fallback produced nothing -> treat as fallback failure, not a
            # real signal, and preserve existing data.
            raise RuntimeError(
                "MRT fallback produced zero valid observations; refusing to "
                "overwrite committed data (treating as a fallback failure)."
            )

    # Step 4: Fetch ASN info for all needed ASNs
    all_asns = set(analysis["outside_counts"].keys()) | set(analysis["iig_counts"].keys()) | set(analysis["local_isp_counts"].keys())
    all_asns |= set(existing_asn_names.keys())  # Keep existing ASN data
    asn_info = fetch_asn_info(list(all_asns), country_asns, rate_limiter, existing_asn_names)
    
    # Step 4b: Fetch geolocation for BD-registered tentative IIGs (offshore peer detection)
    # Only query geolocation for BD ASNs that appear as tentative gateways and are Not in my datasets BTRC list
    tentative_iig_asns = set()
    for (outside, iig), count in analysis["edge_intl"].most_common(1000):
        if iig in country_asns and iig not in btrc_licensed_asns:
            tentative_iig_asns.add(iig)
    
    offshore_asns_geo = {}  # ASN → geo dominant country (for offshore ASNs only)
    if tentative_iig_asns:
        geo_results = fetch_geo_countries(list(tentative_iig_asns), rate_limiter)
        for asn, geo_data in geo_results.items():
            if asn in asn_info:
                asn_info[asn]["geo_country"] = geo_data["dominant_country"]
                asn_info[asn]["geo_country_data"] = geo_data
            else:
                asn_info[asn] = {
                    "asn": asn, "name": f"AS{asn}", "holder": "",
                    "announced": False, "country": "BD",
                    "geo_country": geo_data["dominant_country"],
                    "geo_country_data": geo_data,
                }
            if geo_data["dominant_country"] != "BD":
                offshore_asns_geo[asn] = geo_data["dominant_country"]
    
    # Step 4c: Fetch PeeringDB peering locations for offshore ASNs
    direct_peers_map = analysis.get("direct_peers_map", {})
    peering_locations = {}
    if offshore_asns_geo:
        peering_locations = fetch_peering_locations(
            offshore_asns_geo, direct_peers_map, rate_limiter
        )
    
    # Build visualization data (license-aware, 6-category)
    viz_data = build_viz_data(analysis, asn_info, country_asns, btrc_licensed_asns, peering_locations)
    
    # Save all outputs (use indent=2 for human-readable viz/meta/asn files)
    print(f"\nSaving visualization data to: {out_viz}")
    with open(out_viz, "w") as f:
        json.dump(viz_data, f, indent=2)
    
    print(f"Saving ASN names to: {out_asn}")
    with open(out_asn, "w") as f:
        json.dump(asn_info, f, indent=2)
    
    print(f"Saving metadata to: {out_meta}")
    metadata = {
        "country": country,
        "country_name": "Bangladesh" if country == "BD" else country,
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "schema_version": 3,
        "model": "license-aware",
        "raw_format": "jsonl",
        "json_engine": JSON_ENGINE,
        "stats": viz_data["stats"],
        "source": data_source[0],
        "source_url": data_source[1],
    }
    with open(out_meta, "w") as f:
        json.dump(metadata, f, indent=2)

    # Archive this run into the 7-day rolling history and refresh the manifest
    # that powers the UI time-slider. Reached only after the upstream safety
    # guard passed, so we never archive degraded/garbage data.
    print(f"\nUpdating {RETENTION_DAYS}-day history...")
    update_history(country, viz_data, metadata)

    # Print summary
    print("\n" + "═" * 70)
    print("CLASSIFICATION SUMMARY (6-Category Model)")
    print("═" * 70)
    print(f"Outside ASNs (International):    {viz_data['stats']['total_outside']}")
    print(f"Known IIGs (BTRC Licensed):      {viz_data['stats']['total_iig']}")
    print(f"Detected Gateways:               {viz_data['stats']['total_detected_iig']}")
    print(f"Offshore Enterprises (harmless): {viz_data['stats']['total_offshore_enterprise']}")
    print(f"Offshore Gateways (rogue):       {viz_data['stats']['total_offshore_gateway']}")
    print(f"Local Companies (Origins):       {viz_data['stats']['total_local_company']}")
    print(f"International edges:             {viz_data['stats']['total_intl_edges']}")
    print(f"Domestic edges:                  {viz_data['stats']['total_domestic_edges']}")
    print(f"Total edges:                     {viz_data['stats']['total_edges']}")
    print(f"Valid observations:              {viz_data['stats']['valid_observations']:,}")
    
    print(f"\nTop 5 Known IIGs:")
    iigs = sorted([n for n in viz_data["nodes"] if n["type"] == "iig"], key=lambda n: n["traffic"], reverse=True)
    for n in iigs[:5]:
        print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes ({n['percentage']:.1f}%)")
    
    detected = sorted([n for n in viz_data["nodes"] if n["type"] == "detected-iig"], key=lambda n: n["traffic"], reverse=True)
    if detected:
        print(f"\nDetected Gateways (Not in my datasets BTRC list):")
        for n in detected[:10]:
            print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes")
    
    offshore_ent = [n for n in viz_data["nodes"] if n["type"] == "offshore-enterprise"]
    if offshore_ent:
        print(f"\nOffshore Enterprises (BD-registered, abroad, no transit):")
        for n in offshore_ent:
            peering_info = f", peering: {n.get('peering_country', '?')}" if n.get('peering_country') else ""
            geo_details = ""
            if n.get("geo_breakdown"):
                geo_details = " [" + ", ".join(f"{b['country']}({b['percentage']:.0f}%)" for b in n["geo_breakdown"]) + "]"
            print(f"  AS{n['asn']} {n['name']} (registered: {n['country']}, geo: {n.get('geo_country', '?')}{peering_info}){geo_details}")
    
    offshore_gw = [n for n in viz_data["nodes"] if n["type"] == "offshore-gateway"]
    if offshore_gw:
        print(f"\nOffshore Gateways (BD-registered, abroad, selling transit):")
        for n in offshore_gw:
            peering_info = f", peering: {n.get('peering_country', '?')}" if n.get('peering_country') else ""
            geo_details = ""
            if n.get("geo_breakdown"):
                geo_details = " [" + ", ".join(f"{b['country']}({b['percentage']:.0f}%)" for b in n["geo_breakdown"]) + "]"
            print(f"  AS{n['asn']} {n['name']} (registered: {n['country']}, geo: {n.get('geo_country', '?')}{peering_info}){geo_details}")
    
    print(f"\nTop 5 Local Companies:")
    companies = sorted([n for n in viz_data["nodes"] if n["type"] == "local-company"], key=lambda n: n["traffic"], reverse=True)
    for n in companies[:5]:
        print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes")
    
    print(f"\n{'═' * 70}")
    print("✓ Data update complete!")
    print(f"{'═' * 70}")
    print("\nNext steps:")
    print("  1. Review the data in data/BD/")
    print("  2. Test the visualization by opening index.html")
    print("  3. Commit changes: git add data/ && git commit -m 'Update BGP data'")
    print("  4. Push to GitHub: git push")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nAborted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
