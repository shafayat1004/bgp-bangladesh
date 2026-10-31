import test from 'node:test';
import assert from 'node:assert/strict';

import { searchNetworks } from '../assets/js/ui/search.js';

const nodes = [
  { asn: '58717', name: 'SUMMITCOMMUNICATIONS-BD Summit Communications Ltd', type: 'iig', traffic: 2558087 },
  { asn: '132884', name: 'SUMMIT-BD Summit Communications Limited', type: 'iig', traffic: 110862 },
  { asn: '587', name: 'Small Net', type: 'local-company', traffic: 10 },
  { asn: '24432', name: 'KSNETWORK-AS-AP KS Network Limited', type: 'local-company', traffic: 50000 },
  { asn: '6939', name: 'HURRICANE - Hurricane Electric LLC', type: 'outside', traffic: 877447 },
  { asn: '9498', name: 'BBIL-AP BHARTI Airtel Ltd.', description: 'Bharti Airtel', type: 'outside', traffic: 1071854 },
];
const asns = (q) => searchNetworks(nodes, q).map(n => n.asn);

test('search: "AS58717", "as 58717" and "58717" find the same network first', () => {
  for (const q of ['AS58717', 'as 58717', '58717', ' 58717 ']) assert.equal(asns(q)[0], '58717', q);
});

test('search: an exact ASN beats ASNs that start with the number', () => {
  assert.deepEqual(asns('587'), ['587', '58717']);
});

test('search: partial company names, any case, best known first', () => {
  assert.deepEqual(asns('summit'), ['58717', '132884']);
  assert.deepEqual(asns('hurri'), ['6939']);
  assert.deepEqual(asns('airtel'), ['9498']);
});

test('search: a name starting with the words ranks above one containing them', () => {
  assert.deepEqual(asns('network'), ['24432']);
  assert.equal(asns('k')[0], '24432');   // "KS Network" starts with k
});

test('search: matches the registry handle too, but not across unrelated text', () => {
  assert.deepEqual(asns('ksnetwork'), ['24432']);
  assert.deepEqual(asns('zzz'), []);
  assert.deepEqual(asns(''), []);
  assert.deepEqual(searchNetworks(null, 'summit'), []);
});

test('search: at most 8 results by default', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ asn: String(1000 + i), name: `Net ${i}`, traffic: i }));
  assert.equal(searchNetworks(many, 'net').length, 8);
  assert.equal(searchNetworks(many, 'net')[0].asn, '1019');   // most routes first
});
