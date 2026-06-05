#!/usr/bin/env python3
"""
Fetch raw BGP routes from RIPEstat for Bangladesh.
Saves to data/BD/bgp_routes_raw.json for later processing.

NOTE: This is a legacy script. For a unified all-in-one updater, use:
    python3 scripts/update_bgp_data.py

Usage:
    python3 scripts/fetch_bgp_routes.py
    python3 scripts/fetch_bgp_routes.py --country BD --output data/BD/bgp_routes_raw.json
"""

import json
import sys
import os
import time
import ipaddress
import argparse
import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://stat.ripe.net/data"
UA = {"User-Agent": "bgp-bangladesh-viz/1.0 (https://github.com/bgp-bangladesh)"}

# Transient HTTP status codes worth retrying (rate limiting + upstream errors).
TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}

# Delegated RIR statistics — fallback for RIPEstat country-resource-list.
# RIPEstat derives that endpoint from these files. APNIC is the RIR for BD.
# NOTE: This is the fetch-only legacy script; the MRT bgp-state fallback lives in
# scripts/update_bgp_data.py.
RIR_STATS_URLS = [
    "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest",
]

# Rate limiter (token bucket) matching the website's implementation
class RateLimiter:
    def __init__(self, requests_per_second=4):
        self.tokens = requests_per_second
        self.max_tokens = requests_per_second
        self.refill_rate = requests_per_second
        self.last_refill = time.time()
    
    def acquire(self):
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


def get_with_retries(url, *, params=None, headers=None, timeout=60, attempts=4,
                     rate_limiter=None):
    """GET with retry/backoff on transient HTTP codes and network errors.

    Honors Retry-After on 429/5xx. Optionally gated by a RateLimiter.
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
                    print(f"  Transient HTTP {response.status_code}; retrying in {wait_seconds}s...")
                    time.sleep(wait_seconds)
                    continue

            response.raise_for_status()
            return response

        except requests.RequestException as exc:
            last_error = exc
            if attempt < attempts - 1:
                wait_seconds = min(30, 2 ** attempt)
                print(f"  Request failed: {type(exc).__name__}; retrying in {wait_seconds}s...")
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
    """
    cc = country_code.upper()
    asns = set()
    prefixes = set()

    print(f"  Falling back to delegated RIR stats for {cc}...")
    for url in RIR_STATS_URLS:
        print(f"  Loading {url}")
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

    print(f"  RIR fallback found {len(asns)} ASNs and {len(prefixes)} prefixes")
    return asns, sorted(prefixes)


def _country_resources_cache_path(country_code):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    return os.path.join(project_dir, "data", country_code.upper(), "country_resources.json")


def _save_country_resources_cache(country_code, asns, prefixes):
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
    print(f"  Cached country resources to {path}")


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
    print(f"  Loaded {len(asns)} ASNs and {len(prefixes)} prefixes from cache {path}")
    return asns, prefixes


def get_country_resources(country_code, rate_limiter=None):
    """Fetch ASNs and prefixes for a country, resilient to RIPEstat outages.

    Order: RIPEstat country-resource-list -> APNIC delegated RIR stats -> cache.
    """
    print(f"Fetching country resources for {country_code.upper()}...")

    # Primary: RIPEstat
    try:
        r = get_with_retries(
            f"{BASE}/country-resource-list/data.json",
            params={"resource": country_code.lower(), "v4_format": "prefix"},
            headers=UA, timeout=60, attempts=4, rate_limiter=rate_limiter,
        )
        data = r.json()["data"]["resources"]
        asns = set(str(a) for a in data.get("asn", []))
        prefixes = data.get("ipv4", []) + data.get("ipv6", [])
        if asns and prefixes:
            print(f"  Found {len(asns)} ASNs and {len(prefixes)} prefixes")
            _save_country_resources_cache(country_code, asns, prefixes)
            return asns, prefixes
        print("  RIPEstat returned empty country resources; trying RIR fallback...")
    except Exception as e:
        print(f"  RIPEstat country-resource-list failed: {e}")

    # Fallback: delegated RIR stats (APNIC for BD)
    try:
        asns, prefixes = get_country_resources_from_rir_stats(country_code, rate_limiter=rate_limiter)
        _save_country_resources_cache(country_code, asns, prefixes)
        return asns, prefixes
    except Exception as e:
        print(f"  Delegated RIR stats fallback failed: {e}")

    # Last resort: committed cache
    cached = _load_country_resources_cache(country_code)
    if cached:
        print("  Using committed country_resources.json cache.")
        return cached

    print("ERROR: Failed to fetch country resources from all sources (RIPEstat, RIR stats, cache).")
    sys.exit(1)


def fetch_bgp_routes(prefixes, rate_limiter):
    """Fetch BGP routes for all prefixes from RIPEstat in parallel (matching website behavior)."""
    batches = chunk_prefixes(prefixes)
    total_batches = len(batches)
    all_routes = []
    
    print(f"\nFetching BGP routes in {total_batches} batches (5 parallel)...")
    print("This will take 5-15 minutes depending on API speed.")
    print("Press Ctrl+C to abort.\n")
    
    start_time = time.time()
    completed = 0
    failed = 0
    concurrency = 5  # Match website: fetch 5 batches in parallel
    
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
                        print(f"  Batch {batch_idx}: Rate limited, waiting {retry_after}s (attempt {attempt + 1}/{max_retries})...")
                        time.sleep(retry_after)
                        continue
                
                r.raise_for_status()
                data = r.json()
                routes = data.get("data", {}).get("bgp_state", [])
                
                # Success - log if this was after retries
                if attempt > 0:
                    print(f"  Batch {batch_idx}: Success after {attempt + 1} attempts")
                
                return {"success": True, "routes": routes, "batch_idx": batch_idx}
                
            except requests.RequestException as e:
                if attempt < max_retries:
                    # Exponential backoff: 2s, 4s, 8s
                    wait_time = 2 ** attempt
                    print(f"  Batch {batch_idx}: {type(e).__name__} - retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})...")
                    time.sleep(wait_time)
                else:
                    print(f"  WARNING: Batch {batch_idx} failed after {max_retries + 1} attempts: {e}")
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
                    print(f"Progress: {completed}/{total_batches} batches ({len(all_routes):,} routes, ETA: {remaining/60:.1f} min)...")
    
    elapsed = time.time() - start_time
    print(f"\nFetch complete! {len(all_routes)} routes in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    if failed > 0:
        print(f"  WARNING: {failed} batches failed even after retries")
    
    return all_routes


def main():
    parser = argparse.ArgumentParser(description="Fetch raw BGP routes from RIPEstat")
    parser.add_argument("--country", default="BD", help="Country code (default: BD)")
    parser.add_argument("--output", help="Output file (default: data/{country}/bgp_routes_raw.json)")
    args = parser.parse_args()
    
    # Determine output path
    if args.output:
        output_file = args.output
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_dir = os.path.dirname(script_dir)
        output_file = os.path.join(project_dir, "data", args.country.upper(), "bgp_routes_raw.json")
    
    # Create output directory if needed
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    
    # Initialize rate limiter (4 requests per second, matching website)
    rate_limiter = RateLimiter(requests_per_second=4)
    
    # Fetch data
    country_asns, prefixes = get_country_resources(args.country, rate_limiter)
    routes = fetch_bgp_routes(prefixes, rate_limiter)
    
    # Save to file
    print(f"\nSaving {len(routes)} routes to: {output_file}")
    with open(output_file, "w") as f:
        json.dump(routes, f)
    
    file_size_mb = os.path.getsize(output_file) / (1024 * 1024)
    print(f"  File size: {file_size_mb:.1f} MB")
    print(f"  Timestamp: {datetime.now().isoformat()}")
    print("\nDone! Now run: python3 scripts/reprocess_3layer.py")


if __name__ == "__main__":
    main()
