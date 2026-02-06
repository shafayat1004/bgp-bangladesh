/**
 * Data Processor
 * Converts raw BGP routes into visualization-ready format.
 * Ported from analyze_gateways() and create_interactive_viz.py
 */

/**
 * Analyze BGP routes to find border crossings.
 * Ported from analyze_gateways() in country_gateways_outside.py
 *
 * Walks each AS path backwards from origin to find the border crossing
 * between inside-country and outside-country ASNs.
 *
 * @param {Array} routes - Raw BGP route objects from RIPEstat
 * @param {Set} countryASNs - Set of ASN strings belonging to the country
 * @param {Function} onProgress - Progress callback
 * @returns {{ outsideCounts, insideCounts, edgeCounts, validObservations }}
 */
export function analyzeGateways(routes, countryASNs, onProgress) {
  const seen = new Set();
  const outsideCounts = new Map(); // ASN → count
  const insideCounts = new Map();  // ASN → count
  const edgeCounts = new Map();    // "outside|inside" → count

  let validObservations = 0;
  const total = routes.length;

  for (let idx = 0; idx < routes.length; idx++) {
    const rt = routes[idx];
    const target = rt.target_prefix;
    const sourceId = rt.source_id;
    const pathRaw = rt.path || [];

    // Clean path: keep only valid ASN strings
    const path = pathRaw.map(x => String(x).trim()).filter(x => /^\d+$/.test(x));

    if (!target || !sourceId || path.length < 2) continue;

    const key = `${target}|${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    validObservations++;

    // Walk backwards from origin (end of path)
    let i = path.length - 1;

    // Skip ASNs belonging to the country
    while (i >= 0 && countryASNs.has(path[i])) {
      i--;
    }

    // path[i] = last outside ASN, path[i+1] = first inside ASN
    const outside = i >= 0 ? path[i] : null;
    const inside = (i + 1) < path.length ? path[i + 1] : null;

    if (outside && inside) {
      outsideCounts.set(outside, (outsideCounts.get(outside) || 0) + 1);
      insideCounts.set(inside, (insideCounts.get(inside) || 0) + 1);
      const edgeKey = `${outside}|${inside}`;
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
    }

    // Progress callback every 10000 routes
    if (onProgress && idx % 10000 === 0) {
      onProgress({
        step: 4, totalSteps: 4,
        message: `Processing routes (${idx.toLocaleString()}/${total.toLocaleString()})...`,
        progress: idx / total,
      });
    }
  }

  return { outsideCounts, insideCounts, edgeCounts, validObservations };
}

/**
 * Build visualization data from gateway analysis results.
 * Ported from create_interactive_viz.py
 *
 * @param {Map} outsideCounts - Outside ASN → count
 * @param {Map} insideCounts - Inside ASN → count
 * @param {Map} edgeCounts - "outside|inside" → count
 * @param {Object} asnInfo - ASN → { name, holder, announced }
 * @param {number} topEdges - Number of top edges to include
 * @returns {{ nodes, edges, stats }}
 */
export function buildVisualizationData(outsideCounts, insideCounts, edgeCounts, asnInfo, topEdges = 300) {
  // Sort edges by count and take top N
  const sortedEdges = [...edgeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topEdges);

  // Build nodes and edges
  const nodeMap = {};
  const edges = [];

  for (const [edgeKey, count] of sortedEdges) {
    const [source, target] = edgeKey.split('|');
    edges.push({ source, target, count });

    if (!nodeMap[source]) {
      nodeMap[source] = { asn: source, type: 'outside', traffic: 0 };
    }
    if (!nodeMap[target]) {
      nodeMap[target] = { asn: target, type: 'inside', traffic: 0 };
    }
  }

  // Calculate traffic per node from edges (not global counts, so it matches what's shown)
  const insideTraffic = new Map();
  const outsideTraffic = new Map();
  for (const edge of edges) {
    insideTraffic.set(edge.target, (insideTraffic.get(edge.target) || 0) + edge.count);
    outsideTraffic.set(edge.source, (outsideTraffic.get(edge.source) || 0) + edge.count);
  }

  for (const [asn, total] of insideTraffic) {
    if (nodeMap[asn]) nodeMap[asn].traffic = total;
  }
  for (const [asn, total] of outsideTraffic) {
    if (nodeMap[asn]) nodeMap[asn].traffic = total;
  }

  // Add ASN info
  for (const [asn, node] of Object.entries(nodeMap)) {
    const info = asnInfo[asn];
    if (info) {
      node.name = info.name || `AS${asn}`;
      node.description = info.holder || info.name || '';
      node.announced = info.announced || false;
    } else {
      node.name = `AS${asn}`;
      node.description = '';
      node.announced = false;
    }
    node.country = '';
  }

  // Calculate rankings and percentages
  const totalInsideTraffic = [...insideTraffic.values()].reduce((a, b) => a + b, 0) || 1;

  const insideNodes = Object.values(nodeMap).filter(n => n.type === 'inside').sort((a, b) => b.traffic - a.traffic);
  const outsideNodes = Object.values(nodeMap).filter(n => n.type === 'outside').sort((a, b) => b.traffic - a.traffic);

  insideNodes.forEach((n, i) => {
    n.rank = i + 1;
    n.percentage = (n.traffic / totalInsideTraffic) * 100;
  });
  outsideNodes.forEach((n, i) => {
    n.rank = i + 1;
    n.percentage = (n.traffic / totalInsideTraffic) * 100;
  });

  const nodes = Object.values(nodeMap);

  return {
    nodes,
    edges,
    stats: {
      total_inside: insideNodes.length,
      total_outside: outsideNodes.length,
      total_edges: edges.length,
      total_traffic: totalInsideTraffic,
    },
  };
}
