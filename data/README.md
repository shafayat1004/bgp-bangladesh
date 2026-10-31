# Data Directory

This directory contains static BGP routing data snapshots organized by country code, plus the BTRC IIG license list.

## Structure

```
data/
├── btrc_iig_licenses.json        # Known BTRC-licensed IIG ASNs (contributor-editable)
└── BD/                           # Bangladesh
    ├── viz_data.json             # Processed visualization data with 6 types
    ├── asn_names.json            # ASN name/organization/country lookup
    ├── bgp_routes_raw.jsonl      # Raw BGP route snapshot, JSONL format (~150MB, not committed)
    ├── country_resources.json    # Last good list of BD ASNs and allocated prefixes
    ├── announced_prefixes.json   # Last good announced prefixes per BD ASN (cache)
    ├── metadata.json             # Timestamp, stats, schema version, run completeness
    └── history/                  # One viz_data snapshot per run (7 days) + index.json
```

## Data Source

All data is sourced from [RIPEstat](https://stat.ripe.net/), specifically:

- **BGP State API**: `https://stat.ripe.net/data/bgp-state/data.json`
- **Country Resource List**: `https://stat.ripe.net/data/country-resource-list/data.json`
- **AS Overview**: `https://stat.ripe.net/data/as-overview/data.json`
- **RIR Stats Country**: `https://stat.ripe.net/data/rir-stats-country/data.json` (the country each network is registered to)
- **MaxMind GeoLite**: `https://stat.ripe.net/data/maxmind-geo-lite-announced-by-as/data.json` (for offshore detection)

## File Formats

### btrc_iig_licenses.json

List of known BTRC-licensed IIG operators (source: [BTRC IIG Service Providers License List](https://github.com/shafayat1004/bgp-bangladesh/blob/6273eb61ecd5149b30fe5012e854ff955d7fb8bd/docs/List%20of%20IIG%20Service%20Providers%20License.pdf)). Used to distinguish confirmed IIGs from detected gateways:

```json
{
  "_description": "Known BTRC IIG-licensed ASNs",
  "58717": { "name": "Summit Communications", "license": "IIG" },
  "10075": { "name": "Fiber@Home Global", "license": "IIG" }
}
```

### viz_data.json

The primary data file used by the visualization. Contains 6 node types:

```json
{
  "nodes": [
    {
      "asn": "58717",
      "type": "iig",
      "licensed": true,
      "name": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
      "description": "...",
      "country": "BD",
      "geo_country": "BD",
      "traffic": 281095,
      "rank": 1,
      "percentage": 61.59
    }
  ],
  "edges": [
    {
      "source": "9498",
      "target": "58717",
      "count": 37995,
      "type": "international"
    }
  ],
  "stats": {
    "total_outside": 212,
    "total_iig": 20,
    "total_detected_iig": 8,
    "total_offshore_enterprise": 3,
    "total_offshore_gateway": 0,
    "total_local_company": 739,
    "total_edges": 1885,
    "total_intl_edges": 885,
    "total_domestic_edges": 1000,
    "total_traffic": 456371,
    "valid_observations": 457575
  }
}
```

**Node types:**
- `outside` - International transit providers (red)
- `iig` - BTRC-licensed border gateways (green) - confirmed in [license list](https://github.com/shafayat1004/bgp-bangladesh/blob/6273eb61ecd5149b30fe5012e854ff955d7fb8bd/docs/List%20of%20IIG%20Service%20Providers%20License.pdf)
- `detected-iig` - Acting as gateway, not in [BTRC license list](https://github.com/shafayat1004/bgp-bangladesh/blob/6273eb61ecd5149b30fe5012e854ff955d7fb8bd/docs/List%20of%20IIG%20Service%20Providers%20License.pdf) (amber)
- `offshore-enterprise` - BD-registered, abroad, no downstream BD customers (cyan)
- `offshore-gateway` - BD-registered, abroad, providing transit to BD networks (pink)
- `local-company` - Domestic origin networks (blue)

### asn_names.json

Maps ASN numbers to organization names and the country each network is
registered to. Bangladeshi ASNs (from the country resource list) are `BD`;
every other country comes from the regional internet registries via RIPEstat
`rir-stats-country`, marked `country_source: "rir"`. Entries without that mark
are looked up again on the next run. Some registry records name a region
(`EU`, `AP`) rather than a country.

```json
{
  "58717": {
    "asn": "58717",
    "name": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
    "holder": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
    "announced": true,
    "country": "BD"
  },
  "8529": {
    "asn": "8529",
    "name": "OMANTEL-AS - Zain Omantel International FZ-LLC",
    "holder": "OMANTEL-AS - Zain Omantel International FZ-LLC",
    "announced": true,
    "country": "AE",
    "country_source": "rir"
  }
}
```

### metadata.json

```json
{
  "country": "BD",
  "country_name": "Bangladesh",
  "last_updated": "2026-02-07T12:00:00Z",
  "schema_version": 3,
  "model": "license-aware",
  "stats": { ... },
  "completeness": {
    "complete": true,
    "routes": {
      "batches": 145,
      "batches_failed_first_try": 3,
      "retry_requests": 12,
      "retry_requests_failed": 0,
      "prefixes": 15210,
      "prefixes_missing": 0,
      "seconds": 1096.4
    },
    "announced_prefixes": {
      "asns": 2023,
      "fetched": 2023,
      "failed": 0,
      "from_cache": 0,
      "missing": 0,
      "used_cache": false,
      "timed_out": false,
      "budget_seconds": 720,
      "seconds": 402.1
    }
  }
}
```

`completeness` says how much of this run's data was fetched fresh:

- `complete`: `true` when every prefix returned routes and every network's
  announced prefixes were fetched this run; `false` otherwise; `null` when
  unknown (MRT fallback runs). The whole object is `null` for `--reprocess` runs.
- `routes`: RIPEstat `bgp-state` requests. Batches that fail are retried at the
  end as smaller requests. `prefixes_missing` is what was still lost; above
  0.5% of `prefixes` the run fails and nothing is committed, so a committed
  run has at most that many.
- `announced_prefixes`: the per-network prefix lookup. `from_cache` networks
  used their last good answer from `announced_prefixes.json` because they
  failed or the step hit its time budget (`timed_out`); `missing` networks had
  neither (only their allocated blocks were queried).

### announced_prefixes.json

Cache of each BD network's announced prefixes (`{"asns": {"<asn>": [prefixes]}}`),
rewritten every run with the fresh answers and the last good answer for any
network that wasn't fetched. The route fetch queries these prefixes as well as
the allocated blocks in `country_resources.json`.

## Updating Data

```bash
# One command updates everything:
python3 scripts/update_bgp_data.py

# Then commit:
git add data/BD/*.json
git commit -m "Update BGP data: $(date +%Y-%m-%d)"
git push
```

See the main [README.md](../README.md) for more details.
