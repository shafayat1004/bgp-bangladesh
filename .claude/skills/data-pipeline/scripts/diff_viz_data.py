#!/usr/bin/env python3
"""Compare two viz_data.json files (or snapshots) field by field.

Usage:
  python3 .claude/skills/data-pipeline/scripts/diff_viz_data.py OLD NEW [--show N]

OLD and NEW are file paths or git objects like origin/main:data/BD/viz_data.json.
Prints which node fields changed and how often, a few examples, and whether
edges and stats are identical. The "layout" block is ignored. Use it to prove
a change touched only what it meant to (e.g. only "country").
"""
import argparse
import json
import subprocess
import sys
from collections import Counter


def load(spec):
    if ":" in spec and not spec.startswith(("/", ".")):
        text = subprocess.run(["git", "show", spec], check=True, capture_output=True, text=True).stdout
    else:
        with open(spec) as f:
            text = f.read()
    data = json.loads(text)
    data.pop("layout", None)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--show", type=int, default=5, help="examples to print per field")
    args = ap.parse_args()

    old, new = load(args.old), load(args.new)
    old_nodes = {n["asn"]: n for n in old["nodes"]}
    new_nodes = {n["asn"]: n for n in new["nodes"]}

    added = sorted(set(new_nodes) - set(old_nodes))
    removed = sorted(set(old_nodes) - set(new_nodes))
    fields = Counter()
    examples = {}
    for asn in sorted(set(old_nodes) & set(new_nodes), key=int):
        a, b = old_nodes[asn], new_nodes[asn]
        for key in sorted(set(a) | set(b)):
            if a.get(key) != b.get(key):
                fields[key] += 1
                examples.setdefault(key, []).append((asn, a.get(key), b.get(key)))

    print(f"nodes: {len(old_nodes)} -> {len(new_nodes)} (added {len(added)}, removed {len(removed)})")
    print(f"edges identical: {old['edges'] == new['edges']}")
    print(f"stats identical: {old.get('stats') == new.get('stats')}")
    if not fields:
        print("no node field changed")
    for key, count in fields.most_common():
        print(f"\n{key}: {count} nodes changed")
        for asn, before, after in examples[key][:args.show]:
            name = new_nodes[asn].get("name", "")[:40]
            print(f"  AS{asn} {name}: {before!r} -> {after!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
