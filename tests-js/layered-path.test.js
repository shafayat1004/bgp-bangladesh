import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPath, pathSummary, GATEWAY_TYPES, ABROAD_PER_GATEWAY, CUSTOMER_CAP,
} from '../assets/js/viz/layered-path.js';

// The my-path.test.js fixture, plus more customers and networks abroad.
const data = {
  nodes: [
    { asn: '100', type: 'local-company', name: 'ISP-AS-BD Local ISP Ltd' },
    { asn: '101', type: 'local-company', name: 'Second ISP' },
    { asn: '102', type: 'local-company', name: 'Third ISP' },
    { asn: '103', type: 'local-company', name: 'Fourth ISP' },
    { asn: '200', type: 'iig', name: 'GW-A-BD Gateway A' },
    { asn: '300', type: 'detected-iig', name: 'Gateway B' },
    { asn: '400', type: 'iig', name: 'Gateway C' },
    { asn: '900', type: 'outside', name: 'TRANSIT-X Transit X', country: 'IN' },
    { asn: '901', type: 'outside', name: 'Transit Y', country: 'SG' },
    { asn: '902', type: 'outside', name: 'Transit Z', country: 'US' },
    { asn: '903', type: 'outside', name: 'Transit W', country: 'EU' },
    { asn: '904', type: 'outside', name: 'Transit V', country: 'HK' },
    { asn: '905', type: 'outside', name: 'Transit U', country: 'JP' },
  ],
  edges: [
    { source: '100', target: '200', count: 60, type: 'domestic' },
    { source: '100', target: '300', count: 40, type: 'domestic' },
    { source: '101', target: '200', count: 20, type: 'domestic' },
    { source: '103', target: '200', count: 40, type: 'domestic' },
    { source: '103', target: '300', count: 30, type: 'domestic' },
    { source: '103', target: '400', count: 30, type: 'domestic' },
    { source: '900', target: '200', count: 500, type: 'international' },
    { source: '902', target: '200', count: 300, type: 'international' },
    { source: '903', target: '200', count: 200, type: 'international' },
    { source: '904', target: '200', count: 100, type: 'international' },
    { source: '905', target: '200', count: 50, type: 'international' },
    { source: '901', target: '300', count: 100, type: 'international' },
    { source: '900', target: '300', count: 50, type: 'international' },
    { source: '901', target: '999', count: 1000, type: 'international' },
  ],
};

const rows = (list) => list.map(r => [r.node.asn, r.count, Math.round(r.share * 1000) / 1000]);

test('constants fixed by the spec', () => {
  assert.equal(ABROAD_PER_GATEWAY, 4);
  assert.equal(CUSTOMER_CAP, 8);
  assert.ok(GATEWAY_TYPES.has('iig') && GATEWAY_TYPES.has('offshore-gateway'));
});

test('buildPath local: gateways with shares, abroad capped per gateway, one line per kept pair', () => {
  const p = buildPath(data, '100');
  assert.equal(p.status, 'found');
  assert.equal(p.role, 'local');
  assert.equal(p.node.asn, '100');
  assert.deepEqual(rows(p.gateways), [['200', 60, 0.6], ['300', 40, 0.4]]);
  // Gateway A's top 4 abroad (905 is its 5th), Gateway B's two; 900 counted for both.
  assert.deepEqual(p.abroad.map(r => [r.node.asn, r.count]),
    [['900', 550], ['902', 300], ['903', 200], ['901', 100], ['904', 100]]);
  assert.deepEqual(p.lines.map(l => [l.from, l.to, Math.round(l.share * 1000) / 1000]), [
    ['200', '900', 0.435], ['200', '902', 0.261], ['200', '903', 0.174], ['200', '904', 0.087],
    ['300', '901', 0.667], ['300', '900', 0.333],
  ]);
});

test('buildPath gateway: customers by the gateway\'s share, abroad by its share', () => {
  const p = buildPath(data, '200');
  assert.equal(p.role, 'gateway');
  assert.deepEqual(rows(p.customers), [['100', 60, 0.5], ['103', 40, 0.333], ['101', 20, 0.167]]);
  assert.equal(p.customerTotal, 3);
  assert.deepEqual(p.abroad.map(r => r.node.asn), ['900', '902', '903', '904', '905']);
  assert.equal(Math.round(p.abroad[0].share * 1000) / 1000, 0.435);
});

test('buildPath outside: gateways by that network\'s share', () => {
  const p = buildPath(data, '900');
  assert.equal(p.role, 'outside');
  assert.deepEqual(rows(p.gateways), [['200', 500, 0.909], ['300', 50, 0.091]]);
});

test('buildPath: an offshore company with customers is a gateway, without is local', () => {
  const d = {
    nodes: [
      { asn: '1', type: 'offshore-enterprise', name: 'Offshore One' },
      { asn: '2', type: 'offshore-enterprise', name: 'Offshore Two' },
      { asn: '3', type: 'local-company', name: 'Customer' },
      { asn: '4', type: 'iig', name: 'Gateway' },
    ],
    edges: [
      { source: '3', target: '1', count: 5, type: 'domestic' },
      { source: '2', target: '4', count: 5, type: 'domestic' },
    ],
  };
  assert.equal(buildPath(d, '1').role, 'gateway');
  assert.equal(buildPath(d, '2').role, 'local');
});

test('buildPath missing', () => {
  assert.deepEqual(buildPath(data, '12345'), { status: 'missing' });
});

test('pathSummary: local', () => {
  assert.equal(pathSummary(buildPath(data, '100')),
    'Most of Local ISP Ltd\'s routes (60%) go through Gateway A, which connects abroad mainly through Transit X (India) and Transit Z (United States).');
});

test('pathSummary: local, all through one gateway', () => {
  assert.equal(pathSummary(buildPath(data, '101')),
    'All of Second ISP\'s routes go through Gateway A, which connects abroad mainly through Transit X (India) and Transit Z (United States).');
});

test('pathSummary: local, largest gateway under half', () => {
  assert.equal(pathSummary(buildPath(data, '103')),
    'The largest share of Fourth ISP\'s routes (40%) goes through Gateway A, which connects abroad mainly through Transit X (India) and Transit Z (United States).');
});

test('pathSummary: local, no gateway', () => {
  assert.equal(pathSummary(buildPath(data, '102')),
    'No gateway connections were seen for Third ISP in this data.');
});

test('pathSummary: local, gateway with one or no networks abroad', () => {
  const d = {
    nodes: [...data.nodes],
    edges: [
      { source: '101', target: '300', count: 5, type: 'domestic' },
      { source: '102', target: '400', count: 5, type: 'domestic' },
      { source: '903', target: '300', count: 5, type: 'international' },
    ],
  };
  assert.equal(pathSummary(buildPath(d, '101')),
    'All of Second ISP\'s routes go through Gateway B, which connects abroad mainly through Transit W (Europe).');
  assert.equal(pathSummary(buildPath(d, '102')),
    'All of Third ISP\'s routes go through Gateway C.');
});

test('pathSummary: gateway', () => {
  assert.equal(pathSummary(buildPath(data, '200')),
    '3 local networks reach the world through Gateway A; its connections abroad go mainly through Transit X (India) and Transit Z (United States).');
});

test('pathSummary: outside', () => {
  assert.equal(pathSummary(buildPath(data, '900')),
    'Transit X connects to 2 Bangladeshi gateways; Gateway A carries the most.');
  assert.equal(pathSummary(buildPath(data, '901')),
    'Transit Y connects to 1 Bangladeshi gateway, Gateway B.');
});

test('pathSummary: missing', () => {
  assert.equal(pathSummary({ status: 'missing' }), '');
});
