import test from 'node:test';
import assert from 'node:assert/strict';

import { setLookup, findMyNetwork, myNetwork, onMyNetwork, resetMyNetwork } from '../assets/js/ui/my-network.js';

test('findMyNetwork: two callers share one request', async () => {
  resetMyNetwork();
  let calls = 0;
  setLookup(async () => { calls++; return { asn: '24432', holder: 'Link3' }; });
  const [a, b] = await Promise.all([findMyNetwork(), findMyNetwork()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  // Cached for the session: a later call doesn't ask again.
  await findMyNetwork();
  assert.equal(calls, 1);
  assert.deepEqual(myNetwork(), { asn: '24432', holder: 'Link3' });
});

test('onMyNetwork: subscribers get the result', async () => {
  resetMyNetwork();
  setLookup(async () => ({ asn: '1', holder: 'One' }));
  const seen = [];
  const off = onMyNetwork((r) => seen.push(r.asn));
  await findMyNetwork();
  off();
  resetMyNetwork();
  await findMyNetwork();
  assert.deepEqual(seen, ['1']);
});

test('findMyNetwork: a failed lookup can be retried', async () => {
  resetMyNetwork();
  let calls = 0;
  setLookup(async () => { calls++; if (calls === 1) throw new Error('offline'); return { asn: '2', holder: 'Two' }; });
  await assert.rejects(findMyNetwork(), /offline/);
  assert.equal(myNetwork(), null);
  assert.equal((await findMyNetwork()).asn, '2');
  assert.equal(calls, 2);
});
