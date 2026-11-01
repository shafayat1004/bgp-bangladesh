/**
 * The shared tooltip: every view shows network and connection details here.
 *
 * On desktop it follows the pointer and stays inside the window. On compact
 * screens (the CSS breakpoint below) it is a details sheet above the date bar,
 * opened by a tap and closed by its close button, Escape, a tap elsewhere in
 * the chart panel or a date change.
 */

import { CATEGORY_LABELS } from './glossary.js';
import { countryToFlag } from './names.js';

// Same query as the compact breakpoint in styles.css, where the tooltip is a
// details sheet.
const SHEET_QUERY = '(max-width: 600px), (max-height: 500px)';
const OFFSET = 15;   // px between the pointer and the tooltip
const MARGIN = 5;    // px kept clear of the window edges
// A tap opens the sheet before the rest of that tap (its click) arrives. If
// the sheet opens under the finger, the click would land on the sheet and the
// tapped network would not be selected, so the sheet lets taps through for a
// moment after it opens.
const TAP_THROUGH_MS = 400;

let passThroughTimer = null;
let anchor = null;   // the network, connection or row the tooltip describes

const tooltipEl = () => document.getElementById('tooltip');
const bodyEl = (tip) => tip.querySelector('.tooltip-body') || tip;

const isSheet = () => window.matchMedia(SHEET_QUERY).matches;

function isTooltipOpen() {
  return tooltipEl()?.style.display === 'block';
}

/** Show html in the tooltip; pass the pointer event to place it beside the pointer. */
export function showTooltip(html, event) {
  const tip = tooltipEl();
  if (!tip) return;
  const wasOpen = isTooltipOpen();
  bodyEl(tip).innerHTML = html;
  tip.style.display = 'block';
  anchor = event?.currentTarget instanceof Element ? event.currentTarget : null;
  if (!wasOpen && isSheet()) {
    tip.style.pointerEvents = 'none';
    clearTimeout(passThroughTimer);
    passThroughTimer = setTimeout(() => { tip.style.pointerEvents = ''; }, TAP_THROUGH_MS);
  }
  if (event) moveTooltip(event);
}

/** Keep the tooltip beside the pointer and inside the window (desktop only). */
export function moveTooltip(event) {
  const tip = tooltipEl();
  if (!tip || isSheet()) return;
  const { left, top } = tooltipPosition(event.clientX, event.clientY, tip.getBoundingClientRect(), window.innerWidth, window.innerHeight);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTooltip() {
  const tip = tooltipEl();
  if (tip) tip.style.display = 'none';
}

/**
 * The pointer left what the tooltip describes. A hover tooltip closes; the
 * phone sheet stays until closed by hand. On touch, mouseout fires at the
 * start of the next tap, so closing the sheet then would let that tap land on
 * whatever was under the sheet (a network, which reopens it).
 */
export function endHover() {
  if (!isSheet()) hideTooltip();
}

/**
 * Where to put a tooltip of size {width, height} for a pointer at (x, y):
 * below right of the pointer, flipped to the other side at the window edges.
 */
export function tooltipPosition(x, y, { width, height }, viewportWidth, viewportHeight) {
  let left = x + OFFSET;
  let top = y + OFFSET;
  if (left + width > viewportWidth) left = x - width - OFFSET;
  if (top + height > viewportHeight) top = y - height - OFFSET;
  return { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) };
}

/** Wire the ways to close the tooltip and the sheet's placement. Call once. */
export function setupTooltip() {
  const tip = tooltipEl();
  if (!tip) return;

  tip.querySelector('.tooltip-close')?.addEventListener('click', hideTooltip);

  // Hover tooltips can be dismissed without moving the pointer (WCAG 1.4.13).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTooltip();
  });

  // A tap anywhere else in the chart panel (empty space, another view's
  // controls) closes it; a tap on another network opens that one instead.
  document.getElementById('viz-panel')?.addEventListener('click', (e) => {
    if (!anchor?.contains(e.target)) hideTooltip();
  });

  // The sheet sits just above the date bar (--sheet-bottom in the CSS) so the
  // date stays reachable while it is open.
  const timelineBar = document.getElementById('timeline-bar');
  if (timelineBar) {
    const placeSheet = () => {
      const rect = timelineBar.getBoundingClientRect();
      const bottom = rect.height ? Math.max(0, window.innerHeight - rect.top) : 0;
      document.documentElement.style.setProperty('--sheet-bottom', `${Math.round(bottom)}px`);
    };
    new ResizeObserver(placeSheet).observe(timelineBar);
    window.addEventListener('resize', placeSheet);
    placeSheet();
  }
}

/**
 * Tooltip HTML for a network: name, registry and location facts, category,
 * routes seen, and why an offshore or detected gateway is classified so.
 *
 * @param {Object} d - Node data object with asn, name, type, country, geo_country, etc.
 * @param {Object} [typeLabels] - Optional type label overrides
 * @returns {string} HTML string for tooltip content
 */
export function buildNodeTooltipHtml(d, typeLabels = CATEGORY_LABELS) {
  const regFlag = d.country ? countryToFlag(d.country) : '';
  const licenseBadge = d.licensed ? ' <span class="tip-licensed">[Licensed IIG]</span>' : '';
  const typeLabel = typeLabels[d.type] || d.type || '';

  // Determine if geo differs from registration
  const geoKnown = d.geo_country && d.geo_country !== '';
  const geoDiffers = geoKnown && d.geo_country !== d.country;

  let html = `<div class="tooltip-title">${regFlag} ${d.name || `AS${d.asn}`}${licenseBadge}</div>`;
  html += `<div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${d.asn}</span></div>`;

  if (d.description && d.description !== d.name) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Organisation:</span><span class="tooltip-value">${d.description}</span></div>`;
  }

  if (d.country) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Registered:</span><span class="tooltip-value">${regFlag} ${d.country}</span></div>`;
  }

  // IP geolocation: the full breakdown for several locations, one line otherwise
  if (d.geo_breakdown && d.geo_breakdown.length > 0) {
    if (d.geo_breakdown.length === 1) {
      const loc = d.geo_breakdown[0];
      const flag = countryToFlag(loc.country);
      const cityInfo = loc.city ? ` (${loc.city})` : '';
      const warn = loc.country !== d.country ? ' tip-warn' : '';
      html += `<div class="tooltip-row"><span class="tooltip-label">IP Location:</span><span class="tooltip-value${warn}">${flag} ${loc.country}${cityInfo}${loc.country !== d.country ? ' ⚠' : ''}</span></div>`;
    } else {
      html += `<div class="tooltip-row"><span class="tooltip-label">IP locations, per address block:</span></div>`;
      for (const loc of d.geo_breakdown) {
        const flag = countryToFlag(loc.country);
        const cityInfo = loc.city ? ` (${loc.city})` : '';
        html += `<div class="tooltip-detail">&nbsp;&nbsp;${flag} ${loc.percentage.toFixed(0)}% ${loc.country}${cityInfo}</div>`;
      }
    }
  } else if (geoKnown) {
    // Fallback to simple geo_country if no breakdown available
    const geoFlag = countryToFlag(d.geo_country);
    const geoWarn = geoDiffers ? ' tip-warn' : '';
    html += `<div class="tooltip-row"><span class="tooltip-label">IP Location:</span><span class="tooltip-value${geoWarn}">${geoFlag} ${d.geo_country}${geoDiffers ? ' ⚠' : ''}</span></div>`;
  }

  // Show BGP peering location for offshore ASNs
  if (d.peering_country) {
    const peerFlag = countryToFlag(d.peering_country);
    html += `<div class="tooltip-row"><span class="tooltip-label">Peering at:</span><span class="tooltip-value">${peerFlag} ${d.peering_country}</span></div>`;
    if (d.peering_details && d.peering_details.length > 0) {
      html += `<div class="tooltip-detail">&nbsp;&nbsp;Peers at: ${d.peering_details.slice(0, 2).join(', ')}</div>`;
    }
  }

  html += `<div class="tooltip-row"><span class="tooltip-label">Category:</span><span class="tooltip-value">${typeLabel}</span></div>`;

  if (d.traffic !== undefined) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Routes seen:</span><span class="tooltip-value">${d.traffic.toLocaleString()}</span></div>`;
  }
  if (d.rank) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Rank:</span><span class="tooltip-value">#${d.rank}</span></div>`;
  }
  if (d.percentage !== undefined) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(d.percentage || 0).toFixed(1)}%</span></div>`;
  }

  // Classification insight for offshore types
  if (d.type === 'offshore-enterprise') {
    const peerLoc = d.peering_country || d.geo_country;
    html += `<div class="tooltip-insight">Registered in ${d.country || 'BD'} but located in ${peerLoc}. No other Bangladeshi networks connect through it, so it looks like a company with servers abroad.</div>`;
  } else if (d.type === 'offshore-gateway') {
    const peerLoc = d.peering_country || d.geo_country;
    html += `<div class="tooltip-insight tip-offshore">Registered in ${d.country || 'BD'} but located in ${peerLoc}, and other Bangladeshi networks connect through it, so it may be acting as an unlicensed gateway (<a href="https://github.com/shafayat1004/bgp-bangladesh/blob/main/docs/List%20of%20IIG%20Service%20Providers%20License.pdf" target="_blank">licence list</a>).</div>`;
  } else if (d.type === 'detected-iig') {
    html += `<div class="tooltip-insight tip-warn">Not on <a href="https://github.com/shafayat1004/bgp-bangladesh/blob/main/docs/List%20of%20IIG%20Service%20Providers%20License.pdf" target="_blank">BTRC's licence list</a>, but other Bangladeshi networks connect through it, so it may be acting as an unlicensed gateway.</div>`;
  }

  return html;
}

/**
 * Tooltip HTML for a connection between two networks.
 *
 * @param {Object} srcNode - Source node data
 * @param {Object} tgtNode - Target node data
 * @param {number} count - Route count
 * @param {string} [edgeType] - Edge type (international/domestic)
 * @returns {string} HTML string
 */
export function buildEdgeTooltipHtml(srcNode, tgtNode, count, edgeType) {
  const sf = srcNode?.country ? countryToFlag(srcNode.country) + ' ' : '';
  const tf = tgtNode?.country ? countryToFlag(tgtNode.country) + ' ' : '';
  const sn = srcNode?.name || '?';
  const tn = tgtNode?.name || '?';

  let html = `<div class="tooltip-title">${sf}${sn} &rarr; ${tf}${tn}</div>`;
  html += `<div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${count.toLocaleString()}</span></div>`;
  if (edgeType) {
    html += `<div class="tooltip-row"><span class="tooltip-label">Kind:</span><span class="tooltip-value">${edgeType === 'domestic' ? 'Local' : 'International'}</span></div>`;
  }
  return html;
}
