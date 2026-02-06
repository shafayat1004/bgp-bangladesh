# BGP Bangladesh - Internet Path Visualization

An interactive visualization platform showing how Bangladesh's internet connects to the global network via BGP routing. Explore domestic gateways, international transit providers, and traffic bottlenecks.

**[Live Demo](https://yourusername.github.io/bgp-bangladesh/)** (replace with your GitHub Pages URL)

## What Is This?

Every time you visit a website from Bangladesh, your data travels through a chain of networks:

```
Your ISP  →  Domestic Gateway (IIG)  →  International Transit  →  The World
```

This tool visualizes those paths using real BGP (Border Gateway Protocol) routing data from [RIPEstat](https://stat.ripe.net/). It reveals:

- **Domestic bottlenecks**: Which Bangladeshi networks carry the most international traffic
- **International dependencies**: Which foreign networks Bangladesh relies on
- **Path diversity**: How resilient the country's internet connectivity is
- **Single points of failure**: What happens if a major gateway goes down

## Features

- **6 Interactive Visualizations**: Network graph, Sankey flow, treemap, chord diagram, hierarchical view, and data table
- **Live Data Fetching**: Fetch current BGP state directly in your browser from RIPEstat API
- **Static Baseline Data**: Pre-loaded snapshot for instant viewing
- **Data Export**: Download nodes/edges as CSV or full dataset as JSON
- **Educational Modal**: Explains BGP concepts for non-technical users
- **Responsive Design**: Works on desktop and mobile

## How It Works

All data fetching and processing happens **100% in your browser**. No backend server required.

1. **Static data** loads instantly from `data/BD/viz_data.json` (68KB)
2. Click **"Fetch Live Data"** to query RIPEstat API in real-time
3. The app fetches BGP routes, resolves ASN names, and processes everything client-side
4. Switch between 6 visualization types to explore the data from different angles

## Visualizations

| Tab | Purpose |
|---|---|
| **Network Graph** | Force-directed graph showing all connections and clusters |
| **Traffic Flow** | Sankey diagram showing volume flowing from outside to inside |
| **Market Share** | Treemap showing each ASN's share of total traffic |
| **Chord Diagram** | Circular view of pairwise connections |
| **Layered View** | Clean top-to-bottom view of the gateway structure |
| **Data Table** | Sortable, searchable table with precise numbers |

## Updating Static Data

1. Open the live site in your browser
2. Click **"Fetch Live Data"** and wait for completion
3. Click **"JSON"** export button to download the processed data
4. Replace `data/BD/viz_data.json` with the downloaded file
5. Update `data/BD/metadata.json` with the current timestamp
6. Commit and push to GitHub

## Tech Stack

- **D3.js v7** for all visualizations
- **Vanilla JavaScript** (ES6 modules, no framework)
- **RIPEstat API** for BGP data (public, no auth required)
- **GitHub Pages** for hosting

## Project Structure

```
bgp-bangladesh/
├── index.html                    # Main entry point
├── data/BD/                      # Static data for Bangladesh
│   ├── viz_data.json             # Processed visualization data (68KB)
│   ├── asn_names.json            # ASN company names (32KB)
│   ├── bgp_routes_raw.json       # Raw BGP route snapshot (90MB)
│   └── metadata.json             # Timestamp and stats
├── assets/
│   ├── css/styles.css            # All styles
│   └── js/
│       ├── main.js               # App orchestrator
│       ├── api/ripestat.js       # API client with retry logic
│       ├── api/data-processor.js # Raw → viz data pipeline
│       ├── ui/modal.js           # Educational modal
│       ├── ui/controls.js        # Sidebar controls
│       ├── ui/loading.js         # Progress & toasts
│       ├── ui/export.js          # CSV/JSON export
│       └── viz/                  # 6 visualization modules
└── docs/README.md                # User guide
```

## License

MIT
