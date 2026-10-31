/**
 * Colours for charts drawn in script. One table, so views, legends and the
 * sidebar can't drift apart (issue #36).
 *
 * The page uses the calm "house" palette: sand paper, ink text, phthalo green
 * accent. Category colours are the Okabe-Ito hues (safe for colour vision
 * deficiency, issue #17), muted to sit on the paper. Every pair stays at least
 * 14.7 CIE ΔE apart under protan, deutan and tritan simulation (closest:
 * detected-iig vs offshore-gateway under tritan; the next closest is 15+).
 *
 * The same values are CSS custom properties in assets/css/styles.css
 * (--cat-*, --text, ...); tests-js/colors.test.js keeps the two in step.
 */

export const CATEGORY_COLORS = {
  'local-company': '#27598a',        // blue
  'iig': '#2f8a68',                  // bluish green
  'detected-iig': '#c4901f',         // amber
  'offshore-enterprise': '#67a8cc',  // sky blue
  'offshore-gateway': '#b26a98',     // reddish purple
  'outside': '#b4532a',              // vermilion
};

// Old category names some live-fetch paths may still produce (see issue #36).
const LEGACY = { 'inside': 'iig', 'local-isp': 'local-company', 'offshore-peer': 'offshore-gateway' };

export const UNKNOWN_COLOR = '#8a8670';

export function categoryColor(type) {
  return CATEGORY_COLORS[type] || CATEGORY_COLORS[LEGACY[type]] || UNKNOWN_COLOR;
}

// Connections: international ones in ink grey, local ones in the local-company blue
// (and dashed, so the two differ by more than colour).
export const LINK_COLORS = {
  international: '#4e5346',
  domestic: '#27598a',
};

// Text and surfaces for SVG chart furniture (legends, labels).
export const INK = {
  text: '#2b3129',
  muted: '#4e5346',
  dim: '#565b4b',
  paper: '#e8e1cf',
  panel: '#f1ebda',
  line: '#a9a88c',
};
