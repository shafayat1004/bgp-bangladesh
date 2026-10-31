---
name: verify-site-change
description: Check a change to the BGP Bangladesh site before calling it done - tests, accessibility audit, desktop and phone screenshots, layout-shift and performance checks, and a review from a non-expert visitor's point of view. Use this whenever you've edited anything under assets/, index.html, UI text or the chart/slider/layout code, when the user asks to check how the site looks, reads or behaves on desktop or phone, says it feels slow, jumpy or confusing, or before committing site changes, even if they don't mention testing.
---

# Verify a site change

The site is mostly visual and interactive, so unit tests alone miss most
regressions. Earlier bugs here (a 9x frame slowdown from a CSS transition, every
click moving the whole graph, the slider resetting the user's zoom) all passed
the unit tests. The scripts in `scripts/dev/` start their own server and
browser and catch that class of problem.

They can't judge whether the site makes sense to its audience. Every automated
check passed while the site still had graph jargon, a table that jumped on each
date change and an unreadable flow chart. That's why the last step is a review
against the goals in `CLAUDE.md` ("What the site should feel like").

## Steps

Run what matches the change; when unsure, run all of it.

1. **Unit tests** – `npm run test:js` (fast; always).
2. **Browser regression tests** – `npm run test:e2e` (~40 s). Covers: no console
   errors in any view on desktop and phone, baked layout draws without
   simulating, clicking a node moves nothing, the history slider keeps pan/zoom
   and the Data Table's sort/page/scroll, keyboard paths, the phone sidebar,
   the intro dialog. Keep the full output
   (`mkdir -p .dev-output && npm run test:e2e 2>&1 | tee .dev-output/e2e.log`) rather than grepping it
   down to the totals: when a run fails you need the `✖` line to know which
   test, and a failure you can't name can't be told apart from flakiness.
3. **Look at it** – `npm run screenshots -- --slider-step` writes every view
   at desktop, phone and landscape-phone sizes to `.dev-output/screenshots/`,
   plus an "after-step" shot one date earlier (`--tabs force-graph,intro,sidebar`
   and `--viewports desktop,phone` narrow it down). Open the PNGs that relate to
   the change and look at them: the script only flags console errors, sideways
   scrolling and elements that move after a date step (`SHIFT` lines), so it
   can't tell whether the picture is right. Check that nothing overlaps, the
   chart fills its panel, and text is legible at that size. Any `SHIFT` line
   on something you touched is a regression to fix, not a note.
4. **Accessibility** – `npm run audit:a11y` must end with "No axe violations".
   Each failure prints the rule, a help link and the offending elements.
5. **Performance** – for changes to the Network Graph, the slider, chart CSS or
   data loading: `npm run profile -- --check`. It fails when a budget is
   exceeded (graph open blocking time, slider step time, drag responsiveness,
   nodes moved by a click). Compare against the numbers before your change
   (`--json` saves `.dev-output/profile.json`). These are fast-machine numbers;
   a phone is several times slower, so treat a regression as real even if it is
   under budget.
6. **Review it as a visitor** – look at the screenshots and use the page
   (`npm run serve`) as someone with basic internet knowledge who has never
   seen this site. For the views you changed, answer honestly:
   - Can I say in one sentence what question this view answers, and is the
     answer visible without zooming, on a phone too?
   - Is every technical term explained where it appears (hover, focus and tap)?
     Are there any graph/math words (node, edge) or misleading ones (calling
     route counts "traffic")?
   - When I change the date or a filter, does anything jump, reorder for no
     reason, or lose my zoom, scroll, sort or selection?
   - Does anything move or zoom that doesn't need to (a bar chart that pans)?
     Are controls where I'd expect them, and do they behave the usual way?
   - Do I know where the data comes from and how fresh it is?
   - Is colour the only way to tell two things apart?
   - Does the data itself look right? Names should read like company names
     (registry handles such as `SUMMITCOMMUNICATIONS-BD` are noise; use
     `friendlyName` from `assets/js/ui/names.js`), and counts, countries and
     categories should be plausible. "29 networks in American Samoa" was a
     pipeline bug that only a screenshot showed; see the `data-pipeline` skill.

   Fix what you can within the change. For anything bigger, check whether an
   issue already covers it (`gh issue list`; roadmap #24) and mention it, or
   suggest a new one.

7. **Pipeline or data changes** – if you touched `scripts/*.py`, the live
   fetch in `assets/js/api/`, or anything under `data/`, also run
   `python3 -m unittest discover -s tests -p "test_*.py"` and follow the
   `data-pipeline` skill (check against real data on a scratch copy; prove
   data edits with its `diff_viz_data.py`).

## Reading results

- **Baked layout**: the profile header says whether `data/BD/viz_data.json` has
  baked positions. Without them the graph simulates on load, the numbers look
  worse and the e2e "baked positions" test skips; run `npm run layout` (don't
  commit the data, see CLAUDE.md). `git checkout -- data`, switching branches
  or pulling a bot commit removes a local bake, so check before profiling.
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

## Reporting and shipping

Run the checks, read the results, and only then commit or push, in a
separate step. Chaining `npm run test:e2e; git push` once pushed a branch
with a failing test, because the push ran whatever the tests said.


Say which checks ran and their results, which screenshots you looked at, what
the visitor review found (including problems you left for an issue), and
anything you couldn't verify (for example, no screen reader pass, or only
desktop checked). In the PR, fill in `.github/pull_request_template.md`: one
`Fixes #N` line per issue the PR finishes, so merging closes it.
