import test from 'node:test';
import assert from 'node:assert/strict';

import { GLOSSARY, CATEGORY_LABELS, CATEGORY_PLURALS, termHelp, termExample, aboutNumber } from '../assets/js/ui/glossary.js';

const TYPES = ['local-company', 'iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway', 'outside'];

// A small snapshot: two local companies behind Summit, Summit behind Bharti
// Airtel, plus one of each other category.
const data = {
  nodes: [
    { asn: '58717', type: 'iig', name: 'SUMMITCOMMUNICATIONS-BD Summit Communications Ltd', country: 'BD', traffic: 2558087, percentage: 76.5 },
    { asn: '9498', type: 'outside', name: 'BBIL-AP BHARTI Airtel Ltd.', country: 'IN', traffic: 1071854, percentage: 32.1 },
    { asn: '24432', type: 'local-company', name: 'KSNETWORK-AS-AP KS Network Limited', country: 'BD', traffic: 50000 },
    { asn: '63969', type: 'local-company', name: 'Small ISP', country: 'BD', traffic: 900 },
    { asn: '139901', type: 'detected-iig', name: 'Apple Communication Ltd.', country: 'BD', traffic: 204549 },
    { asn: '1', type: 'offshore-enterprise', name: 'ABROAD-AS Abroad Co', country: 'BD', geo_country: 'SG', traffic: 300,
      geo_breakdown: [{ country: 'SG', percentage: 70 }, { country: 'BD', percentage: 30 }],
      peering_country: 'SG', peering_details: ['Equinix Singapore'] },
    { asn: '2', type: 'offshore-gateway', name: 'Offshore GW', country: 'BD', geo_country: 'US', traffic: 200 },
  ],
  edges: [
    { source: '9498', target: '58717', count: 900000, type: 'international' },
    { source: '24432', target: '58717', count: 50000, type: 'domestic' },
    { source: '63969', target: '139901', count: 900, type: 'domestic' },
    { source: '24432', target: '139901', count: 100, type: 'domestic' },
    { source: '63969', target: '2', count: 50, type: 'domestic' },
  ],
  stats: { valid_observations: 3355888, total_edges: 5 },
};

test('glossary: every term has a title and a one-sentence explanation', () => {
  for (const [key, term] of Object.entries(GLOSSARY)) {
    assert.ok(term.title, `${key} has no title`);
    assert.ok(term.short && term.short.length < 320, `${key} short text missing or too long`);
  }
});

test('glossary: every category has a term and a label', () => {
  for (const type of TYPES) {
    assert.ok(GLOSSARY[type], `no glossary entry for ${type}`);
    assert.ok(CATEGORY_LABELS[type] && CATEGORY_PLURALS[type], `no label for ${type}`);
  }
});

test('glossary: no graph jargon or "traffic" for route counts', () => {
  const text = Object.values(GLOSSARY).map(t => `${t.title} ${t.short} ${termExample(Object.keys(GLOSSARY).find(k => GLOSSARY[k] === t), data) || ''}`).join(' ')
    + Object.values(CATEGORY_LABELS).join(' ') + Object.values(CATEGORY_PLURALS).join(' ');
  assert.doesNotMatch(text, /\b(nodes?|edges?)\b/i);
  // "traffic" may only appear to say what the numbers are not.
  for (const m of text.matchAll(/[^.]*\btraffic\b[^.]*\./gi)) assert.match(m[0], /\bnot\b/i, m[0]);
});

test('glossary: examples use real networks from the data, with friendly names', () => {
  assert.match(termExample('iig', data), /Summit Communications Ltd/);
  assert.match(termExample('iig', data), /Bharti|BHARTI/);
  assert.doesNotMatch(termExample('iig', data), /SUMMITCOMMUNICATIONS-BD/);
  assert.match(termExample('detected-iig', data), /Apple Communication Ltd\. .*2 local companies/);
  assert.match(termExample('offshore-enterprise', data), /Singapore/);
  assert.match(termExample('ip-location', data), /Abroad Co .*in Singapore/);
  assert.match(termExample('offshore-gateway', data), /located in the United States, yet 1 local company connects/);
  assert.doesNotMatch(Object.keys(GLOSSARY).map(k => termExample(k, data) || '').join(' '), /\.\./);
  assert.match(termExample('peering', data), /Equinix Singapore/);
  assert.match(termExample('route', data), /Bharti.*Summit.*KS Network/i);
  assert.match(termExample('observations', data), /3\.4 million/);
});

test('glossary: examples are skipped when the data has nothing to show', () => {
  const empty = { nodes: [], edges: [], stats: {} };
  for (const key of Object.keys(GLOSSARY)) {
    assert.doesNotThrow(() => termExample(key, empty), key);
  }
  assert.equal(termExample('detected-iig', empty), null);
  assert.equal(termExample('iig', null), null);
});

test('termHelp: an accessible button that names its term', () => {
  const html = termHelp('iig');
  assert.match(html, /^<button type="button" class="term-help"/);
  assert.match(html, /data-term="iig"/);
  assert.match(html, /aria-label="What is an IIG\?"/);
  assert.match(html, /aria-expanded="false"/);
  assert.throws(() => termHelp('no-such-term'));
});

test('aboutNumber: rounds route counts the way people say them', () => {
  assert.equal(aboutNumber(2558087), '2.6 million');
  assert.equal(aboutNumber(316473), '316,000');
  assert.equal(aboutNumber(50000), '50,000');
  assert.equal(aboutNumber(904), '904');
});
