import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeRoutesBatch,
  buildVisualizationData,
  classifyTentativeIIGType,
  computeShares,
  createAnalysisState,
  isReservedASN,
} from '../assets/js/api/data-processor.js';

test('classifyTentativeIIGType: licensed asn stays iig', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '100',
      isBDRegistered: true,
      geoCountry: 'BD',
      btrcLicensedASNs: new Set(['100']),
      iigsWithDomestic: new Set(),
    }),
    'iig'
  );
});

test('classifyTentativeIIGType: offshore without domestic is enterprise', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '200',
      isBDRegistered: true,
      geoCountry: 'SG',
      btrcLicensedASNs: new Set(),
      iigsWithDomestic: new Set(),
      directPeersMap: { '200': ['174'] },
    }),
    'offshore-enterprise'
  );
});

test('classifyTentativeIIGType: offshore with domestic is gateway', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '201',
      isBDRegistered: true,
      geoCountry: 'SG',
      btrcLicensedASNs: new Set(),
      iigsWithDomestic: new Set(['201']),
    }),
    'offshore-gateway'
  );
});

test('classifyTentativeIIGType: domestic evidence is detected-iig', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '300',
      isBDRegistered: true,
      geoCountry: 'BD',
      btrcLicensedASNs: new Set(),
      iigsWithDomestic: new Set(['300']),
    }),
    'detected-iig'
  );
});

test('classifyTentativeIIGType: direct international peer without customers is local-company', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '45273',
      isBDRegistered: true,
      geoCountry: 'BD',
      btrcLicensedASNs: new Set(),
      iigsWithDomestic: new Set(),
    }),
    'local-company'
  );
});

test('classifyTentativeIIGType: non-gateway falls back to local-company', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '999',
      isBDRegistered: true,
      geoCountry: 'BD',
      btrcLicensedASNs: new Set(),
      iigsWithDomestic: new Set(),
    }),
    'local-company'
  );
});

test('buildVisualizationData flags a direct-peer network without customers', () => {
  const analysis = {
    outsideCounts: new Map([['174', 5]]),
    iigCounts: new Map([['45273', 5], ['200', 4]]),
    localISPCounts: new Map([['65001', 3]]),
    edgeIntl: new Map([
      ['174|45273', 5],
      ['174|200', 4],
    ]),
    edgeDomestic: new Map([
      ['65001|200', 3],
    ]),
    directPeersMap: {
      '45273': ['174'],
      '200': ['174'],
    },
    validObservations: 42,
  };

  const asnInfo = {
    '174': { name: 'Outside', holder: 'Outside', country: 'US' },
    '45273': { name: 'Bangla Trac', holder: 'Bangla Trac', country: 'BD', geo_country: 'BD' },
    '200': { name: 'Offshore', holder: 'Offshore', country: 'BD', geo_country: 'SG' },
    '65001': { name: 'LocalCo', holder: 'LocalCo', country: 'BD' },
  };

  const data = buildVisualizationData(
    analysis,
    asnInfo,
    new Set(['45273', '200', '65001']),
    1500,
    2000,
    new Set()
  );

  const nodes = new Map(data.nodes.map((n) => [n.asn, n]));
  assert.equal(nodes.get('45273').type, 'local-company');
  assert.equal(nodes.get('45273').abroad_link, 'only-abroad');
  assert.equal(nodes.get('200').type, 'offshore-gateway');
  assert.equal(nodes.get('65001').type, 'local-company');
  assert.equal(nodes.get('65001').abroad_link, '');
  assert.equal(nodes.get('174').type, 'outside');
  assert.equal(data.stats.total_detected_iig, 0);
  assert.equal(data.stats.total_offshore_gateway, 1);
  assert.equal(data.stats.valid_observations, 42);
});

test('analyzeRoutesBatch collects expected edges for one route', () => {
  const state = createAnalysisState();
  const countryASNs = new Set(['45273', '65001']);
  const routes = [
    {
      target_prefix: '1.1.1.0/24',
      source_id: 'rrc00',
      path: ['174', '45273', '65001'],
    },
  ];

  analyzeRoutesBatch(routes, countryASNs, state);

  assert.equal(state.validObservations, 1);
  assert.equal(state.outsideCounts.get('174'), 1);
  assert.equal(state.iigCounts.get('45273'), 1);
  assert.equal(state.localISPCounts.get('65001'), 1);
  assert.equal(state.edgeIntl.get('174|45273'), 1);
  assert.equal(state.edgeDomestic.get('65001|45273'), 1);
  assert.equal(state.directPeers.get('174|45273'), 1);
  assert.equal(state.directPeers.get('45273|65001'), 1);
});

test('analyzeRoutesBatch deduplicates by target prefix and source id', () => {
  const state = createAnalysisState();
  const countryASNs = new Set(['45273', '65001']);
  const routes = [
    {
      target_prefix: '1.1.1.0/24',
      source_id: 'rrc00',
      path: ['174', '45273', '65001'],
    },
  ];

  analyzeRoutesBatch(routes, countryASNs, state);
  analyzeRoutesBatch(routes, countryASNs, state);

  assert.equal(state.validObservations, 1);
  assert.equal(state.outsideCounts.get('174'), 1);
  assert.equal(state.iigCounts.get('45273'), 1);
  assert.equal(state.edgeIntl.get('174|45273'), 1);
});

function analysisFrom(intl, domestic) {
  return {
    outsideCounts: new Map(), iigCounts: new Map(), localISPCounts: new Map(),
    edgeIntl: new Map(Object.entries(intl)),
    edgeDomestic: new Map(Object.entries(domestic)),
    directPeersMap: {},
    validObservations: 0,
  };
}

test('buildVisualizationData keeps a licensed gateway seen only behind its sister network', () => {
  const data = buildVisualizationData(
    analysisFrom({ '6939|17494': 50 }, { '45588|17494': 30 }),
    {}, new Set(['17494', '45588']), 1500, 2000, new Set(['17494', '45588']),
  );
  const nodes = new Map(data.nodes.map((n) => [n.asn, n]));
  assert.equal(nodes.get('45588').type, 'iig');
  assert.equal(data.stats.total_local_company, 0);
});

test('buildVisualizationData uses every domestic connection as customer evidence', () => {
  const data = buildVisualizationData(
    analysisFrom({ '174|100': 90, '174|200': 10 }, { '300|100': 80, '400|200': 5 }),
    {}, new Set(['100', '200', '300', '400']), 1500, 1, new Set(['100']),
  );
  const nodes = new Map(data.nodes.map((n) => [n.asn, n]));
  assert.equal(nodes.get('200').type, 'detected-iig');
  assert.equal(data.stats.total_domestic_edges, 1);
});

test('gateway share counts only routes crossing the border', () => {
  const data = buildVisualizationData(
    analysisFrom({ '174|100': 60, '6939|200': 40 }, { '300|100': 50, '400|200': 10 }),
    {}, new Set(['100', '200', '300', '400']), 1500, 2000, new Set(['100', '200']),
  );
  const nodes = new Map(data.nodes.map((n) => [n.asn, n]));
  assert.equal(nodes.get('100').percentage, 60);
  assert.equal(nodes.get('174').percentage, 60);
  assert.equal(nodes.get('300').percentage, 50);
  assert.equal(nodes.get('100').traffic, 110);
});

test('computeShares corrects shares in data written before the fix', () => {
  // History snapshots stored a gateway's share with its domestic routes added.
  const snapshot = {
    nodes: [
      { asn: '174', type: 'outside', percentage: 100 },
      { asn: '100', type: 'iig', percentage: 180 },
      { asn: '300', type: 'local-company', percentage: 80 },
    ],
    edges: [
      { source: '174', target: '100', count: 100, type: 'international' },
      { source: '300', target: '100', count: 80, type: 'domestic' },
    ],
  };
  computeShares(snapshot);
  const pct = Object.fromEntries(snapshot.nodes.map((n) => [n.asn, n.percentage]));
  assert.deepEqual(pct, { '174': 100, '100': 100, '300': 80 });
});

test('abroad_link tells a second link abroad from the only one, and marks IGW licences', () => {
  const data = buildVisualizationData(
    analysisFrom({ '174|100': 50, '13335|300': 5, '6453|500': 5 }, { '300|100': 20 }),
    {}, new Set(['100', '300', '500']), 1500, 2000, new Set(['100']), new Set(['500']),
  );
  const nodes = new Map(data.nodes.map((n) => [n.asn, n]));
  assert.equal(nodes.get('300').abroad_link, 'also-abroad');
  assert.equal(nodes.get('500').abroad_link, 'only-abroad');
  assert.equal(nodes.get('500').igw, true);
  assert.equal(nodes.get('300').igw, false);
  assert.equal(nodes.get('100').abroad_link, '');
});

test('isReservedASN covers private-use, documentation and reserved numbers', () => {
  for (const a of ['0', '23456', '64512', '65000', '65535', '64496', '100000', '4200000000', '4294967295']) {
    assert.equal(isReservedASN(a), true, a);
  }
  for (const a of ['174', '58717', '131072', '154725']) assert.equal(isReservedASN(a), false, a);
});

test('analyzeRoutesBatch skips a private ASN leaked between BD networks', () => {
  const state = createAnalysisState();
  analyzeRoutesBatch(
    [{ target_prefix: '1.0.0.0/24', source_id: 'rrc00', path: [9498, 139009, 65260, 134732] }],
    new Set(['139009', '134732']), state,
  );
  assert.deepEqual([...state.edgeIntl.entries()], [['9498|139009', 1]]);
  assert.deepEqual([...state.edgeDomestic.entries()], [['134732|139009', 1]]);
  assert.equal(state.outsideCounts.has('65260'), false);
});
