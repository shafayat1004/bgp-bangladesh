/**
 * Gateway Ranking
 * Answers "which gateways carry most of Bangladesh's routes?": the top
 * gateways as a static bar list, each bar split into routes seen with
 * international networks and routes seen with local networks.
 */

import { CATEGORY_LABELS } from '../ui/glossary.js';
import { countryToFlag, buildNodeTooltipHtml } from '../api/ripestat.js';
import { renderBarList, highlightBarRow } from './bar-list.js';
import { friendlyName } from '../ui/names.js';
import { CATEGORY_COLORS, LINK_COLORS } from '../ui/colors.js';

// The gateway categories this ranking shows, with their colours.
const TYPE_COLORS = Object.fromEntries(
  ['iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway'].map(t => [t, CATEGORY_COLORS[t]]));

const TYPE_LABELS = CATEGORY_LABELS;

// Short text tag beside each name, so the category doesn't rely on colour.
const TYPE_TAGS = {
  'iig': 'Licensed IIG',
  'detected-iig': 'Detected',
  'offshore-enterprise': 'Offshore',
  'offshore-gateway': 'Offshore gateway',
};

const INTL_COLOR = CATEGORY_COLORS.outside;   // matches "International networks"
const LOCAL_COLOR = LINK_COLORS.domestic;     // matches "Local companies"
const TOP_N = 40;

let currentData = null;
let currentOptions = {};
let highlighted = null;

export function init() {}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  highlighted = null;
  render();
}

// History slider: redraw in place, keeping scroll position and highlight.
export function updateData(data, options = {}) {
  currentData = data;
  currentOptions = { ...currentOptions, ...options };
  render();
}

/** Route totals per gateway for the current filter. Exported for testing. */
export function gatewayTotals(data, minTraffic = 0, maxTraffic = Infinity) {
  const nodeMap = {};
  data.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const totals = {};
  data.edges.forEach(e => {
    const count = e.count || 0;
    if (count < minTraffic || count > maxTraffic) return;
    // Both edge kinds point at the gateway: outside -> gateway, local -> gateway.
    const tgt = e.target?.asn || e.target;
    const node = nodeMap[tgt];
    if (!node || !TYPE_COLORS[node.type]) return;
    const t = totals[tgt] ||= { asn: tgt, node, international: 0, local: 0 };
    if (e.type === 'domestic') t.local += count;
    else t.international += count;
  });

  return Object.values(totals)
    .map(t => ({ ...t, total: t.international + t.local }))
    .filter(t => t.total > 0)
    .sort((a, b) => b.total - a.total || a.asn.localeCompare(b.asn));
}

function render() {
  const container = document.getElementById('viz-panel');
  if (!container || !currentData) return;
  const all = gatewayTotals(currentData, currentOptions.minTraffic ?? 0, currentOptions.maxTraffic ?? Infinity);
  const gateways = all.slice(0, TOP_N);
  const grandTotal = all.reduce((s, g) => s + g.total, 0);
  const pct = (v) => `${((v / grandTotal) * 100).toFixed(1)}%`;

  const top3 = gateways.slice(0, 3).reduce((s, g) => s + g.total, 0);
  const summary = gateways.length >= 3
    ? `The 3 largest of ${all.length} gateways carry ${pct(top3)} of the routes seen through gateways.`
    : '';

  renderBarList(container, {
    title: 'Which gateways carry the most routes?',
    summary,
    label: `Gateway ranking: the ${gateways.length} gateways carrying the most routes. ${summary}`,
    legend: [
      { color: INTL_COLOR, text: 'With international networks' },
      { color: LOCAL_COLOR, text: 'With local networks' },
    ],
    max: gateways[0]?.total || 0,
    empty: 'No gateways match the current Min/Max Routes filter.',
    rows: gateways.map((g, i) => {
      const name = friendlyName(g.node);
      const flag = g.node.country ? `${countryToFlag(g.node.country)} ` : '';
      return {
        key: g.asn,
        rank: i + 1,
        name: `${flag}${name}`,
        fullName: `${g.node.name || name} (AS${g.asn})`,
        tag: TYPE_TAGS[g.node.type],
        tagColor: TYPE_COLORS[g.node.type],
        segments: [
          { value: g.international, color: INTL_COLOR },
          { value: g.local, color: LOCAL_COLOR },
        ],
        value: g.total.toLocaleString(),
        detail: `routes, ${pct(g.total)} of all. ${g.international.toLocaleString()} with international networks, ${g.local.toLocaleString()} with local networks.`,
        tooltip: () => buildNodeTooltipHtml(g.node, TYPE_LABELS) +
          `<div class="tooltip-row"><span class="tooltip-label">With international networks:</span><span class="tooltip-value">${g.international.toLocaleString()}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">With local networks:</span><span class="tooltip-value">${g.local.toLocaleString()}</span></div>`,
      };
    }),
  });

  if (highlighted) highlightBarRow(container, highlighted);
}

export function destroy() {
  const c = document.getElementById('viz-panel');
  if (c) c.innerHTML = '';
}

export function highlightASN(asn) {
  const c = document.getElementById('viz-panel');
  highlighted = c && highlightBarRow(c, asn) ? String(asn) : null;
}

export function updateFilter(minVal, maxVal) {
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render();
}

export function filterByTypes() {
  // Every gateway type stays listed; the ranking is about gateways only.
}
