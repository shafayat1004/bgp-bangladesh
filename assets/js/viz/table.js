/**
 * Interactive Data Table - 3-layer model with country flags
 */

import { countryToFlag } from '../api/ripestat.js';

const TYPE_LABELS = { 'outside': 'Outside BD', 'iig': 'IIG', 'local-isp': 'Local ISP', 'inside': 'Inside BD' };
const TYPE_CLASSES = { 'outside': 'type-outside', 'iig': 'type-iig', 'local-isp': 'type-local-isp', 'inside': 'type-iig' };

let currentData = null;
let currentOptions = {};
let currentSort = { column: 'traffic', asc: false };
let searchQuery = '';
let currentPage = 0;
let pageSize = 50;
let showEdges = false;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<div id="table-container"></div>';
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  currentPage = 0;
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

function renderNodesTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  const footer = document.getElementById('table-footer');

  const columns = [
    { key: 'rank', label: 'Rank', numeric: true },
    { key: 'asn', label: 'ASN', numeric: false },
    { key: 'name', label: 'Company', numeric: false },
    { key: 'country', label: 'Country', numeric: false },
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

  const minTraffic = currentOptions.minTraffic || 0;
  let rows = currentData.nodes.filter(n => n.traffic >= minTraffic);
  
  if (searchQuery) {
    rows = rows.filter(n =>
      n.asn.includes(searchQuery) ||
      (n.name || '').toLowerCase().includes(searchQuery) ||
      (n.description || '').toLowerCase().includes(searchQuery) ||
      (n.country || '').toLowerCase().includes(searchQuery) ||
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

  tbody.innerHTML = pageRows.map(n => {
    const flag = n.country ? countryToFlag(n.country) : '';
    return `<tr data-asn="${n.asn}">
      <td>${n.rank || '-'}</td>
      <td>AS${n.asn}</td>
      <td>${flag} ${n.name || '-'}</td>
      <td>${flag} ${n.country || '-'}</td>
      <td><span class="type-badge ${TYPE_CLASSES[n.type] || ''}">${TYPE_LABELS[n.type] || n.type}</span></td>
      <td class="num">${(n.traffic || 0).toLocaleString()}</td>
      <td class="num">${(n.percentage || 0).toFixed(2)}%</td>
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

  const minTraffic = currentOptions.minTraffic || 0;
  let rows = currentData.edges
    .filter(e => e.count >= minTraffic)
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
    rows = rows.filter(r =>
      r.source.includes(searchQuery) || r.target.includes(searchQuery) ||
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
    const typeCls = r.edge_type === 'domestic' ? 'type-local-isp' : 'type-outside';
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
  // Set search query to the ASN and re-render to filter the table
  searchQuery = asn;
  currentPage = 0;
  const searchEl = document.getElementById('table-search');
  if (searchEl) searchEl.value = asn;
  render();
}
export function updateFilter(val) { 
  currentOptions.minTraffic = val; 
  render(); 
}
