# Data Directory

This directory contains static BGP routing data snapshots organized by country code, plus the BTRC IIG license list.

## Structure

```
data/
├── btrc_iig_licenses.json        # Known BTRC-licensed IIG ASNs (contributor-editable)
└── BD/                           # Bangladesh
    ├── viz_data.json             # Processed visualization data with 6 types
    ├── asn_names.json            # ASN name/organization/country lookup
    ├── bgp_routes_raw.jsonl      # Raw BGP route snapshot, JSONL format (~150MB)
    └── metadata.json             # Timestamp, stats, schema version
```

## Data Source

All data is sourced from [RIPEstat](https://stat.ripe.net/), specifically:

- **BGP State API**: `https://stat.ripe.net/data/bgp-state/data.json`
- **Country Resource List**: `https://stat.ripe.net/data/country-resource-list/data.json`
- **AS Overview**: `https://stat.ripe.net/data/as-overview/data.json`
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

Maps ASN numbers to organization names and country info:

```json
{
  "58717": {
    "asn": "58717",
    "name": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
    "holder": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
    "announced": true,
    "country": "BD",
    "geo_country": "BD"
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
  "stats": { ... }
}
```

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
