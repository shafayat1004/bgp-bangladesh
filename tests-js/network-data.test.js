import test from 'node:test';
import assert from 'node:assert/strict';

import { sourceAsn, targetAsn, connectionEnds, networksByAsn } from '../assets/js/data/network-data.js';

test('connection ends: ASN ids as loaded, or network objects after a D3 simulation', () => {
  const loaded = { source: '58717', target: '6939' };
  const simulated = { source: { asn: '58717' }, target: { asn: '6939' } };
  for (const e of [loaded, simulated]) {
    assert.equal(sourceAsn(e), '58717');
    assert.equal(targetAsn(e), '6939');
    assert.deepEqual(connectionEnds(e), ['58717', '6939']);
  }
});

test('networksByAsn: looks networks up by ASN; missing input gives an empty lookup', () => {
  const a = { asn: '1', name: 'A' };
  const b = { asn: '2', name: 'B' };
  const byAsn = networksByAsn([a, b]);
  assert.equal(byAsn['1'], a);
  assert.equal(byAsn['2'], b);
  assert.equal(byAsn['3'], undefined);
  assert.deepEqual(networksByAsn(undefined), {});
});
