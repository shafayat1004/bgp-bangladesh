#!/usr/bin/env python3
"""
One-time script to reclassify existing viz_data.json nodes using the BTRC license list.
Converts old 3-layer IIG nodes into the 5-category model:
  - iig (BTRC licensed)
  - detected-iig (acts as gateway, not in BTRC list)
  - offshore-peer (BD-registered, infrastructure abroad)
  - local-isp (demoted: no domestic customers)

This operates on the existing viz_data.json without needing raw BGP routes.
"""

import json
import os
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, "data", "BD")
LICENSE_FILE = os.path.join(PROJECT_DIR, "data", "btrc_iig_licenses.json")

# Load files
print("Loading viz_data.json...")
with open(os.path.join(DATA_DIR, "viz_data.json")) as f:
    viz_data = json.load(f)

print("Loading asn_names.json...")
with open(os.path.join(DATA_DIR, "asn_names.json")) as f:
    asn_names = json.load(f)

print("Loading btrc_iig_licenses.json...")
with open(LICENSE_FILE) as f:
    raw_licenses = json.load(f)
    btrc_licensed_asns = set(k for k in raw_licenses.keys() if not k.startswith("_"))

print(f"  {len(btrc_licensed_asns)} BTRC-licensed ASNs loaded")

# Get BD country ASNs from asn_names (those with country=BD)
country_asns = set()
for asn, info in asn_names.items():
    if info.get("country") == "BD":
        country_asns.add(asn)
print(f"  {len(country_asns)} BD-registered ASNs found")

# Compute which IIGs have domestic customers (appear as targets in domestic edges)
iigs_with_domestic = set()
for edge in viz_data["edges"]:
    if edge.get("type") == "domestic":
        tgt = edge.get("target")
        if isinstance(tgt, dict):
            tgt = tgt.get("asn", "")
        iigs_with_domestic.add(str(tgt))

print(f"  {len(iigs_with_domestic)} gateway ASNs serve domestic customers")

# Reclassify nodes
reclassified = {"iig": 0, "detected-iig": 0, "offshore-enterprise": 0, "demoted": 0}
for node in viz_data["nodes"]:
    asn = str(node["asn"])
    old_type = node["type"]
    
    # Add licensed field to all nodes
    node["licensed"] = asn in btrc_licensed_asns
    
    # Only reclassify IIG nodes
    if old_type != "iig":
        continue
    
    info = asn_names.get(asn, {})
    detected_country = info.get("country", "")
    is_bd_registered = asn in country_asns
    
    if asn in btrc_licensed_asns:
        node["type"] = "iig"
        reclassified["iig"] += 1
    elif is_bd_registered and detected_country and detected_country != "BD":
        node["type"] = "offshore-enterprise"
        reclassified["offshore-enterprise"] += 1
    elif asn in iigs_with_domestic:
        node["type"] = "detected-iig"
        reclassified["detected-iig"] += 1
    else:
        node["type"] = "local-company"
        reclassified["demoted"] += 1

print(f"\nReclassification results:")
print(f"  Confirmed IIGs (BTRC licensed):  {reclassified['iig']}")
print(f"  Detected Gateways:               {reclassified['detected-iig']}")
print(f"  Offshore Enterprises:               {reclassified['offshore-peer']}")
print(f"  Demoted to Local Company:            {reclassified['demoted']}")

# Recalculate rankings per type
total_intl_traffic = sum(
    e["count"] for e in viz_data["edges"] if e.get("type") == "international"
) or 1

for ntype in ["outside", "iig", "detected-iig", "offshore-enterprise", "local-company"]:
    typed_nodes = sorted(
        [n for n in viz_data["nodes"] if n["type"] == ntype],
        key=lambda n: n["traffic"], reverse=True
    )
    for rank, n in enumerate(typed_nodes, 1):
        n["rank"] = rank
        n["percentage"] = (n["traffic"] / total_intl_traffic) * 100

# Update stats
nodes = viz_data["nodes"]
viz_data["stats"] = {
    "total_outside": len([n for n in nodes if n["type"] == "outside"]),
    "total_iig": len([n for n in nodes if n["type"] == "iig"]),
    "total_detected_iig": len([n for n in nodes if n["type"] == "detected-iig"]),
    "total_offshore_enterprise": len([n for n in nodes if n["type"] == "offshore-enterprise"]),
    "total_local_company": len([n for n in nodes if n["type"] == "local-company"]),
    "total_edges": len(viz_data["edges"]),
    "total_intl_edges": len([e for e in viz_data["edges"] if e["type"] == "international"]),
    "total_domestic_edges": len([e for e in viz_data["edges"] if e["type"] == "domestic"]),
    "total_traffic": total_intl_traffic,
    "valid_observations": viz_data["stats"].get("valid_observations", 0),
}

# Save updated viz_data.json
out_viz = os.path.join(DATA_DIR, "viz_data.json")
print(f"\nSaving updated viz_data.json...")
with open(out_viz, "w") as f:
    json.dump(viz_data, f, indent=2)

# Update metadata
out_meta = os.path.join(DATA_DIR, "metadata.json")
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
print(f"Saving updated metadata.json...")
with open(out_meta, "w") as f:
    json.dump(metadata, f, indent=2)

# Print summary
print(f"\n{'='*50}")
print("UPDATED CLASSIFICATION SUMMARY")
print(f"{'='*50}")
print(f"Outside ASNs (International):  {viz_data['stats']['total_outside']}")
print(f"Known IIGs (BTRC Licensed):    {viz_data['stats']['total_iig']}")
print(f"Detected Gateways:             {viz_data['stats']['total_detected_iig']}")
print(f"Offshore Enterprises:             {viz_data['stats']['total_offshore_enterprise']}")
print(f"Local Companys:                    {viz_data['stats']['total_local_company']}")
print(f"Total edges:                   {viz_data['stats']['total_edges']}")

print(f"\nTop Known IIGs:")
iigs = sorted([n for n in nodes if n["type"] == "iig"], key=lambda n: n["traffic"], reverse=True)
for n in iigs[:5]:
    print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes ({n['percentage']:.1f}%)")

detected = sorted([n for n in nodes if n["type"] == "detected-iig"], key=lambda n: n["traffic"], reverse=True)
if detected:
    print(f"\nDetected Gateways:")
    for n in detected:
        print(f"  AS{n['asn']} {n['name']} - {n['traffic']:,} routes")

offshore = [n for n in nodes if n["type"] == "offshore-enterprise"]
if offshore:
    print(f"\nOffshore Enterprises:")
    for n in offshore:
        print(f"  AS{n['asn']} {n['name']} (country={n.get('country', '?')})")

demoted = [n for n in nodes if n.get("licensed") is False and n["type"] == "local-company" and n["asn"] not in {nn["asn"] for nn in nodes if nn["type"] in ("outside",)}]
print(f"\nDone! Static data is now using the license-aware classification.")
