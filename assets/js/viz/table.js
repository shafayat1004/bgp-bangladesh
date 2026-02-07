/**
 * Interactive Data Table with country flags, license badges, and ASN detail panel.
 * Clicking a row expands a detail panel showing full analysis info.
 */

import { countryToFlag } from '../api/ripestat.js';

const TYPE_LABELS = { 'outside': 'Outside BD', 'iig': 'IIG (Licensed)', 'detected-iig': 'Detected Gateway', 'offshore-enterprise': 'Offshore Enterprise', 'offshore-gateway': 'Offshore Gateway', 'local-company': 'Local Company', 'inside': 'Inside BD', 'offshore-peer': 'Offshore Peer', 'local-isp': 'Local ISP' };
const TYPE_CLASSES = { 'outside': 'type-outside', 'iig': 'type-iig', 'detected-iig': 'type-detected-iig', 'offshore-enterprise': 'type-offshore-enterprise', 'offshore-gateway': 'type-offshore-gateway', 'local-company': 'type-local-company', 'inside': 'type-iig', 'offshore-peer': 'type-offshore-peer', 'local-isp': 'type-local-company' };

const TYPE_EXPLANATIONS = {
  'outside': 'International transit provider that feeds routes into Bangladesh from abroad.',
  'iig': 'BTRC-licensed International Internet Gateway — authorized to carry international traffic for Bangladesh.',
  'detected-iig': 'Not in the official BTRC license list, but detected acting as a gateway with downstream BD customers. Potential unlicensed IIG.',
  'offshore-enterprise': 'Registered in Bangladesh but IP addresses are geolocated abroad. No downstream BD customers detected — likely an offshore hosting or enterprise presence (harmless).',
  'offshore-gateway': 'Registered in Bangladesh but IP addresses are geolocated abroad. Has downstream BD customers — potential unlicensed international gateway operating from outside the country.',
  'local-company': 'Domestic network operating within Bangladesh. Receives routes via IIGs or detected gateways.',
};

let currentData = null;
let currentOptions = {};
let currentSort = { column: 'traffic', asc: false };
let searchQuery = '';
let currentPage = 0;
let pageSize = 50;
let showEdges = false;
let activeTypeFilters = null; // null = show all
let expandedASN = null; // currently expanded detail panel ASN

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

function render() {
  if (!currentData) return;
  const container = document.getElementById('table-container');
  if (!container) return;

  container.innerHTML = `
    <div class="table-toolbar">
      <input type="text" id="table-search" placeholder="Search ASN, name, or country..." class="table-search" value="${searchQuery}">
      <div class="table-toolbar-right">
        <button class="btn btn-small ${!showEdges ? 'btn-active' : ''}" id="table-show-nodes">Nodes</button>
        <button class="btn btn-small ${showEdges ? 'btn-active' : ''}" id="table-show-edges">Edges</button>
        <select id="table-page-size" class="table-select">
          <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 rows</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 rows</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100 rows</option>
        </select>
      </div>
    </div>
    <div class="table-wrapper"><table class="data-table"><thead id="table-head"></thead><tbody id="table-body"></tbody></table></div>
    <div class="table-footer" id="table-footer"></div>
  `;

  document.getElementById('table-search').addEventListener('input', (e) => { searchQuery = e.target.value.toLowerCase(); currentPage = 0; renderTable(); });
  document.getElementById('table-show-nodes').addEventListener('click', () => { showEdges = false; currentPage = 0; render(); });
  document.getElementById('table-show-edges').addEventListener('click', () => { showEdges = true; currentPage = 0; render(); });
  document.getElementById('table-page-size').addEventListener('change', (e) => { pageSize = parseInt(e.target.value); currentPage = 0; renderTable(); });

  renderTable();
}

function renderTable() {
  if (showEdges) renderEdgesTable();
  else renderNodesTable();
}

/**
 * Find all connections for a given ASN from the edge data.
 */
function getConnections(asn) {
  if (!currentData?.edges) return { upstream: [], downstream: [] };

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const upstream = []; // edges where this ASN is the target (receiving routes from)
  const downstream = []; // edges where this ASN is the source (sending routes to)

  for (const e of currentData.edges) {
    const src = e.source?.asn || e.source;
    const tgt = e.target?.asn || e.target;

    if (tgt === asn) {
      upstream.push({
        asn: src,
        name: nodeMap[src]?.name || `AS${src}`,
        country: nodeMap[src]?.country || '',
        type: nodeMap[src]?.type || '',
        count: e.count,
        edgeType: e.type || 'international',
      });
    }
    if (src === asn) {
      downstream.push({
        asn: tgt,
        name: nodeMap[tgt]?.name || `AS${tgt}`,
        country: nodeMap[tgt]?.country || '',
        type: nodeMap[tgt]?.type || '',
        count: e.count,
        edgeType: e.type || 'international',
      });
    }
  }

  upstream.sort((a, b) => b.count - a.count);
  downstream.sort((a, b) => b.count - a.count);

  return { upstream, downstream };
}

/**
 * Build the detail panel HTML for a node.
 */
function buildDetailPanel(n) {
  const regFlag = n.country ? countryToFlag(n.country) : '';
  const geoFlag = n.geo_country ? countryToFlag(n.geo_country) : '';
  const geoKnown = n.geo_country && n.geo_country !== '';
  const geoDiffers = geoKnown && n.geo_country !== n.country;

  const { upstream, downstream } = getConnections(n.asn);

  const typeExplanation = TYPE_EXPLANATIONS[n.type] || '';
  const typeLabel = TYPE_LABELS[n.type] || n.type;
  const typeCls = TYPE_CLASSES[n.type] || '';

  // Build connections HTML
  function connectionRows(list, label) {
    if (list.length === 0) return `<div class="detail-empty">No ${label.toLowerCase()} connections found in dataset.</div>`;
    const maxShow = 10;
    const shown = list.slice(0, maxShow);
    let html = '<table class="detail-connections-table"><thead><tr><th>ASN</th><th>Name</th><th>Country</th><th>Type</th><th>Routes</th></tr></thead><tbody>';
    for (const c of shown) {
      const cf = c.country ? countryToFlag(c.country) + ' ' : '';
      html += `<tr>
        <td>AS${c.asn}</td>
        <td>${cf}${c.name}</td>
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
          <div class="detail-section-title">IP Address Distribution</div>`;
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
          <div class="detail-section-title">BGP Peering Location</div>
          <div class="detail-row">
            <span class="detail-label">Physical Peering:</span>
            <span class="detail-value">${peeringFlag} ${n.peering_country}</span>
          </div>`;
    if (n.peering_details && n.peering_details.length > 0) {
      peeringHtml += `
          <div class="detail-explanation">Peers at: ${n.peering_details.join(', ')}</div>`;
    }
    if (n.peering_source) {
      const sourceLabel = n.peering_source === 'peeringdb' ? 'PeeringDB'
        : n.peering_source === 'peeringdb-upstream' ? 'PeeringDB (via upstream)'
        : 'Inferred from geolocation';
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
        <div class="detail-title">${regFlag} ${n.name || `AS${n.asn}`}</div>
        <button class="detail-close" title="Close">&times;</button>
      </div>

      <div class="detail-grid">
        <div class="detail-section">
          <div class="detail-section-title">Identity</div>
          <div class="detail-row"><span class="detail-label">ASN:</span><span class="detail-value">AS${n.asn}</span></div>
          <div class="detail-row"><span class="detail-label">Name:</span><span class="detail-value">${n.name || '-'}</span></div>
          ${n.description && n.description !== n.name ? `<div class="detail-row"><span class="detail-label">Organization:</span><span class="detail-value">${n.description}</span></div>` : ''}
          ${n.country ? `<div class="detail-row"><span class="detail-label">Registered In:</span><span class="detail-value">${regFlag} ${n.country}</span></div>` : ''}
          ${geoKnown && !(n.geo_breakdown && n.geo_breakdown.length > 0) ? `<div class="detail-row"><span class="detail-label">IP Geolocation:</span><span class="detail-value${geoDiffers ? ' detail-warning' : ''}">${geoFlag} ${n.geo_country}${geoDiffers ? ' (differs from registration!)' : ''}</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Announced:</span><span class="detail-value">${n.announced ? 'Yes' : 'No'}</span></div>
          <div class="detail-row"><span class="detail-label">RIPEstat:</span><span class="detail-value"><a href="https://stat.ripe.net/AS${n.asn}" target="_blank" rel="noopener">View on RIPEstat</a></span></div>
        </div>

        ${geoBreakdownHtml}
        ${peeringHtml}

        <div class="detail-section">
          <div class="detail-section-title">Classification</div>
          <div class="detail-row"><span class="detail-label">Type:</span><span class="detail-value"><span class="type-badge ${typeCls}">${typeLabel}</span></span></div>
          ${n.licensed ? '<div class="detail-row"><span class="detail-label">License:</span><span class="detail-value detail-licensed">BTRC Licensed IIG</span></div>' : '<div class="detail-row"><span class="detail-label">License:</span><span class="detail-value">Not in my datasets BTRC list</span></div>'}
          ${typeExplanation ? `<div class="detail-explanation">${typeExplanation}</div>` : ''}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Traffic Statistics</div>
          <div class="detail-row"><span class="detail-label">Total Routes:</span><span class="detail-value">${(n.traffic || 0).toLocaleString()}</span></div>
          ${n.rank ? `<div class="detail-row"><span class="detail-label">Rank:</span><span class="detail-value">#${n.rank} in category</span></div>` : ''}
          <div class="detail-row"><span class="detail-label">Route Share:</span><span class="detail-value">${(n.percentage || 0).toFixed(2)}%</span></div>
        </div>
      </div>

      <div class="detail-connections">
        <div class="detail-section">
          <div class="detail-section-title">Upstream Peers (${upstream.length})</div>
          <div class="detail-section-subtitle">ASNs that send routes to this network</div>
          ${connectionRows(upstream, 'Upstream')}
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Downstream Customers (${downstream.length})</div>
          <div class="detail-section-subtitle">ASNs that receive routes from this network</div>
          ${connectionRows(downstream, 'Downstream')}
        </div>
      </div>
    </div>
  `;
}

function renderNodesTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  const footer = document.getElementById('table-footer');

  const columns = [
    { key: 'rank', label: 'Rank', numeric: true },
    { key: 'asn', label: 'ASN', numeric: false },
    { key: 'name', label: 'Company', numeric: false },
    { key: 'country', label: 'Registered', numeric: false },
    { key: 'geo_country', label: 'IP Location', numeric: false },
    { key: 'peering_country', label: 'Peering At', numeric: false },
    { key: 'type', label: 'Type', numeric: false },
    { key: 'traffic', label: 'Routes', numeric: true },
    { key: 'percentage', label: 'Share %', numeric: true },
  ];

  thead.innerHTML = '<tr>' + columns.map(c => {
    const arrow = currentSort.column === c.key ? (currentSort.asc ? ' &#9650;' : ' &#9660;') : '';
    return `<th data-col="${c.key}" class="sortable">${c.label}${arrow}</th>`;
  }).join('') + '</tr>';

  thead.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (currentSort.column === col) currentSort.asc = !currentSort.asc;
      else { currentSort.column = col; currentSort.asc = false; }
      currentPage = 0;
      renderTable();
    });
  });

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
      <td>AS${n.asn}</td>
      <td>${regFlag} ${n.name || '-'}${licenseBadge}</td>
      <td>${regFlag} ${n.country || '-'}</td>
      <td class="${geoClass}">${geoDisplay}</td>
      <td>${peerDisplay}</td>
      <td><span class="type-badge ${TYPE_CLASSES[n.type] || ''}">${TYPE_LABELS[n.type] || n.type}</span></td>
      <td class="num">${(n.traffic || 0).toLocaleString()}</td>
      <td class="num">${(n.percentage || 0).toFixed(2)}%</td>
    </tr>`;

    // Insert detail panel row if this ASN is expanded
    if (isExpanded) {
      tbodyHtml += `<tr class="detail-row"><td colspan="${columns.length}">${buildDetailPanel(n)}</td></tr>`;
    }
  }
  tbody.innerHTML = tbodyHtml;

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
      }
      renderTable();
    });
  });

  // Close button handlers (delegated)
  tbody.querySelectorAll('.detail-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      expandedASN = null;
      renderTable();
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

  document.getElementById('page-prev')?.addEventListener('click', () => { if (currentPage > 0) { currentPage--; renderTable(); } });
  document.getElementById('page-next')?.addEventListener('click', () => { if (currentPage < totalPages - 1) { currentPage++; renderTable(); } });
}

function renderEdgesTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  const footer = document.getElementById('table-footer');

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const columns = [
    { key: 'source', label: 'Source ASN', numeric: false },
    { key: 'source_name', label: 'Source Name', numeric: false },
    { key: 'target', label: 'Target ASN', numeric: false },
    { key: 'target_name', label: 'Target Name', numeric: false },
    { key: 'edge_type', label: 'Type', numeric: false },
    { key: 'count', label: 'Route Count', numeric: true },
  ];

  thead.innerHTML = '<tr>' + columns.map(c => {
    const arrow = currentSort.column === c.key ? (currentSort.asc ? ' &#9650;' : ' &#9660;') : '';
    return `<th data-col="${c.key}" class="sortable">${c.label}${arrow}</th>`;
  }).join('') + '</tr>';

  thead.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (currentSort.column === col) currentSort.asc = !currentSort.asc;
      else { currentSort.column = col; currentSort.asc = false; }
      currentPage = 0;
      renderTable();
    });
  });

  const minTraffic = currentOptions.minTraffic !== undefined ? currentOptions.minTraffic : 100;
  const maxTraffic = currentOptions.maxTraffic !== undefined ? currentOptions.maxTraffic : Infinity;
  let rows = currentData.edges
    .filter(e => e.count >= minTraffic && e.count <= maxTraffic)
    .map(e => {
      const src = e.source?.asn || e.source;
      const tgt = e.target?.asn || e.target;
      return {
        source: src, target: tgt, count: e.count,
        source_name: nodeMap[src]?.name || '',
        target_name: nodeMap[tgt]?.name || '',
        edge_type: e.type || 'international',
        source_country: nodeMap[src]?.country || '',
        target_country: nodeMap[tgt]?.country || '',
      };
    });

  if (searchQuery) {
    // Normalize search: strip "AS" prefix if present
    const normalizedQuery = searchQuery.replace(/^as/i, '');
    
    rows = rows.filter(r =>
      r.source.includes(normalizedQuery) || r.target.includes(normalizedQuery) ||
      r.source_name.toLowerCase().includes(searchQuery) || r.target_name.toLowerCase().includes(searchQuery) ||
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
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  tbody.innerHTML = pageRows.map(r => {
    const sf = r.source_country ? countryToFlag(r.source_country) + ' ' : '';
    const tf = r.target_country ? countryToFlag(r.target_country) + ' ' : '';
    const typeCls = r.edge_type === 'domestic' ? 'type-local-company' : 'type-outside';
    return `<tr>
      <td>${sf}AS${r.source}</td>
      <td>${sf}${r.source_name || '-'}</td>
      <td>${tf}AS${r.target}</td>
      <td>${tf}${r.target_name || '-'}</td>
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

  document.getElementById('page-prev')?.addEventListener('click', () => { if (currentPage > 0) { currentPage--; renderTable(); } });
  document.getElementById('page-next')?.addEventListener('click', () => { if (currentPage < totalPages - 1) { currentPage++; renderTable(); } });
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  // Expand the detail panel for this ASN and filter to show it
  searchQuery = asn;
  expandedASN = asn;
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
  activeTypeFilters = activeTypes;
  currentPage = 0;
  render();
}
