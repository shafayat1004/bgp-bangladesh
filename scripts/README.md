# BGP Data Update Scripts

This directory contains Python scripts for fetching and processing BGP routing data from RIPEstat.

## Quick Start

**Recommended: Use the all-in-one script**

```bash
python3 scripts/update_bgp_data.py
```

This single command:
- ✓ Fetches country resources (ASNs and prefixes)
- ✓ Downloads BGP routes in parallel (5 concurrent batches)
- ✓ Saves raw routes to `bgp_routes_raw.json`
- ✓ Analyzes routes into 3-layer model
- ✓ Fetches ASN names and countries in parallel (20 concurrent)
- ✓ Generates all output files (viz_data.json, asn_names.json, metadata.json)

**Time estimate:** 5-15 minutes depending on API speed

## Scripts Overview

### `update_bgp_data.py` (Recommended)
**Purpose:** All-in-one data updater - combines fetching and processing in one go.

**Usage:**
```bash
# Update Bangladesh data (default)
python3 scripts/update_bgp_data.py

# Update for another country
python3 scripts/update_bgp_data.py --country IN
```

**Output files:**
- `data/BD/bgp_routes_raw.json` - Raw BGP routes (~90MB)
- `data/BD/viz_data.json` - Processed visualization data (~3MB)
- `data/BD/asn_names.json` - ASN names and countries (~50KB)
- `data/BD/metadata.json` - Timestamp and statistics

**Features:**
- Parallel fetching (5 BGP batches, 20 ASN lookups) - matches website behavior
- Rate limiting (4 req/sec) - respects RIPEstat API limits
- Progress reporting with ETA
- ASN info caching (reuses existing names to speed up updates)
- Automatic retry logic
- Comprehensive error handling

---

### `fetch_bgp_routes.py` (Legacy)
**Purpose:** Fetch raw BGP routes only (first step of two-step process).

**Usage:**
```bash
python3 scripts/fetch_bgp_routes.py
python3 scripts/fetch_bgp_routes.py --country BD --output data/BD/bgp_routes_raw.json
```

**Output:** Creates `bgp_routes_raw.json` with raw BGP route data.

**When to use:** Only if you want to separate fetching from processing (e.g., for debugging).

---

### `reprocess_3layer.py` (Legacy)
**Purpose:** Reprocess existing raw BGP data into 3-layer visualization format.

**Usage:**
```bash
python3 scripts/reprocess_3layer.py
```

**Input:** Requires `data/BD/bgp_routes_raw.json` to exist.

**Output:** Updates `viz_data.json`, `asn_names.json`, and `metadata.json`.

**When to use:** 
- Reprocessing existing raw data without re-fetching
- Tweaking the 3-layer model algorithm
- Debugging visualization data generation

---

## Workflow Comparison

### Recommended: One-Step Workflow
```bash
python3 scripts/update_bgp_data.py
git add data/BD/*.json
git commit -m "Update BGP data: $(date +%Y-%m-%d)"
git push
```

### Legacy: Two-Step Workflow
```bash
# Step 1: Fetch raw routes
python3 scripts/fetch_bgp_routes.py

# Step 2: Process into visualization data
python3 scripts/reprocess_3layer.py

# Commit
git add data/BD/*.json
git commit -m "Update BGP data: $(date +%Y-%m-%d)"
git push
```

## Technical Details

### Parallel Fetching
Both the new unified script and the website use the same parallel fetching strategy:
- **BGP Routes:** 5 batches fetched concurrently
- **ASN Info:** 20 ASN lookups concurrently
- **Rate Limiting:** Token bucket algorithm at 4 requests/second

This ensures the Python scripts produce identical results to the website's "Fetch Live Data" button.

### 3-Layer Model

The scripts analyze BGP AS paths to classify networks into three layers:

**Layer 1: Local ISPs (Blue 🔵)**
- Origin ASNs that announce prefixes
- May not have direct international peering
- Examples: ADN Telecom, Dot Internet

**Layer 2: IIGs / Border Gateways (Green 🟢)**
- First Bangladesh ASN encountered after crossing the border
- Have direct international peering
- Examples: Summit Communications, Fiber@Home, Grameenphone

**Layer 3: Outside / International (Red 🔴)**
- Non-Bangladesh networks
- International transit providers
- Examples: Bharti Airtel (India), Hurricane Electric (USA), NTT (Japan)

**Algorithm:**
For each BGP path like `[Cloudflare, NTT, Bharti, Summit, ADN]`:
1. Walk backwards from origin (ADN)
2. Skip all BD ASNs (ADN, Summit)
3. First non-BD ASN = Outside (Bharti)
4. Next BD ASN = IIG (Summit)
5. Origin = Local ISP (ADN)

### Edge Types
- **International edges:** Outside → IIG (cyan lines)
- **Domestic edges:** Local ISP → IIG (blue dashed lines)

Top 1000 edges of each type are included in the visualization data.

## Requirements

```bash
# Python 3.7+
python3 --version

# No external dependencies - uses only standard library!
# - json
# - requests (standard in Python 3)
# - collections
# - concurrent.futures
# - time, datetime
```

## Troubleshooting

**Problem:** Script hangs or takes forever
- **Solution:** Check your internet connection. The script fetches ~300 API requests. Use Ctrl+C to cancel.

**Problem:** "Too many failures" error
- **Solution:** RIPEstat API might be rate limiting. Wait a few minutes and try again.

**Problem:** Empty or missing data files
- **Solution:** Ensure you have write permissions to the `data/BD/` directory.

**Problem:** ASN names not resolving
- **Solution:** This is normal for some ASNs. The script will use "AS12345" as fallback.

**Problem:** Country codes showing as empty
- **Solution:** Not all ASNs have clear country indicators. The script applies well-known ASN overrides for major networks.

## Automation

### Daily Updates with Cron
```bash
# Edit crontab
crontab -e

# Add this line to run daily at 3 AM
0 3 * * * cd /path/to/bgp-bangladesh && python3 scripts/update_bgp_data.py && git add data/ && git commit -m "Auto-update BGP data" && git push
```

### GitHub Actions
See `.github/workflows/update-bgp-data.yml` (if it exists) for automated CI/CD setup.

## Data Sources

All data comes from [RIPEstat](https://stat.ripe.net/):

- **Country Resources:** `https://stat.ripe.net/data/country-resource-list/data.json`
- **BGP State:** `https://stat.ripe.net/data/bgp-state/data.json`
- **AS Overview:** `https://stat.ripe.net/data/as-overview/data.json`

RIPEstat is free, public, and requires no API key.

## Performance

**update_bgp_data.py benchmarks:**
- Step 1 (Country resources): ~5 seconds
- Step 2 (BGP routes): ~5-10 minutes (depends on API)
- Step 3 (Route analysis): ~10-30 seconds
- Step 4 (ASN info): ~1-3 minutes (cached ASNs are reused)

**Total:** ~7-15 minutes for a full update

**Rate limiting:** 4 requests/second (RIPEstat's recommended rate)

**Memory usage:** ~200-500MB peak during route processing

## Contributing

When modifying the scripts:
1. Ensure the output format matches the website's expectations
2. Keep the parallel fetching behavior (5 BGP batches, 20 ASN lookups)
3. Maintain backward compatibility with existing data files
4. Update this README with any changes

## License

MIT - Same as the main project
