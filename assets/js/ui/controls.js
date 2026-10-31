/**
 * Controls Module
 * Manages sidebar controls: data source indicator, ASN lists by type, filters.
 */

import { countryToFlag } from '../api/ripestat.js';

const PREFS_KEY = 'bgp_bd_prefs';
const TAB_KEY = 'bgp_bd_active_tab';

/**
 * JSON has no Infinity, so "no Max Routes limit" is stored as null and turned
 * back into Infinity on load. Exported for unit testing.
 */
export function parsePreferences(raw) {
  const prefs = raw ? JSON.parse(raw) : {};
  if (prefs.maxTraffic === null) prefs.maxTraffic = Infinity;
  return prefs;
}

export function serializePreferences(prefs) {
  return JSON.stringify({ ...prefs, ...(prefs.maxTraffic === Infinity && { maxTraffic: null }) });
}

export function loadPreferences() {
  try {
    return parsePreferences(localStorage.getItem(PREFS_KEY));
  } catch { return {}; }
}

export function savePreferences(prefs) {
  try { localStorage.setItem(PREFS_KEY, serializePreferences(prefs)); } catch {}
}

export function getActiveTab() {
  try { return localStorage.getItem(TAB_KEY) || 'hierarchical'; } catch { return 'hierarchical'; }
}

export function saveActiveTab(tabId) {
  try { localStorage.setItem(TAB_KEY, tabId); } catch {}
}

export function setDataSourceLabel(text) {
  const el = document.getElementById('data-source-label');
  if (el) el.textContent = text;
}

/**
 * Format an ASN item with flag emoji
 */
function formatASNItem(n) {
  const flag = n.country ? countryToFlag(n.country) : '';
  const name = n.name || `AS${n.asn}`;
  const desc = n.description || '';
  return `
    <span class="asn-name">${flag ? flag + ' ' : ''}#${n.rank} ${name}</span>
    <span class="asn-details">${desc}${n.country ? ` (${n.country})` : ''}</span>
    <span class="asn-traffic">${n.traffic.toLocaleString()} routes &bull; ${(n.percentage || 0).toFixed(1)}%</span>
  `;
}

/**
 * Populate the sidebar with ASN lists for all 5 types
 */
export function populateSidebar(data, onNodeClick) {
  const statsEl = document.getElementById('stats-container');
  if (statsEl) {
    const s = data.stats;
    const detectedCount = s.total_detected_iig || 0;
    const offshoreEntCount = s.total_offshore_enterprise || s.total_offshore_peer || 0;
    const offshoreGwCount = s.total_offshore_gateway || 0;
    statsEl.innerHTML = `
      <div class="stat">
        <div class="stat-label">Observations</div>
        <div class="stat-value">${(s.valid_observations || s.total_traffic || 0).toLocaleString()}</div>
      </div>
      <div class="stat-row">
        <div class="stat stat-mini">
          <div class="stat-label">Local Companies</div>
          <div class="stat-value">${s.total_local_company || s.total_local_isp || 0}</div>
        </div>
        <div class="stat stat-mini">
          <div class="stat-label">IIGs</div>
          <div class="stat-value">${s.total_iig || s.total_inside || 0}</div>
        </div>
        <div class="stat stat-mini">
          <div class="stat-label">Outside ASNs</div>
          <div class="stat-value">${s.total_outside || 0}</div>
        </div>
      </div>
      ${(detectedCount > 0 || offshoreEntCount > 0 || offshoreGwCount > 0) ? `
      <div class="stat-row">
        ${detectedCount > 0 ? `<div class="stat stat-mini"><div class="stat-label">Detected Gateways</div><div class="stat-value">${detectedCount}</div></div>` : ''}
        ${offshoreEntCount > 0 ? `<div class="stat stat-mini"><div class="stat-label">Offshore Ent.</div><div class="stat-value">${offshoreEntCount}</div></div>` : ''}
        ${offshoreGwCount > 0 ? `<div class="stat stat-mini"><div class="stat-label">Offshore GW</div><div class="stat-value">${offshoreGwCount}</div></div>` : ''}
      </div>` : ''}
      <div class="stat">
        <div class="stat-label">Connections</div>
        <div class="stat-value">${s.total_edges || 0}</div>
      </div>
    `;
  }

  // IIG list (licensed border gateways)
  populateList('iig-list', data, 'iig', 'iig', onNodeClick);

  // Detected Gateways list
  populateList('detected-iig-list', data, 'detected-iig', 'detected-iig', onNodeClick);

  // Offshore Enterprise list
  populateList('offshore-enterprise-list', data, 'offshore-enterprise', 'offshore-enterprise', onNodeClick);

  // Offshore Gateway list
  populateList('offshore-gateway-list', data, 'offshore-gateway', 'offshore-gateway', onNodeClick);

  // Local Company list
  populateList('local-company-list', data, 'local-company', 'local-company', onNodeClick);

  // Outside ASN list
  populateList('outside-list', data, 'outside', 'outside', onNodeClick);
}

function populateList(containerId, data, type, cssClass, onNodeClick) {
  const listEl = document.getElementById(containerId);
  if (!listEl) return;

  const nodes = data.nodes
    .filter(n => n.type === type)
    .sort((a, b) => b.traffic - a.traffic)
    .slice(0, 20);

  // Buttons, so each network can be focused and highlighted from the keyboard.
  listEl.innerHTML = nodes.map(n => `
    <div role="listitem">
      <button type="button" class="asn-item ${cssClass}" data-asn="${n.asn}" id="asn-${n.asn}" aria-describedby="${containerId}-hint">
        ${formatASNItem(n)}
      </button>
    </div>
  `).join('') + `<span class="visually-hidden" id="${containerId}-hint">Highlights this network's connections in the chart</span>`;

  listEl.querySelectorAll('.asn-item').forEach(el => {
    el.addEventListener('click', () => onNodeClick(el.dataset.asn));
  });
}

/**
 * Show why the "How does my internet reach the world?" lookup failed.
 * (The story itself is drawn by my-path.js.)
 */
export function showMyASNResult(result) {
  const el = document.getElementById('my-asn-result');
  if (!el) return;
  el.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'my-asn-error';
  msg.textContent = result.error;
  el.appendChild(msg);
}
