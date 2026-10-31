# Data Directory

This directory contains static BGP routing data snapshots organized by country code, plus the BTRC IIG license list.

## Structure

```
data/
├── btrc_iig_licenses.json        # Known BTRC-licensed IIG ASNs (contributor-editable)
├── btrc_igw_licenses.json        # Known BTRC-licensed IGW (voice gateway) ASNs (contributor-editable)
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
- **RIR Stats Country**: `https://stat.ripe.net/data/rir-stats-country/data.json` (the country each network is registered to)
- **MaxMind GeoLite**: `https://stat.ripe.net/data/maxmind-geo-lite-announced-by-as/data.json` (for offshore detection)

## File Formats

### btrc_iig_licenses.json

List of known BTRC-licensed IIG operators (source: [BTRC licence list](https://btrc.gov.bd/pages/static-pages/6922ddd6933eb65569e1691d), IIG row; a copy is in `docs/List of IIG Service Providers License.pdf`). Used to distinguish confirmed IIGs from detected gateways. A listed ASN is always shown as an IIG, even when it only reaches the world through a sister network (BTCL's AS45588 through AS17494). Each entry records where it came from:

```json
{
  "_last_verified": "2026-11-01",
  "58717": { "name": "Summit Communications Limited", "short": "Summit", "issued": "2012-04-12", "status": "active", "verified_on": "2026-11-01" },
  "58601": { "name": "Aamra Technologies Limited", "short": "Aamra", "issued": "2012-04-12", "status": "suspended", "notes": "Why, with a source link", "verified_on": "2026-11-01" }
}
```

`status` is `active` unless a source says otherwise; `notes` holds the evidence for anything unusual. Only the keys are used for classification.

### btrc_igw_licenses.json

BTRC-licensed international voice gateways (IGW), same format, from the IGW row of the same BTRC page (copy in `docs/List of IGW Service Providers License.pdf`). IGW operators have their own links to foreign carriers for phone calls; the site labels their networks but doesn't treat them as internet gateways.

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
      "percentage": 38.7,
      "igw": false,
      "abroad_link": ""
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
- `local-company` - Domestic origin networks (blue). `abroad_link` is `also-abroad` or `only-abroad` for one with its own link abroad (seen right behind a network abroad) that no other BD network goes through; see `docs/classification-pipeline.md`.

`igw: true` marks a licensed international voice gateway (from `btrc_igw_licenses.json`); it's a label, not a category.

**`percentage` (shown as "Share"):** of all routes crossing the border (international connections), the share that crosses through or starts from this network: an international network's and a gateway's international routes, a local company's routes through gateways. Shares within one category add up to at most 100%. The site recomputes it from the connections on load, so history snapshots written before this rule (which added a gateway's domestic routes) read the same way.

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
