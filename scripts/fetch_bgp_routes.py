#!/usr/bin/env python3
"""
Fetch raw BGP routes from RIPEstat for Bangladesh.
Saves to data/BD/bgp_routes_raw.json for later processing.

Usage:
    python3 scripts/fetch_bgp_routes.py
    python3 scripts/fetch_bgp_routes.py --country BD --output data/BD/bgp_routes_raw.json
"""

import json
import sys
import os
import time
import argparse
import requests
from datetime import datetime

BASE = "https://stat.ripe.net/data"
UA = {"User-Agent": "bgp-bangladesh-viz/1.0 (https://github.com/bgp-bangladesh)"}


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


def get_country_resources(country_code):
    """Fetch ASNs and prefixes for a country from RIPEstat."""
    print(f"Fetching country resources for {country_code.upper()}...")
    
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
        
        print(f"  Found {len(asns)} ASNs and {len(prefixes)} prefixes")
        return asns, prefixes
        
    except Exception as e:
        print(f"ERROR: Failed to fetch country resources: {e}")
        sys.exit(1)


def fetch_bgp_routes(prefixes):
    """Fetch BGP routes for all prefixes from RIPEstat."""
    batches = chunk_prefixes(prefixes)
    total_batches = len(batches)
    all_routes = []
    
    print(f"\nFetching BGP routes in {total_batches} batches...")
    print("This will take 5-15 minutes depending on API speed.")
    print("Press Ctrl+C to abort.\n")
    
    start_time = time.time()
    failed = 0
    
    for i, batch in enumerate(batches, 1):
        if i % 5 == 0 or i == 1:
            elapsed = time.time() - start_time
            avg_per_batch = elapsed / i if i > 0 else 0
            remaining = (total_batches - i) * avg_per_batch
            print(f"Batch {i}/{total_batches} ({len(all_routes)} routes so far, ETA: {remaining/60:.1f} min)...")
        
        params = {"resource": ",".join(batch)}
        url = f"{BASE}/bgp-state/data.json"
        
        try:
            r = requests.get(url, params=params, headers=UA, timeout=120)
            r.raise_for_status()
            data = r.json()
            
            routes = data.get("data", {}).get("bgp_state", [])
            all_routes.extend(routes)
            
            # Be nice to the API
            time.sleep(0.1)
            
        except requests.RequestException as e:
            print(f"  WARNING: Batch {i} failed: {e}")
            failed += 1
            if failed > 10:
                print("ERROR: Too many failures, aborting.")
                sys.exit(1)
            time.sleep(1)  # Back off on failure
    
    elapsed = time.time() - start_time
    print(f"\nFetch complete! {len(all_routes)} routes in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    if failed > 0:
        print(f"  ({failed} batches failed)")
    
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
    
    # Fetch data
    country_asns, prefixes = get_country_resources(args.country)
    routes = fetch_bgp_routes(prefixes)
    
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
