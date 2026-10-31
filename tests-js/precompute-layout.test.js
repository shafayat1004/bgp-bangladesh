import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLayout, withLayoutBlock, stripLayoutBlock } from '../scripts/precompute_layout.mjs';
import { LAYOUT_VERSION, hasBakedLayout, applyBakedPositions } from '../assets/js/viz/force-layout.js';

// Small dataset shaped like viz_data.json.
const data = {
  nodes: [
    { asn: '1', type: 'local-company', traffic: 500 },
    { asn: '2', type: 'iig', traffic: 5000 },
    { asn: '3', type: 'outside', traffic: 9000 },
    { asn: '4', type: 'local-company', traffic: 20 },
  ],
  edges: [
    { source: '1', target: '2', count: 500, type: 'domestic' },
    { source: '2', target: '3', count: 4000, type: 'international' },
    { source: '4', target: '2', count: 20, type: 'domestic' },  // below the default filter
  ],
  stats: { total_edges: 3 },
};

// Python's json.dump(indent=2) style: no trailing newline, floats like 100.0.
const pythonText = '{\n  "nodes": [],\n  "stats": {\n    "percentage": 100.0\n  }\n}';

test('computeLayout: positions every node in the default filter, and only those', () => {
  const { layout } = computeLayout(data);
  assert.deepEqual(Object.keys(layout.positions).sort(), ['1', '2', '3']);
  for (const [x, y] of Object.values(layout.positions)) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
  assert.equal(layout.version, LAYOUT_VERSION);
  assert.equal(layout.minTraffic, 100);
  assert.equal(layout.maxTraffic, null);
});

test('computeLayout: is deterministic', () => {
  assert.deepEqual(computeLayout(data).layout, computeLayout(data).layout);
});

test('computeLayout: seeds nodes from the previous positions', () => {
  const first = computeLayout(data).layout.positions;
  const { seeded, layout } = computeLayout(data, first);
  assert.equal(seeded, 3);
  for (const asn of Object.keys(first)) {
    const [x0, y0] = first[asn];
    const [x1, y1] = layout.positions[asn];
    assert.ok(Math.hypot(x1 - x0, y1 - y0) < 50, `AS${asn} moved too far`);
  }
});

test('withLayoutBlock: keeps the original text byte-for-byte and appends layout', () => {
  const layout = computeLayout(data).layout;
  const out = withLayoutBlock(pythonText, layout);
  assert.ok(out.startsWith(pythonText.slice(0, -2)));
  assert.ok(out.includes('"percentage": 100.0'));
  assert.deepEqual(JSON.parse(out).layout, layout);
  assert.equal(stripLayoutBlock(out), pythonText);
});

test('withLayoutBlock: replaces an existing layout block', () => {
  const a = computeLayout(data).layout;
  const b = { ...a, positions: { 1: [1, 2] } };
  const out = withLayoutBlock(withLayoutBlock(pythonText, a), b);
  assert.deepEqual(JSON.parse(out).layout, b);
  assert.equal(out.split('"layout"').length, 2);
});

test('hasBakedLayout: only matches the baked filter and version', () => {
  const baked = { layout: computeLayout(data).layout };
  assert.equal(hasBakedLayout(baked, 100, Infinity), true);
  assert.equal(hasBakedLayout(baked, 0, Infinity), false);
  assert.equal(hasBakedLayout(baked, 100, 5000), false);
  assert.equal(hasBakedLayout({ layout: { ...baked.layout, version: -1 } }, 100, Infinity), false);
  assert.equal(hasBakedLayout({}, 100, Infinity), false);
});

test('applyBakedPositions: positions matching nodes and resets velocity', () => {
  const nodes = [{ asn: '1', vx: 5 }, { asn: '9' }];
  assert.equal(applyBakedPositions({ positions: { 1: [3, 4] } }, nodes), 1);
  assert.deepEqual(nodes[0], { asn: '1', x: 3, y: 4, vx: 0, vy: 0 });
  assert.equal(nodes[1].x, undefined);
});
