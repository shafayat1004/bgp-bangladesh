import test from 'node:test';
import assert from 'node:assert/strict';

import { describePath } from '../assets/js/ui/my-path.js';
import { friendlyName } from '../assets/js/ui/names.js';

const data = {
  nodes: [
    { asn: '100', type: 'local-company', name: 'ISP-AS-BD Local ISP Ltd' },
    { asn: '200', type: 'iig', name: 'GW-A-BD Gateway A' },
    { asn: '300', type: 'detected-iig', name: 'Gateway B' },
    { asn: '900', type: 'outside', name: 'TRANSIT-X Transit X', country: 'IN' },
    { asn: '901', type: 'outside', name: 'Transit Y', country: 'SG' },
  ],
  edges: [
    { source: '100', target: '200', count: 60, type: 'domestic' },
    { source: '100', target: '300', count: 40, type: 'domestic' },
    { source: '900', target: '200', count: 500, type: 'international' },
    { source: '901', target: '300', count: 100, type: 'international' },
    { source: '901', target: '999', count: 1000, type: 'international' },
  ],
};

test('describePath: a local network goes through its gateways, largest first', () => {
  const p = describePath(data, '100');
  assert.equal(p.status, 'found');
  assert.equal(p.role, 'local');
  assert.deepEqual(p.gateways.map(g => [g.node.asn, g.share]), [['200', 0.6], ['300', 0.4]]);
  // Only international connections into its own gateways count.
  assert.deepEqual(p.international.map(i => [i.node.asn, i.count]), [['900', 500], ['901', 100]]);
});

test('describePath: a gateway lists its own international connections', () => {
  const p = describePath(data, '200');
  assert.equal(p.role, 'gateway');
  assert.deepEqual(p.international.map(i => i.node.asn), ['900']);
});

test('describePath: networks outside Bangladesh and unknown networks', () => {
  assert.equal(describePath(data, '900').role, 'outside');
  assert.deepEqual(describePath(data, '12345'), { status: 'missing' });
});

test('friendlyName drops a leading registry handle', () => {
  assert.equal(friendlyName({ asn: '1', name: 'LINK3-TECH-AS-BD-AP Link3 Technologies Ltd.' }), 'Link3 Technologies Ltd.');
  assert.equal(friendlyName({ asn: '1', name: 'Gateway B' }), 'Gateway B');
  assert.equal(friendlyName({ asn: '1', name: 'CLOUDFLARENET' }), 'CLOUDFLARENET');
  assert.equal(friendlyName({ asn: '7', name: '' }), 'AS7');
});
