#!/usr/bin/env python3
"""
Re-apply the current classification rules to stored data, without fetching.

Updates data/<country>/viz_data.json and every history snapshot in place, from
the networks and connections each file already holds:
  - licensed / igw flags from btrc_iig_licenses.json and btrc_igw_licenses.json
  - category of gateway-like networks (a licensed ASN is always "iig"; an
    unlicensed one is a detected gateway only when a BD network goes through it)
  - abroad_link for local companies seen right behind a network abroad
  - share (percentage), rank and the per-category totals in stats

Run it after the rules or a licence list change, so the history slider doesn't
show the change as a jump. Snapshots only hold the drawn connections, so
"has BD networks behind it" uses those; the pipeline uses every connection.
Leaked private ASNs and geolocation stay as stored.

Each rewritten file loses its baked Network Graph layout; bake it again with
`node scripts/precompute_layout.mjs --country BD --force`.

    python3 scripts/reclassify_stored.py [--country BD] [--data-dir DIR]
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_bgp_data import (  # noqa: E402
    classify_tentative_iig_type,
    compute_shares,
    load_licensed_asns,
)

GATEWAY_LIKE = {"iig", "detected-iig"}
TYPES = ["outside", "iig", "detected-iig", "offshore-enterprise", "offshore-gateway", "local-company"]
STAT_KEYS = {
    "outside": "total_outside",
    "iig": "total_iig",
    "detected-iig": "total_detected_iig",
    "offshore-enterprise": "total_offshore_enterprise",
    "offshore-gateway": "total_offshore_gateway",
    "local-company": "total_local_company",
}


def reclassify_viz(viz, iig_asns, igw_asns):
    """Apply the current rules to one viz_data dict in place. Returns {asn: (old, new)} for moved networks."""
    viz.pop("layout", None)
    edges = viz["edges"]
    customers = {e["target"] for e in edges if e["type"] == "domestic"}
    via_gateway = {e["source"] for e in edges if e["type"] == "domestic"}
    abroad = {e["target"] for e in edges if e["type"] == "international"}

    moved = {}
    for i, n in enumerate(viz["nodes"]):
        asn, old = n["asn"], n["type"]
        new = old
        if asn in iig_asns:
            new = "iig"
        elif old in GATEWAY_LIKE:
            new = classify_tentative_iig_type(
                asn, n.get("country") == "BD", n.get("geo_country", ""), iig_asns, customers)
        if new != old:
            moved[asn] = (old, new)
        n["type"] = new
        n["licensed"] = asn in iig_asns
        link = ""
        if new == "local-company" and asn in abroad:
            link = "also-abroad" if asn in via_gateway else "only-abroad"
        # Same key order as the pipeline writes: the two flags sit before "traffic"
        rest = {k: v for k, v in n.items() if k not in ("igw", "abroad_link")}
        ordered = {}
        for k, v in rest.items():
            if k == "traffic":
                ordered["igw"] = asn in igw_asns
                ordered["abroad_link"] = link
            ordered[k] = v
        viz["nodes"][i] = ordered

    nodes = viz["nodes"]
    compute_shares(nodes, edges)
    for t in TYPES:
        typed = sorted((n for n in nodes if n["type"] == t), key=lambda n: n["traffic"], reverse=True)
        for rank, n in enumerate(typed, 1):
            n["rank"] = rank
        viz["stats"][STAT_KEYS[t]] = len(typed)
    return moved


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--country", default="BD")
    parser.add_argument("--data-dir", help="the data/ directory (default: this repo's)")
    args = parser.parse_args()

    data_dir = args.data_dir or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    iig_asns = load_licensed_asns(os.path.join(data_dir, "btrc_iig_licenses.json"))
    igw_asns = load_licensed_asns(os.path.join(data_dir, "btrc_igw_licenses.json"))
    country_dir = os.path.join(data_dir, args.country.upper())
    history_dir = os.path.join(country_dir, "history")
    files = [os.path.join(country_dir, "viz_data.json")] + sorted(
        os.path.join(history_dir, f) for f in os.listdir(history_dir)
        if f.endswith(".json") and f != "index.json")

    for path in files:
        with open(path) as f:
            viz = json.load(f)
        moved = reclassify_viz(viz, iig_asns, igw_asns)
        with open(path, "w") as f:
            json.dump(viz, f, indent=2)
        changes = {}
        for old, new in moved.values():
            changes[f"{old} -> {new}"] = changes.get(f"{old} -> {new}", 0) + 1
        print(f"{os.path.relpath(path, data_dir)}: {changes or 'no category changes'}")


if __name__ == "__main__":
    main()
