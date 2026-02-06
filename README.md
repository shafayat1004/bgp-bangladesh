# BGP Bangladesh - Internet Path Visualization

An interactive visualization platform showing how Bangladesh's internet connects to the global network via BGP routing. Understand the **3-layer structure** of internet connectivity: Local ISPs → IIGs (Border Gateways) → International Transit.

**[Live Demo](https://yourusername.github.io/bgp-bangladesh/)** (replace with your GitHub Pages URL)

## What Is This?

Every time you visit a website from Bangladesh, your data travels through a chain of networks:

```
Local ISP  →  IIG (Border Gateway)  →  International Transit  →  The World
   🔵              🟢                          🔴
```

This tool visualizes those paths using real BGP (Border Gateway Protocol) routing data from [RIPEstat](https://stat.ripe.net/). It reveals:

- **3-Layer Network Structure**: See how Local ISPs connect to IIGs, and IIGs peer with international networks
- **Traffic Distribution**: Which networks carry the most routes (Summit, Fiber@Home, Level3, etc.)
- **International Dependencies**: Which foreign ASNs Bangladesh relies on (Bharti Airtel, Hurricane Electric, NTT, etc.)
- **Path Diversity**: How resilient the country's internet connectivity is
- **Border Gateways**: Which ASNs act as actual international peering points vs purely domestic ISPs

## Features

### 🎨 Visualizations
- **6 Interactive Views**: Network graph, Sankey flow, treemap, chord diagram, hierarchical view, and data table
- **3-Layer Model**: Clearly distinguishes Local ISPs (blue 🔵), IIGs (green 🟢), and Outside networks (red 🔴)
- **Edge Types**: Visual distinction between domestic peering (blue dashed) and international peering (cyan)
- **Country Flags**: Every ASN shows its country flag emoji (🇧🇩 🇮🇳 🇺🇸 etc.)
- **Smart Highlighting**: Click any ASN to highlight its connections across all visualizations
- **Zoom & Pan**: Navigate large network graphs with mouse controls

### 🔧 Tools
- **"What's My ASN?"**: Detect which Bangladesh ISP you're connected to right now
- **ASN Search**: Find any network by name, number, or country
- **Traffic Filtering**: Slider to show only major routes (reduce visual clutter)
- **Node Size Control**: Adjust visualization density
- **Data Export**: Download processed data as CSV or JSON

### 🚀 Performance
- **Live Data Fetching**: Query RIPEstat API directly in your browser (5x parallel batching)
- **Real-time Progress**: See exactly which batch is fetching with ETA countdown
- **Retry Logic**: Automatic exponential backoff on failures
- **Rate Limiting**: Respects API limits with intelligent throttling
- **Cancellable**: Stop a fetch mid-process if needed

### 📚 Educational
- **Interactive Modal**: Explains BGP concepts, IIGs vs Local ISPs, and how internet routing works
- **Tooltip Details**: Hover over any element for detailed stats
- **3-Layer Explanation**: Clear distinction between different network roles

## How It Works

All data fetching and processing happens **100% in your browser**. No backend server required.

1. **Static data** loads instantly from `data/BD/viz_data.json` (~3MB processed data)
2. Click **"Fetch Live Data"** to query RIPEstat API in real-time:
   - Fetches Bangladesh ASNs and prefixes
   - Retrieves BGP routes (5 batches in parallel)
   - Resolves ASN names and countries (20 in parallel)
   - Processes 3-layer model (Local ISP → IIG → Outside)
3. All analysis happens client-side using the 3-layer BGP model
4. Switch between 6 visualization types to explore the data from different angles

### The 3-Layer Model

The app analyzes BGP AS paths to identify:

- **Local ISPs** (blue 🔵): Origin networks that announce prefixes but don't have direct international peering
- **IIGs** (green 🟢): Border gateways that peer directly with international networks (first BD ASN after crossing the border)
- **Outside ASNs** (red 🔴): International transit providers and content networks

**Example AS path**: `[Cloudflare, NTT, Bharti Airtel, Summit, ADN Telecom]`
- Outside: Cloudflare, NTT, Bharti Airtel (🔴)
- IIG: Summit (🟢) - first BD ASN after the border
- Local ISP: ADN Telecom (🔵) - origin announcing the prefix

## Visualizations

| Tab | Purpose | Best For |
|---|---|---|
| **Network Graph** | Force-directed graph with color-coded layers | Exploring clusters and overall topology |
| **Traffic Flow** | Sankey diagram showing 3-layer traffic flow | Understanding bottlenecks and volume distribution |
| **Market Share** | Treemap showing each ASN's market share per layer | Comparing relative sizes and dominance |
| **Chord Diagram** | Circular view of pairwise connections | Seeing all interconnections at once |
| **Layered View** | Top-to-bottom hierarchical layout (zoomable) | Following specific paths through layers |
| **Data Table** | Sortable, searchable table with all stats | Finding specific numbers and doing research |

### Interactive Features

All visualizations support:
- **Click**: Highlight an ASN and its connections (click background to clear)
- **Hover**: See detailed tooltip with country, traffic, percentage
- **Filter**: Use the sidebar slider to show/hide low-traffic routes
- **Search**: Type an ASN number or company name to find it instantly
- **Export**: Download CSV/JSON of processed data, or raw BGP routes (~20MB, available after live fetch)

## Updating Static Data

### Quick Method (Browser)
1. Open the live site and click **"Fetch Live Data"** (~1-2 minutes)
2. Once complete, click **"JSON"** export to download `viz_data.json`
3. Replace `data/BD/viz_data.json` with the downloaded file
4. Commit and push to GitHub

### Python Method (Recommended for Repo Updates)

**One-Command Update** (fetches and processes everything):
```bash
# Update all data files (5-15 minutes total)
python3 scripts/update_bgp_data.py

# Then commit the changes
git add data/BD/*.json
git commit -m "Update BGP data: $(date +%Y-%m-%d)"
git push
```

**Script options:**
```bash
python3 scripts/update_bgp_data.py --country BD  # Default
python3 scripts/update_bgp_data.py --country IN  # For other countries
```

**What the script does:**
- ✓ Fetches Bangladesh ASNs and prefixes from RIPEstat
- ✓ Downloads BGP routes in parallel (5 concurrent batches, matching website)
- ✓ Saves raw routes to `bgp_routes_raw.json` (~90MB)
- ✓ Analyzes routes into 3-layer model (Local ISP → IIG → Outside)
- ✓ Fetches ASN info in parallel (20 concurrent, matching website)
- ✓ Applies country detection and well-known ASN overrides
- ✓ Generates visualization data (`viz_data.json`)
- ✓ Updates ASN names database (`asn_names.json`)
- ✓ Creates metadata with timestamp and stats (`metadata.json`)

**Alternative: Individual Scripts** (for debugging/development):
```bash
# Step 1: Fetch raw BGP routes only
python3 scripts/fetch_bgp_routes.py  # Creates bgp_routes_raw.json

# Step 2: Reprocess existing raw data
python3 scripts/reprocess_3layer.py  # Updates viz_data.json, asn_names.json, metadata.json
```

**Why use the Python script?**
- Same parallel fetching as the website (5 BGP batches, 20 ASN lookups)
- Can be automated with cron for daily updates
- Better for CI/CD pipelines
- Saves raw routes for debugging/research
- Consistent output format guaranteed

## Tech Stack

- **D3.js v7** for all visualizations (force simulation, Sankey, treemap, chord, etc.)
- **Vanilla JavaScript** (ES6 modules, no framework, no build step)
- **RIPEstat API** for BGP data (public, no auth, CORS-friendly)
- **ipify.org** for "What's My ASN?" IP detection
- **GitHub Pages** for hosting (pure static site)
- **Python 3** for optional data preprocessing scripts

### Browser Requirements
- Modern browser with ES6 module support (Chrome 61+, Firefox 60+, Safari 11+, Edge 79+)
- JavaScript enabled
- ~5MB memory for processing large datasets
- CORS-enabled fetch API for live data

## Project Structure

```
bgp-bangladesh/
├── index.html                       # Main entry point
├── data/BD/                         # Static data for Bangladesh
│   ├── viz_data.json                # Processed 3-layer visualization data (~3MB)
│   ├── asn_names.json               # ASN names + countries (~50KB)
│   ├── bgp_routes_raw.json          # Raw BGP route snapshot (~90MB, optional)
│   └── metadata.json                # Timestamp, schema version, stats
├── assets/
│   ├── css/styles.css               # All styles (dark theme, responsive)
│   └── js/
│       ├── main.js                  # App orchestrator, event handling
│       ├── api/
│       │   ├── ripestat.js          # RIPEstat client (5x parallel, retry logic, rate limiting)
│       │   └── data-processor.js    # 3-layer model analyzer
│       ├── ui/
│       │   ├── modal.js             # Educational modal (3-layer explanation)
│       │   ├── controls.js          # Sidebar (ASN lists, filters, "What's My ASN?")
│       │   ├── loading.js           # Progress bar, toast notifications
│       │   └── export.js            # CSV/JSON export with 3-layer metadata
│       └── viz/                     # 6 visualization modules
│           ├── force-graph.js       # Network graph (D3 force simulation)
│           ├── sankey.js            # Traffic flow (zoomable, 3 columns)
│           ├── treemap.js           # Market share (adaptive text)
│           ├── chord.js             # Circular connections
│           ├── hierarchical.js      # Layered view (zoomable)
│           └── table.js             # Data table (sortable, filterable)
├── scripts/
│   ├── update_bgp_data.py           # Python: All-in-one data updater (fetch + process)
│   ├── fetch_bgp_routes.py          # Python: Fetch raw BGP routes only (legacy)
│   └── reprocess_3layer.py          # Python: Reprocess raw routes only (legacy)
└── docs/
    ├── README.md                    # User guide
    ├── IMPLEMENTATION_NOTES.md      # Technical details
    └── FIXES_APPLIED.md             # Changelog
```

## Key Differences from Traditional BGP Visualizations

1. **3-Layer Classification**: Most BGP visualizers show a simple "inside vs outside" view. This tool distinguishes between Local ISPs (endpoints), IIGs (actual border gateways), and Outside networks.

2. **Topological, Not Regulatory**: IIGs are identified by their position in BGP AS paths (first BD ASN after the border), not by BTRC license lists. This shows **actual** connectivity.

3. **Both Edge Types**: Visualizes both international peering (Outside → IIG) and domestic peering (Local ISP → IIG) with different visual styles.

4. **Browser-Based Processing**: All route analysis happens client-side. No server required.

5. **Country-Aware**: Detects and displays country flags for every ASN using holder name parsing and well-known ASN databases.

## Use Cases

- **Network Engineers**: Understand peering relationships and path diversity
- **Researchers**: Study Bangladesh's internet topology and resilience
- **Policymakers**: Identify single points of failure and dependencies
- **ISPs**: Benchmark your position in the market
- **General Public**: Learn how the internet works in Bangladesh

## Performance Notes

- **Static Load**: Instant (<100ms)
- **Live Fetch**: ~1-2 minutes for full dataset
  - Step 1 (Country resources): ~5 seconds
  - Step 2 (BGP routes): ~30-60 seconds (5 parallel batches)
  - Step 3 (ASN info): ~20-40 seconds (20 parallel requests)
  - Step 4 (Processing): <1 second
- **Memory Usage**: ~50-100MB during processing
- **Visualization Render**: <500ms for 400+ nodes

## Contributing

Contributions welcome! Areas of interest:
- Support for other countries (expand beyond Bangladesh)
- Additional visualization types
- Performance optimizations
- Better country detection heuristics
- Historical data tracking

## Acknowledgments

- Data: [RIPEstat](https://stat.ripe.net/) API
- Visualization: [D3.js](https://d3js.org/)
- IP Detection: [ipify.org](https://www.ipify.org/)

## License

MIT - See LICENSE file for details
