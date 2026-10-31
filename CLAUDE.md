# BGP Bangladesh

A static site (no build step) that shows how Bangladesh's local ISPs reach the
internet: local companies → IIGs / detected gateways → offshore → international
networks, from RIPEstat BGP data. Live at https://www.shafayat.bd/bgp-bangladesh/.

## Layout

- `index.html` – page shell: sidebar, ARIA tabs, `#viz-panel`, history slider, intro `<dialog>`, SEO metadata.
- `assets/js/main.js` – wiring: data loading, tabs, filters, history slider, live fetch.
- `assets/js/viz/*.js` – one module per tab (see the `chart-views` skill for the module contract).
- `assets/js/viz/force-layout.js` – Network Graph forces, shared by the browser and `scripts/precompute_layout.mjs`.
- `assets/js/ui/chart-a11y.js` – chart labels plus keyboard/button pan and zoom.
- `scripts/update_bgp_data.py` – data pipeline (GitHub Action every 4 h) → `data/BD/viz_data.json` + `data/BD/history/`.
- `scripts/dev/` – Playwright dev tools; `tests-js/` unit tests; `tests-e2e/` browser tests.

D3 v7 is a global loaded from d3js.org; modules are native ES modules.

## Commands

| | |
|---|---|
| `npm run serve` | local server on :8000 with caching off |
| `npm run test:js` | unit tests (node:test) |
| `npm run test:e2e` | browser regression tests (graph stability, slider, keyboard, phone sidebar) |
| `npm run audit:a11y` | axe WCAG 2.2 AA audit of every view, desktop + phone |
| `npm run screenshots` | every view at desktop + phone into `.dev-output/screenshots/` |
| `npm run profile -- --check` | graph/slider performance with budgets |
| `npm run layout` | bake Network Graph positions into the data files |
| `npm run og-image` | regenerate `assets/img/og-image.png` |
| `python -m unittest discover -s tests -p "test_*.py"` | pipeline tests |

The dev scripts use installed Chrome, or Playwright's Chromium (`npx playwright install chromium`).

## Rules that matter here

- **Don't commit changes under `data/`.** A bot commits new data every 4 hours, so local data commits conflict. `npm run layout` edits data files locally for testing only; CI bakes positions on its next run. Pull before pushing.
- **Never put a CSS `transition` on properties the graphs update every frame.** In Chromium the SVG `transform` and `d` attributes are CSS properties; a blanket `transition` on `.node`/`.link` once started ~8,500 animations per tick and made frames 9x slower. Transition only highlight properties (opacity, filter).
- **Avoid CSS `filter` on many SVG elements.** A drop-shadow on ~700 highlighted links cost ~0.7 s per redraw.
- **A click on a node also fires d3-drag's `start`.** Never reheat the simulation there, or every click moves the whole graph.
- Keep the site WCAG 2.2 AA: `npm run audit:a11y` must report no violations and `npm run test:e2e` must pass.

## Known issues

- Moving "Max Routes" to ∞ saves `Infinity` to localStorage, which JSON turns into `null`; on reload the filter compares `count <= null` and the graphs come up empty.
- `wasm/bgp-wasm/` (the WASM accelerator) isn't committed; the 404 for `bgp_wasm.js` is expected and the JS fallback runs.
- Bar chart SVGs are taller than their panel, so some bars need zooming to reach.
- Landscape phones (e.g. 844×390) leave only ~212 px for the chart.
