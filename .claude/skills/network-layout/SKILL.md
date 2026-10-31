---
name: network-layout
description: How the Network Graph's node positions are computed, baked into the data files, and drawn - and how to change them safely. Use this whenever the user wants to change how the network graph is arranged (spacing, columns, which category goes where, node sizes affecting layout), mentions the graph "jumping", "moving", "re-laying out" or being slow to settle, touches force-layout.js, precompute_layout.mjs or the update-bgp-data workflow's layout step, or asks why positions differ between snapshots.
---

# Network Graph layout

## How it works

The layout reads left to right along the path traffic takes: local companies
(far left), IIGs, detected gateways, offshore networks, international networks
(far right). Each category is pulled toward its own column.

- **Forces** live in `assets/js/viz/force-layout.js` (`FLOW_X` column
  positions, `configureForces`, `bandPosition` for starting positions). The
  browser and the precompute script both import it, so baked positions match
  what the browser would compute.
- **Baking**: `scripts/precompute_layout.mjs` (`npm run layout`) runs the
  simulation to completion for the default filter (Min Routes 100) in a
  3200×1000 layout space. It appends a `"layout"` block (`version`, `width`,
  `height`, filter, `positions: {asn: [x, y]}`) to the end of
  `data/BD/viz_data.json` and every history snapshot. It appends text instead
  of re-serialising because Python writes `100.0` and JavaScript writes `100`;
  re-serialising would rewrite the whole file.
- **Stability across snapshots**: each snapshot is seeded from the previous
  snapshot's positions with a gentle reheat (`SEEDED_ALPHA = 0.1`), so nodes
  move ~10 layout units between neighbouring snapshots. `viz_data.json` reuses
  the newest snapshot's layout when the files hold the same data.
- **In the browser** (`assets/js/viz/force-graph.js`): when the data has a
  current-version layout and the filter matches, positions are drawn as-is
  with no simulation (`render({ alpha: 0 })`) and the zoom fits the drawing to
  the panel. Other filters start from the baked positions and relax gently.
  Data without a layout (live fetch) simulates in the panel's own space.
- **Portrait panels** draw the layout transposed (flow top to bottom) through
  `sx`/`sy`. Layout coordinates never change; only drawing and dragging map
  through them.
- **CI**: `.github/workflows/update-bgp-data.yml` runs `npm ci` then
  `node scripts/precompute_layout.mjs --country BD` after the Python updater.
  The script only processes files without a current-version layout, so
  normally it touches just the new snapshot (~1.5 s).

## Changing the layout

1. Edit `force-layout.js`. Keep it free of DOM access; it runs in Node too.
2. **Bump `LAYOUT_VERSION`.** Files with an older version are then recomputed
   by CI automatically, and the browser stops trusting stale positions (it
   falls back to simulating) until they are.
3. Iterate on one file quickly: compute a fresh layout for `viz_data.json`
   with `computeLayout` and `withLayoutBlock` from
   `scripts/precompute_layout.mjs`, reload, and screenshot the graph
   (`npm run screenshots -- --tabs force-graph`). Print each category's x
   range (10th to 90th percentile) to see whether the columns overlap; it's
   quicker than eyeballing.
4. When it looks right, recompute everything: `npm run layout -- --force`.
5. Check stability and speed: `npm run profile`. Slider drift is the median
   node movement per step; opening the graph should show 0 simulation ticks.
6. Check both orientations: `--viewports desktop,phone` (portrait is drawn
   transposed).
7. `npm run test:js` (`tests-js/precompute-layout.test.js` covers determinism,
   seeding and the text-append format).

## Baking now, without waiting for CI

Signs the committed data has no current layout: the graph moves and settles
on open, `npm run profile` prints "baked layout in data: no", and the e2e
"baked positions" test skips instead of failing (issue #32). If the user wants
it fixed now, bake locally; don't dispatch `update-bgp-data.yml`. The workflow
refetches BGP data and adds an off-schedule history snapshot just to run a
script that takes ~1 s per file.

```bash
git fetch origin
git worktree add -b bake-layout <scratch>/bake origin/main   # clean copy, not your working tree
ln -s "$PWD/node_modules" <scratch>/bake/node_modules
(cd <scratch>/bake && node scripts/precompute_layout.mjs --country BD)
```

Before pushing:
- `git diff --numstat` shows additions only (the script appends a `layout`
  block; a deleted line means something else changed).
- Every file has positions: `JSON.parse(...).layout.positions` is non-empty
  for `viz_data.json` and each history snapshot.
- `origin/main` hasn't moved since the worktree was cut, and
  `gh run list --workflow update-bgp-data.yml --status in_progress` is empty. A
  run that checked out the older `main` can't push over yours.

Commit only `data/BD`, push to `main`, then check `npm run profile` shows 0
simulation ticks on open and the e2e "baked positions" test runs. Remove the
worktree and branch afterwards.

## Things that bite

- **Don't commit `data/`.** The bot commits data every 4 hours; local data
  commits conflict. CI recomputes the layout because of the version bump. The
  one exception is a layout-only bake CI hasn't done yet (see above).
- **Layout space matters**: the zoom fits the whole drawing, so a tall, narrow
  layout makes everything tiny. Widening `LAYOUT_WIDTH` spreads the columns;
  pulling toward the vertical middle (`forceY` strength) keeps it from getting
  tall.
- **Big gateways** have collision radii over 300 layout units; they push into
  neighbouring columns more than the column gap suggests.
- **Never reheat the simulation on drag start**: d3-drag fires `start` on every
  click, so the whole graph moves when someone clicks a node.
- A higher `SEEDED_ALPHA` lets newly appearing nodes settle better but makes
  everything drift more between snapshots (0.3 gave ~70 units, 0.1 ~30).
