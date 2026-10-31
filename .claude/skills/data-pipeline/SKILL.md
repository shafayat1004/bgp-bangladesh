---
name: data-pipeline
description: How the BGP Bangladesh data pipeline (scripts/update_bgp_data.py, the every-4-hours update workflow, data/BD/*.json and history snapshots) gets its facts, caches them and commits them, and how to change it or correct the data safely. Use this whenever you touch update_bgp_data.py, reprocess_3layer.py, the browser live fetch (assets/js/api/ripestat.js, data-processor.js) or the update workflow; when a network's name, country, category, route count or classification looks wrong on the site; when asked to fix, backfill, regenerate or correct data files; or before committing anything under data/, even if the user only says "the data looks off".
---

# Data pipeline

`scripts/update_bgp_data.py` builds everything the site shows. A GitHub Action
(`.github/workflows/update-bgp-data.yml`) runs it every 4 hours on `main`, bakes
the Network Graph layout (`scripts/precompute_layout.mjs`, see the
`network-layout` skill) and commits as `github-actions[bot]`:

- `data/BD/viz_data.json`: nodes (networks), edges (connections), stats
- `data/BD/asn_names.json`: a **cache** of per-ASN facts (name, country)
- `data/BD/country_resources.json`: last good list of BD ASNs and prefixes
- `data/BD/metadata.json`, and `data/BD/history/` (one snapshot per run,
  7 days kept, `index.json` lists them)

The browser's "Fetch Latest Routes" repeats most of this in JavaScript
(`assets/js/api/ripestat.js`, `assets/js/api/data-processor.js`), and the
legacy `scripts/reprocess_3layer.py` repeats parts of it too. A fix to how a
fact is derived belongs in all of them; otherwise the wrong value comes back
through the path you didn't touch.

## Where each fact comes from

| Fact | Source | Code |
|---|---|---|
| Which ASNs and prefixes are Bangladeshi | RIPEstat `country-resource-list` → APNIC delegated stats → committed cache | `get_country_resources` |
| AS paths (who carries whose routes) | RIPEstat `bgp-state`; opt-in MRT fallback (RIS / RouteViews via BGPKIT) | `fetch_bgp_routes`, `fetch_bgp_routes_mrt` |
| Network name | RIPEstat `as-overview` (`holder`) | `fetch_asn_info` |
| Registered country (non-BD) | RIPEstat `rir-stats-country`, the RIRs' delegation stats | `fetch_registered_country` |
| Where its IPs are | RIPEstat `maxmind-geo-lite-announced-by-as` | `fetch_geo_country` |
| Where it peers | PeeringDB `net` / `ix` | `fetch_peering_locations` |
| Licensed IIGs | `data/btrc_iig_licenses.json` (manual) | `build_viz_data` |

Derive a fact from the source that actually records it. A holder handle is a
name, not a country: guessing from its suffix turned `OMANTEL-AS` into
American Samoa and `SINGTEL-AS-AP` into "AP". Registry records can still say
`EU` or `AP` (a region); keep those and let the UI label them as regions.

RIPEstat allows about 8 parallel requests; the pipeline rate-limits to 4 per
second (`RateLimiter`) and retries timeouts and 429/5xx (`get_with_retries`).
Read timeouts during a big lookup are normal.

## Caches keep old answers

`asn_names.json` is loaded at the start of every run and only ASNs missing
from it are fetched. So when you fix how a cached field is derived, the fix
does nothing for ASNs already cached: the old guesses stay forever. That is
how `AS`/`AP` countries survived a code fix that already rejected them.

When you change how a cached field is derived:

1. Record where each value came from (e.g. `country_source: "rir"`).
2. On each run, refresh entries without that mark (`refresh_registered_countries`
   is the pattern). A failed lookup must not leave the old guess behind:
   clear it (or use a documented fallback) and leave it unmarked so the next
   run retries.
3. Expect the first run after the change to do one big batch of lookups
   (~390 for countries, about a minute) and say so in the PR.

The same applies to anything else reused between runs: the baked layout
(`LAYOUT_VERSION`), `country_resources.json`, and history snapshots, whose
data is written once and never recomputed (only a missing layout is added).

## Changing the pipeline

1. **Unit tests first** (`tests/test_update_bgp_data.py`). Network calls are
   faked: `_FakeResponse`, `mock.patch.object(ubd, "get_with_retries", ...)`,
   or pass a fake function in (as `refresh_registered_countries(fetch=...)`
   allows). Cover the failure path, not just the happy one.
2. **Check against real data on a scratch copy.** Don't run the whole updater
   into `data/` to see what happens: it takes 5-15 minutes, rewrites every data
   file and adds a history snapshot. Instead import the function you changed
   and run it over a copy of the real inputs in the scratchpad:

   ```python
   import json, sys
   sys.path.insert(0, 'scripts')
   import update_bgp_data as u
   names = json.load(open('data/BD/asn_names.json'))        # read, never write
   bd = set(json.load(open('data/BD/country_resources.json'))['asns'])
   u.refresh_registered_countries(names, bd, u.RateLimiter(requests_per_second=4))
   json.dump(names, open('<scratchpad>/asn_names.after.json', 'w'), indent=2)
   ```

   Then print before/after counts for what the site shows (e.g. countries of
   `outside` nodes, route share per country) and spot-check a few well-known
   networks. Numbers that look implausible (29 networks in American Samoa)
   are the signal.
3. Mirror the change in `ripestat.js` (live fetch, "How does my internet reach
   the world?") and `reprocess_3layer.py`, which imports helpers from
   `update_bgp_data.py`. Add a `tests-js/` test for any JS parser.
4. Run `python3 -m unittest discover -s tests -p "test_*.py"` and
   `npm run test:js`. If the output shape or values the site reads change,
   also follow the `verify-site-change` skill.
5. Update `docs/classification-pipeline.md` (and `.mmd`), `scripts/README.md`
   and `data/README.md` when a source changes. The `.svg`/`.png` diagram
   exports need mermaid-cli to regenerate; say so if you can't.

## Correcting the data itself

Normally don't commit `data/`: the bot commits there every 4 hours and the
next run fixes the current files anyway. Make a one-off data correction only
when waiting is worse, e.g. wrong values would otherwise sit in 7 days of
history (snapshots are never rewritten). Then:

- **Start from the committed files**, not your working copy, which may hold a
  locally baked `layout` block (`git checkout -- data/BD`, keep a copy of
  anything you want back).
- **Change only the values you mean to**, editing the text rather than
  re-serialising, so formatting and any appended `layout` block stay
  byte-identical. For `asn_names.json`, `json.dump(..., indent=2)` matches
  what the pipeline writes.
- **Fix every place the value lives**: the cache (`asn_names.json`, with its
  source mark so the bot keeps it), `viz_data.json`, and each snapshot in
  `data/BD/history/`.
- **Prove it** with `scripts/diff_viz_data.py` in this skill's folder:

  ```bash
  python3 .claude/skills/data-pipeline/scripts/diff_viz_data.py origin/main:data/BD/viz_data.json data/BD/viz_data.json
  ```

  Only the intended field may change; edges and stats must be identical.
  (A normal bot run changes rank, traffic, percentage and nodes; that is
  what an unintended diff looks like.)
- Commit the data separately from code, with the counts in the message.

### When the bot commits in between

Check `git fetch && git log HEAD..origin/main` right before pushing. If the
bot has committed, merging `main` conflicts in `data/BD/` (often as a
"rename" of a pruned snapshot into the new one). Don't hand-merge JSON: take
`main`'s data and re-apply the correction to it.

```bash
git checkout origin/main -- data/BD
# re-run the correction against these files (start from the current cache:
# the bot may have added ASNs), then re-check with diff_viz_data.py
```

A PR that changes `data/` will keep conflicting until it merges, so merge it
soon after, and say in the PR how to resolve a conflict.

## After it ships

The first scheduled run after a pipeline change is the real test: it runs
the full pipeline against live RIPEstat with the committed cache. Read that
run's log (`gh run list --workflow update-bgp-data.yml`, then
`gh run view <id> --log`) and diff its commit with `diff_viz_data.py`: expected lookups
happened, no failures piled up, and the values you fixed stayed fixed.
