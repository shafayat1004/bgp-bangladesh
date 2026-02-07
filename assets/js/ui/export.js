/**
 * Export Module
 * Handles CSV and JSON data downloads.
 */

/**
 * Trigger a browser file download from a string.
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Export nodes as CSV
 */
export function exportNodesCSV(data) {
  const BOM = '\uFEFF';
  const typeOrder = { 'iig': 0, 'detected-iig': 1, 'offshore-peer': 2, 'local-isp': 3, 'inside': 0, 'outside': 4 };
  const header = 'rank,asn,name,type,licensed,country,traffic,percentage,description';
  const rows = data.nodes
    .sort((a, b) => {
      const ta = typeOrder[a.type] ?? 9;
      const tb = typeOrder[b.type] ?? 9;
      if (ta !== tb) return ta - tb;
      return b.traffic - a.traffic;
    })
    .map(n => {
      const name = (n.name || '').replace(/"/g, '""');
      const desc = (n.description || '').replace(/"/g, '""');
      return `${n.rank || ''},${n.asn},"${name}",${n.type},${n.licensed ? 'yes' : 'no'},${n.country || ''},${n.traffic},${(n.percentage || 0).toFixed(2)},"${desc}"`;
    });

  const csv = BOM + header + '\n' + rows.join('\n');
  downloadFile(csv, `bgp_bd_nodes_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
}

/**
 * Export edges as CSV
 */
export function exportEdgesCSV(data) {
  const BOM = '\uFEFF';

  // Build a name lookup
  const nameMap = {};
  for (const n of data.nodes) {
    nameMap[n.asn] = n.name || `AS${n.asn}`;
  }

  const header = 'source_asn,source_name,target_asn,target_name,edge_type,route_count';
  const rows = data.edges
    .sort((a, b) => b.count - a.count)
    .map(e => {
      const src = e.source?.asn || e.source;
      const tgt = e.target?.asn || e.target;
      const sn = (nameMap[src] || '').replace(/"/g, '""');
      const tn = (nameMap[tgt] || '').replace(/"/g, '""');
      return `${src},"${sn}",${tgt},"${tn}",${e.type || 'international'},${e.count}`;
    });

  const csv = BOM + header + '\n' + rows.join('\n');
  downloadFile(csv, `bgp_bd_edges_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
}

/**
 * Export full dataset as JSON (viz_data.json format)
 */
export function exportJSON(data) {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `bgp_bd_data_${dateStamp()}.json`, 'application/json');
}

/**
 * Export raw BGP routes as JSON (unprocessed route data from RIPEstat)
 */
export function exportRawRoutes(routes) {
  const data = {
    timestamp: new Date().toISOString(),
    source: 'RIPEstat BGP State API',
    route_count: routes.length,
    routes: routes
  };
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `bgp_bd_raw_routes_${dateStamp()}.json`, 'application/json');
}
