import test from 'node:test';
import assert from 'node:assert/strict';

import { overviewLayers, ZOOM_LEVELS, DEFAULT_ZOOM, LOCAL_CAP } from '../assets/js/viz/hierarchical.js';

const data = {
  nodes: [
    { asn: '1', type: 'local-company', traffic: 50 },
    { asn: '2', type: 'local-company', traffic: 500 },
    { asn: '3', type: 'local-company', traffic: 5 },
    { asn: '10', type: 'iig', traffic: 900 },
    { asn: '11', type: 'detected-iig', traffic: 300 },
    { asn: '12', type: 'offshore-gateway', traffic: 120 },
    { asn: '20', type: 'outside', traffic: 800 },
    { asn: '21', type: 'outside', traffic: 1000 },
    { asn: '99', type: 'offshore-enterprise', traffic: 400 },   // in no connection
  ],
  edges: [
    { source: '1', target: '10', count: 50, type: 'domestic' },
    { source: '2', target: '10', count: 400, type: 'domestic' },
    { source: '2', target: '11', count: 100, type: 'domestic' },
    { source: '3', target: '12', count: 5, type: 'domestic' },
    { source: '20', target: '10', count: 800, type: 'international' },
    { source: '21', target: '11', count: 1000, type: 'international' },
    { source: '21', target: '12', count: 120, type: 'international' },
  ],
};

const shape = (layers) => layers.map(l => [l.type, l.nodes.map(n => n.asn)]);

test('overviewLayers: layer order and traffic order', () => {
  assert.deepEqual(shape(overviewLayers(data, { minTraffic: 0 })), [
    ['local-company', ['2', '1', '3']],
    ['iig', ['10']],
    ['detected-iig', ['11']],
    ['offshore-gateway', ['12']],
    ['outside', ['21', '20']],
  ]);
  const local = overviewLayers(data, { minTraffic: 0 })[0];
  assert.equal(local.total, 555);   // routes seen in the layer
});

test('overviewLayers: respects the route range and active types', () => {
  // Networks under 100 routes, and connections under 100, drop out.
  assert.deepEqual(shape(overviewLayers(data, { minTraffic: 100 })), [
    ['local-company', ['2']],
    ['iig', ['10']],
    ['detected-iig', ['11']],
    ['offshore-gateway', ['12']],
    ['outside', ['21', '20']],
  ]);
  assert.deepEqual(shape(overviewLayers(data, { minTraffic: 0, maxTraffic: 600 })), [
    ['local-company', ['2', '1', '3']],
    ['detected-iig', ['11']],
    ['offshore-gateway', ['12']],
  ]);
  assert.deepEqual(
    shape(overviewLayers(data, { minTraffic: 0, activeTypes: new Set(['iig', 'outside']) })),
    [['iig', ['10']], ['outside', ['21', '20']]]);
});

test('overviewLayers: drops empty layers', () => {
  const layers = overviewLayers(data, { minTraffic: 0 });
  assert.ok(!layers.some(l => l.type === 'offshore-enterprise'));
  assert.deepEqual(overviewLayers(data, { minTraffic: 1e9 }), []);
  assert.deepEqual(overviewLayers({ nodes: [], edges: [] }, {}), []);
});

test('ZOOM_LEVELS: three sizes, default names and shares', () => {
  assert.deepEqual(ZOOM_LEVELS.map(z => [z.id, z.minWidth, z.height]),
    [['names', 110, 30], ['shares', 150, 48], ['large', 210, 58]]);
  assert.equal(DEFAULT_ZOOM, 1);
  assert.equal(ZOOM_LEVELS[DEFAULT_ZOOM].label, 'Names and shares');
  assert.equal(LOCAL_CAP, 40);
});
