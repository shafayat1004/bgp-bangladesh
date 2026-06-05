#!/usr/bin/env python3
"""
Backfill the BGP history directory from past git commits.

The scheduled pipeline only starts accumulating snapshots from the moment the
history feature is deployed. This one-time script reconstructs the last N days
of snapshots from previous `data/<COUNTRY>/viz_data.json` commits so the UI
time-slider is full immediately.

For each commit that touched viz_data.json within the retention window it:
  1. recovers the snapshot timestamp from that commit's metadata.json
     (`last_updated`), falling back to the commit date,
  2. writes the historical viz_data.json into
     `data/<COUNTRY>/history/<timestamp>.json`,
then prunes anything outside the window and rebuilds `history/index.json`.

Usage:
    python3 scripts/backfill_history.py
    python3 scripts/backfill_history.py --country BD --days 7
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

# Reuse the canonical helpers so backfilled history matches the live pipeline.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_bgp_data import (  # noqa: E402
    RETENTION_DAYS,
    _history_dir,
    _snapshot_filename,
    prune_history,
    write_history_index,
)

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run_git(args):
    """Run a git command from the project root and return (ok, stdout)."""
    result = subprocess.run(
        ["git", *args],
        cwd=PROJECT_DIR,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0, result.stdout


def _git_show_bytes(ref):
    """Return the raw bytes of a file at a git ref, or None if unavailable."""
    result = subprocess.run(
        ["git", "show", ref],
        cwd=PROJECT_DIR,
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def _normalize_ts(raw):
    """Normalize any ISO-8601 timestamp to '%Y-%m-%dT%H:%M:%SZ' (UTC)."""
    if not raw:
        return None
    text = raw.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _snapshot_ts_for_commit(sha, country):
    """Best-effort snapshot timestamp for a commit: metadata, then commit date."""
    meta_bytes = _git_show_bytes(f"{sha}:data/{country}/metadata.json")
    if meta_bytes:
        try:
            meta = json.loads(meta_bytes.decode("utf-8"))
            ts = _normalize_ts(meta.get("last_updated"))
            if ts:
                return ts
        except (ValueError, json.JSONDecodeError):
            pass
    ok, commit_date = _run_git(["show", "-s", "--format=%cI", sha])
    if ok:
        return _normalize_ts(commit_date)
    return None


def backfill(country, days):
    country = country.upper()
    viz_rel = f"data/{country}/viz_data.json"

    ok, log_out = _run_git([
        "log", f"--since={days} days ago", "--format=%H", "--", viz_rel,
    ])
    if not ok:
        print("ERROR: `git log` failed. Are you inside the repository?")
        return 1

    shas = [line.strip() for line in log_out.splitlines() if line.strip()]
    print(f"Found {len(shas)} commit(s) touching {viz_rel} in the last {days} days.")

    history_dir = _history_dir(country)
    os.makedirs(history_dir, exist_ok=True)

    written = 0
    seen_files = set()
    # git log is newest-first; keep the first (newest) commit for a given ts.
    for sha in shas:
        ts = _snapshot_ts_for_commit(sha, country)
        if not ts:
            print(f"      Skipping {sha[:10]}: could not determine timestamp")
            continue
        filename = _snapshot_filename(ts)
        if filename in seen_files:
            continue
        dest = os.path.join(history_dir, filename)
        if os.path.exists(dest):
            seen_files.add(filename)
            continue
        viz_bytes = _git_show_bytes(f"{sha}:{viz_rel}")
        if viz_bytes is None:
            print(f"      Skipping {sha[:10]}: viz_data.json not present at commit")
            continue
        with open(dest, "wb") as f:
            f.write(viz_bytes)
        seen_files.add(filename)
        written += 1
        print(f"      Backfilled {ts} <- {sha[:10]}")

    print(f"Wrote {written} new snapshot(s) into {history_dir}")

    prune_history(country, days)
    write_history_index(country, days)
    return 0


def main():
    parser = argparse.ArgumentParser(description="Backfill BGP history from git.")
    parser.add_argument("--country", default="BD", help="Country code (default: BD)")
    parser.add_argument("--days", type=int, default=RETENTION_DAYS,
                        help=f"Retention window in days (default: {RETENTION_DAYS})")
    args = parser.parse_args()
    return backfill(args.country, args.days)


if __name__ == "__main__":
    sys.exit(main())
