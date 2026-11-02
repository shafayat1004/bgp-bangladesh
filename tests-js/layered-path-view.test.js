import test from 'node:test';
import assert from 'node:assert/strict';

import { pathCards, pathHistory } from '../assets/js/viz/layered-path-view.js';
import { buildPath } from '../assets/js/viz/layered-path.js';
import { indexChanges, fromTwoSnapshots } from '../assets/js/data/changes.js';

// Digicon's week from tests-js/changes.test.js: Fiber@Home stops appearing at
// position 7, the snapshot Apple Communication goes from 43% to 99%.
const SNAPSHOTS = Array.from({ length: 11 }, (_, i) =>
  `2026-10-2${5 + Math.floor(i / 6)}T${String((i % 6) * 4).padStart(2, '0')}:00:00Z`);
const FIBER = [57, 58, 58, 57, 57, 55, 56, null, null, null, null];
const APPLE = [41, 40, 40, 41, 41, 43, 43, 99, 98, 98, 98];
const ALL = Array(11).fill(30);
const history = indexChanges({
  country: 'BD',
  snapshots: SNAPSHOTS,
  connections: [
    ['137967', '10075', 'd', FIBER, FIBER.map(s => s === null ? null : 3)],
    ['137967', '58717', 'd', APPLE, APPLE.map(s => s === null ? null : 2)],
    // Another network's change, which Digicon's list must not show.
    ['24432', '10075', 'd', [50, null, null, null, null, null, null, null, null, null, null], ALL],
    // Gateways' connections abroad.
    ['9498', '58717', 'i', ALL, ALL],
    ['6939', '10075', 'i', ALL, ALL],
  ],
});

const nodes = [
  { asn: '137967', type: 'local-company', name: 'Digicon Telecommunication Ltd', traffic: 900 },
  { asn: '10075', type: 'iig', name: 'Fiber@Home Global Limited', traffic: 9000 },
  { asn: '58717', type: 'detected-iig', name: 'Apple Communication Ltd.', traffic: 8000 },
  { asn: '24432', type: 'local-company', name: 'Link3', traffic: 800 },
  { asn: '9498', type: 'outside', name: 'Bharti Airtel', country: 'IN', traffic: 5000 },
  { asn: '6939', type: 'outside', name: 'Hurricane Electric', country: 'US', traffic: 5000 },
];
const lookupNode = (asn) => nodes.find(n => n.asn === asn) || null;
// The snapshot after the change: Digicon only through Apple.
const data = {
  nodes,
  edges: [
    { source: '137967', target: '58717', count: 98, type: 'domestic' },
    { source: '9498', target: '58717', count: 30, type: 'international' },
    { source: '6939', target: '10075', count: 30, type: 'international' },
  ],
};
const path = buildPath(data, '137967');
const opts = { asn: '137967', lookupNode };
const states = (cards) => cards.map(c => [c.asn, c.state, c.fading]);

test('pathCards: GONE gateway kept for three snapshots then dropped', () => {
  assert.deepEqual(states(pathCards(path, history, 6, opts).columns.gateways),
    [['58717', 'present', false], ['10075', 'present', false]]);
  assert.deepEqual(states(pathCards(path, history, 7, opts).columns.gateways),
    [['58717', 'present', false], ['10075', 'gone', false]]);
  assert.deepEqual(states(pathCards(path, history, 9, opts).columns.gateways),
    [['58717', 'present', false], ['10075', 'gone', true]]);
  assert.deepEqual(states(pathCards(path, history, 10, opts).columns.gateways),
    [['58717', 'present', false]]);
  const gone = pathCards(path, history, 7, opts).columns.gateways[1];
  assert.equal(gone.since, 7);
  assert.equal(gone.share, 56);
  assert.equal(gone.name, 'Fiber@Home Global Limited');
});

test('pathCards: stable order across positions', () => {
  for (const pos of [0, 3, 6, 7, 8]) {
    assert.deepEqual(pathCards(path, history, pos, opts).columns.gateways.map(c => c.asn), ['58717', '10075']);
  }
  const apple = pathCards(path, history, 7, opts).columns.gateways[0];
  assert.equal(apple.share, 99);
  assert.equal(apple.delta, 56);
});

test('pathCards: abroad follows the gateways, and lines join each kept pair', () => {
  const before = pathCards(path, history, 6, opts);
  assert.deepEqual(states(before.columns.abroad), [['6939', 'present', false], ['9498', 'present', false]]);
  assert.deepEqual(before.lines.map(l => [l.from, l.to, l.share]), [['58717', '9498', 30], ['10075', '6939', 30]]);
  // Fiber@Home's only network abroad leaves the path with it, unmarked: which
  // networks make a gateway's top few churns while they stay in the data.
  const after = pathCards(path, history, 7, opts);
  assert.deepEqual(states(after.columns.abroad), [['9498', 'present', false]]);
  assert.deepEqual(after.lines.map(l => [l.from, l.to]), [['58717', '9498']]);
});

test('pathCards: events only for this network\'s connections', () => {
  const { events } = pathCards(path, history, 10, opts);
  assert.deepEqual(events.map(e => [e.pos, e.asn, e.kind, e.from, e.to, e.column]), [
    [7, '58717', 'move', 43, 99, 'gateways'],
    [7, '10075', 'disappear', 56, null, 'gateways'],
  ]);
});

test('pathCards: missing network shows its previous connections as GONE', () => {
  const lost = indexChanges({
    country: 'BD',
    snapshots: SNAPSHOTS.slice(0, 3),
    connections: [['137967', '58717', 'd', [60, 60, null], [2, 2, null]]],
  });
  const cards = pathCards({ status: 'missing' }, lost, 2, opts);
  assert.equal(cards.role, 'local');
  assert.deepEqual(states(cards.columns.gateways), [['58717', 'gone', false]]);
});

test('pathCards: works with fromTwoSnapshots history', () => {
  const prev = {
    nodes,
    edges: [
      { source: '137967', target: '10075', count: 56, type: 'domestic' },
      { source: '137967', target: '58717', count: 44, type: 'domestic' },
    ],
  };
  const two = fromTwoSnapshots(prev, data, 'tA', 'tB');
  const cards = pathCards(path, two, 1, opts);
  assert.deepEqual(states(cards.columns.gateways), [['58717', 'present', false], ['10075', 'gone', false]]);
  assert.equal(cards.columns.gateways[0].delta, 56);
});

test('pathCards: gateway and outside roles', () => {
  const gw = pathCards(buildPath(data, '58717'), history, 10, { asn: '58717', lookupNode });
  assert.equal(gw.role, 'gateway');
  assert.deepEqual(gw.columns.customers.map(c => [c.asn, c.share]), [['137967', 2]]);
  assert.deepEqual(gw.columns.abroad.map(c => [c.asn, c.share]), [['9498', 30]]);
  const out = pathCards(buildPath(data, '9498'), history, 10, { asn: '9498', lookupNode });
  assert.equal(out.role, 'outside');
  assert.deepEqual(out.columns.gateways.map(c => [c.asn, c.share]), [['58717', 30]]);
});

test('pathHistory: uses changes.json when it has the date', () => {
  const h = pathHistory({ history, ts: SNAPSHOTS[7], data, prevData: null, prevTs: null });
  assert.equal(h.fromHistory, true);
  assert.equal(h.pos, 7);
});

test('pathHistory: without changes.json, compares only with an earlier snapshot', () => {
  const prev = { nodes, edges: [{ source: '137967', target: '10075', count: 5, type: 'domestic' }] };
  const forward = pathHistory({ history: null, ts: 'tB', data, prevData: prev, prevTs: 'tA' });
  assert.deepEqual([forward.fromHistory, forward.pos, forward.history.snapshots], [false, 1, ['tA', 'tB']]);
  // Stepping back: the snapshot shown before is newer, so nothing can be called NEW or GONE.
  const back = pathHistory({ history: null, ts: 'tA', data, prevData: prev, prevTs: 'tB' });
  assert.deepEqual([back.pos, back.history.snapshots], [0, ['tA']]);
  assert.ok(pathCards(path, back.history, back.pos, opts).columns.gateways.every(c => c.state === 'present'));
});

test('pathHistory: live data (no timestamp) gets no comparison', () => {
  const prev = { nodes, edges: [] };
  const live = pathHistory({ history, ts: null, data, prevData: prev, prevTs: SNAPSHOTS[10] });
  assert.deepEqual([live.fromHistory, live.pos, live.history.snapshots], [false, 0, [null]]);
});
