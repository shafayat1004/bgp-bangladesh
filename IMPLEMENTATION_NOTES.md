# Implementation Notes - 3-Layer BGP Visualization

## Recent Changes (Feb 7, 2026)

### ✅ 3-Layer Model Implementation

Transitioned from 2-layer (inside/outside) to 3-layer model:

- **Layer 1: Local ISPs** (blue) - Origin networks (774 total, top 264 shown)
- **Layer 2: IIGs** (green) - Border gateways (32 shown)  
- **Layer 3: Outside ASNs** (red) - International transit (110 shown)

**Edge Types:**
- **Domestic** (dashed blue): Local ISP → IIG (300 edges)
- **International** (solid cyan): IIG ← Outside ASN (300 edges)

### ✅ Country Flags & Metadata

- Added country code extraction from RIPEstat ASN data
- Display flag emojis for all ASNs throughout UI
- 862/988 ASNs now have country metadata

### ✅ "What's My ASN?" Tool

- Uses `api.ipify.org` for CORS-safe IP detection
- Fallback to Cloudflare CDN trace
- Queries RIPEstat for network info and ASN details
- Checks against full BD ASN list for accurate country tagging

### ✅ UI Improvements

**Fixed Issues:**
1. **Sankey diagram edges now visible** - Increased opacity from 0.25 to 0.35, min stroke width to 1px
2. **Tooltip positioning** - Smart viewport-aware positioning prevents cutoff
3. **Treemap text overlap** - Adaptive font sizing and better truncation
4. **Network graph density** - Default min traffic filter set to 1000 (was 0)
5. **ASN search** - Real-time search bar with 500ms debounce

**New Features:**
- Legend in force graph showing edge types and node colors
- ASN search bar in sidebar
- Better visual feedback for "What's My ASN?" results
- Improved toast messages with context

### 🐛 Known Limitations

1. **Small ISPs not visible**: Only top 300 edges per type are shown to keep performance reasonable. Smaller ISPs (like AS134599 Digital Dot Net) may not appear but still route through visible IIGs.

2. **Country detection accuracy**: ~87% of ASNs have country codes. Some require manual enrichment via well-known mappings.

3. **Data freshness**: Static data is a snapshot. Use "Fetch Live Data" for current state (takes ~60-90s).

## File Structure Changes

```
New/Modified:
├── scripts/reprocess_3layer.py      # Generates 3-layer viz_data.json
├── data/BD/viz_data.json            # Now 600 edges (300 domestic + 300 intl)
├── data/BD/asn_names.json           # 988 ASNs with country field
├── data/BD/metadata.json            # schema_version: 2, model: "3-layer"
├── assets/js/api/ripestat.js        # Removed CORS-breaking User-Agent header
├── assets/js/api/data-processor.js  # 3-layer gateway analysis
├── assets/js/ui/controls.js         # 3-layer sidebar lists + My ASN display
├── assets/js/ui/tooltip.js          # NEW: Smart tooltip positioning
└── assets/js/viz/*.js               # All updated for 3 node types + flags
```

## Testing Checklist

- [x] Static data loads and displays 3 layers
- [x] Domestic edges visible as dashed blue lines
- [x] Country flags display correctly
- [x] "What's My ASN?" detects IP and resolves ASN with country
- [x] Tooltips stay within viewport
- [x] ASN search finds and highlights nodes
- [x] Default filter (1000) reduces graph density
- [x] All 6 visualizations render correctly
- [x] Export functions include country and edge type columns
- [ ] Live data fetch (requires user to test with full network access)

## Performance Notes

- Initial load: <500ms (68KB viz_data.json + 32KB asn_names.json)
- Network graph with 406 nodes: Smooth at default 1000 filter (~120 visible nodes)
- Sankey with 600 edges: Renders in ~100ms
- Treemap with 406 nodes: Renders in ~80ms
