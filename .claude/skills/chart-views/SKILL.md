---
name: chart-views
description: How to design and build the BGP Bangladesh visualization tabs (Network Graph, Traffic Flow, Layered View, Gateway Ranking, Country Origins, Data Table) - what each view must achieve for a non-expert audience, when a view should pan/zoom, layout stability, wording, the module interface, accessibility and SVG performance rules. Use this whenever adding or redesigning a chart or tab, changing how a view draws, zooms, highlights, labels things or responds to filters and the history slider, or when a view looks tiny, cluttered, unreadable, jumpy, off-screen, resets unexpectedly, or isn't keyboard accessible.
---

# Chart views

Each tab is a module in `assets/js/viz/` registered in `vizModules` in
`assets/js/main.js`. All of them draw into `#viz-panel` using the global `d3`.
The design goals are in `CLAUDE.md` ("What the site should feel like"); this
skill turns them into rules for views.

## Start from the question, not the data

Before drawing anything, write down the question the view answers for a
visitor with basic internet knowledge (e.g. "which gateways carry most of
Bangladesh's routes?"). Then:

- **Aggregate first.** Show the handful of things that answer the question and
  group the long tail ("1,300 smaller networks"). Drawing every one of ~1,600
  networks at once is what made Traffic Flow an unreadable blob (issue #2).
- **Then focus.** Selecting a network (click, search, sidebar) should show its
  own story (its gateways, its international transit) with everything else
  faded or grouped.
- **Readable without zooming.** At the default view on a phone and a desktop,
  the main point must be legible. Zoom is for detail, not for understanding.
- **Label with the takeaway.** Titles and spoken labels state what the chart
  shows with real numbers, in plain words.

## When a view may pan and zoom

Only when the content is genuinely larger than the screen and spatial
(Network Graph, Layered View, Traffic Flow). Bar charts, rankings, tables and
summaries fit the panel and use normal vertical scrolling; making them pan or
zoom adds movement without adding understanding (issue #8). Gateway Ranking
and Country Origins are HTML lists with CSS bars (`bar-list.js`): fixed row
heights, fitted to the panel width, scrolling like a page.

## Words on screen

- Networks and connections, never nodes and edges (internal code names are
  fine; anything a visitor sees isn't).
- The numbers are route observations: say "routes" or "routes seen", not
  "traffic".
- Every technical term gets an explanation reachable by hover, keyboard focus
  and tap. Write it once in `assets/js/ui/glossary.js` and put `termHelp(key)`
  (a "?" button) right after the term; static HTML can mark the term with
  `data-glossary="<key>"` instead. Each entry has one plain sentence and an
  optional `example(data)` built from the snapshot on screen. Don't put a "?"
  inside a `<label>` or another button, and don't write explanations inline.
  Hover tooltips on charts can't hold buttons, so they only use the words.
- Category names match everywhere: tabs, legend, sidebar, table, tooltips.
  Use `CATEGORY_LABELS` / `CATEGORY_PLURALS` from the glossary rather than a
  local label table.
- `tests-e2e` fails when "node", "edge" or "traffic" appears on screen in any
  view, so a new view or string gets checked automatically.
- Show network names with `friendlyName` (`assets/js/ui/names.js`): registry
  names start with a handle (`LINK3-TECH-AS-BD-AP Link3 Technologies Ltd.`)
  that means nothing to a visitor. Put the full name and `AS<number>` in a
  `title` or the details.
- Country codes aren't always countries: `EU` and `AP` are registry regions.
  Name countries with `Intl.DisplayNames` and label regions as regions (see
  `NOT_COUNTRIES` in `bar-country.js`).
- Shares are of routes seen: "Summit (82% of its routes seen)", not "82% of
  its traffic".

## Stay still when the data changes

A history slider step or a filter change must not make the view jump (issue #5):

- Fixed sizes for rows, columns, labels and readouts; ellipsis for long text,
  full text on hover/focus.
- `font-variant-numeric: tabular-nums` for numbers that change.
- Stable ordering between snapshots where position carries no meaning.
- Keep what the user set: zoom/pan, scroll position, sort, page, selection,
  expanded rows. Implement `updateData` for this; without it the slider does a
  full rebuild.
- `main.js` calls `filterByTypes` again after every date step (whenever not
  all types are ticked), with the same set. Treat an unchanged filter as a
  no-op; resetting the page there sent the Data Table back to page 1 on every
  step (`typeFilterKey` in `table.js`).
- Animate only in response to the user. A slide-in on the table's detail
  panel replayed on every date step because the row was re-rendered; add the
  animation class only when the user opens it.
- `tests-e2e/site.test.mjs` has a "keeps the data table still" test that
  compares sort, page, scroll, row heights and column widths across a step;
  copy it for a new view with state worth keeping.

## Module contract

`main.js` calls these. Only `init`, `loadData` and `destroy` are required; the
rest are feature-detected (`mod.updateData?.(...)`).

| Export | Called when | Notes |
|---|---|---|
| `init(containerId)` | tab opens, panel resized | create the `<svg>` (and any `.viz-controls`) inside the container; may do nothing for HTML views that draw everything in `loadData` |
| `loadData(data, options)` | first draw, tab switch, live fetch, "Static Data" | full draw; `options` has `minTraffic`, `maxTraffic`, `nodeSize`. Reset zoom/highlight here |
| `updateData(data, options)` | history slider step | keep the user's pan/zoom, scroll, sort, selection and highlight; without it the slider falls back to a full rebuild, which resets their view |
| `destroy()` | leaving the tab | clear the panel, stop timers/simulations |
| `updateFilter(min, max)` | Min/Max Routes sliders | redraw with the new range, keep the view |
| `filterByTypes(activeTypes)` | type checkboxes | hide rather than redraw where possible |
| `highlightASN(asn)` | sidebar list, search, "How do I reach the world?" | |
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
   accessibility audit and e2e tests cover it. `waitForView` there waits for
   `#viz-panel svg *, #viz-panel table, #viz-panel .bar-view`; if the new view
   draws something else, add its selector or every dev script hangs on it.

## Drawing conventions

- **Fit to the panel.** Lay the chart out in its own coordinates, then fit the
  content to `#viz-panel` (see `fitTransform` in `force-graph.js`, and
  `chooseColumns` in `hierarchical.js`, which picks a grid shape for the panel's
  aspect ratio). Starting at a fixed scale or offset is what left views tiny or
  half off-screen. For zoomable views keep the fitted transform for
  `resetView`; static views just size themselves to the panel.
- **Portrait screens.** Phones are portrait; a left-to-right chart should flow
  top to bottom there (the Network Graph transposes through `sx`/`sy`; Traffic
  Flow has an orientation toggle).
- **One phone breakpoint.** The CSS treats `(max-width: 900px), (max-height:
  500px)` as phone/tablet (off-canvas sidebar; landscape phones are short,
  not narrow), and `(max-width: 600px), (max-height: 500px)` as compact
  (bottom-sheet tooltip, hidden title bar). In JS use the same query with
  `matchMedia` (as `isMobile` in `main.js` does), not `innerWidth <= 900`.
  Older tooltip code in `tooltip.js`, `sankey.js`, `hierarchical.js`,
  and `force-graph.js` still checks `innerWidth`; align it
  when you touch those files.
- **Keep the view across snapshots.** In `updateData`, keep the current zoom
  transform (`hierarchical.js` stores `savedTransform`) and re-apply any
  highlight if that ASN still exists.
- **Accessibility for zoomable views.** After setting up zoom, call
  `makeChartAccessible(svg, { zoom, label, reset, onEscape })` from
  `assets/js/ui/chart-a11y.js`. It makes the SVG focusable with a spoken
  `label`, adds arrow/plus/minus/0 keys and on-screen pan/zoom buttons (needed
  for WCAG 2.5.7, so nobody has to drag), and Escape runs `onEscape`. Pass
  `toolbar` to add the buttons to an existing `.viz-controls`. Issue #6 makes
  the buttons repeat when held and the keys work while the pointer is over the
  chart.
- **Static rankings: use `bar-list.js`.** `renderBarList(container, view)`
  draws an HTML `<ol>` with CSS bars: a question as the heading, a takeaway
  sentence, optional segment legend, fixed-height rows (rank, name with an
  ellipsis and a text tag, bar, tabular number, extra screen-reader text),
  hover tooltips, and it keeps the scroll position when called again.
  `highlightBarRow` marks and scrolls to a row. Gateway Ranking and Country
  Origins use it; their totals functions (`gatewayTotals`, `countryTotals`)
  are pure and exported for testing.
- **Accessibility for static views.** No pan/zoom helper. Prefer real HTML
  lists or tables (as `bar-list.js` does) so screen readers read each row; a
  scrolling region needs `tabindex="0"`, a role and a label so keyboard users
  can scroll it. An SVG-only static chart needs `role="img"` plus a spoken
  summary.
- **Spoken labels** state the takeaway with real numbers (counts, top five),
  not "a chart". The Data Table is the full text alternative, so new data
  should appear there too.
- **Controls inside the panel** are real `<button type="button">`s with an
  accessible name; toggles carry `aria-pressed`. If a re-render replaces the
  focused control, put focus back on its replacement.
- **Colours**: the site uses the calm house palette (sand paper, ink text,
  phthalo green accent; rust and ochre are the only warm signals). Take
  colours from tokens, never new hex values: CSS custom properties in
  `styles.css`, and `CATEGORY_COLORS` / `LINK_COLORS` / `INK` from
  `assets/js/ui/colors.js` in script (`tests-js/colors.test.js` keeps the two
  in step and checks text contrast). Category hues are muted Okabe-Ito, safe
  for colour blindness, but too light for text: show a category as a swatch,
  edge or tint beside ink text, and outline shapes in ink. Text must reach
  4.5:1 (`--text-dim` is the lightest ink that passes on every surface).
  Pair colour with a label, shape or dash; never use colour alone.
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
--check` for anything that touches drawing or the slider. Then do its
visitor-perspective review: the automated checks can all pass on a view that
still fails the goals above.
