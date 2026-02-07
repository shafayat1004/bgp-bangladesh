#!/usr/bin/env python3
"""
Update BGP data for Bangladesh - All-in-one script.
Fetches live BGP routes from RIPEstat and processes them into visualization data.

This script combines the functionality of:
- fetch_bgp_routes.py (fetches raw BGP routes in parallel)
- reprocess_3layer.py (processes routes into 3-layer model)

Usage:
    python3 scripts/update_bgp_data.py
    python3 scripts/update_bgp_data.py --country BD
"""

import json
import collections
import sys
import os
import time
import argparse
import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://stat.ripe.net/data"
UA = {"User-Agent": "bgp-bangladesh-viz/1.0 (https://github.com/bgp-bangladesh)"}


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
# Step 1: Fetch Country Resources
# ═══════════════════════════════════════════════════════════════════════════

def get_country_resources(country_code):
    """Fetch ASNs and prefixes for a country from RIPEstat."""
    print(f"[1/4] Fetching country resources for {country_code.upper()}...")
    
    try:
        r = requests.get(
            f"{BASE}/country-resource-list/data.json",
            params={"resource": country_code.lower(), "v4_format": "prefix"},
            headers=UA,
            timeout=60
        )
        r.raise_for_status()
        data = r.json()["data"]["resources"]
        
        asns = set(str(a) for a in data.get("asn", []))
        prefixes = data.get("ipv4", []) + data.get("ipv6", [])
        
        print(f"      Found {len(asns)} ASNs and {len(prefixes)} prefixes")
        return asns, prefixes
        
    except Exception as e:
        print(f"ERROR: Failed to fetch country resources: {e}")
        sys.exit(1)


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
    """Fetch BGP routes for all prefixes from RIPEstat in parallel (matching website behavior)."""
    batches = chunk_prefixes(prefixes)
    total_batches = len(batches)
    all_routes = []
    
    print(f"\n[2/4] Fetching BGP routes in {total_batches} batches (5 parallel)...")
    print("      This will take 5-15 minutes depending on API speed.")
    print("      Press Ctrl+C to abort.\n")
    
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
                        print(f"      Batch {batch_idx}: Rate limited, waiting {retry_after}s (attempt {attempt + 1}/{max_retries})...")
                        time.sleep(retry_after)
                        continue
                
                r.raise_for_status()
                data = r.json()
                routes = data.get("data", {}).get("bgp_state", [])
                
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
# Step 3: Process Routes into 3-Layer Model
# ═══════════════════════════════════════════════════════════════════════════

def analyze_routes_3layer(routes, country_asns):
    """
    Analyze BGP routes to find border crossings and domestic peering.
    Extracts the 3-layer model: Local ISP → IIG → Outside ASN.
    """
    print(f"\n[3/4] Analyzing routes for 3-layer model...")
    
    seen = set()
    outside_counts = collections.Counter()
    iig_counts = collections.Counter()
    local_isp_counts = collections.Counter()
    edge_intl = collections.Counter()      # "outside|iig" → count
    edge_domestic = collections.Counter()  # "local-isp|iig" → count
    valid_obs = 0
    
    for idx, rt in enumerate(routes):
        if idx % 50000 == 0 and idx > 0:
            print(f"      Processing route {idx:,}/{len(routes):,}...")
        
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
            continue
        
        key = (target, source_id)
        if key in seen:
            continue
        seen.add(key)
        valid_obs += 1
        
        # Walk backwards from origin
        i = len(path) - 1
        while i >= 0 and path[i] in country_asns:
            i -= 1
        
        outside = path[i] if i >= 0 else None
        iig = path[i + 1] if (i + 1) < len(path) else None
        origin = path[-1]
        
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
    
    print(f"      Valid observations: {valid_obs:,}")
    print(f"      Outside ASNs: {len(outside_counts)}")
    print(f"      IIG ASNs: {len(iig_counts)}")
    print(f"      Local ISP ASNs: {len(local_isp_counts)}")
    print(f"      International edges: {len(edge_intl)}")
    print(f"      Domestic edges: {len(edge_domestic)}")
    
    return {
        "outside_counts": outside_counts,
        "iig_counts": iig_counts,
        "local_isp_counts": local_isp_counts,
        "edge_intl": edge_intl,
        "edge_domestic": edge_domestic,
        "valid_obs": valid_obs,
    }


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
    
    print(f"\n[4/4] Fetching ASN info for {len(need_fetch):,} ASNs (20 parallel)...")
    
    results = dict(existing_asn_names)  # Start with existing data
    completed = 0
    failed = 0
    concurrency = 20  # Match website
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
# Build Visualization Data
# ═══════════════════════════════════════════════════════════════════════════

def build_viz_data(analysis, asn_info, country_asns, btrc_licensed_asns=None):
    """Build visualization data with license-aware classification."""
    if btrc_licensed_asns is None:
        btrc_licensed_asns = set()
    
    print(f"\nBuilding visualization data (license-aware)...")
    print(f"      Known IIG ASNs from BTRC list: {len(btrc_licensed_asns)}")
    
    # Top edges (matching website: increased from 300 to 1000)
    top_intl_edges = analysis["edge_intl"].most_common(1000)
    top_domestic_edges = analysis["edge_domestic"].most_common(1000)
    
    # Pre-compute which tentative IIGs have domestic customers
    iigs_with_domestic = set()
    for (local_isp, iig), count in top_domestic_edges:
        iigs_with_domestic.add(iig)
    
    node_map = {}
    
    def ensure_node(asn, node_type):
        if asn not in node_map:
            info = asn_info.get(asn, {})
            detected_country = info.get("country", "")
            is_bd_registered = asn in country_asns
            
            # Reclassify tentative IIGs based on license list
            if node_type == "iig":
                if asn in btrc_licensed_asns:
                    node_type = "iig"  # Confirmed: in BTRC license list
                elif is_bd_registered and detected_country and detected_country != "BD":
                    node_type = "offshore-peer"  # BD-registered but located abroad
                elif asn in iigs_with_domestic:
                    node_type = "detected-iig"  # Acting as gateway, not in known IIG list
                else:
                    node_type = "local-isp"  # No domestic customers, demote
            
            node_map[asn] = {
                "asn": asn,
                "type": node_type,
                "licensed": asn in btrc_licensed_asns,
                "name": info.get("name", f"AS{asn}"),
                "description": info.get("holder", info.get("name", "")),
                "country": info.get("country", "BD" if asn in country_asns else ""),
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
    for (local_isp, iig), count in top_domestic_edges:
        ensure_node(local_isp, "local-isp")
        ensure_node(iig, "iig")
        edges.append({"source": local_isp, "target": iig, "count": count, "type": "domestic"})
    
    # Calculate traffic per node
    for edge in edges:
        if edge["source"] in node_map:
            node_map[edge["source"]]["traffic"] += edge["count"]
        if edge["target"] in node_map:
            node_map[edge["target"]]["traffic"] += edge["count"]
    
    # Calculate rankings per type
    total_intl_traffic = sum(c for (_, _), c in top_intl_edges) or 1
    
    for ntype in ["outside", "iig", "detected-iig", "offshore-peer", "local-isp"]:
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
            "total_offshore_peer": len([n for n in nodes if n["type"] == "offshore-peer"]),
            "total_local_isp": len([n for n in nodes if n["type"] == "local-isp"]),
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
    args = parser.parse_args()
    
    country = args.country.upper()
    
    # Setup paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    data_dir = os.path.join(project_dir, "data", country)
    os.makedirs(data_dir, exist_ok=True)
    
    out_raw = os.path.join(data_dir, "bgp_routes_raw.json")
    out_viz = os.path.join(data_dir, "viz_data.json")
    out_asn = os.path.join(data_dir, "asn_names.json")
    out_meta = os.path.join(data_dir, "metadata.json")
    
    print("═" * 70)
    print(f"BGP Data Update - {country}")
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
    
    # Step 1: Get country resources
    country_asns, prefixes = get_country_resources(args.country)
    
    # Step 2: Fetch BGP routes in parallel
    routes = fetch_bgp_routes(prefixes, rate_limiter)
    
    # Save raw routes
    print(f"\nSaving raw routes to: {out_raw}")
    with open(out_raw, "w") as f:
        json.dump(routes, f)
    file_size_mb = os.path.getsize(out_raw) / (1024 * 1024)
    print(f"      File size: {file_size_mb:.1f} MB")
    
    # Step 3: Analyze routes
    analysis = analyze_routes_3layer(routes, country_asns)
    
    # Step 4: Fetch ASN info for all needed ASNs
    all_asns = set(analysis["outside_counts"].keys()) | set(analysis["iig_counts"].keys()) | set(analysis["local_isp_counts"].keys())
    all_asns |= set(existing_asn_names.keys())  # Keep existing ASN data
    asn_info = fetch_asn_info(list(all_asns), country_asns, rate_limiter, existing_asn_names)
    
    # Build visualization data (license-aware)
    viz_data = build_viz_data(analysis, asn_info, country_asns, btrc_licensed_asns)
    
    # Save all outputs
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
        "schema_version": 2,
        "model": "3-layer",
        "stats": viz_data["stats"],
        "source": "RIPEstat BGP State API",
        "source_url": "https://stat.ripe.net/data/bgp-state/data.json",
    }
    with open(out_meta, "w") as f:
        json.dump(metadata, f, indent=2)
    
    # Print summary
    print("\n" + "═" * 70)
    print("CLASSIFICATION SUMMARY")
    print("═" * 70)
    print(f"Outside ASNs (International):  {viz_data['stats']['total_outside']}")
    print(f"Known IIGs (BTRC Licensed):    {viz_data['stats']['total_iig']}")
    print(f"Detected Gateways:             {viz_data['stats']['total_detected_iig']}")
    print(f"BD Offshore Peers:             {viz_data['stats']['total_offshore_peer']}")
    print(f"Local ISP ASNs (Origins):      {viz_data['stats']['total_local_isp']}")
    print(f"International edges:           {viz_data['stats']['total_intl_edges']}")
    print(f"Domestic edges:                {viz_data['stats']['total_domestic_edges']}")
    print(f"Total edges:                   {viz_data['stats']['total_edges']}")
    print(f"Valid observations:            {viz_data['stats']['valid_observations']:,}")
    
    print(f"\nTop 5 Known IIGs:")
    iigs = sorted([n for n in viz_data["nodes"] if n["type"] == "iig"], key=lambda n: n["traffic"], reverse=True)
    for n in iigs[:5]:
        print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes ({n['percentage']:.1f}%)")
    
    detected = sorted([n for n in viz_data["nodes"] if n["type"] == "detected-iig"], key=lambda n: n["traffic"], reverse=True)
    if detected:
        print(f"\nDetected Gateways (not in BTRC list):")
        for n in detected[:10]:
            print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes")
    
    offshore = [n for n in viz_data["nodes"] if n["type"] == "offshore-peer"]
    if offshore:
        print(f"\nBD Offshore Peers:")
        for n in offshore:
            print(f"  AS{n['asn']} {n['name']} ({n['country']})")
    
    print(f"\nTop 5 Local ISPs:")
    isps = sorted([n for n in viz_data["nodes"] if n["type"] == "local-isp"], key=lambda n: n["traffic"], reverse=True)
    for n in isps[:5]:
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
