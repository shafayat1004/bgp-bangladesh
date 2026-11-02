# Layered View Redesign and Timeline Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pan/zoom SVG Layered View with a reflowing HTML overview and a readable path screen for one network, add a Play control to the history bar on every tab, and mark what appeared, disappeared or moved on a path, backed by a small change summary the pipeline writes.

**Architecture:** The pipeline writes `data/BD/history/changes.json` (per-connection integer shares for every retained snapshot). Pure JS modules turn that into per-connection states and events (`assets/js/data/changes.js`) and turn one snapshot into a path model (`assets/js/viz/layered-path.js`). `assets/js/viz/hierarchical.js` becomes an HTML view with two screens: the overview grid and the path screen (`assets/js/viz/layered-path-view.js`). `assets/js/ui/timeline.js` gains Play, a jump API and slider marks.

**Tech Stack:** Vanilla ES modules, D3 v7 global (only where already used), node:test for JS units, Python unittest for the pipeline, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-layered-view-redesign-design.md` (read it before any task; the plan argues from it).

## Global Constraints

- Follow `CLAUDE.md` and the `chart-views`, `writing-site-text` and `verify-site-change` skills. Pipeline task: the `data-pipeline` skill.
- Visible words: networks, connections, routes; never node, edge, traffic (the e2e jargon test enforces it). Names through `friendlyName`; categories through `CATEGORY_LABELS` / `CATEGORY_PLURALS`; colours only from `CATEGORY_COLORS`, `LINK_COLORS`, `INK` and CSS tokens.
- Never colour alone: NEW and GONE are text tags; GONE is also a dashed outline.
- `:hover` styles only inside `@media (hover: hover) and (pointer: fine)`; touch gets `:active`.
- No CSS `transition` on properties changed per frame; transitions only on opacity, width of share bars, and the GONE collapse (height). All of them off under `prefers-reduced-motion: reduce`.
- Tabular numbers (`font-variant-numeric: tabular-nums`) on every changing number.
- Don't commit anything under `data/`. `changes.json` is written by CI.
- Wording fixed by the spec: tags `NEW` and `GONE`; GONE sub-line "Not in this data since <date>" (see Task 7 note on the connection cutoff); never "removed", "dropped", "cut off".
- Constants fixed by the spec: local companies shown first `LOCAL_CAP = 40`; abroad networks per gateway `ABROAD_PER_GATEWAY = 4`; GONE lifetime `GONE_TICKS = 3`; move threshold `MOVE_POINTS = 10`; play step `PLAY_STEP_MS = 1200`.
- Work on branch `layered-view-redesign`; commit after each task; PR body uses `.github/pull_request_template.md` (`Part of #24`).

## Review Focus

1. **The history grows while the page is open** (a bot run adds a snapshot): `changes.json` and `history/index.json` can disagree in length. Match snapshots by timestamp, never by array index (test in Task 2).
2. **The picked network is missing from the selected snapshot**: the path screen stays open with "Not seen in the routes on <date>" and its connections as GONE; it must not throw or jump to the overview (test in Task 7).
3. **`changes.json` is missing or fails to load** (older deploy, failed run): the change list and slider marks are absent, NEW/GONE fall back to the previous snapshot (test in Task 2 and Task 7).
4. **Filters hide the picked network or empty the overview**: the path screen ignores filters and shows its note; an overview with nothing left shows one line, not an empty panel (test in Task 5 and Task 7).
5. **Phone width with long names and a gateway that uses 100+ networks abroad**: no horizontal page scroll, abroad column capped at `ABROAD_PER_GATEWAY` per gateway (e2e in Task 8).

---

### Task 1: Pipeline writes the change summary

**Files:**
- Modify: `scripts/update_bgp_data.py` (history section, ~lines 272-388)
- Modify: `data/README.md`, `scripts/README.md` (one paragraph each: what `history/changes.json` holds)
- Test: `tests/test_update_bgp_data.py` (`TestHistorySnapshots`)

**Interfaces:**
- Produces `data/<CC>/history/changes.json`:

```json
{
  "country": "BD",
  "snapshots": ["2026-10-25T13:47:22Z", "..."],
  "connections": [
    ["137967", "10075", "d", [57, 58, null], [3, 3, null]],
    ["9498", "58717", "i", [38, 38, 38], [41, 40, 41]]
  ]
}
```

  Each connection: `[source, target, kind, s0, s1]`, `kind` is `"d"` (domestic: source local network, target gateway) or `"i"` (international: source network abroad, target gateway). `s0` and `s1` have one entry per snapshot (same order as `snapshots`), an integer percent rounded half up (`int(100 * count / total + 0.5)`, matching JS `Math.round`) or `null` when absent:
  - `"d"`: `s0` = share of the **source** network's domestic routes; `s1` = share of the **target** gateway's domestic (customer) routes.
  - `"i"`: `s0` = share of the **target** gateway's international routes; `s1` = share of the **source** network's international routes.
  Written compact (`separators=(",", ":")`), keys in this order.
- Produces `build_change_summary(country_code: str, snapshots: list[tuple[str, dict]]) -> dict` (pure; `snapshots` is `(iso_ts, viz_data)` oldest first) and `write_change_summary(country_code: str) -> None` (reads every snapshot file in the history dir, sorted by timestamp, writes `changes.json`).

- [ ] **Step 1: Create the branch and commit the spec and plan**

```bash
git checkout -b layered-view-redesign
git add docs/superpowers
git commit -m "Add Layered View redesign spec and plan"
```

- [ ] **Step 2: Write the failing tests** in `TestHistorySnapshots`:
  - `test_build_change_summary_shares`: two snapshots; snapshot A edges `100→200 d 60`, `100→300 d 40`, `400→200 d 100`, `900→200 i 75`, `901→200 i 25`; snapshot B has only `100→200 d 50` and `400→200 d 100` (no `100→300`, no international edges). Assert `snapshots == [tsA, tsB]`; connection `["100","200","d", [60,100], [38,33]]` (100's share 60/100 then 50/50; 200's customers 60/160 → 38, 50/150 → 33); `["100","300","d",[40,None],[100,None]]`; `["900","200","i",[75,None],[100,None]]`; and a half-way share rounds up (add a case with 1 of 8 routes → `13`).
  - `test_write_change_summary_ignores_index_and_itself`: temp history dir with two snapshot files, `index.json` and an old `changes.json`; after `write_change_summary("BD")` the file lists exactly the two snapshot timestamps.
  - `test_update_history_writes_change_summary`: `update_history` on a temp dir produces `changes.json`.

- [ ] **Step 3: Run them to verify they fail**

Run: `python -m unittest tests.test_update_bgp_data.TestHistorySnapshots -v`
Expected: FAIL (`AttributeError: ... has no attribute 'build_change_summary'`)

- [ ] **Step 4: Implement** `build_change_summary` and `write_change_summary` next to `write_history_index`; call `write_change_summary(country_code)` at the end of `update_history`. Skip `index.json` and `changes.json` the way `write_history_index` does (names `_parse_snapshot_ts` rejects). Totals per snapshot come from that snapshot's own edges.

- [ ] **Step 5: Run the pipeline tests**

Run: `python -m unittest discover -s tests -p "test_*.py"`
Expected: all pass.

- [ ] **Step 6: Check size on a scratch copy of the real week** (never write into `data/`):

```bash
python3 -c "
import sys,glob,json,os,gzip; sys.path.insert(0,'scripts'); import update_bgp_data as u
files=sorted(glob.glob('data/BD/history/2*.json'))
s=[(u._parse_snapshot_ts(os.path.basename(f)).strftime('%Y-%m-%dT%H:%M:%SZ'), json.load(open(f))) for f in files]
b=json.dumps(u.build_change_summary('BD', s), separators=(',',':')).encode()
print(len(b), len(gzip.compress(b)))"
```

Expected: about 470,000 raw and under 60,000 gzipped for the 20-snapshot week.

- [ ] **Step 7: Update the READMEs and commit**

```bash
git add scripts/update_bgp_data.py tests/test_update_bgp_data.py data/README.md scripts/README.md
git commit -m "Pipeline: write history/changes.json with per-connection shares"
```

(`data/README.md` is documentation, not data; it is the one `data/` path this PR touches.)

---

### Task 2: Change states and events in the browser

**Files:**
- Create: `assets/js/data/changes.js`
- Test: `tests-js/changes.test.js`

**Interfaces:**
- Consumes: the `changes.json` format from Task 1.
- Produces:
  - `loadChanges(country: string) -> Promise<ChangeIndex|null>`: fetches `data/<country>/history/changes.json`; `null` on any failure.
  - `indexChanges(raw) -> ChangeIndex`: `{ snapshots: string[], byKey: Map<string, Conn> }`, key `"<source>><target>"`, `Conn = { source, target, kind, s0: (number|null)[], s1: (number|null)[] }`.
  - `fromTwoSnapshots(prevData, curData, prevTs, curTs) -> ChangeIndex`: the same shape built from two loaded snapshots (fallback when `changes.json` is missing; computes shares with the Task 1 definitions).
  - `snapshotPos(index: ChangeIndex, ts: string) -> number`: position of a timestamp, `-1` if absent.
  - `connState(conn: Conn, pos: number, persp: 's0'|'s1') -> { state: 'present'|'new'|'gone'|'absent', share: number, delta: number|null, since: number|null, fading: boolean }`.
    - `new`: present at `pos`, absent at `pos-1` (`since = pos`); `pos === 0` is never `new`.
    - `gone`: absent at `pos`, last present at `p < pos`, and `pos - (p+1) < GONE_TICKS` (`since = p+1`); `fading` when `pos - (p+1) === GONE_TICKS - 1`.
    - `delta`: `share - previous share` when both present, else `null`.
  - `stableOrder(conns: Conn[], persp) -> Conn[]`: by first present position, then by largest share ever (descending), then by source+target string.
  - `connEvents(conns: Conn[], persp) -> Array<{ pos, conn, kind: 'appear'|'disappear'|'move', from: number|null, to: number|null }>`: one per change between consecutive snapshots; `move` when both present and `|to - from| >= MOVE_POINTS`; sorted by `pos`, then `stableOrder`.
  - Exported constants `GONE_TICKS = 3`, `MOVE_POINTS = 10`.

- [ ] **Step 1: Write the failing tests** with a fixture built from Digicon's real week (copy the shares from the spec's mockup note: Fiber@Home `s0` = `[57,58,58,57,57,55,56,null,null,null,null]`, Apple `[41,40,40,41,41,43,43,99,98,98,98]`):
  - `connState: GONE for three snapshots, fading on the third, then absent`: Fiber@Home at pos 7 → `{state:'gone', since:7, fading:false}`, pos 9 → `fading:true`, pos 10 → `absent`.
  - `connState: delta`: Apple at pos 7 → `share 99, delta 56`.
  - `connState: a connection present from the start is never new at pos 0`.
  - `connEvents: one disappear and one move at pos 7` (Apple `43 → 99`, Fiber@Home `56 → null`), no events for 1-2 point wobbles.
  - `stableOrder: first appearance, then largest share ever`.
  - `snapshotPos: matches by timestamp when the index has an extra newer snapshot` (Review Focus 1).
  - `fromTwoSnapshots: same shares as the pipeline for the Task 1 fixture` (copy Task 1's numbers).
  - `loadChanges: resolves null on 404` (stub `globalThis.fetch`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests-js/changes.test.js`
Expected: FAIL (`Cannot find module .../changes.js`).

- [ ] **Step 3: Implement `assets/js/data/changes.js`** with the signatures above.

- [ ] **Step 4: Run the tests**

Run: `npm run test:js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/data/changes.js tests-js/changes.test.js
git commit -m "Change states and events for path connections"
```

---

### Task 3: Path model for one network

**Files:**
- Create: `assets/js/viz/layered-path.js`
- Test: `tests-js/layered-path.test.js`

**Interfaces:**
- Consumes: `networksByAsn`, `sourceAsn`, `targetAsn` (`assets/js/data/network-data.js`), `friendlyName` (`assets/js/ui/names.js`).
- Produces:
  - `GATEWAY_TYPES` (same set as `my-path.js`; import from there by exporting it, don't copy).
  - `buildPath(data, asn) -> Path`:
    - `{ status: 'missing' }` when the ASN isn't in `data.nodes`.
    - `role: 'local'`: `{ status:'found', role, node, gateways: Row[], abroad: Row[], lines: Line[] }`. `gateways` from domestic edges where `source === asn`, share = `s0` definition. `abroad`: for each gateway, its top `ABROAD_PER_GATEWAY` international partners by the gateway's `s0`; union, ordered by total count. `lines`: `{ from: gatewayAsn, to: abroadAsn, share }` for each kept pair.
    - `role: 'gateway'`: `{ ..., customers: Row[], customerTotal: number, abroad: Row[] }`; `customers` by `s1` of domestic edges into it (all of them; the view shows the first `CUSTOMER_CAP = 8`), `abroad` by `s0` of its international edges (all; view caps at 10).
    - `role: 'outside'`: `{ ..., gateways: Row[] }` by `s1` of its international edges.
    - `Row = { node, count, share }` (share 0-1), largest first.
  - `pathSummary(path) -> string`: one plain sentence, exact patterns:
    - local: `Most of ${A}'s routes (${p}%) go through ${G}, which connects abroad mainly through ${X} (${countryX}) and ${Y} (${countryY}).` With one gateway at 100%: `All of ${A}'s routes go through ${G}, ...`. With no gateways: `No gateway connections were seen for ${A} in this data.`
    - gateway: `${n} local networks reach the world through ${G}; most of its connections abroad go through ${X} (${countryX}) and ${Y} (${countryY}).`
    - outside: `${X} connects to ${n} Bangladeshi gateways; ${G} carries the most.`
    Names via `friendlyName`; countries via `Intl.DisplayNames(['en'], { type: 'region' })`, regions `EU`/`AP` as "Europe (region)"/"Asia-Pacific (region)" (reuse `NOT_COUNTRIES` handling from `bar-country.js` by exporting it).

- [ ] **Step 1: Write the failing tests** reusing the fixture from `tests-js/my-path.test.js` plus a second customer `101 → 200 d 20`:
  - `buildPath local: gateways with shares, abroad capped per gateway, one line per kept pair`.
  - `buildPath gateway: customers by the gateway's share, abroad by its share` (200: customers 100 → 60/80, 101 → 20/80).
  - `buildPath outside: gateways by that network's share`.
  - `buildPath missing`.
  - `pathSummary` for each role (exact strings with the fixture names), and the "All of" and "No gateway" variants.

- [ ] **Step 2: Run to verify they fail**: `node --test tests-js/layered-path.test.js` → module not found.
- [ ] **Step 3: Implement** `assets/js/viz/layered-path.js`; export `GATEWAY_TYPES` from `my-path.js` and `NOT_COUNTRIES` from `bar-country.js`.
- [ ] **Step 4: Run** `npm run test:js` → all pass.
- [ ] **Step 5: Commit**

```bash
git add assets/js/viz/layered-path.js tests-js/layered-path.test.js assets/js/ui/my-path.js assets/js/viz/bar-country.js
git commit -m "Path model and summary sentence for one network"
```

---

### Task 4: Timeline Play, jump API and slider marks

**Files:**
- Modify: `assets/js/ui/timeline.js`
- Modify: `index.html` (`#timeline-bar`, ~line 225)
- Modify: `assets/css/styles.css` (timeline block ~1122-1200, phone block ~1693-1712 and ~1827)
- Modify: `assets/js/main.js` (`setupTimeline`, ~lines 138-158)
- Test: `tests-js/timeline.test.js`

**Interfaces:**
- Produces:
  - `nextPlayIndex(current: number, latestIndex: number, starting: boolean) -> number|null`: when `starting` and `current === latestIndex`, `0`; otherwise `current + 1`, or `null` past the end.
  - `initTimeline(...)` now returns `TimelineApi = { selectIndex(i: number): Promise<void>, currentIndex(): number, snapshots(): Array<{ts, file}>, setMarks(positions: number[]): void, isPlaying(): boolean }` (null until the manifest loads; callers get it through `onReady(api)`, a new option).
  - Callbacks gain the index: `onSelectSnapshot(viz, ts, index)` and `onSelectLatest(index)`.
  - `select(index)` returns a promise resolved after the callback ran and two animation frames passed.
- Markup: `<button id="timeline-play" class="timeline-btn timeline-play" type="button" aria-pressed="false"><span aria-hidden="true">▶</span> <span class="timeline-play-text">Play</span></button>` before `#timeline-prev`; text `Pause`/icon `❚❚` while playing; fixed width so the label swap doesn't move anything. Marks: `<div id="timeline-marks" aria-hidden="true">` positioned over the slider track; `setMarks` draws one 3px tick per position.
- Behaviour: Play waits for `select()` then `PLAY_STEP_MS` (1200) before the next step; prefetches the following snapshot into the existing LRU cache during the wait; stops at the latest snapshot; any `prev`/`next` click, slider `input`, or `selectIndex` call from elsewhere pauses. The slider's `aria-valuetext` keeps updating while playing; announce "Playing"/"Paused" through the existing polite readout.

- [ ] **Step 1: Write the failing tests**: `nextPlayIndex: starting at the latest goes back to the oldest`, `nextPlayIndex: steps forward`, `nextPlayIndex: stops past the end` (returns `null`).
- [ ] **Step 2: Run** `node --test tests-js/timeline.test.js` → FAIL (not exported).
- [ ] **Step 3: Implement** the API, Play and marks in `timeline.js`; add the markup and CSS (play button min 44×44 px; phone layout keeps all controls on one row as today); pass `index` through `main.js` callbacks and keep the API in a module-level `timelineApi` in `main.js`.
- [ ] **Step 4: Run** `npm run test:js` → pass. Then `npm run serve` and check by hand on desktop and phone width: Play steps every 1.2 s on Network Graph, Gateway Ranking and Data Table, stops at Latest, a slider drag pauses it.
- [ ] **Step 5: Commit**

```bash
git add assets/js/ui/timeline.js index.html assets/css/styles.css assets/js/main.js tests-js/timeline.test.js
git commit -m "Timeline: Play, jump API and change marks"
```

---

### Task 5: Layered overview as a reflowing page

**Files:**
- Modify (rewrite): `assets/js/viz/hierarchical.js`
- Modify: `assets/css/styles.css` (new `.layered-*` block)
- Modify: `tests-js/hierarchical.test.js` (replace the `chooseColumns` tests)
- Modify: `scripts/dev/lib/site.mjs` (`waitForView` selector)

**Interfaces:**
- Consumes: `CATEGORY_PLURALS`, `termHelp` (glossary), `friendlyName`, `countryToFlag`, tooltip helpers, `CATEGORY_COLORS`, `DEFAULT_MIN_ROUTES`.
- Produces (module contract from the `chart-views` skill): `init`, `loadData`, `updateData`, `destroy`, `updateFilter`, `filterByTypes`, `highlightASN`, `resetView`. Plus exports for tests and later tasks:
  - `ZOOM_LEVELS = [{ id: 'names', label: 'Names only', minWidth: 110, height: 30 }, { id: 'shares', label: 'Names and shares', minWidth: 150, height: 48 }, { id: 'large', label: 'Large', minWidth: 210, height: 58 }]`, default index `1`.
  - `LOCAL_CAP = 40`.
  - `overviewLayers(data, { minTraffic, maxTraffic, activeTypes }) -> Array<{ type, total, nodes }>`: pure; layer order `local-company, iig, detected-iig, offshore-enterprise, offshore-gateway, outside`; empty layers dropped; nodes by `traffic` descending; same "used in a connection within the route range" rule as today.
  - `anchorFor(scroller: Element) -> { asn, offset } | null` and `restoreAnchor(scroller, anchor)`: keep the first visible box at the same screen offset across a re-render.
  - `openPath(asn)` (implemented in Task 7; this task leaves a stub that calls `highlightASN`).
- DOM: `#viz-panel > .layered-view` (scroll container, `overflow-y: auto`, `touch-action: pan-y`) containing a sticky `.layered-zoom` bar (− button `aria-label="Smaller boxes"`, level text, + button `aria-label="Bigger boxes"`) and one `<section class="layered-layer">` per layer: `<h3>` with the plural label, `termHelp(type)`, count; a one-line explanation (glossary words); `<ul class="layered-grid">` (CSS grid, `repeat(auto-fill, minmax(var(--box-min), 1fr))`) of `<li><button class="layered-box" data-asn>` with name (ellipsis), share line `x.x% of routes seen` (hidden at `names`), category stripe colour; `aria-label` "<name>, <category>, x.x% of routes seen". After the local grid, when more than `LOCAL_CAP`: `<button class="layered-more">Show 1,316 smaller local companies</button>` (live count; state kept across `updateData`).
- Zoom input: the buttons; `+`, `-`, `0` keys on the view; Ctrl/⌘ + wheel (trackpad pinch) steps once per 250 ms; two-finger touch pinch steps when the finger distance changes by 25%. Zoom and `updateData` keep the anchor (`anchorFor`/`restoreAnchor`); `updateData` also keeps zoom level, "show all" and scroll.
- Empty state: when every layer is empty, one line "No networks match the current filters." (Review Focus 4).
- Remove `chooseColumns`, d3-zoom and `makeChartAccessible` from this view; the view root gets `role="region"`, `aria-label` with the layer summary (e.g. "Layered view: 1,356 local companies, 33 gateways, ...") and `tabindex="0"`.

- [ ] **Step 1: Write the failing tests** in `tests-js/hierarchical.test.js`: `overviewLayers: layer order and traffic order`, `overviewLayers: respects the route range and active types`, `overviewLayers: drops empty layers`, `ZOOM_LEVELS: three sizes, default names and shares`.
- [ ] **Step 2: Run** `node --test tests-js/hierarchical.test.js` → FAIL.
- [ ] **Step 3: Implement** the view and CSS; update `waitForView` in `scripts/dev/lib/site.mjs` to also accept `#viz-panel .layered-view .layered-box`.
- [ ] **Step 4: Run** `npm run test:js` → pass; `npm run serve`, open the Layered View at desktop and 390 px width: zoom steps reflow, the box at the top stays put, page scrolls vertically, no sideways scroll.
- [ ] **Step 5: Commit**

```bash
git add assets/js/viz/hierarchical.js assets/css/styles.css tests-js/hierarchical.test.js scripts/dev/lib/site.mjs
git commit -m "Layered View: reflowing overview with zoom sizes instead of pan/zoom"
```

---

### Task 6: "Find my network" in the view, one shared lookup

**Files:**
- Create: `assets/js/ui/my-network.js`
- Modify: `assets/js/main.js` (`detectMyASN`, `showMyPath`, ~lines 384-412)
- Modify: `assets/js/viz/hierarchical.js` (prompt box above the local grid)
- Test: `tests-js/my-network.test.js`

**Interfaces:**
- Produces in `my-network.js`:
  - `setLookup(fn: () => Promise<{asn, holder}>)`: main passes `() => ripeClient.getMyASN()`.
  - `findMyNetwork() -> Promise<{asn, holder}>`: one in-flight request shared by every caller; caches the result for the session.
  - `myNetwork() -> {asn, holder} | null` and `onMyNetwork(cb) -> unsubscribe`.
- Prompt box (`.layered-mine`, fixed `min-height` so both states are the same height):
  - Before: "Is one of these yours?" + small "Sends your IP address to ipify.org and RIPEstat to look it up." + `<button>Find my network</button>`; while waiting the button reads "Looking up your network…" and is disabled.
  - Found in the data: "You're on <strong>name</strong> (AS…)." + "Marked YOURS below." + `<button>Show its path</button>`; the network moves to the first slot of its layer with a `YOURS` text tag and an accent outline; it is shown even if Min/Max Routes or category filters would hide it, with "(hidden by your filters elsewhere)" in its share line.
  - Not in the data: "You're on <name> (AS…). It isn't among the networks in this data." (reuse the sentence from `renderMyPath`).
  - Error: "Couldn't look up your network. Try again." with the button.
- The sidebar button uses `findMyNetwork()` too, so either place shows the result in both.

- [ ] **Step 1: Write the failing tests**: `findMyNetwork: two callers share one request` (lookup stub counts calls → 1), `onMyNetwork: subscribers get the result`, `findMyNetwork: a failed lookup can be retried` (second call calls the stub again).
- [ ] **Step 2: Run** `node --test tests-js/my-network.test.js` → FAIL.
- [ ] **Step 3: Implement** `my-network.js`, the prompt in `hierarchical.js`, and switch `detectMyASN` to `findMyNetwork`.
- [ ] **Step 4: Run** `npm run test:js` → pass; by hand: the box keeps its height through all states (measure with DevTools), sidebar and view agree.
- [ ] **Step 5: Commit**

```bash
git add assets/js/ui/my-network.js tests-js/my-network.test.js assets/js/main.js assets/js/viz/hierarchical.js assets/css/styles.css
git commit -m "Find my network inside the Layered View; one shared lookup"
```

---

### Task 7: Path screen with change markings

**Files:**
- Create: `assets/js/viz/layered-path-view.js`
- Modify: `assets/js/viz/hierarchical.js` (`openPath`, back, `highlightASN`, `updateData` while a path is open)
- Modify: `assets/js/main.js` (pass `TimelineApi` and change index to the view: `Hierarchical.setHistory({ api, changes })` after `onReady`; load `loadChanges('BD')` once in `setupTimeline`)
- Modify: `assets/css/styles.css` (`.layered-path-*`)
- Test: `tests-js/layered-path-view.test.js` (pure helpers only)

**Interfaces:**
- Consumes: `buildPath`, `pathSummary` (Task 3); `indexChanges`, `fromTwoSnapshots`, `snapshotPos`, `connState`, `stableOrder`, `connEvents`, `GONE_TICKS` (Task 2); `TimelineApi` (Task 4); `myNetwork` (Task 6).
- Produces:
  - `renderPathView(container: Element, opts: { data, asn, ts, history: ChangeIndex|null, prevData, prevTs, filtersActive: boolean, onBack(): void, onPick(asn): void, onJump(pos: number): void }) -> { destroy(): void }`.
  - Pure helper `pathCards(path, history, pos) -> { columns: { [name]: Card[] }, events }`: `Card = { asn, name, kind, share, delta, state, since, fading }`; GONE cards come from `history` connections of the picked network that are absent at `pos` but within `GONE_TICKS`; order from `stableOrder`; columns per role: local `gateways` (persp `s0` of `d`) and `abroad` (persp `s0` of `i` for the kept gateways); gateway `customers` (`s1` of `d`) and `abroad` (`s0` of `i`); outside `gateways` (`s1` of `i`).
- Screen (mockup `path-focus-a-summary.html` + `path-over-time-v2.html`):
  - Header row: `<button class="layered-back">← All networks</button>`; `<h2 tabindex="-1">` with the picked network's name, focused on open; Escape = back; back restores the overview's zoom, scroll and focus on the box that opened it.
  - `pathSummary` sentence (fixed `min-height` for three lines); picked card with category, routes seen, `YOURS` tag when it is `myNetwork()`.
  - Local: two columns (gateways left, abroad right) with an absolutely positioned SVG of lines drawn from card positions (redraw on `ResizeObserver`), stroke width `max(1, share/9)` px, `LINK_COLORS`; trunk from the picked card to each gateway, dashed (`LINK_COLORS.domestic`). Gateway: customers grid above the picked card (first `CUSTOMER_CAP = 8`, then "and N more" expandable), abroad list below (first 10, then "and N more"). Outside: gateways list. All columns stack to one column under 600 px except the local two-column layout, which stays two columns (as in the mockup).
  - Tap/click a gateway: only its lines stay strong (others 0.15 opacity), tap again clears; tap a network abroad: lines into it stay strong. Keyboard: the cards are buttons; Enter does the same.
  - Each card: share bar (CSS `width` transition 500 ms), tabular percent, delta `▲ +56 pts` / `▼ −56 pts` when `|delta| >= 1`, `NEW` tag on `state === 'new'` (plus "Added <date>" sub-line until the range ends), `GONE` tag + dashed outline + crossed-out name + "Not in this data since <date>" on `gone`, `.fading` (opacity 0.35) on the last GONE tick, then a 300 ms height collapse when it leaves.
  - Under the path: "Changes this week" (`<h3>`), one `<button>` per `connEvents` entry for the shown connections: "`<time>`  **Name** appears as a gateway (43%)", "**Name** no longer in this data (was 56%)", "**Name** 43% → 99%"; clicking calls `onJump(pos)` (→ `TimelineApi.selectIndex`). The timeline gets `setMarks` with those positions while the path is open and `setMarks([])` on back.
  - Filters note when `filtersActive`: "Showing this network's whole path; your filters apply to the overview."
  - Missing network at `ts`: picked card reads "Not seen in the routes on <date>", every connection from `history` that was present at `pos-1` shows as GONE, no throw (Review Focus 2).
  - Without `history` (Review Focus 3): build one with `fromTwoSnapshots(prevData, data, prevTs, ts)`; no change list, no marks.
  - Cutoff note under the change list, once: "This data keeps the 2,000 busiest local connections and 1,500 busiest international ones, so a small connection can leave the data without stopping." (glossary entry `data-cutoff` in `assets/js/ui/glossary.js`; use `termHelp`).
- `hierarchical.js`: `highlightASN(asn)` now opens the path screen (search, sidebar, "How do I reach the world?", "Show its path"). `updateData` while a path is open re-renders the path at the new `ts` and keeps it open; needs the previous snapshot, so keep `prevData`/`prevTs` from the last `updateData`.

- [ ] **Step 1: Write the failing tests** for `pathCards` with the Digicon fixture from Task 2 and a matching two-snapshot `data`: `pathCards: GONE gateway kept for three snapshots then dropped`, `pathCards: stable order across positions`, `pathCards: events only for this network's connections`, `pathCards: missing network shows its previous connections as GONE`, `pathCards: works with fromTwoSnapshots history`.
- [ ] **Step 2: Run** `node --test tests-js/layered-path-view.test.js` → FAIL.
- [ ] **Step 3: Implement** `layered-path-view.js`, wire `hierarchical.js` and `main.js`, add the glossary entry and CSS.
- [ ] **Step 4: Run** `npm run test:js` → pass. By hand with `npm run serve`: a network whose gateways changed this week (Digicon, AS137967, while its 27 Oct change is still inside the 7-day window; otherwise any network `connEvents` reports) shows NEW/GONE on the right snapshot, Play shows shares moving, the change list jumps, back restores the overview.
- [ ] **Step 5: Commit**

```bash
git add assets/js/viz/layered-path-view.js assets/js/viz/hierarchical.js assets/js/main.js assets/js/ui/glossary.js assets/css/styles.css tests-js/layered-path-view.test.js
git commit -m "Layered View path screen with NEW/GONE markings and change list"
```

---

### Task 8: Browser tests, checks and docs

**Files:**
- Modify: `tests-e2e/site.test.mjs`
- Modify: `.claude/skills/chart-views/SKILL.md` (Layered View no longer pans; module notes), `CLAUDE.md` only if a listed command or file changed
- Modify: `scripts/dev/profile.mjs` only if its Layered View step breaks

**Interfaces:**
- Consumes everything above.

- [ ] **Step 1: Replace the Layered View parts of the e2e tests**:
  - In `history slider keeps pan/zoom ...` keep only the Network Graph; add `history slider keeps the Layered View's size, scroll and open path`: press `+`, scroll the view by 600 px, step the slider, assert zoom label, `scrollTop` within 2 px, and the first visible box unchanged; open a path, step, assert the path is still open.
  - In `keyboard: skip link, tabs and chart pan/zoom`, replace the `hier-svg` part: focus `.layered-view`, `+` changes the zoom label, `0` restores it.
  - New `Layered View: picking a network opens its path and back restores the overview`: click the first box, assert `h2` focused and summary present, press Escape, assert focus on that box and same scroll.
  - New `Play steps through snapshots and stops at the latest`: on Data Table, click Play from an older snapshot, wait for `aria-pressed="false"`, assert the label is the latest.
  - New `Layered View path on a phone has no sideways scroll` (Review Focus 5): phone viewport, open the gateway with the most international connections (pick it in the page from the data), assert `scrollWidth <= innerWidth` and at most `4 × gateways` abroad cards for a local network.
- [ ] **Step 2: Run** `npm run test:e2e` → all pass.
- [ ] **Step 3: Run the full checks** and fix what they find:

```bash
npm run test:js
python -m unittest discover -s tests -p "test_*.py"
npm run audit:a11y
npm run screenshots -- --slider-step
npm run profile -- --check
```

Expected: tests pass, the audit reports 0 violations, the profile has no OVER lines, and the screenshots in `.dev-output/screenshots/` show the overview and a path readable at desktop, phone and landscape phone without zooming.
- [ ] **Step 4: Visitor review** per the `verify-site-change` skill (words, calm on date step and Play, phone in the iOS Simulator for sticky hover and pinch).
- [ ] **Step 5: Update the `chart-views` skill** (Layered View is an HTML view that scrolls; zoom = sizes) and commit:

```bash
git add tests-e2e/site.test.mjs .claude/skills/chart-views/SKILL.md
git commit -m "Tests and docs for the Layered View redesign and Play"
```

- [ ] **Step 6: Finish** with superpowers:finishing-a-development-branch (PR body from the template: `Part of #24`; mention `Part of #18` for the performance side and that the first CI run after merge writes `changes.json`).
