# BGP Bangladesh

A static site (no build step) that shows how Bangladesh's local ISPs reach the
internet: local companies → IIGs / detected gateways → offshore → international
networks, from RIPEstat BGP data. Live at https://www.shafayat.bd/bgp-bangladesh/.

## What the site should feel like

Read this before any UI or content change. The roadmap is issue #24.

- **Audience: curious people with basic internet knowledge**, not network
  engineers and not complete beginners. Assume they know what an ISP and a
  website are; don't assume they know ASN, BGP, transit or peering.
- **Every view answers a question a person has.** For example: How does my
  internet reach the world? Which gateways carry the most? What happens if one
  fails? What changed? If a view can't say which question it answers, rethink
  it. Drawing all ~1,600 networks at the same weight isn't an answer.
- **Aggregate first, then let people focus.** Show the few things that matter
  (gateways, big transit, "1,300 smaller networks" as a group), and let a
  click, search or the sidebar focus on one network.
- **Plain, accurate words.** Say networks and connections, never nodes and
  edges. The data counts *route observations*, so say "routes" and don't call
  it traffic. Every technical term (ASN, IIG, registered country, IP location,
  peering location, transit, share) gets an explanation that opens on hover,
  keyboard focus and tap. Use the shared glossary (`assets/js/ui/glossary.js`)
  instead of writing explanations inline.
- **Calm and predictable.** Nothing should jump when the date or a filter
  changes: fixed sizes, tabular numbers, stable ordering, and the user's
  zoom, scroll, sort and selection kept. Things move only when movement helps
  understanding. Static charts don't pan or zoom.
- **Standard places and gestures.** Search in the header, controls where
  people expect them, buttons that repeat when held, arrow keys that work over
  a chart.
- **Readable at the default view.** If someone has to zoom to understand the
  main point, the default is wrong. Check phones (portrait and landscape) as
  well as desktop.
- **Trustworthy.** Say where the data comes from, how fresh it is, and why a
  network is classified the way it is. Gateway classifications must be
  verifiable (sources and dates).
- **Accessible by default** (WCAG 2.2 AA): keyboard, screen readers, contrast,
  reduced motion, no information by colour alone.

Automated checks passing is not the same as this being met. The checks passed
while the site still had jargon, a jumpy table and an unreadable flow chart.

## Layout

- `index.html` – page shell: sidebar, ARIA tabs, `#viz-panel`, history slider, intro `<dialog>`, SEO metadata.
- `assets/js/main.js` – wiring: data loading, tabs, filters, history slider, live fetch.
- `assets/js/viz/*.js` – one module per tab (see the `chart-views` skill for the module contract).
- `assets/js/viz/force-layout.js` – Network Graph forces, shared by the browser and `scripts/precompute_layout.mjs`.
- `assets/js/ui/chart-a11y.js` – chart labels plus keyboard/button pan and zoom.
- `scripts/update_bgp_data.py` – data pipeline (GitHub Action every 4 h) → `data/BD/viz_data.json` + `data/BD/history/` (see the `data-pipeline` skill before changing it or the data).
- `scripts/dev/` – Playwright dev tools; `tests-js/` unit tests; `tests-e2e/` browser tests.

D3 v7 is a global loaded from d3js.org; modules are native ES modules.

## Commands

| | |
|---|---|
| `npm run serve` | local server on :8000 with caching off (`PORT=8010` for another port, `-- --lan` to open it from a phone on the same Wi-Fi) |
| `npm run test:js` | unit tests (node:test) |
| `npm run test:e2e` | browser regression tests (graph stability, slider, keyboard, phone sidebar) |
| `npm run audit:a11y` | axe WCAG 2.2 AA audit of every view, desktop + phone |
| `npm run screenshots -- --slider-step` | every view at desktop, phone and landscape phone into `.dev-output/screenshots/`, plus layout shifts after a date step |
| `npm run profile -- --check` | graph/slider performance with budgets |
| `npm run layout` | bake Network Graph positions into the data files |
| `npm run og-image` | regenerate `assets/img/og-image.png` |
| `python -m unittest discover -s tests -p "test_*.py"` | pipeline tests |

The dev scripts use installed Chrome, or Playwright's Chromium (`npx playwright install chromium`).

## Rules that matter here

- **Don't commit changes under `data/`.** A bot commits new data every 4 hours, so local data commits conflict. `npm run layout` edits data files locally for testing only; CI bakes positions on its next run. Pull before pushing. The rare exception, a one-off correction the next run can't make (e.g. wrong values in history), follows the `data-pipeline` skill.
- **Never put a CSS `transition` on properties the graphs update every frame.** In Chromium the SVG `transform` and `d` attributes are CSS properties; a blanket `transition` on `.node`/`.link` once started ~8,500 animations per tick and made frames 9x slower. Transition only highlight properties (opacity, filter).
- **Avoid CSS `filter` on many SVG elements.** A drop-shadow on ~700 highlighted links cost ~0.7 s per redraw.
- **Put `:hover` styles inside `@media (hover: hover) and (pointer: fine)`.** On phones a hover style sticks after a tap (a tapped button stayed lifted and green, looking selected). Touch gets `:active` press styles instead. Chrome's device mode doesn't show this; check in the iOS Simulator or on a phone.
- **A click on a node also fires d3-drag's `start`.** Never reheat the simulation there, or every click moves the whole graph.
- Keep the site WCAG 2.2 AA: `npm run audit:a11y` must report no violations and `npm run test:e2e` must pass.
- **PRs close their issues.** Fill in `.github/pull_request_template.md`: one `Fixes #N` line per issue the PR finishes (GitHub closes it when the PR merges into `main`), `Part of #N` for issues it only moves forward, or `No issue`. The "PR links issues" check fails otherwise. Merges are squash or rebase only.

## Known issues

- `wasm/bgp-wasm/` (the WASM accelerator) isn't committed; the 404 for `bgp_wasm.js` is expected and the JS fallback runs.
