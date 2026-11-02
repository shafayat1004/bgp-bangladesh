/**
 * What changed on a network's path between history snapshots.
 *
 * The pipeline writes data/<CC>/history/changes.json: every connection seen in
 * the retained snapshots with one integer share per snapshot (null when it
 * isn't in that snapshot). Each connection has two shares:
 *   "d" (local network -> gateway): s0 = share of the local network's routes,
 *       s1 = share of the gateway's customer routes.
 *   "i" (network abroad -> gateway): s0 = share of the gateway's routes abroad,
 *       s1 = share of the network abroad's routes into Bangladesh.
 * Without the file (older deploy, failed run) fromTwoSnapshots builds the same
 * shape from the previous and current snapshot. No DOM access here.
 */

import { sourceAsn, targetAsn } from './network-data.js';

/** Snapshots a GONE connection stays on screen (about half a day). */
export const GONE_TICKS = 3;
/** Share change, in points, that counts as a move in the change list. */
export const MOVE_POINTS = 10;

const keyOf = (source, target) => `${source}>${target}`;

/** Fetch and index changes.json; null when it is missing or unreadable. */
export async function loadChanges(country) {
  try {
    const resp = await fetch(`data/${country}/history/changes.json`);
    if (!resp.ok) return null;
    return indexChanges(await resp.json());
  } catch {
    return null;
  }
}

/** { snapshots, byKey: Map<"source>target", { source, target, kind, s0, s1 }> } */
export function indexChanges(raw) {
  const byKey = new Map();
  for (const [source, target, kind, s0, s1] of raw?.connections || []) {
    byKey.set(keyOf(source, target), { source, target, kind, s0, s1 });
  }
  return { snapshots: raw?.snapshots || [], byKey };
}

/** Same shape as indexChanges, built from up to two loaded snapshots. */
export function fromTwoSnapshots(prevData, curData, prevTs, curTs) {
  const snaps = prevData ? [[prevTs, prevData], [curTs, curData]] : [[curTs, curData]];
  const n = snaps.length;
  const byKey = new Map();
  snaps.forEach(([, data], pos) => {
    const edges = (data?.edges || []).filter(e => e.type === 'domestic' || e.type === 'international');
    const totals = new Map();
    const add = (k, c) => totals.set(k, (totals.get(k) || 0) + c);
    for (const e of edges) {
      const kind = e.type === 'domestic' ? 'd' : 'i';
      add(`${kind}:s:${sourceAsn(e)}`, e.count || 0);
      add(`${kind}:t:${targetAsn(e)}`, e.count || 0);
    }
    for (const e of edges) {
      const source = String(sourceAsn(e));
      const target = String(targetAsn(e));
      const kind = e.type === 'domestic' ? 'd' : 'i';
      const key = keyOf(source, target);
      let conn = byKey.get(key);
      if (!conn) {
        conn = { source, target, kind, s0: Array(n).fill(null), s1: Array(n).fill(null) };
        byKey.set(key, conn);
      }
      const srcShare = percent(e.count || 0, totals.get(`${kind}:s:${source}`));
      const tgtShare = percent(e.count || 0, totals.get(`${kind}:t:${target}`));
      if (kind === 'd') { conn.s0[pos] = srcShare; conn.s1[pos] = tgtShare; }
      else { conn.s0[pos] = tgtShare; conn.s1[pos] = srcShare; }
    }
  });
  return { snapshots: snaps.map(([ts]) => ts), byKey };
}

// Integer percent rounded half up, as the pipeline writes it.
function percent(count, total) {
  return total ? Math.round(100 * count / total) : 0;
}

/** Position of a snapshot by timestamp (never by array index); -1 if absent. */
export function snapshotPos(index, ts) {
  return index?.snapshots ? index.snapshots.indexOf(ts) : -1;
}

/**
 * A connection's state at snapshot `pos`, from one perspective ('s0' or 's1').
 * share is the current share, or the last one seen while it is GONE.
 */
export function connState(conn, pos, persp) {
  const s = conn[persp];
  const cur = s[pos] ?? null;
  const prev = pos > 0 ? (s[pos - 1] ?? null) : null;
  if (cur !== null) {
    const isNew = pos > 0 && prev === null;
    return {
      state: isNew ? 'new' : 'present',
      share: cur,
      delta: prev === null ? null : cur - prev,
      since: isNew ? pos : null,
      fading: false,
    };
  }
  let last = -1;
  for (let p = Math.min(pos, s.length) - 1; p >= 0; p--) {
    if (s[p] !== null && s[p] !== undefined) { last = p; break; }
  }
  const age = pos - (last + 1);
  if (last >= 0 && age < GONE_TICKS) {
    return { state: 'gone', share: s[last], delta: null, since: last + 1, fading: age === GONE_TICKS - 1 };
  }
  return { state: 'absent', share: 0, delta: null, since: null, fading: false };
}

/** Order that never changes across the range: first seen, then largest share ever. */
export function stableOrder(conns, persp) {
  const meta = new Map(conns.map(c => {
    const s = c[persp];
    const first = s.findIndex(v => v !== null && v !== undefined);
    const max = Math.max(0, ...s.filter(v => v !== null && v !== undefined));
    return [c, { first: first < 0 ? Infinity : first, max, key: keyOf(c.source, c.target) }];
  }));
  return [...conns].sort((a, b) => {
    const ma = meta.get(a), mb = meta.get(b);
    return ma.first - mb.first || mb.max - ma.max || (ma.key < mb.key ? -1 : ma.key > mb.key ? 1 : 0);
  });
}

/** Every appear, disappear and move of MOVE_POINTS or more between snapshots. */
export function connEvents(conns, persp) {
  const order = new Map(stableOrder(conns, persp).map((c, i) => [c, i]));
  const events = [];
  for (const conn of conns) {
    const s = conn[persp];
    for (let pos = 1; pos < s.length; pos++) {
      const from = s[pos - 1] ?? null;
      const to = s[pos] ?? null;
      if (from === null && to !== null) events.push({ pos, conn, kind: 'appear', from, to });
      else if (from !== null && to === null) events.push({ pos, conn, kind: 'disappear', from, to });
      else if (from !== null && to !== null && Math.abs(to - from) >= MOVE_POINTS) {
        events.push({ pos, conn, kind: 'move', from, to });
      }
    }
  }
  return events.sort((a, b) => a.pos - b.pos || order.get(a.conn) - order.get(b.conn));
}
