---
name: verify-site-change
description: Check a change to the BGP Bangladesh site in a real browser before calling it done - tests, accessibility audit, desktop and phone screenshots, and performance budgets. Use this whenever you've edited anything under assets/, index.html or the chart/slider/layout code, when the user asks to check how the site looks or behaves on desktop or phone, says it feels slow, or before committing site changes, even if they don't mention testing.
---

# Verify a site change

The site is mostly visual and interactive, so unit tests alone miss most
regressions. Earlier bugs here (a 9x frame slowdown from a CSS transition, every
click moving the whole graph, the slider resetting the user's zoom) all passed
the unit tests. This workflow catches that class of problem, using scripts in
`scripts/dev/` that start their own server and browser.

## Steps

Run what matches the change; when unsure, run all of it.

1. **Unit tests** – `npm run test:js` (fast; always).
2. **Browser regression tests** – `npm run test:e2e` (~40 s). Covers: no console
   errors in any view on desktop and phone, baked layout draws without
   simulating, clicking a node moves nothing, the history slider keeps pan/zoom,
   keyboard paths, the phone sidebar, the intro dialog.
3. **Look at it** – `npm run screenshots` writes every view at desktop and
   phone sizes to `.dev-output/screenshots/` (`--tabs force-graph,intro,sidebar`
   and `--viewports desktop,phone,phone-landscape` narrow it down). Open the
   PNGs that relate to the change and look at them: the script only flags
   console errors and sideways scrolling, so it can't tell whether the picture
   is right. Check that nothing overlaps, the chart fills its panel, and text
   is legible.
4. **Accessibility** – `npm run audit:a11y` must end with "No axe violations".
   Each failure prints the rule, a help link and the offending elements.
5. **Performance** – for changes to the Network Graph, the slider, chart CSS or
   data loading: `npm run profile -- --check`. It fails when a budget is
   exceeded (graph open blocking time, slider step time, drag responsiveness,
   nodes moved by a click). Compare against the numbers before your change
   (`--json` saves `.dev-output/profile.json`). These are fast-machine numbers;
   a phone is several times slower, so treat a regression as real even if it is
   under budget.

## Reading results

- **Baked layout**: the profile header says whether `data/BD/viz_data.json` has
  baked positions. Without them the graph simulates on load and the numbers
  look worse; run `npm run layout` (don't commit the data, see CLAUDE.md).
- **Flaky timing**: rerun once before chasing a timing failure.
- **Need more detail** than the scripts give? Import the helpers from
  `scripts/dev/lib/site.mjs` (`startServer`, `launchBrowser`, `openSite`,
  `switchTab`, `nodePositions`, `movement`) in a scratch script rather than
  rebuilding the setup: `openSite` already dismisses the intro, accepts the
  Network Graph CPU warning, resets saved filters and collects console errors.
- **Stale code in a browser you drive yourself**: `npm run serve` sends
  `Cache-Control: no-store`; `python -m http.server` doesn't, and Chrome then
  keeps running old ES modules after an edit.

## When you add behaviour

If you fix a bug or add an interaction that could silently break later, add a
test to `tests-e2e/site.test.mjs` using the same helpers. Then make sure it can
fail: put the bug back temporarily and confirm the test goes red.

## Reporting

Say which checks ran and their results, which screenshots you looked at, and
anything you couldn't verify (for example, no screen reader pass, or only
desktop checked).
