import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadChanges, indexChanges, fromTwoSnapshots, snapshotPos, connState,
  stableOrder, connEvents, GONE_TICKS, MOVE_POINTS,
} from '../assets/js/data/changes.js';

// Digicon (AS137967) over 11 snapshots: Fiber@Home stops appearing at
// position 7, the same snapshot Apple Communication goes from 43% to 99%.
const SNAPSHOTS = Array.from({ length: 11 }, (_, i) =>
  `2026-10-2${5 + Math.floor(i / 6)}T${String((i % 6) * 4).padStart(2, '0')}:00:00Z`);
const FIBER = [57, 58, 58, 57, 57, 55, 56, null, null, null, null];
const APPLE = [41, 40, 40, 41, 41, 43, 43, 99, 98, 98, 98];
const raw = {
  country: 'BD',
  snapshots: SNAPSHOTS,
  connections: [
    ['137967', '10075', 'd', FIBER, FIBER.map(s => s === null ? null : 3)],
    ['137967', '58717', 'd', APPLE, APPLE.map(s => s === null ? null : 2)],
  ],
};
const index = indexChanges(raw);
const fiber = index.byKey.get('137967>10075');
const apple = index.byKey.get('137967>58717');

test('constants fixed by the spec', () => {
  assert.equal(GONE_TICKS, 3);
  assert.equal(MOVE_POINTS, 10);
});

test('indexChanges: keyed by source>target', () => {
  assert.deepEqual(index.snapshots, SNAPSHOTS);
  assert.equal(fiber.kind, 'd');
  assert.equal(fiber.source, '137967');
  assert.equal(fiber.target, '10075');
  assert.deepEqual(fiber.s0, FIBER);
});

test('connState: GONE for three snapshots, fading on the third, then absent', () => {
  assert.deepEqual(
    pick(connState(fiber, 7, 's0')),
    { state: 'gone', since: 7, fading: false, share: 56 });
  assert.equal(connState(fiber, 8, 's0').fading, false);
  assert.deepEqual(
    pick(connState(fiber, 9, 's0')),
    { state: 'gone', since: 7, fading: true, share: 56 });
  assert.equal(connState(fiber, 10, 's0').state, 'absent');
  assert.equal(connState(fiber, 6, 's0').state, 'present');
});

test('connState: delta', () => {
  const s = connState(apple, 7, 's0');
  assert.equal(s.state, 'present');
  assert.equal(s.share, 99);
  assert.equal(s.delta, 56);
  assert.equal(connState(fiber, 7, 's0').delta, null);
});

test('connState: a connection present from the start is never new at pos 0', () => {
  const s = connState(apple, 0, 's0');
  assert.equal(s.state, 'present');
  assert.equal(s.delta, null);
});

test('connState: new when absent on the previous snapshot', () => {
  const conn = { source: '1', target: '2', kind: 'd', s0: [null, 20, 25], s1: [null, 5, 5] };
  assert.deepEqual(pick(connState(conn, 1, 's0')), { state: 'new', since: 1, fading: false, share: 20 });
  assert.equal(connState(conn, 2, 's0').state, 'present');
  assert.equal(connState(conn, 0, 's0').state, 'absent');
});

test('connEvents: one disappear and one move at pos 7', () => {
  const events = connEvents([fiber, apple], 's0');
  assert.deepEqual(
    events.map(e => [e.pos, e.conn.target, e.kind, e.from, e.to]),
    // Same position: stable order (Apple's largest share ever, 99, comes first).
    [[7, '58717', 'move', 43, 99], [7, '10075', 'disappear', 56, null]]);
});

test('connEvents: appear', () => {
  const conn = { source: '1', target: '2', kind: 'd', s0: [null, 20], s1: [null, 5] };
  assert.deepEqual(connEvents([conn], 's0').map(e => [e.pos, e.kind, e.from, e.to]),
    [[1, 'appear', null, 20]]);
});

test('stableOrder: first appearance, then largest share ever', () => {
  const late = { source: '1', target: '9', kind: 'd', s0: [null, 90], s1: [null, 1] };
  const small = { source: '1', target: '8', kind: 'd', s0: [10, 10], s1: [1, 1] };
  const big = { source: '1', target: '7', kind: 'd', s0: [30, 80], s1: [1, 1] };
  assert.deepEqual(stableOrder([late, small, big], 's0').map(c => c.target), ['7', '8', '9']);
  // Ties break on source+target so the order never depends on input order.
  const a = { source: '1', target: 'a', kind: 'd', s0: [10], s1: [1] };
  const b = { source: '1', target: 'b', kind: 'd', s0: [10], s1: [1] };
  assert.deepEqual(stableOrder([b, a], 's0').map(c => c.target), ['a', 'b']);
});

test('snapshotPos: matches by timestamp when the index has an extra newer snapshot', () => {
  const grown = indexChanges({ ...raw, snapshots: [...SNAPSHOTS, '2026-10-27T04:00:00Z'] });
  assert.equal(snapshotPos(grown, SNAPSHOTS[7]), 7);
  assert.equal(snapshotPos(grown, '2026-10-27T04:00:00Z'), 11);
  assert.equal(snapshotPos(index, '2026-10-27T04:00:00Z'), -1);
});

// Same fixture as the pipeline's test_build_change_summary_shares.
const kinds = { d: 'domestic', i: 'international' };
const snap = (...rows) => ({
  nodes: [],
  edges: rows.map(([source, target, k, count]) => ({ source, target, count, type: kinds[k] })),
});

test('fromTwoSnapshots: same shares as the pipeline for the Task 1 fixture', () => {
  const a = snap(['100', '200', 'd', 60], ['100', '300', 'd', 40], ['400', '200', 'd', 100],
    ['900', '200', 'i', 75], ['901', '200', 'i', 25]);
  const b = snap(['100', '200', 'd', 50], ['400', '200', 'd', 100]);
  const idx = fromTwoSnapshots(a, b, 'tA', 'tB');
  assert.deepEqual(idx.snapshots, ['tA', 'tB']);
  const get = k => { const c = idx.byKey.get(k); return [c.kind, c.s0, c.s1]; };
  assert.deepEqual(get('100>200'), ['d', [60, 100], [38, 33]]);
  assert.deepEqual(get('100>300'), ['d', [40, null], [100, null]]);
  assert.deepEqual(get('400>200'), ['d', [100, 100], [63, 67]]);
  assert.deepEqual(get('900>200'), ['i', [75, null], [100, null]]);
  assert.equal(idx.byKey.size, 5);
});

test('fromTwoSnapshots: reads connection ends that a simulation turned into objects', () => {
  const b = { nodes: [], edges: [{ source: { asn: '1' }, target: { asn: '2' }, count: 1, type: 'domestic' }] };
  const idx = fromTwoSnapshots(null, b, null, 'tB');
  assert.deepEqual(idx.snapshots, ['tB']);
  assert.deepEqual(idx.byKey.get('1>2').s0, [100]);
});

test('loadChanges: resolves null on 404', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    assert.equal(await loadChanges('BD'), null);
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.equal(await loadChanges('BD'), null);
    globalThis.fetch = async (url) => {
      assert.equal(url, 'data/BD/history/changes.json');
      return { ok: true, json: async () => raw };
    };
    const loaded = await loadChanges('BD');
    assert.equal(loaded.byKey.size, 2);
  } finally {
    globalThis.fetch = saved;
  }
});

function pick(s) {
  return { state: s.state, since: s.since, fading: s.fading, share: s.share };
}
