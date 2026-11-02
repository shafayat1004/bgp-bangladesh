import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSelection, formatTimestamp, nextPlayIndex, PLAY_STEP_MS, createPlayer } from '../assets/js/ui/timeline.js';

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

// A player whose steps stay pending until the test resolves them, like a slow snapshot load.
function slowPlayer(start = 1, latest = 5) {
  let cur = start;
  const steps = [];
  const pending = [];
  const player = createPlayer({
    latest: () => latest,
    current: () => cur,
    step: (i) => { cur = i; steps.push(i); return new Promise((r) => pending.push(r)); },
    stepMs: 5,
  });
  return { player, steps, pending };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('createPlayer: Pause then Play during a slow load leaves one Play running', async () => {
  const { player, steps, pending } = slowPlayer();
  player.play();
  await sleep(20);                 // first step is loading
  assert.deepEqual(steps, [2]);
  player.pause();
  player.play();
  await sleep(20);                 // the new Play's first step is loading too
  assert.deepEqual(steps, [2, 3]);
  pending[0](true);                // the old load finishes
  await sleep(30);
  assert.deepEqual(steps, [2, 3], 'the paused Play must not step again');
  assert.equal(player.isPlaying(), true);
});

test('createPlayer: an old load replaced by a newer one does not stop the new Play', async () => {
  const { player, steps, pending } = slowPlayer();
  player.play();
  await sleep(20);
  player.pause();
  player.play();
  await sleep(20);
  pending[0](false);               // superseded by the new Play's load
  await sleep(10);
  assert.equal(player.isPlaying(), true);
  pending[1](true);
  await sleep(20);
  assert.deepEqual(steps, [2, 3, 4]);
});

test('createPlayer: from the latest starts at the oldest and stops at the latest', async () => {
  let cur = 2;
  const steps = [];
  const player = createPlayer({ latest: () => 2, current: () => cur, step: async (i) => { cur = i; steps.push(i); return true; }, stepMs: 1 });
  player.play();
  await sleep(40);
  assert.deepEqual(steps, [0, 1, 2]);
  assert.equal(player.isPlaying(), false);
});
