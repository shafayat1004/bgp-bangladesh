# Layered View redesign and timeline Play

Date: 2026-11-02. Status: written up after the owner's review answers;
waiting for approval.

## Why

The Layered View is the view people use to trace a path: "how does my
network reach the world?". Today it draws all ~1,670 networks as 70x28 SVG
boxes in a zoomable canvas. At the fitted size nothing is readable, so
tracing a path means a lot of pinching and panning. Picking a network fades
everything else but leaves its partners scattered and tiny across the grid,
and it stops after one step: a local network's gateways are shown, the
gateways' networks abroad are not.

It is also the slowest view to pan on a phone. A traced touch pan on a
phone-sized screen measured about 3.9 ms of paint/raster work per frame on a
fast Mac, against about 1.8 ms for the Network Graph (3,204 SVG text labels
against 125; raster 3x, pre-paint 8x). A phone is 5-10x slower, which matches
the owner seeing the Network Graph pan more smoothly than this view.

The owner also wants to watch a network's path change over the week, and to
be able to play the history on every tab.

## Goals

1. **Picked network, full path, readable.** Picking a network shows the whole
   path out to the world at a readable size, without panning or zooming.
2. **Overview that scrolls like a page.** No freeform pan. Zooming makes the
   boxes bigger, rows reflow, and the page grows taller; the visitor scrolls
   vertically.
3. **"Which one is mine?" in the view.** A visible prompt in the Layered View
   (not only in the sidebar, which is off-canvas on phones) to look up the
   visitor's own network.
4. **Play the history.** A Play control in the timeline bar steps through the
   snapshots on every tab.
5. **See what changed on a path.** While stepping or playing on a picked
   network, gateways and networks abroad that appear or disappear are marked
   explicitly, and shares visibly grow or shrink.

## Non-goals

- Change markings (new/gone) on any other tab. Other tabs only play and
  update the way they already do on a date step; markings there are later
  work.
- Changing the existing data files' format. The pipeline only gains the new
  change summary file (see "Change history from the data pipeline").
- Redesigning the Network Graph or Traffic Flow.
- Running the network lookup automatically (see Decisions).

## Anti-goals (fails even if it works)

- Anything jumps when the date, a filter or the zoom size changes, other than
  the deliberate, explained movement below.
- The path screen implies the data shows more than it does (see "Data limit").
- Wording that judges a network or implies someone acted ("removed",
  "dropped", "cut off").
- Lines for all ~2,700 connections back in the overview: that is the tangle
  this replaces.

## Decided by the owner

These came from the owner during design, with mockups on a phone.

### Picked network (path screen)

- Layout is mockup **A ("two columns with lines") plus the one-sentence
  summary from mockup C** on top.
  - Summary sentence built from the data, e.g. "Most of Link3's routes (79%)
    go through Summit Communications, which connects abroad mainly through
    Bharti Airtel (India) and Hurricane Electric (US)."
  - The picked network as a card across the top, with routes seen.
  - Left column: the gateways it uses, each with its share of the network's
    routes seen (bar + tabular number).
  - Right column: the networks abroad those gateways use, with connecting
    lines whose thickness is the share.
  - Everything not on the path is hidden. The page scrolls if the path is
    long.

### Overview

- **Top to bottom on every screen size**: local companies, gateways (IIG),
  detected gateways, offshore companies, offshore gateways, international
  networks. Desktop gets more boxes per row; it does not switch to side by
  side.
- **Zoom = bigger boxes, reflowing rows, taller page, vertical scroll.** No
  pan.
- **Local companies come first**, with the visitor's own network marked once
  known.
- **The lookup is not automatic.** The owner decided against running it on
  page load because it sends the visitor's IP address to ipify.org and
  RIPEstat. Instead a prompt **inside the view**, above the local companies,
  offers it: "Is one of these yours?", the privacy line, and a "Find my
  network" button. It must not be reachable only through the sidebar.

### Timeline Play and change markings

- **Play is built together with the Layered View redesign**, not as a
  separate project.
- **Play lives in the shared timeline bar and works on every tab.** Other
  tabs just play and update as they do today; their own markings come later.
- On the path screen, while stepping or playing:
  - Gateways and networks abroad that **appear** are marked **NEW**.
  - Ones that **disappear** stay in place, marked **GONE**, with "Not in
    this data since <date>" (see Wording under My calls).
  - Shares grow and shrink smoothly, with the change since the previous
    snapshot shown (e.g. "▲ +56 pts").
  - The owner asked that **GONE cards go away after some time** so they
    don't take space.

## Data limit (must stay true in the UI)

The data has (a) which gateways a network uses (`domestic` edges, network →
gateway) and (b) which networks abroad each gateway uses for **all** its
customers (`international` edges, network abroad → gateway). It does not
have the second hop for one network's own routes. So the path screen must not
say "Link3's routes go Summit → Airtel". The second column is worded as the
gateway's connections abroad ("Summit's connections abroad"), and the summary
says "which connects abroad mainly through...". `describePath` in
`assets/js/ui/my-path.js` already computes both parts and should be reused.

## My calls (the owner can override)

Mockup-tested unless marked otherwise.

- **No lines in the overview.** Lines appear only on the path screen.
- **Zoom sizes.** Three or four steps from compact to large. The mockup's
  colour-only smallest size was useless (a wall of identical squares) and is
  replaced by a compact "names only" size. Default is "names and shares"
  (2 boxes per row on a 390 px phone).
- **Zoom input.** − / + buttons in a bar that stays at the top of the view;
  pinch on touch and Ctrl/⌘ + wheel or trackpad pinch on desktop step the same
  sizes. Keyboard: + / − / 0 as today via the chart keyboard handling.
- **Anchor while zooming.** The network at the top of the screen stays in the
  same place on screen when the size changes (tested in the mockup).
- **Long tail.** Only the 40 biggest local companies show at first, then a
  "Show 1,316 smaller local companies" button (the count is live). Other
  layers are short enough to show in full.
- **Your network.** After the lookup it moves to the first place among local
  companies, marked "YOURS" with an accent outline. The prompt box keeps its
  size and turns into "You're on <name> (AS…)" with a "Show its path" button,
  so nothing below jumps (in the first mockup the box vanished and the grid
  jumped ~140 px). The in-view prompt and the sidebar button share one
  lookup; a result from either shows in both. If the visitor's network isn't
  in the data, the box says so in one line.
- **Picking.** Tap/click a box, search, the sidebar list, or "Show its path"
  opens the path screen. A back control (and Escape) returns to the overview
  at the same size and scroll position.
- **Desktop path screen** uses the same layout, wider; not three columns left
  to right.
- **Networks abroad per gateway**: the top 4 per gateway (union across
  gateways) to keep the right column short. Summit alone uses 113 networks
  abroad.
- **Tapping inside the path screen** (not mockup-tested): tapping a gateway
  emphasises only its lines abroad; tapping a network abroad emphasises which
  gateways use it.
- **GONE lifetime**: a GONE card stays for 3 snapshots (about half a day),
  is faded on the last one, then is removed. Stepping back shows it again.
  The change stays in "Changes this week".
- **Stable order while playing**: cards keep their order for the whole range
  (by first appearance, then by largest share ever), so nothing swaps places
  during play.
- **Change list**: under the path, "Changes this week" lists every appear,
  disappear and share move of 10 points or more; each entry jumps to that
  snapshot. Small marks on the timeline slider show where changes happened.
- **Play speed**: one snapshot per 1.2 s; Play from the latest snapshot starts
  at the oldest. Any manual step, slider drag or tab-key interaction pauses.
  Reduced motion: no tweening, steps still advance.
- **Wording**: "GONE" and "Not in this data since <date>", not "removed":
  the data only shows that it stopped appearing. Snapshots keep only the
  2,000 busiest local connections and 1,500 busiest international ones, and
  in the week checked 751 of 930 disappearances were connections near that
  cutoff, so "no routes seen" would overstate it. A one-line note under the
  change list explains the cutoff. Follow the `writing-site-text` skill.
- **Filters on the path screen**: the path screen shows the picked network's
  whole path and ignores Min/Max Routes and the category filters (it is one
  network's story; hiding a gateway would make the shares wrong). A one-line
  note says so when filters are active. Picking a network the overview's
  filters hide still works, as `focusNetwork` does today.
- **GONE removal is the one deliberate movement**: on the snapshot after its
  faded one, the GONE card collapses (height animates to 0 over ~300 ms, none
  under reduced motion) and the cards below move up. NEW cards take their
  slot in the stable order.
- **Play and loading**: Play waits until the next snapshot is painted before
  starting the 1.2 s wait (it never skips or shows stale data), prefetches
  the snapshot after that, and stops at the latest snapshot (no loop).
- **Picked network not seen on a date**: the path screen stays; the network's
  card says "Not seen in the routes on <date>", its gateways show as GONE, and
  it does not jump back to the overview.

## Decided by the owner after review

### Path screen for each kind of network

`describePath` already sorts networks into three roles (`local`, `gateway`,
`outside`); the path screen follows them.

- **Local company** (also offshore companies picked as a customer): as above,
  its gateways, then those gateways' connections abroad.
- **Gateway** (IIG, detected gateway, offshore gateway or offshore company
  acting as one): the local companies that use it **above** it (the biggest
  few, then "and N more", expandable), and its networks abroad **below**.
  Summary e.g. "657 local networks reach the world through Summit
  Communications; most of its connections abroad go through Bharti Airtel
  (India) and Hurricane Electric (US)."
- **International network**: the gateways that use it, each with its share of
  that network's routes seen into Bangladesh. Summary e.g. "Hurricane
  Electric connects to 19 Bangladeshi gateways; Summit Communications carries the
  most."

NEW/GONE marking, the change list and Play apply to whichever columns the
screen shows.

### Change history from the data pipeline

The pipeline writes a small change summary alongside the history snapshots,
so the browser never has to load the whole week. It must give, for every
connection seen in the retained history range:

- the first and last snapshot it was seen in, and its largest share (for the
  stable card order);
- the snapshots where it appeared, disappeared, or its share moved 10 points
  or more, with the before/after shares (for "Changes this week", the slider
  marks, and NEW/GONE on any date the visitor jumps to).

Shares are as the path screen shows them: a connection's share of the picked
network's routes seen (local → gateway), of the gateway's connections abroad
(gateway ← abroad), and of the international network's routes (abroad →
gateway). The file must stay small (target: tens of KB gzipped for a week) and
is regenerated on every run from the retained snapshots, so it follows the
retention window, including a longer one later (#10). Follow the
`data-pipeline` skill: CI commits it; it is never committed from a local run.
The site works without it (older deploys, a failed run): the change list and
slider marks are then left out, and NEW/GONE fall back to comparing with the
previous snapshot.

## Constraints

- Follow `CLAUDE.md` and the `chart-views` skill: plain words (networks,
  connections, routes), glossary terms via `termHelp`, `friendlyName` for
  names, colour tokens from `colors.js`/`styles.css`, never colour alone
  (NEW/GONE are text tags, GONE is also dashed), WCAG 2.2 AA, hover styles
  inside `@media (hover: hover) and (pointer: fine)`.
- Module contract for `assets/js/viz/hierarchical.js` stays: `init`,
  `loadData`, `updateData` (keeps zoom size, scroll, picked network),
  `destroy`, `updateFilter`, `filterByTypes`, `highlightASN` (now opens the
  path screen), `resetView`.
- Min/Max Routes and category filters still apply to the overview and the
  path screen.
- Play must not refetch more than the existing snapshot loader does; reuse
  the LRU cache in `assets/js/ui/timeline.js`. Prefetching the next snapshot
  while playing is reasonable (it is also in issue #18).
- Things in `tests-e2e` that assume the SVG Layered View (`hier-svg`,
  "history slider keeps pan/zoom (Network Graph and Layered View)") change
  with it; the Layered View test becomes "keeps zoom size and scroll".
- `scripts/dev/lib/site.mjs` `waitForView` must recognise the new markup.

## Relevant code

- `assets/js/viz/hierarchical.js`: current Layered View (SVG, d3-zoom,
  `chooseColumns`, `highlightASN`).
- `assets/js/ui/my-path.js`: `describePath` (gateways and networks abroad
  with shares) and `renderMyPath` (sidebar result).
- `assets/js/main.js`: `detectMyASN`, `showMyPath`, `focusNetwork`,
  `vizModules`, timeline wiring (`onSelectSnapshot` → `updateData`).
- `assets/js/ui/timeline.js`: snapshot index, slider, prev/next, LRU cache.
- `index.html` `#timeline-bar`: where Play goes.
- Related issues: #33 (Layered View click-again to deselect), #18 (phones,
  prefetch), #6 (pan/zoom buttons and keys; the Layered View no longer pans).

## Mockups

Throwaway HTML in `.superpowers/brainstorm/` (not committed):
`path-focus-a-summary.html` (path screen), `overview-zoom-v3.html`
(overview with zoom and "Find my network"), `path-over-time-v2.html`
(Play with NEW/GONE on Digicon's real 27 Oct change, when Fiber@Home stopped
appearing and Apple Communication went from 43% to 99%).

## Left to the builder

- How the overview is drawn (HTML grid is expected: cheap to scroll, and text
  is readable at any size) and how the path screen's lines are drawn.
- Exact zoom sizes, breakpoints and spacing within the constraints above.
- Where the back control sits and how the path screen is announced to screen
  readers.
- How Play is structured in `timeline.js` and how views learn the previous
  snapshot for change marking.
- The change summary's file name, exact format and where in
  `update_bgp_data.py` it is built (check #51, which plans to split that
  script).
- How many "biggest few" customers a gateway's path screen shows before
  "and N more".
