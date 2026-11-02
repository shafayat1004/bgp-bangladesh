import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSelection, formatTimestamp, nextPlayIndex, PLAY_STEP_MS } from '../assets/js/ui/timeline.js';

const snapshots = [
  { ts: '2026-06-01T06:00:00Z', file: 'a.json' },
  { ts: '2026-06-02T06:00:00Z', file: 'b.json' },
  { ts: '2026-06-03T06:00:00Z', file: 'c.json' },
];

test('resolveSelection: last index is latest', () => {
  const sel = resolveSelection(snapshots, 2);
  assert.equal(sel.isLatest, true);
  assert.equal(sel.index, 2);
  assert.equal(sel.snapshot.file, 'c.json');
});

test('resolveSelection: middle index is not latest', () => {
  const sel = resolveSelection(snapshots, 1);
  assert.equal(sel.isLatest, false);
  assert.equal(sel.snapshot.file, 'b.json');
});

test('resolveSelection: clamps below range', () => {
  const sel = resolveSelection(snapshots, -5);
  assert.equal(sel.index, 0);
  assert.equal(sel.snapshot.file, 'a.json');
  assert.equal(sel.isLatest, false);
});

test('resolveSelection: clamps above range', () => {
  const sel = resolveSelection(snapshots, 99);
  assert.equal(sel.index, 2);
  assert.equal(sel.isLatest, true);
});

test('formatTimestamp: returns a non-empty string for valid ts', () => {
  const out = formatTimestamp('2026-06-03T06:00:00Z');
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});

test('formatTimestamp: passes through invalid input unchanged', () => {
  assert.equal(formatTimestamp('not-a-date'), 'not-a-date');
});

test('PLAY_STEP_MS: one snapshot per 1.2 s', () => {
  assert.equal(PLAY_STEP_MS, 1200);
});

test('nextPlayIndex: starting at the latest goes back to the oldest', () => {
  assert.equal(nextPlayIndex(2, 2, true), 0);
});

test('nextPlayIndex: steps forward', () => {
  assert.equal(nextPlayIndex(0, 2, true), 1);
  assert.equal(nextPlayIndex(1, 2, false), 2);
});

test('nextPlayIndex: stops past the end', () => {
  assert.equal(nextPlayIndex(2, 2, false), null);
});
