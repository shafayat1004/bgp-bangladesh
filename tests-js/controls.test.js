import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePreferences, serializePreferences } from '../assets/js/ui/controls.js';

test('preferences: no Max Routes limit survives a save and reload', () => {
  const prefs = parsePreferences(serializePreferences({ minTraffic: 100, maxTraffic: Infinity }));
  assert.equal(prefs.maxTraffic, Infinity);
  assert.equal(prefs.minTraffic, 100);
});

test('preferences: a finite Max Routes is kept as is', () => {
  assert.equal(parsePreferences(serializePreferences({ maxTraffic: 5000 })).maxTraffic, 5000);
});

test('preferences: null saved by older versions means no limit', () => {
  assert.equal(parsePreferences('{"maxTraffic":null}').maxTraffic, Infinity);
});

test('preferences: nothing saved gives no values', () => {
  assert.deepEqual(parsePreferences(null), {});
});
