/**
 * Country Origins
 * Answers "which countries' networks connect Bangladesh to the world?": the
 * registered countries of the international networks that hand routes to
 * Bangladesh's gateways, as a static bar list.
 */

import { renderBarList } from './bar-list.js';
import { countryName, countryToFlag, NOT_COUNTRIES } from '../ui/names.js';
import { CATEGORY_COLORS } from '../ui/colors.js';

const BAR_COLOR = CATEGORY_COLORS.outside;   // matches "International networks"
const TOP_N = 30;

let currentData = null;
let currentOptions = {};

export function init() {}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  render();
}

// History slider: redraw in place, keeping the scroll position.
export function updateData(data, options = {}) {
  currentData = data;
  currentOptions = { ...currentOptions, ...options };
  render();
}

/** Routes per registered country of international networks. Exported for testing. */
export function countryTotals(data, minTraffic = 0, maxTraffic = Infinity) {
  const nodeMap = {};
  data.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const totals = {};
  data.edges.forEach(e => {
    if (e.type === 'domestic') return;
    const count = e.count || 0;
    if (count < minTraffic || count > maxTraffic) return;
    const src = e.source?.asn || e.source;
    const node = nodeMap[src];
    if (!node || node.type !== 'outside') return;
    const cc = node.country || 'Unknown';
    const t = totals[cc] ||= { cc, routes: 0, networks: new Map() };
    t.routes += count;
    t.networks.set(src, node);
  });

  return Object.values(totals)
    .map(t => ({
      cc: t.cc,
      routes: t.routes,
      networkCount: t.networks.size,
      topNetworks: [...t.networks.values()].sort((a, b) => (b.traffic || 0) - (a.traffic || 0)).slice(0, 5),
    }))
    .filter(t => t.routes > 0)
    .sort((a, b) => b.routes - a.routes || a.cc.localeCompare(b.cc));
}

function render() {
  const container = document.getElementById('viz-panel');
  if (!container || !currentData) return;
  const all = countryTotals(currentData, currentOptions.minTraffic ?? 0, currentOptions.maxTraffic ?? Infinity);
  const countries = all.slice(0, TOP_N);
  const grandTotal = all.reduce((s, c) => s + c.routes, 0);
  const pct = (v) => `${((v / grandTotal) * 100).toFixed(1)}%`;

  const first = countries[0];
  const inCountry = (cc) => {
    const name = countryName(cc);
    return /^(United |Netherlands|Philippines|Czech Republic|Bahamas|Gambia|Maldives)/.test(name) ? `the ${name}` : name;
  };
  const summary = first
    ? `Networks registered in ${inCountry(first.cc)} carry ${pct(first.routes)} of the routes reaching Bangladesh's gateways from abroad.`
    : '';

  renderBarList(container, {
    title: 'Where do Bangladesh\'s international connections come from?',
    summary,
    label: `Country origins: the ${countries.length} countries whose networks carry the most routes into Bangladesh. ${summary}`,
    max: first?.routes || 0,
    empty: 'No international networks match the current Min/Max Routes filter.',
    rows: countries.map((c, i) => {
      const flag = NOT_COUNTRIES[c.cc] ? '' : `${countryToFlag(c.cc)} `;
      const nets = `${c.networkCount} network${c.networkCount === 1 ? '' : 's'}`;
      return {
        key: c.cc,
        rank: i + 1,
        name: `${flag}${countryName(c.cc)}`,
        tag: nets,
        segments: [{ value: c.routes, color: BAR_COLOR }],
        value: pct(c.routes),
        detail: `of routes from abroad, ${c.routes.toLocaleString()} routes.`,
        tooltip: () =>
          `<div class="tooltip-title">${flag}${countryName(c.cc)}</div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${c.routes.toLocaleString()}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${pct(c.routes)}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Networks:</span><span class="tooltip-value">${c.networkCount}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Largest:</span></div>` +
          c.topNetworks.map(n => `<div class="tooltip-detail">&nbsp;&nbsp;AS${n.asn} ${n.name || ''}</div>`).join(''),
      };
    }),
  });
}

export function destroy() {
  const c = document.getElementById('viz-panel');
  if (c) c.innerHTML = '';
}

export function highlightASN() {}

export function updateFilter(minVal, maxVal) {
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render();
}

export function filterByTypes() {}
