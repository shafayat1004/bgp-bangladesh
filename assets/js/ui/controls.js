/**
 * Controls Module
 * Manages sidebar controls: data source indicator, filters, buttons.
 */

const PREFS_KEY = 'bgp_bd_prefs';
const TAB_KEY = 'bgp_bd_active_tab';

/**
 * Load user preferences from localStorage
 */
export function loadPreferences() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save user preferences
 */
export function savePreferences(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/**
 * Get saved active tab
 */
export function getActiveTab() {
  try {
    return localStorage.getItem(TAB_KEY) || 'force-graph';
  } catch {
    return 'force-graph';
  }
}

/**
 * Save active tab
 */
export function saveActiveTab(tabId) {
  try {
    localStorage.setItem(TAB_KEY, tabId);
  } catch {
    // ignore
  }
}

/**
 * Update the data source indicator
 */
export function setDataSourceLabel(text) {
  const el = document.getElementById('data-source-label');
  if (el) el.textContent = text;
}

/**
 * Populate the sidebar with ASN lists
 */
export function populateSidebar(data, onNodeClick) {
  const statsEl = document.getElementById('stats-container');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat">
        <div class="stat-label">Total Routes Analyzed</div>
        <div class="stat-value">${(data.stats.total_traffic || 0).toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Inside BD ASNs</div>
        <div class="stat-value">${data.stats.total_inside || 0}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Outside BD ASNs</div>
        <div class="stat-value">${data.stats.total_outside || 0}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Connections</div>
        <div class="stat-value">${data.stats.total_edges || 0}</div>
      </div>
    `;
  }

  // Inside ASN list
  const insideList = document.getElementById('inside-list');
  if (insideList) {
    const insideNodes = data.nodes
      .filter(n => n.type === 'inside')
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 20);

    insideList.innerHTML = insideNodes.map(n => `
      <div class="asn-item inside" data-asn="${n.asn}" id="asn-${n.asn}">
        <div class="asn-name">#${n.rank} ${n.name || `AS${n.asn}`}</div>
        <div class="asn-details">${n.description || ''}</div>
        <div class="asn-traffic">${n.traffic.toLocaleString()} routes &bull; ${(n.percentage || 0).toFixed(1)}%</div>
      </div>
    `).join('');

    insideList.querySelectorAll('.asn-item').forEach(el => {
      el.addEventListener('click', () => onNodeClick(el.dataset.asn));
    });
  }

  // Outside ASN list
  const outsideList = document.getElementById('outside-list');
  if (outsideList) {
    const outsideNodes = data.nodes
      .filter(n => n.type === 'outside')
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 20);

    outsideList.innerHTML = outsideNodes.map(n => `
      <div class="asn-item outside" data-asn="${n.asn}" id="asn-${n.asn}">
        <div class="asn-name">#${n.rank} ${n.name || `AS${n.asn}`}</div>
        <div class="asn-details">${n.description || ''}</div>
        <div class="asn-traffic">${n.traffic.toLocaleString()} routes &bull; ${(n.percentage || 0).toFixed(1)}%</div>
      </div>
    `).join('');

    outsideList.querySelectorAll('.asn-item').forEach(el => {
      el.addEventListener('click', () => onNodeClick(el.dataset.asn));
    });
  }
}
