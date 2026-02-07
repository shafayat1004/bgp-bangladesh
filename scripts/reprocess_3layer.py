#!/usr/bin/env python3
"""
Reprocess raw BGP data into license-aware classification model:
  Local Companys (origin ASNs within the country)
  IIGs (BTRC-licensed border gateway ASNs)
  Detected Gateways (acting as gateway but not in known license list)
  Offshore Enterprises (BD-registered ASNs with infrastructure abroad)
  Outside ASNs (international feeders)

Also fetches country info for all ASNs from RIPEstat.

NOTE: This is a legacy script. For a unified all-in-one updater, use:
    python3 scripts/update_bgp_data.py

This script requires bgp_routes_raw.json to already exist.
"""

import json
import collections
import sys
import os
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://stat.ripe.net/data"
UA = {"User-Agent": "bgp-bangladesh-viz/1.0"}

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

# ─────────────────────────────────────────────
# Step 1: Load raw data
# ─────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "BD")

print("Loading raw BGP routes...")
with open(os.path.join(DATA_DIR, "bgp_routes_raw.json")) as f:
    routes = json.load(f)
print(f"  Loaded {len(routes)} routes")

print("Loading existing ASN names...")
with open(os.path.join(DATA_DIR, "asn_names.json")) as f:
    asn_names = json.load(f)
print(f"  Loaded {len(asn_names)} ASN entries")

# ─────────────────────────────────────────────
# Step 2: Get BD ASNs from RIPEstat
# ─────────────────────────────────────────────

print("Fetching BD country resources from RIPEstat...")
try:
    r = requests.get(f"{BASE}/country-resource-list/data.json",
                     params={"resource": "bd", "v4_format": "prefix"},
                     headers=UA, timeout=60)
    r.raise_for_status()
    resources = r.json()["data"]["resources"]
    country_asns = set(str(a) for a in resources.get("asn", []))
    print(f"  Found {len(country_asns)} BD ASNs")
except Exception as e:
    print(f"  Failed to fetch: {e}, using fallback from existing data")
    # Fallback: all 'inside' nodes from existing viz_data
    with open(os.path.join(DATA_DIR, "viz_data.json")) as f:
        old_data = json.load(f)
    country_asns = set(n["asn"] for n in old_data["nodes"] if n["type"] == "inside")
    print(f"  Using {len(country_asns)} BD ASNs from existing data")

# ─────────────────────────────────────────────
# Step 3: Analyze routes for gateway structure
# ─────────────────────────────────────────────

print("Analyzing routes for gateway structure...")
seen = set()
outside_counts = collections.Counter()
iig_counts = collections.Counter()     # Border gateway ASN (first inside after border)
local_isp_counts = collections.Counter()  # Origin ASN (last in path)
edge_intl = collections.Counter()      # outside → iig edges
edge_domestic = collections.Counter()  # local_isp → iig edges
valid_obs = 0

for idx, rt in enumerate(routes):
    if idx % 50000 == 0:
        print(f"  Processing route {idx}/{len(routes)}...")

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

    # Walk backwards from the origin
    i = len(path) - 1

    # Skip ASNs belonging to the country
    while i >= 0 and path[i] in country_asns:
        i -= 1

    # path[i] = last outside ASN, path[i+1] = first inside ASN (IIG/border)
    outside = path[i] if i >= 0 else None
    iig = path[i + 1] if (i + 1) < len(path) else None

    # Origin ASN = last ASN in path (the one announcing the prefix)
    origin = path[-1]

    if outside and iig:
        outside_counts[outside] += 1
        iig_counts[iig] += 1
        edge_intl[(outside, iig)] += 1

        # Domestic edge: origin → IIG (only if they're different)
        if origin != iig and origin in country_asns:
            local_isp_counts[origin] += 1
            edge_domestic[(origin, iig)] += 1
        elif origin == iig:
            # The IIG is also the origin - it announces its own prefix
            # Still count it as a local ISP too for completeness
            local_isp_counts[origin] += 1

print(f"  Valid observations: {valid_obs}")
print(f"  Outside ASNs: {len(outside_counts)}")
print(f"  IIG ASNs: {len(iig_counts)}")
print(f"  Local Company ASNs: {len(local_isp_counts)}")
print(f"  International edges: {len(edge_intl)}")
print(f"  Domestic edges: {len(edge_domestic)}")

# ─────────────────────────────────────────────
# Step 4: Fetch country info for all ASNs
# ─────────────────────────────────────────────

all_asns = set(outside_counts.keys()) | set(iig_counts.keys()) | set(local_isp_counts.keys())
# Add any ASNs from existing names that we should keep
all_asns |= set(asn_names.keys())

# Determine which ASNs need country info
need_country = [a for a in all_asns if a not in asn_names or "country" not in asn_names.get(a, {})]
print(f"\nFetching country info for {len(need_country)} ASNs...")

# Initialize rate limiter (4 requests per second, matching website)
rate_limiter = RateLimiter(requests_per_second=4)

def fetch_asn_country(asn):
    """Fetch ASN overview and extract country from holder name or RIR data."""
    # Invalid region codes that should not be treated as countries
    INVALID_REGIONS = {"AP", "EU", "AS", "AF", "LA", "NA", "OC", "AN"}
    
    try:
        rate_limiter.acquire()  # Rate limit API calls
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
            # Common patterns: "COMPANYNAME-CC Company Name" or "NAME - Company CC"
            country = ""
            # Check if the ASN is in our BD set
            if asn in country_asns:
                country = "BD"
            else:
                # Try to extract from holder - pattern like "NAME-CC"
                parts = holder.split()
                if parts:
                    first = parts[0]
                    if "-" in first:
                        suffix = first.split("-")[-1].upper()
                        # Check if it looks like a 2-letter country code and not a region
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
    except Exception:
        return asn, {"asn": asn, "name": f"AS{asn}", "holder": "", "announced": False, "country": "BD" if asn in country_asns else ""}


# Fetch in parallel
completed = 0
with ThreadPoolExecutor(max_workers=20) as executor:
    futures = {executor.submit(fetch_asn_country, a): a for a in need_country}
    for future in as_completed(futures):
        asn, result = future.result()
        asn_names[asn] = result
        completed += 1
        if completed % 50 == 0:
            print(f"  Fetched {completed}/{len(need_country)} ASNs...")

# Also set country for all BD ASNs we know about
for asn in country_asns:
    if asn in asn_names:
        asn_names[asn]["country"] = "BD"

# For any ASN still missing country, try common well-known ones
WELL_KNOWN_COUNTRIES = {
    "174": "US", "6939": "US", "6461": "US", "3356": "US", "1299": "SE",
    "2914": "US", "3257": "DE", "3491": "US", "5511": "FR", "6762": "IT",
    "9002": "EU", "9498": "IN", "4637": "HK", "2516": "JP", "4826": "AU",
    "7922": "US", "20473": "US", "13335": "US", "16509": "US", "15169": "US",
    "8075": "US", "32934": "US", "36351": "US", "46489": "US", "397143": "US",
}

INVALID_REGIONS = {"AP", "EU", "AS", "AF", "LA", "NA", "OC", "AN"}
for asn, cc in WELL_KNOWN_COUNTRIES.items():
    if asn in asn_names:
        current = asn_names[asn].get("country", "")
        # Override if empty or invalid region code
        if not current or current in INVALID_REGIONS:
            asn_names[asn]["country"] = cc

print(f"  ASN info complete: {len(asn_names)} entries")

# Count how many have country
with_country = sum(1 for v in asn_names.values() if v.get("country"))
print(f"  ASNs with country: {with_country}/{len(asn_names)}")

# ─────────────────────────────────────────────
# Step 5: Build viz_data.json (license-aware)
# ─────────────────────────────────────────────

# Load BTRC IIG license list
LICENSE_FILE = os.path.join(os.path.dirname(DATA_DIR), "btrc_iig_licenses.json")
btrc_licensed_asns = set()
if os.path.exists(LICENSE_FILE):
    print(f"\nLoading BTRC IIG license list from {LICENSE_FILE}...")
    with open(LICENSE_FILE) as f:
        raw_licenses = json.load(f)
        btrc_licensed_asns = set(k for k in raw_licenses.keys() if not k.startswith("_"))
    print(f"  Loaded {len(btrc_licensed_asns)} licensed IIG ASNs")
else:
    print(f"\nWARNING: BTRC license file not found at {LICENSE_FILE}")

print("\nBuilding visualization data (license-aware)...")

# Top edges for international (outside → iig) - increased to 1500
top_intl_edges = edge_intl.most_common(1500)
# Top edges for domestic (local_isp → iig) - increased to 2000
top_domestic_edges = edge_domestic.most_common(2000)

# Pre-compute which tentative IIGs have domestic customers
iigs_with_domestic = set()
for (local_isp, iig), count in top_domestic_edges:
    iigs_with_domestic.add(iig)

# Collect all nodes from top edges
node_map = {}

def ensure_node(asn, node_type):
    if asn not in node_map:
        info = asn_names.get(asn, {})
        detected_country = info.get("country", "")
        is_bd_registered = asn in country_asns
        
        # Reclassify tentative IIGs based on license list
        if node_type == "iig":
            if asn in btrc_licensed_asns:
                node_type = "iig"  # Confirmed licensed
            elif is_bd_registered and detected_country and detected_country != "BD":
                node_type = "offshore-enterprise"
            elif asn in iigs_with_domestic:
                node_type = "detected-iig"
            else:
                node_type = "local-company"  # Demote: no domestic customers
        
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
    # If an ASN already exists with a different type, keep the more specific one
    if node_map[asn]["type"] != node_type:
        existing = node_map[asn].get("roles", [node_map[asn]["type"]])
        if node_type not in existing:
            existing.append(node_type)
        node_map[asn]["roles"] = existing

edges = []

# Add international edges
for (outside, iig), count in top_intl_edges:
    ensure_node(outside, "outside")
    ensure_node(iig, "iig")
    edges.append({"source": outside, "target": iig, "count": count, "type": "international"})

# Add domestic edges
for (local_isp, iig), count in top_domestic_edges:
    ensure_node(local_isp, "local-company")
    ensure_node(iig, "iig")
    edges.append({"source": local_isp, "target": iig, "count": count, "type": "domestic"})

# Calculate traffic per node from edges
for edge in edges:
    src = edge["source"]
    tgt = edge["target"]
    if src in node_map:
        node_map[src]["traffic"] += edge["count"]
    if tgt in node_map:
        node_map[tgt]["traffic"] += edge["count"]

# Calculate rankings per type
total_intl_traffic = sum(c for (_, _), c in top_intl_edges) or 1
total_domestic_traffic = sum(c for (_, _), c in top_domestic_edges) or 1

for ntype in ["outside", "iig", "detected-iig", "offshore-enterprise", "local-company"]:
    typed_nodes = sorted(
        [n for n in node_map.values() if n["type"] == ntype],
        key=lambda n: n["traffic"], reverse=True
    )
    ref_total = total_intl_traffic if ntype == "outside" else total_intl_traffic
    for rank, n in enumerate(typed_nodes, 1):
        n["rank"] = rank
        n["percentage"] = (n["traffic"] / ref_total) * 100 if ref_total else 0

nodes = list(node_map.values())

viz_data = {
    "nodes": nodes,
    "edges": edges,
    "stats": {
        "total_outside": len([n for n in nodes if n["type"] == "outside"]),
        "total_iig": len([n for n in nodes if n["type"] == "iig"]),
        "total_detected_iig": len([n for n in nodes if n["type"] == "detected-iig"]),
        "total_offshore_enterprise": len([n for n in nodes if n["type"] == "offshore-enterprise"]),
        "total_local_company": len([n for n in nodes if n["type"] == "local-company"]),
        "total_edges": len(edges),
        "total_intl_edges": len([e for e in edges if e["type"] == "international"]),
        "total_domestic_edges": len([e for e in edges if e["type"] == "domestic"]),
        "total_traffic": total_intl_traffic,
        "valid_observations": valid_obs,
    },
}

# ─────────────────────────────────────────────
# Step 6: Save outputs
# ─────────────────────────────────────────────

out_viz = os.path.join(DATA_DIR, "viz_data.json")
out_asn = os.path.join(DATA_DIR, "asn_names.json")
out_meta = os.path.join(DATA_DIR, "metadata.json")

print(f"\nSaving {out_viz}...")
with open(out_viz, "w") as f:
    json.dump(viz_data, f, indent=2)

print(f"Saving {out_asn}...")
with open(out_asn, "w") as f:
    json.dump(asn_names, f, indent=2)

print(f"Saving {out_meta}...")
metadata = {
    "country": "BD",
    "country_name": "Bangladesh",
    "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "schema_version": 3,
    "model": "license-aware",
    "stats": viz_data["stats"],
    "source": "RIPEstat BGP State API",
    "source_url": "https://stat.ripe.net/data/bgp-state/data.json",
}
with open(out_meta, "w") as f:
    json.dump(metadata, f, indent=2)

# Summary
print(f"\n{'='*50}")
print(f"CLASSIFICATION SUMMARY")
print(f"{'='*50}")
print(f"Outside ASNs (International):  {viz_data['stats']['total_outside']}")
print(f"Known IIGs (BTRC Licensed):    {viz_data['stats']['total_iig']}")
print(f"Detected Gateways:             {viz_data['stats']['total_detected_iig']}")
print(f"Offshore Enterprises:             {viz_data['stats']['total_offshore_enterprise']}")
print(f"Local Company ASNs (Origins):      {viz_data['stats']['total_local_company']}")
print(f"International edges:           {viz_data['stats']['total_intl_edges']}")
print(f"Domestic edges:                {viz_data['stats']['total_domestic_edges']}")
print(f"Total edges:                   {viz_data['stats']['total_edges']}")
print(f"Valid observations:            {valid_obs}")
print(f"\nTop 5 Known IIGs:")
iigs = sorted([n for n in nodes if n["type"] == "iig"], key=lambda n: n["traffic"], reverse=True)
for n in iigs[:5]:
    print(f"  AS{n['asn']} {n['name']} - {n['traffic']} routes ({n['percentage']:.1f}%)")

detected = sorted([n for n in nodes if n["type"] == "detected-iig"], key=lambda n: n["traffic"], reverse=True)
if detected:
    print(f"\nDetected Gateways (Not in my datasets BTRC list):")
    for n in detected[:10]:
        print(f"  AS{n['asn']} {n['name']} - {n['traffic']} routes")

offshore = [n for n in nodes if n["type"] == "offshore-enterprise"]
if offshore:
    print(f"\nOffshore Enterprises:")
    for n in offshore:
        print(f"  AS{n['asn']} {n['name']} ({n['country']})")

print(f"\nTop 5 Local Companys:")
isps = sorted([n for n in nodes if n["type"] == "local-company"], key=lambda n: n["traffic"], reverse=True)
for n in isps[:5]:
    print(f"  AS{n['asn']} {n['name']} - {n['traffic']} routes")
print(f"\nDone!")
