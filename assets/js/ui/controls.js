/**
 * Controls Module
 * Manages sidebar controls: data source indicator, 3-layer ASN lists, filters.
 */

import { countryToFlag } from '../api/ripestat.js';

const PREFS_KEY = 'bgp_bd_prefs';
const TAB_KEY = 'bgp_bd_active_tab';

export function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function savePreferences(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export function getActiveTab() {
  try { return localStorage.getItem(TAB_KEY) || 'force-graph'; } catch { return 'force-graph'; }
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
    <div class="asn-name">${flag ? flag + ' ' : ''}#${n.rank} ${name}</div>
    <div class="asn-details">${desc}${n.country ? ` (${n.country})` : ''}</div>
    <div class="asn-traffic">${n.traffic.toLocaleString()} routes &bull; ${(n.percentage || 0).toFixed(1)}%</div>
  `;
}

/**
 * Populate the sidebar with 3-layer ASN lists
 */
export function populateSidebar(data, onNodeClick) {
  const statsEl = document.getElementById('stats-container');
  if (statsEl) {
    const s = data.stats;
    const detectedCount = s.total_detected_iig || 0;
    const offshoreCount = s.total_offshore_peer || 0;
    statsEl.innerHTML = `
      <div class="stat">
        <div class="stat-label">Observations</div>
        <div class="stat-value">${(s.valid_observations || s.total_traffic || 0).toLocaleString()}</div>
      </div>
      <div class="stat-row">
        <div class="stat stat-mini">
          <div class="stat-label">Local ISPs</div>
          <div class="stat-value">${s.total_local_isp || 0}</div>
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
      ${(detectedCount > 0 || offshoreCount > 0) ? `
      <div class="stat-row">
        ${detectedCount > 0 ? `<div class="stat stat-mini"><div class="stat-label">Detected Gateways</div><div class="stat-value">${detectedCount}</div></div>` : ''}
        ${offshoreCount > 0 ? `<div class="stat stat-mini"><div class="stat-label">Offshore Peers</div><div class="stat-value">${offshoreCount}</div></div>` : ''}
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

  // Offshore Peers list
  populateList('offshore-peer-list', data, 'offshore-peer', 'offshore-peer', onNodeClick);

  // Local ISP list
  populateList('local-isp-list', data, 'local-isp', 'local-isp', onNodeClick);

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

  listEl.innerHTML = nodes.map(n => `
    <div class="asn-item ${cssClass}" data-asn="${n.asn}" id="asn-${n.asn}">
      ${formatASNItem(n)}
    </div>
  `).join('');

  listEl.querySelectorAll('.asn-item').forEach(el => {
    el.addEventListener('click', () => onNodeClick(el.dataset.asn));
  });
}

/**
 * Display "What's My ASN?" result
 */
export function showMyASNResult(result) {
  const el = document.getElementById('my-asn-result');
  if (!el) return;

  if (result.error) {
    el.innerHTML = `<div class="my-asn-error">${result.error}</div>`;
    return;
  }

  const flag = result.country ? countryToFlag(result.country) : '';
  el.innerHTML = `
    <div class="my-asn-card">
      <div class="my-asn-row"><span class="my-asn-label">Your IP:</span><span class="my-asn-value">${result.ip}</span></div>
      <div class="my-asn-row"><span class="my-asn-label">Your ASN:</span><span class="my-asn-value">${flag} AS${result.asn}</span></div>
      <div class="my-asn-row"><span class="my-asn-label">Network:</span><span class="my-asn-value">${result.holder}</span></div>
      <div class="my-asn-row"><span class="my-asn-label">Prefix:</span><span class="my-asn-value">${result.prefix}</span></div>
    </div>
  `;
}
