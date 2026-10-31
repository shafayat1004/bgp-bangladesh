import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRirCountry } from '../assets/js/api/ripestat.js';

const payload = (...locations) => ({ data: { located_resources: locations.map(location => ({ resource: '1', location })) } });

test('parseRirCountry: takes the registry location', () => {
  assert.equal(parseRirCountry(payload('AE')), 'AE');
  assert.equal(parseRirCountry(payload('sg')), 'SG');
});

test('parseRirCountry: keeps regions, drops unknown and empty', () => {
  assert.equal(parseRirCountry(payload('EU')), 'EU');
  assert.equal(parseRirCountry(payload('ZZ')), '');
  assert.equal(parseRirCountry(payload()), '');
  assert.equal(parseRirCountry(undefined), '');
});
