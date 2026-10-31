import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CATEGORY_COLORS, LINK_COLORS, INK, categoryColor } from '../assets/js/ui/colors.js';

const css = readFileSync(new URL('../assets/css/styles.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const tokens = Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2].toLowerCase()]));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('colors: CSS category tokens match the JS table', () => {
  for (const [type, color] of Object.entries(CATEGORY_COLORS)) {
    assert.equal(tokens[`cat-${type}`], color, `--cat-${type}`);
  }
});

test('colors: JS ink and link colours match the CSS tokens', () => {
  assert.equal(INK.text, tokens.text);
  assert.equal(INK.muted, tokens['text-muted']);
  assert.equal(INK.paper, tokens['bg-primary']);
  assert.equal(INK.panel, tokens['bg-secondary']);
  assert.equal(INK.line, tokens.border);
  assert.equal(LINK_COLORS.domestic, CATEGORY_COLORS['local-company']);
});

test('colors: text tokens reach 4.5:1 on every surface they sit on', () => {
  const surfaces = ['bg-primary', 'bg-secondary', 'bg-card', 'bg-raised'];
  for (const fg of ['text', 'text-muted', 'text-dim', 'accent', 'red', 'warn']) {
    for (const bg of surfaces) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert.ok(ratio >= 4.5, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.ok(contrast(tokens.accent, tokens['accent-soft']) >= 4.5, 'accent on accent-soft');
  assert.ok(contrast(tokens.text, tokens['warn-soft']) >= 4.5, 'text on warn-soft');
  for (const fill of ['accent', 'red', 'warn']) {
    assert.ok(contrast(tokens.reverse, tokens[fill]) >= 4.5, `reverse on --${fill}`);
    assert.ok(contrast(tokens['bg-primary'], tokens[fill]) >= 4.5, `paper on --${fill}`);
  }
});

test('colors: every category outline (ink) stands out from its fill', () => {
  // Nodes are drawn with an ink outline, so a light hue still has a 3:1 edge.
  for (const [type, color] of Object.entries(CATEGORY_COLORS)) {
    assert.ok(Math.max(contrast(INK.text, color), contrast(INK.paper, color)) >= 3, type);
  }
});

test('colors: old category names fall back to their current colour', () => {
  assert.equal(categoryColor('inside'), CATEGORY_COLORS.iig);
  assert.equal(categoryColor('local-isp'), CATEGORY_COLORS['local-company']);
  assert.notEqual(categoryColor('nonsense'), undefined);
});
