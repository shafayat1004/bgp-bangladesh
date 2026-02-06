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
  const header = 'rank,asn,name,type,traffic,percentage,description';
  const rows = data.nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'inside' ? -1 : 1;
      return b.traffic - a.traffic;
    })
    .map(n => {
      const name = (n.name || '').replace(/"/g, '""');
      const desc = (n.description || '').replace(/"/g, '""');
      return `${n.rank || ''},${n.asn},"${name}",${n.type},${n.traffic},${(n.percentage || 0).toFixed(2)},"${desc}"`;
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

  const header = 'source_asn,source_name,target_asn,target_name,route_count';
  const rows = data.edges
    .sort((a, b) => b.count - a.count)
    .map(e => {
      const sn = (nameMap[e.source] || '').replace(/"/g, '""');
      const tn = (nameMap[e.target] || '').replace(/"/g, '""');
      return `${e.source},"${sn}",${e.target},"${tn}",${e.count}`;
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
