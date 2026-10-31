import test from 'node:test';
import assert from 'node:assert/strict';

import { carryOverPositions } from '../assets/js/viz/force-graph.js';

test('carryOverPositions: matched ASNs keep their previous position', () => {
  const prev = [{ asn: '1', x: 10, y: 20, vx: 3, vy: 4 }, { asn: '2', x: 30, y: 40 }];
  const next = [{ asn: '2' }, { asn: '1' }];
  const matched = carryOverPositions(prev, next);
  assert.equal(matched, 2);
  assert.deepEqual(next[0], { asn: '2', x: 30, y: 40, vx: 0, vy: 0 });
  assert.deepEqual(next[1], { asn: '1', x: 10, y: 20, vx: 0, vy: 0 });
});

test('carryOverPositions: unmatched nodes drop stale positions', () => {
  const prev = [{ asn: '1', x: 10, y: 20 }];
  const next = [{ asn: '3', x: 999, y: 999 }];
  assert.equal(carryOverPositions(prev, next), 0);
  assert.equal(next[0].x, undefined);
  assert.equal(next[0].y, undefined);
});

test('carryOverPositions: ignores previous nodes without a valid position', () => {
  const prev = [{ asn: '1', x: NaN, y: 5 }, { asn: '2' }];
  const next = [{ asn: '1' }, { asn: '2' }];
  assert.equal(carryOverPositions(prev, next), 0);
  assert.equal(next[0].x, undefined);
});

test('carryOverPositions: tolerates empty input', () => {
  assert.equal(carryOverPositions(undefined, []), 0);
  assert.equal(carryOverPositions([], undefined), 0);
});
