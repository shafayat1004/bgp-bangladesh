---
name: chart-views
description: The contract and conventions for the BGP Bangladesh visualization tabs (Network Graph, Traffic Flow, Layered View, Gateway Ranking, Country Origins, Data Table) - module interface, registering a tab, fitting to the screen, keeping pan/zoom across history snapshots, accessibility and SVG performance rules. Use this whenever adding a new chart or tab, changing how an existing view draws, zooms, highlights or responds to filters and the history slider, or when a view looks tiny, off-screen, resets unexpectedly, or isn't keyboard accessible.
---

# Chart views

Each tab is a module in `assets/js/viz/` registered in `vizModules` in
`assets/js/main.js`. All of them draw into `#viz-panel` using the global `d3`.

## Module contract

`main.js` calls these. Only `init`, `loadData` and `destroy` are required; the
rest are feature-detected (`mod.updateData?.(...)`).

| Export | Called when | Notes |
|---|---|---|
| `init(containerId)` | tab opens, panel resized | create the `<svg>` (and any `.viz-controls`) inside the container |
| `loadData(data, options)` | first draw, tab switch, live fetch, "Static Data" | full draw; `options` has `minTraffic`, `maxTraffic`, `nodeSize`. Reset zoom/highlight here |
| `updateData(data, options)` | history slider step | keep the user's pan/zoom and highlight; without it the slider falls back to a full rebuild, which resets their view |
| `destroy()` | leaving the tab | clear the panel, stop timers/simulations |
| `updateFilter(min, max)` | Min/Max Routes sliders | redraw with the new range, keep the view |
| `filterByTypes(activeTypes)` | type checkboxes | hide rather than redraw where possible |
| `highlightASN(asn)` | sidebar list, search, What's My ASN | |
| `resetView()` | Reset View button, `0` key | back to the fitted view |
| `toggleLabelsVisibility()`, `setNodeSize(n)` | sidebar controls | optional |

`data` is `{ nodes, edges, stats, layout? }`. Nodes have `asn`, `type`
(`local-company`, `iig`, `detected-iig`, `offshore-enterprise`,
`offshore-gateway`, `outside`), `traffic`, `name`, `country`. Edges have
`source`, `target`, `count` and `type` (`domestic`/`international`). D3
simulations replace `source`/`target` with node objects, so read them as
`e.source?.asn || e.source`.

## Adding a tab

1. Write the module with the contract above.
2. Import it in `main.js` and add it to `vizModules`.
3. Add the tab button to `#tab-nav` in `index.html`, copying an existing one:
   `role="tab"`, `id="tab-<name>"`, `data-tab="<name>"`,
   `aria-controls="viz-panel"`, `aria-selected="false"`, `tabindex="-1"`.
   Arrow-key handling and selection state come from `setupTabs`/`highlightTab`.
4. Add the name to `TABS` in `scripts/dev/lib/site.mjs` so the screenshots,
   accessibility audit and e2e tests cover it.

## Drawing conventions

- **Fit to the panel.** Lay the chart out in its own coordinates, then compute
  a zoom transform that fits the content to `#viz-panel` (see `fitTransform` in
  `force-graph.js`, and `chooseColumns` in `hierarchical.js`, which picks a grid
  shape for the panel's aspect ratio). Starting at a fixed scale or offset is
  what left views tiny or half off-screen. Keep the fitted transform for
  `resetView`.
- **Portrait screens.** Phones are portrait; a left-to-right chart should flow
  top to bottom there (the Network Graph transposes through `sx`/`sy`; Traffic
  Flow has an orientation toggle).
- **Keep the view across snapshots.** In `updateData`, keep the current zoom
  transform (`hierarchical.js` stores `savedTransform`) and re-apply any
  highlight if that ASN still exists.
- **Accessibility.** After setting up zoom, call
  `makeChartAccessible(svg, { zoom, label, reset, onEscape })` from
  `assets/js/ui/chart-a11y.js`. It makes the SVG focusable with a spoken
  `label`, adds arrow/plus/minus/0 keys and on-screen pan/zoom buttons (needed
  for WCAG 2.5.7, so nobody has to drag), and Escape runs `onEscape`. Write the
  label as the chart's takeaway with real numbers (counts, top five), not "a
  chart". Pass `toolbar` to add the buttons to an existing `.viz-controls`. The
  Data Table is the full text alternative, so new data should appear there
  too.
- **Controls inside the panel** are real `<button type="button">`s with an
  accessible name; toggles carry `aria-pressed`. If a re-render replaces the
  focused control, put focus back on its replacement.
- **Colours**: text must reach 4.5:1 on the dark panels (`--text-dim` is the
  lightest gray that passes). Pair colour with a label or shape; never use
  colour alone.
- **Motion**: honour `prefers-reduced-motion` for d3 transitions (see
  `resetView` in `force-graph.js`); CSS animations are already handled
  globally.

## SVG performance rules

These came from measured slowdowns on this site:

- No CSS `transition` on anything whose `transform`, `d`, `x`/`y` or `r` changes
  per frame. Chromium animates SVG geometry attributes as CSS properties.
- No CSS `filter` (drop-shadow, blur) on large sets of elements; one
  highlighted node is fine, 700 highlighted links are not.
- Thousands of elements are normal here (1,600 nodes, 3,000 links). Rebuilding
  them costs ~80 ms; running a simulation costs ~30-40 ms per frame. Prefer
  drawing precomputed positions once over animating.
- Don't restart a simulation on drag start; d3-drag fires it on every click.

## Check your work

Use the `verify-site-change` skill: `npm run test:e2e`, `npm run audit:a11y`,
`npm run screenshots` (look at desktop and phone), and `npm run profile --
--check` for anything that touches drawing or the slider.
