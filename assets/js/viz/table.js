/**
 * Interactive Data Table with country flags, license badges, and ASN detail panel.
 * Clicking a row expands a detail panel showing full analysis info.
 */

import { countryToFlag } from '../api/ripestat.js';
import { GLOSSARY, CATEGORY_LABELS as TYPE_LABELS, CATEGORY_PLURALS, termHelp } from '../ui/glossary.js';
import { friendlyName } from '../ui/names.js';
const TYPE_CLASSES = { 'outside': 'type-outside', 'iig': 'type-iig', 'detected-iig': 'type-detected-iig', 'offshore-enterprise': 'type-offshore-enterprise', 'offshore-gateway': 'type-offshore-gateway', 'local-company': 'type-local-company', 'inside': 'type-iig', 'offshore-peer': 'type-offshore-peer', 'local-isp': 'type-local-company' };

// Connections in the detail panel, grouped by the other network's category.
const CONNECTION_GROUPS = ['outside', 'iig', 'detected-iig', 'offshore-gateway', 'offshore-enterprise', 'local-company'];
const CONNECTION_KINDS = { 'domestic': 'Local', 'international': 'International' };

let currentData = null;
let currentOptions = {};
let currentSort = { column: 'traffic', asc: false };
let searchQuery = '';
let currentPage = 0;
let pageSize = 50;
let showEdges = false;
let activeTypeFilters = null; // null = show all
let expandedASN = null; // currently expanded detail panel ASN
let animateDetail = false; // slide the detail panel in only when the user opens it
let typeFilterKey = null; // which type filter is applied, to tell real changes from re-applies

// Full text for cells that may be cut off with an ellipsis.
const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<div id="table-container"></div>';
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  currentPage = 0;
  expandedASN = null;
  render();
}

// History slider: swap the data without touching the user's sort, page,
// search, open row or scroll position, so the table doesn't jump.
export function updateData(data, options = {}) {
  currentData = data;
  currentOptions = { ...currentOptions, ...options };
  if (expandedASN && !data.nodes.some(n => n.asn === expandedASN)) expandedASN = null;
  const wrapper = document.querySelector('#table-container .table-wrapper');
  const scroll = wrapper ? [wrapper.scrollTop, wrapper.scrollLeft] : null;
  const focusedRow = document.activeElement?.closest?.('#table-body tr[data-asn]')?.dataset.asn;
  renderTable();
  if (wrapper && scroll) [wrapper.scrollTop, wrapper.scrollLeft] = scroll;
  if (focusedRow) focusRowToggle(focusedRow);
}

function render() {
  if (!currentData) return;
  const container = document.getElementById('table-container');
  if (!container) return;

  container.innerHTML = `
    <div class="table-toolbar">
      <input type="search" id="table-search" placeholder="Search name, ASN or country…" class="table-search" value="${searchQuery}" aria-label="Search the table">
      <div class="table-toolbar-right">
        <button type="button" class="btn btn-small ${!showEdges ? 'btn-active' : 'btn-outline'}" id="table-show-nodes" aria-pressed="${!showEdges}">Networks</button>
        <button type="button" class="btn btn-small ${showEdges ? 'btn-active' : 'btn-outline'}" id="table-show-edges" aria-pressed="${showEdges}">Connections</button>
        <select id="table-page-size" class="table-select" aria-label="Rows per page">
          <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 rows</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 rows</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100 rows</option>
        </select>
      </div>
    </div>
    <div class="table-wrapper"><table class="data-table ${showEdges ? 'data-table-edges' : 'data-table-nodes'}"><caption class="visually-hidden">${showEdges ? 'Connections between networks, with route counts' : 'Networks seen on BGP paths into Bangladesh'}</caption><colgroup id="table-cols"></colgroup><thead id="table-head"></thead><tbody id="table-body"></tbody></table></div>
    <div class="table-footer" id="table-footer"></div>
  `;

  document.getElementById('table-search').addEventListener('input', (e) => { searchQuery = e.target.value.toLowerCase(); currentPage = 0; renderTable(); });
  document.getElementById('table-show-nodes').addEventListener('click', () => { showEdges = false; currentPage = 0; render(); document.getElementById('table-show-nodes')?.focus(); });
  document.getElementById('table-show-edges').addEventListener('click', () => { showEdges = true; currentPage = 0; render(); document.getElementById('table-show-edges')?.focus(); });
  document.getElementById('table-page-size').addEventListener('change', (e) => { pageSize = parseInt(e.target.value); currentPage = 0; renderTable(); });

  renderTable();
}

function renderTable() {
  if (showEdges) renderEdgesTable();
  else renderNodesTable();
}

/**
 * All connections of an ASN, grouped by the category of the network at the
 * other end (international networks, gateways, local companies), busiest first.
 */
function getConnections(asn) {
  const groups = {};
  if (!currentData?.edges) return groups;

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  for (const e of currentData.edges) {
    const src = e.source?.asn || e.source;
    const tgt = e.target?.asn || e.target;
    const other = src === asn ? tgt : tgt === asn ? src : null;
    if (!other) continue;
    const type = nodeMap[other]?.type || '';
    (groups[type] ||= []).push({
      asn: other,
      name: friendlyName(nodeMap[other] || { asn: other }),
      fullName: nodeMap[other]?.name || '',
      country: nodeMap[other]?.country || '',
      type,
      count: e.count,
    });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => b.count - a.count);
  return groups;
}

/**
 * Build the detail panel HTML for a node.
 */
function buildDetailPanel(n) {
  const regFlag = n.country ? countryToFlag(n.country) : '';
  const geoFlag = n.geo_country ? countryToFlag(n.geo_country) : '';
  const geoKnown = n.geo_country && n.geo_country !== '';
  const geoDiffers = geoKnown && n.geo_country !== n.country;

  const groups = getConnections(n.asn);

  const typeExplanation = GLOSSARY[n.type]?.short || '';
  const typeLabel = TYPE_LABELS[n.type] || n.type;
  const typeCls = TYPE_CLASSES[n.type] || '';

  // Build connections HTML
  function connectionRows(list) {
    const maxShow = 10;
    const shown = list.slice(0, maxShow);
    let html = '<table class="detail-connections-table"><thead><tr><th>ASN</th><th>Name</th><th>Registered</th><th>Category</th><th>Routes</th></tr></thead><tbody>';
    for (const c of shown) {
      const cf = c.country ? countryToFlag(c.country) + ' ' : '';
      html += `<tr>
        <td>AS${c.asn}</td>
        <td title="${attr(c.fullName)}">${cf}${c.name}</td>
        <td>${cf}${c.country || '-'}</td>
        <td><span class="type-badge ${TYPE_CLASSES[c.type] || ''}">${TYPE_LABELS[c.type] || c.type}</span></td>
        <td class="num">${c.count.toLocaleString()}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    if (list.length > maxShow) {
      html += `<div class="detail-more">... and ${list.length - maxShow} more</div>`;
    }
    return html;
  }

  // Build IP distribution section
  let geoBreakdownHtml = '';
  if (n.geo_breakdown && n.geo_breakdown.length > 0) {
    geoBreakdownHtml = `
        <div class="detail-section">
          <div class="detail-section-title">IP locations, per address block${termHelp('ip-location')}</div>`;
    for (const loc of n.geo_breakdown) {
      const flag = countryToFlag(loc.country);
      const cityInfo = loc.city ? ` (${loc.city})` : '';
      geoBreakdownHtml += `
          <div class="detail-row">
            <span class="detail-label">${flag} ${loc.country}${cityInfo}:</span>
            <span class="detail-value">${loc.percentage.toFixed(1)}%</span>
          </div>`;
    }
    geoBreakdownHtml += '</div>';
  }

  // Build peering location section
  let peeringHtml = '';
  if (n.peering_country) {
    const peeringFlag = countryToFlag(n.peering_country);
    peeringHtml = `
        <div class="detail-section">
          <div class="detail-section-title">Peering location${termHelp('peering')}</div>
          <div class="detail-row">
            <span class="detail-label">Country:</span>
            <span class="detail-value">${peeringFlag} ${n.peering_country}</span>
          </div>`;
    if (n.peering_details && n.peering_details.length > 0) {
      peeringHtml += `
          <div class="detail-explanation">Peers at: ${n.peering_details.join(', ')}</div>`;
    }
    if (n.peering_source) {
      const sourceLabel = n.peering_source === 'peeringdb' ? 'PeeringDB'
        : n.peering_source === 'peeringdb-upstream' ? 'PeeringDB (where the networks it connects to peer)'
        : 'Guessed from its IP location';
      peeringHtml += `
          <div class="detail-row">
            <span class="detail-label">Data Source:</span>
            <span class="detail-value">${sourceLabel}</span>
          </div>`;
    }
    peeringHtml += '</div>';
  }

  return `
    <div class="detail-panel">
      <div class="detail-header">
        <div class="detail-title">${regFlag} ${friendlyName(n)}</div>
        <button class="detail-close" type="button" title="Close" aria-label="Close details">&times;</button>
      </div>

      <div class="detail-grid">
        <div class="detail-section">
          <div class="detail-section-title">Identity</div>
          <div class="detail-row"><span class="detail-label">ASN${termHelp('asn')}:</span><span class="detail-value">AS${n.asn}</span></div>
          <div class="detail-row"><span class="detail-label">Registry name:</span><span class="detail-value">${n.name || '-'}</span></div>
          ${n.description && n.description !== n.name ? `<div class="detail-row"><span class="detail-label">Organisation:</span><span class="detail-value">${n.description}</span></div>` : ''}
          ${n.country ? `<div class="detail-row"><span class="detail-label">Registered in${termHelp('registered')}:</span><span class="detail-value">${regFlag} ${n.country}</span></div>` : ''}
          ${geoKnown && !(n.geo_breakdown && n.geo_breakdown.length > 0) ? `<div class="detail-row"><span class="detail-label">IP location${termHelp('ip-location')}:</span><span class="detail-value${geoDiffers ? ' detail-warning' : ''}">${geoFlag} ${n.geo_country}${geoDiffers ? ' (not where it is registered)' : ''}</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Announces its own addresses:</span><span class="detail-value">${n.announced ? 'Yes' : 'No'}</span></div>
          <div class="detail-row"><span class="detail-label">RIPEstat:</span><span class="detail-value"><a href="https://stat.ripe.net/AS${n.asn}" target="_blank" rel="noopener">View on RIPEstat</a></span></div>
        </div>

        ${geoBreakdownHtml}
        ${peeringHtml}

        <div class="detail-section">
          <div class="detail-section-title">Classification</div>
          <div class="detail-row"><span class="detail-label">Category${termHelp(GLOSSARY[n.type] ? n.type : 'local-company')}:</span><span class="detail-value"><span class="type-badge ${typeCls}">${typeLabel}</span></span></div>
          ${n.licensed ? '<div class="detail-row"><span class="detail-label">Licence:</span><span class="detail-value detail-licensed">Licensed IIG, on the BTRC list (<a href="https://github.com/shafayat1004/bgp-bangladesh/blob/main/docs/List%20of%20IIG%20Service%20Providers%20License.pdf" target="_blank">source</a>)</span></div>' : '<div class="detail-row"><span class="detail-label">Licence:</span><span class="detail-value">Not on <a href="https://github.com/shafayat1004/bgp-bangladesh/blob/main/docs/List%20of%20IIG%20Service%20Providers%20License.pdf" target="_blank">the BTRC licence list</a></span></div>'}
          ${typeExplanation ? `<div class="detail-explanation">${typeExplanation}</div>` : ''}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Routes seen${termHelp('routes-seen')}</div>
          <div class="detail-row"><span class="detail-label">Routes:</span><span class="detail-value">${(n.traffic || 0).toLocaleString()}</span></div>
          ${n.rank ? `<div class="detail-row"><span class="detail-label">Rank:</span><span class="detail-value">#${n.rank} among ${(CATEGORY_PLURALS[n.type] || 'its category').toLowerCase()}</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Share${termHelp('share')}:</span><span class="detail-value">${(n.percentage || 0).toFixed(2)}%</span></div>
        </div>
      </div>

      <div class="detail-connections">
        ${CONNECTION_GROUPS.filter(t => groups[t]).map(t => `
        <div class="detail-section">
          <div class="detail-section-title">Connected ${(CATEGORY_PLURALS[t] || t).toLowerCase()} (${groups[t].length})${termHelp(t)}</div>
          ${connectionRows(groups[t])}
        </div>`).join('') || '<div class="detail-empty">No connections to this network in this snapshot.</div>'}
      </div>
    </div>
  `;
}

// Sortable column headers: a button in each header (keyboard operable) and
// aria-sort on the sorted column. Focus returns to the header after re-render.
function renderSortableHeader(thead, columns) {
  // Fixed column widths (table-layout: fixed) so new data never resizes them.
  const cols = document.getElementById('table-cols');
  if (cols) cols.innerHTML = columns.map(c => `<col${c.width ? ` style="width:${c.width}"` : ''}>`).join('');
  thead.innerHTML = '<tr>' + columns.map(c => {
    const sorted = currentSort.column === c.key;
    const ariaSort = sorted ? (currentSort.asc ? 'ascending' : 'descending') : 'none';
    const arrow = sorted ? (currentSort.asc ? ' &#9650;' : ' &#9660;') : '';
    return `<th scope="col" data-col="${c.key}" class="sortable" aria-sort="${ariaSort}"><button type="button" class="th-sort">${c.label}<span aria-hidden="true">${arrow}</span></button>${c.term ? termHelp(c.term) : ''}</th>`;
  }).join('') + '</tr>';

  thead.querySelectorAll('th.sortable').forEach(th => {
    th.querySelector('button').addEventListener('click', () => {
      const col = th.dataset.col;
      if (currentSort.column === col) currentSort.asc = !currentSort.asc;
      else { currentSort.column = col; currentSort.asc = false; }
      currentPage = 0;
      renderTable();
      document.querySelector(`#table-head th[data-col="${col}"] button`)?.focus();
    });
  });
}

// The pager is rebuilt on each page change; keep focus on it (on the other
// button if this one became disabled at the first/last page).
function refocusPager(id) {
  const btn = document.getElementById(id);
  const other = document.getElementById(id === 'page-next' ? 'page-prev' : 'page-next');
  (btn && !btn.disabled ? btn : other)?.focus();
}

// The table is re-rendered on every change; put focus back on the row's button.
function focusRowToggle(asn) {
  document.querySelector(`#table-body tr[data-asn="${asn}"] .row-toggle`)?.focus();
}

function renderNodesTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  const footer = document.getElementById('table-footer');

  const columns = [
    { key: 'rank', label: 'Rank', numeric: true, width: '56px' },
    { key: 'asn', label: 'ASN', numeric: false, width: '100px', term: 'asn' },
    { key: 'name', label: 'Network', numeric: false },
    { key: 'country', label: 'Registered', numeric: false, width: '124px', term: 'registered' },
    { key: 'geo_country', label: 'IP Location', numeric: false, width: '124px', term: 'ip-location' },
    { key: 'peering_country', label: 'Peering At', numeric: false, width: '124px', term: 'peering' },
    { key: 'type', label: 'Category', numeric: false, width: '150px' },
    { key: 'traffic', label: 'Routes', numeric: true, width: '112px', term: 'routes-seen' },
    { key: 'percentage', label: 'Share', numeric: true, width: '88px', term: 'share' },
  ];

  renderSortableHeader(thead, columns);

  const minTraffic = currentOptions.minTraffic !== undefined ? currentOptions.minTraffic : 100;
  const maxTraffic = currentOptions.maxTraffic !== undefined ? currentOptions.maxTraffic : Infinity;
  let rows = currentData.nodes.filter(n => n.traffic >= minTraffic && n.traffic <= maxTraffic);
  
  // Apply type filters
  if (activeTypeFilters) {
    rows = rows.filter(n => activeTypeFilters.has(n.type));
  }
  
  if (searchQuery) {
    // Normalize search: strip "AS" prefix if present
    const normalizedQuery = searchQuery.replace(/^as/i, '');
    
    rows = rows.filter(n =>
      n.asn.includes(normalizedQuery) ||
      (n.name || '').toLowerCase().includes(searchQuery) ||
      (n.description || '').toLowerCase().includes(searchQuery) ||
      (n.country || '').toLowerCase().includes(searchQuery) ||
      (n.geo_country || '').toLowerCase().includes(searchQuery) ||
      (n.peering_country || '').toLowerCase().includes(searchQuery) ||
      (n.type || '').toLowerCase().includes(searchQuery)
    );
  }

  const col = columns.find(c => c.key === currentSort.column);
  // Sort names by what's shown, not by the registry handle in front of them.
  const sortValue = currentSort.column === 'name' ? friendlyName : (r) => r[currentSort.column] ?? '';
  rows.sort((a, b) => {
    let va = sortValue(a);
    let vb = sortValue(b);
    if (col?.numeric) { va = Number(va) || 0; vb = Number(vb) || 0; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return currentSort.asc ? -1 : 1;
    if (va > vb) return currentSort.asc ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(rows.length / pageSize) || 1;
  currentPage = Math.min(currentPage, totalPages - 1);
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  let tbodyHtml = '';
  for (const n of pageRows) {
    const regFlag = n.country ? countryToFlag(n.country) : '';
    const geoFlag = n.geo_country ? countryToFlag(n.geo_country) : '';
    const licenseBadge = n.licensed ? ' <span class="license-badge">BTRC</span>' : '';
    const isExpanded = expandedASN === n.asn;
    const geoDiffers = n.geo_country && n.geo_country !== '' && n.geo_country !== n.country;
    const geoDisplay = n.geo_country && n.geo_country !== '' ? `${geoFlag} ${n.geo_country}` : '-';
    const geoClass = geoDiffers ? ' geo-mismatch' : '';

    const peerFlag = n.peering_country ? countryToFlag(n.peering_country) : '';
    const peerDisplay = n.peering_country ? `${peerFlag} ${n.peering_country}` : '-';

    tbodyHtml += `<tr data-asn="${n.asn}" class="clickable-row${isExpanded ? ' row-expanded' : ''}">
      <td>${n.rank || '-'}</td>
      <td><button type="button" class="row-toggle" aria-expanded="${isExpanded}"${isExpanded ? ` aria-controls="detail-${n.asn}"` : ''} aria-label="AS${n.asn} details">AS${n.asn}</button></td>
      <td title="${attr(`${n.name || ''} (AS${n.asn})`)}">${regFlag} ${friendlyName(n)}${licenseBadge}</td>
      <td>${regFlag} ${n.country || '-'}</td>
      <td class="${geoClass}">${geoDisplay}</td>
      <td>${peerDisplay}</td>
      <td><span class="type-badge ${TYPE_CLASSES[n.type] || ''}">${TYPE_LABELS[n.type] || n.type}</span></td>
      <td class="num">${(n.traffic || 0).toLocaleString()}</td>
      <td class="num">${(n.percentage || 0).toFixed(2)}%</td>
    </tr>`;

    // Insert detail panel row if this ASN is expanded
    if (isExpanded) {
      tbodyHtml += `<tr class="detail-row${animateDetail ? ' detail-row-enter' : ''}" id="detail-${n.asn}"><td colspan="${columns.length}">${buildDetailPanel(n)}</td></tr>`;
    }
  }
  tbody.innerHTML = tbodyHtml;
  animateDetail = false;

  // Click handler: toggle detail panel
  tbody.querySelectorAll('tr.clickable-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const asn = tr.dataset.asn;
      if (!asn) return;

      if (expandedASN === asn) {
        // Collapse
        expandedASN = null;
      } else {
        // Expand this ASN
        expandedASN = asn;
        animateDetail = true;
      }
      renderTable();
      focusRowToggle(asn);
    });
  });

  // Close button handlers (delegated)
  tbody.querySelectorAll('.detail-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const asn = expandedASN;
      expandedASN = null;
      renderTable();
      focusRowToggle(asn);
    });
  });

  footer.innerHTML = `
    <span>Showing ${rows.length > 0 ? currentPage * pageSize + 1 : 0}-${Math.min((currentPage + 1) * pageSize, rows.length)} of ${rows.length} &middot; Click a row for details</span>
    <div class="table-pagination">
      <button class="btn btn-small" id="page-prev" ${currentPage === 0 ? 'disabled' : ''}>Prev</button>
      <span>Page ${currentPage + 1} / ${totalPages}</span>
      <button class="btn btn-small" id="page-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
    </div>
  `;

  document.getElementById('page-prev')?.addEventListener('click', () => { if (currentPage > 0) { currentPage--; renderTable(); refocusPager('page-prev'); } });
  document.getElementById('page-next')?.addEventListener('click', () => { if (currentPage < totalPages - 1) { currentPage++; renderTable(); refocusPager('page-next'); } });
}

function renderEdgesTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  const footer = document.getElementById('table-footer');

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const columns = [
    // Every connection runs from a network to the gateway it connects through.
    { key: 'source', label: 'ASN', numeric: false, width: '110px', term: 'asn' },
    { key: 'source_name', label: 'Network', numeric: false },
    { key: 'target', label: 'Gateway ASN', numeric: false, width: '136px' },
    { key: 'target_name', label: 'Gateway', numeric: false },
    { key: 'edge_type', label: 'Kind', numeric: false, width: '140px', term: 'connection-type' },
    { key: 'count', label: 'Routes', numeric: true, width: '108px', term: 'routes-seen' },
  ];

  renderSortableHeader(thead, columns);

  const minTraffic = currentOptions.minTraffic !== undefined ? currentOptions.minTraffic : 100;
  const maxTraffic = currentOptions.maxTraffic !== undefined ? currentOptions.maxTraffic : Infinity;
  let rows = currentData.edges
    .filter(e => e.count >= minTraffic && e.count <= maxTraffic)
    .map(e => {
      const src = e.source?.asn || e.source;
      const tgt = e.target?.asn || e.target;
      return {
        source: src, target: tgt, count: e.count,
        source_name: friendlyName(nodeMap[src] || { asn: src }),
        target_name: friendlyName(nodeMap[tgt] || { asn: tgt }),
        source_full: nodeMap[src]?.name || '',
        target_full: nodeMap[tgt]?.name || '',
        edge_type: CONNECTION_KINDS[e.type] || 'International',
        source_country: nodeMap[src]?.country || '',
        target_country: nodeMap[tgt]?.country || '',
      };
    });

  if (searchQuery) {
    // Normalize search: strip "AS" prefix if present
    const normalizedQuery = searchQuery.replace(/^as/i, '');
    
    rows = rows.filter(r =>
      r.source.includes(normalizedQuery) || r.target.includes(normalizedQuery) ||
      r.source_full.toLowerCase().includes(searchQuery) || r.target_full.toLowerCase().includes(searchQuery) ||
      r.edge_type.toLowerCase().includes(searchQuery)
    );
  }

  const col = columns.find(c => c.key === currentSort.column);
  rows.sort((a, b) => {
    let va = a[currentSort.column] ?? '';
    let vb = b[currentSort.column] ?? '';
    if (col?.numeric) { va = Number(va) || 0; vb = Number(vb) || 0; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return currentSort.asc ? -1 : 1;
    if (va > vb) return currentSort.asc ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(rows.length / pageSize) || 1;
  currentPage = Math.min(currentPage, totalPages - 1);
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  tbody.innerHTML = pageRows.map(r => {
    const sf = r.source_country ? countryToFlag(r.source_country) + ' ' : '';
    const tf = r.target_country ? countryToFlag(r.target_country) + ' ' : '';
    const typeCls = r.edge_type === 'Local' ? 'type-local-company' : 'type-outside';
    return `<tr>
      <td>${sf}AS${r.source}</td>
      <td title="${attr(`${r.source_full} (AS${r.source})`)}">${sf}${r.source_name}</td>
      <td>${tf}AS${r.target}</td>
      <td title="${attr(`${r.target_full} (AS${r.target})`)}">${tf}${r.target_name}</td>
      <td><span class="type-badge ${typeCls}">${r.edge_type}</span></td>
      <td class="num">${r.count.toLocaleString()}</td>
    </tr>`;
  }).join('');

  footer.innerHTML = `
    <span>Showing ${rows.length > 0 ? currentPage * pageSize + 1 : 0}-${Math.min((currentPage + 1) * pageSize, rows.length)} of ${rows.length}</span>
    <div class="table-pagination">
      <button class="btn btn-small" id="page-prev" ${currentPage === 0 ? 'disabled' : ''}>Prev</button>
      <span>Page ${currentPage + 1} / ${totalPages}</span>
      <button class="btn btn-small" id="page-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
    </div>
  `;

  document.getElementById('page-prev')?.addEventListener('click', () => { if (currentPage > 0) { currentPage--; renderTable(); refocusPager('page-prev'); } });
  document.getElementById('page-next')?.addEventListener('click', () => { if (currentPage < totalPages - 1) { currentPage++; renderTable(); refocusPager('page-next'); } });
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  // Expand the detail panel for this ASN and filter to show it
  searchQuery = asn;
  expandedASN = asn;
  animateDetail = true;
  currentPage = 0;
  const searchEl = document.getElementById('table-search');
  if (searchEl) searchEl.value = asn;
  render();
}
export function updateFilter(minVal, maxVal) { 
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render(); 
}
export function filterByTypes(activeTypes) {
  // main.js re-applies the same filter after every date step; only a real
  // change should send the user back to page 1.
  const key = [...activeTypes].sort().join();
  if (key === typeFilterKey) return;
  typeFilterKey = key;
  activeTypeFilters = activeTypes;
  currentPage = 0;
  render();
}
