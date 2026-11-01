import test from 'node:test';
import assert from 'node:assert/strict';

import { tooltipPosition, buildNodeTooltipHtml, buildEdgeTooltipHtml } from '../assets/js/ui/tooltip.js';

const size = { width: 200, height: 100 };

test('tooltipPosition: below right of the pointer when it fits', () => {
  assert.deepEqual(tooltipPosition(100, 100, size, 1000, 800), { left: 115, top: 115 });
});

test('tooltipPosition: flips to the left and above at the window edges', () => {
  assert.deepEqual(tooltipPosition(900, 750, size, 1000, 800), { left: 685, top: 635 });
});

test('tooltipPosition: never leaves the top left corner of the window', () => {
  const pos = tooltipPosition(10, 10, { width: 990, height: 790 }, 1000, 800);
  assert.ok(pos.left >= 5 && pos.top >= 5);
});

test('buildNodeTooltipHtml: names the network, its category and routes seen', () => {
  const html = buildNodeTooltipHtml({ asn: '58717', name: 'Summit', type: 'iig', country: 'BD', traffic: 1234, licensed: true });
  assert.match(html, /Summit/);
  assert.match(html, /AS58717/);
  assert.match(html, /Licensed IIG/);
  assert.match(html, /Routes seen:.*1,234/);
});

test('buildEdgeTooltipHtml: both ends, routes and kind', () => {
  const html = buildEdgeTooltipHtml({ name: 'A', country: 'BD' }, { name: 'B', country: 'SG' }, 42, 'international');
  assert.match(html, /A .*&rarr;.*B/);
  assert.match(html, /Routes:.*42/);
  assert.match(html, /International/);
});
