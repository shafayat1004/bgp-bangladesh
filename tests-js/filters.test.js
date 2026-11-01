import test from 'node:test';
import assert from 'node:assert/strict';

import { currentFilters, hiddenByRoutes, applyFilters, isTypeShown, DEFAULT_MIN_ROUTES, DEFAULT_NODE_SIZE } from '../assets/js/ui/filters.js';

// No saved preferences here (no localStorage in Node), so the defaults apply.
test('currentFilters: defaults when nothing is saved', () => {
  assert.deepEqual(currentFilters(), { minTraffic: DEFAULT_MIN_ROUTES, maxTraffic: Infinity, nodeSize: DEFAULT_NODE_SIZE });
});

test('hiddenByRoutes: below Min Routes is hidden, no Max Routes limit by default', () => {
  assert.equal(hiddenByRoutes(DEFAULT_MIN_ROUTES - 1), true);
  assert.equal(hiddenByRoutes(undefined), true);
  assert.equal(hiddenByRoutes(DEFAULT_MIN_ROUTES), false);
  assert.equal(hiddenByRoutes(5e6), false);
});

test('applyFilters: leaves a view alone while every category is shown', () => {
  let calls = 0;
  applyFilters({ filterByTypes: () => calls++ });
  applyFilters(null);
  assert.equal(calls, 0);
  assert.equal(isTypeShown('iig'), true);
});
