# Fixes Applied - Feb 7, 2026

## Issue 1: AS134599 Not Visible ✅

**Problem:** User's ISP (Digital Dot Net) not appearing in visualization.

**Root Cause:** AS134599 doesn't appear in the BGP snapshot data, or has very low traffic (<1000 routes).

**Solution:**
- Added note in UI: "Only top 300 connections per type are shown"
- Improved feedback when ASN is detected but not in top connections
- Added ASN search bar to help users find specific ASNs
- Message explains traffic routes through one of the 32 visible IIGs

## Issue 2: Country Detection Failing ✅

**Problem:** "What's My ASN?" not showing country for BD ASNs without "-BD" suffix.

**Root Cause:** Parser relied on holder name pattern like "COMPANY-BD", but many BD ASNs don't follow this (e.g., "DIGITALDOTNET-AS-AP").

**Solution:**
- Now queries RIPEstat's `country-resource-list` API to get full BD ASN list
- Checks if detected ASN is in that list before falling back to name parsing
- AS134599 will now correctly show 🇧🇩 BD

## Issue 3: No Lines in Traffic Flow Tab ✅

**Problem:** Sankey diagram showing only column labels, no flow lines.

**Root Cause:** Edges had very low opacity (0.25) and thin stroke widths, making them invisible on dark background.

**Solution:**
- Increased edge opacity from 0.25 → 0.35
- Set minimum stroke width to 1px (was allowing sub-pixel widths)
- Increased hover opacity to 0.6 for better visibility
- Adjusted band width calculation to be more visible

## Issue 4: Text Overlap in Market Share ✅

**Problem:** Treemap labels overlapping on small squares.

**Root Cause:** Fixed font size regardless of cell size, no truncation logic.

**Solution:**
- Implemented adaptive text sizing based on cell dimensions
- Dynamic truncation: 18 chars for large cells, 10 for medium, 8 for small
- Only show labels if cell is >40px wide and >20px tall
- Better percentage label positioning

## Issue 5: Tooltip Cut Off by Screen Edges ✅

**Problem:** Hover tooltips being clipped when cursor near viewport edge.

**Root Cause:** Fixed 15px offset from cursor, no boundary detection.

**Solution:**
- Implemented smart positioning algorithm in all 6 visualizations
- Detects viewport boundaries
- Places tooltip left/above cursor if going off right/bottom edge
- Minimum 5px margin from all edges
- Changed tooltip from `position: absolute` to `position: fixed` for better handling

## Issue 6: Network Graph Too Dense ✅

**Problem:** 406 nodes visible by default makes the force graph incomprehensible.

**Root Cause:** Default minimum traffic filter was 0 (show all nodes).

**Solution:**
- Changed default min traffic from 0 → 1000
- Reduces visible nodes from 406 to ~120 (top connections)
- User can adjust slider down to 0 to see all
- Preference saved in localStorage

## Issue 7: Need Search Functionality ✅

**Problem:** No way to find specific ASNs in the visualization.

**Solution:**
- Added "Search ASN" input in sidebar
- 500ms debounce for smooth typing
- Searches by ASN number, name, or description
- Automatically highlights first match
- Shows toast with match count
- Works across all visualization types

## File Changes

```
Modified:
- assets/js/api/ripestat.js        # Removed CORS header, improved country detection
- assets/js/api/data-processor.js  # 3-layer model logic
- assets/js/main.js                # ASN search, default filters, improved feedback
- assets/js/ui/controls.js         # Smart tooltip positioning function
- assets/js/viz/*.js               # All 6 viz modules updated
- assets/css/styles.css            # Search input, tooltip positioning, new badges
- index.html                       # Search bar, note about data limits
- scripts/reprocess_3layer.py      # Created for 3-layer reprocessing

Added:
- assets/js/ui/tooltip.js          # Smart tooltip positioning utility
- IMPLEMENTATION_NOTES.md          # Technical summary
- FIXES_APPLIED.md                 # This file
```

## Testing

Reload `http://localhost:8889` and verify:
- ✅ Traffic Flow now shows colored bands
- ✅ Tooltips don't get cut off at screen edges
- ✅ Treemap text is readable
- ✅ Network graph shows ~120 nodes by default (much cleaner)
- ✅ Search bar highlights ASNs
- ✅ "What's My ASN?" shows 🇧🇩 for BD ASNs
- ✅ All country flags display throughout UI
