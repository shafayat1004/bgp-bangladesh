import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseColumns } from '../assets/js/viz/hierarchical.js';

const layers = [1341, 25, 28, 21, 2, 184];

test('chooseColumns: a wide panel gets more boxes per row than a tall one', () => {
  const wide = chooseColumns(layers, 1100, 700, 20);
  const tall = chooseColumns(layers, 370, 700, 20);
  assert.ok(wide.cols > tall.cols, `${wide.cols} vs ${tall.cols}`);
});

test('chooseColumns: no other column count fits larger', () => {
  // Same geometry as hierarchical.js: 70px cells, 30px rows, 12px between layers.
  const scaleFor = (cols, width, height, title) => {
    const w = cols * 70 + 35;
    const h = layers.reduce((s, n) => s + title + Math.ceil(n / cols) * 30 + 12, 0);
    return Math.min(width / w, height / h);
  };
  const best = chooseColumns(layers, 1100, 700, 20);
  for (let cols = 1; cols <= 1341; cols++) {
    assert.ok(scaleFor(cols, 1100, 700, 20) <= best.scale + 1e-12, `cols=${cols}`);
  }
  assert.ok(Math.abs(scaleFor(best.cols, 1100, 700, 20) - best.scale) < 1e-12);
});

test('chooseColumns: a single small layer fits in one row', () => {
  assert.equal(chooseColumns([3], 1000, 200, 20).cols, 3);
});
