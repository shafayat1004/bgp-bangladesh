import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeRoutesBatch,
  buildVisualizationData,
  classifyTentativeIIGType,
  createAnalysisState,
} from '../assets/js/api/data-processor.js';

test('classifyTentativeIIGType: licensed asn stays iig', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '100',
      isBDRegistered: true,
      geoCountry: 'BD',
      btrcLicensedASNs: new Set(['100']),
      iigsWithDomestic: new Set(),
      directPeersMap: {},
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
      directPeersMap: {},
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
      directPeersMap: {},
    }),
    'detected-iig'
  );
});

test('classifyTentativeIIGType: direct international peer is detected-iig', () => {
  assert.equal(
    classifyTentativeIIGType({
      asn: '45273',
      isBDRegistered: true,
      geoCountry: 'BD',
      btrcLicensedASNs: new Set(),
      iigsWithDomestic: new Set(),
      directPeersMap: { '45273': ['174'] },
    }),
    'detected-iig'
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
      directPeersMap: {},
    }),
    'local-company'
  );
});

test('buildVisualizationData marks direct-peer tentative gateway as detected-iig', () => {
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
  assert.equal(nodes.get('45273').type, 'detected-iig');
  assert.equal(nodes.get('200').type, 'offshore-gateway');
  assert.equal(nodes.get('65001').type, 'local-company');
  assert.equal(nodes.get('174').type, 'outside');
  assert.equal(data.stats.total_detected_iig, 1);
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
