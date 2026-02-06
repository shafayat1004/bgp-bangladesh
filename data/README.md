# Data Directory

This directory contains static BGP routing data snapshots organized by country code.

## Structure

```
data/
└── BD/                           # Bangladesh
    ├── viz_data.json             # Processed visualization data (~68KB)
    ├── asn_names.json            # ASN name/organization lookup (~32KB)
    ├── bgp_routes_raw.json       # Raw BGP route snapshot (~90MB)
    └── metadata.json             # Timestamp, stats, schema version
```

## Data Source

All data is sourced from [RIPEstat](https://stat.ripe.net/), specifically:

- **BGP State API**: `https://stat.ripe.net/data/bgp-state/data.json`
- **Country Resource List**: `https://stat.ripe.net/data/country-resource-list/data.json`
- **AS Overview**: `https://stat.ripe.net/data/as-overview/data.json`

## File Formats

### viz_data.json

The primary data file used by the visualization. Contains:

```json
{
  "nodes": [
    {
      "asn": "58717",
      "type": "inside",
      "name": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
      "description": "...",
      "traffic": 140241,
      "rank": 1,
      "percentage": 31.49
    }
  ],
  "edges": [
    {
      "source": "9498",
      "target": "58717",
      "count": 37995
    }
  ],
  "stats": {
    "total_inside": 32,
    "total_outside": 110,
    "total_edges": 300,
    "total_traffic": 445391
  }
}
```

### asn_names.json

Maps ASN numbers to organization names:

```json
{
  "58717": {
    "asn": "58717",
    "name": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
    "holder": "SUMMITCOMMUNICATIONS-BD Summit Communications Ltd",
    "announced": true
  }
}
```

### metadata.json

```json
{
  "country": "BD",
  "country_name": "Bangladesh",
  "last_updated": "2026-02-06T19:00:00Z",
  "schema_version": 1,
  "stats": { ... }
}
```

## Updating Data

See the main [README.md](../README.md) for instructions on updating static data.
