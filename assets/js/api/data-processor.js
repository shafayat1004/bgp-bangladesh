/**
 * Data Processor
 * Converts raw BGP routes into visualization-ready format with license-aware classification:
 *   - Local ISPs (origin ASNs within the country)
 *   - IIGs (BTRC-licensed border gateway ASNs)
 *   - Detected Gateways (acting as gateway but not in known IIG list)
 *   - Offshore Peers (BD-registered ASNs with infrastructure abroad)
 *   - Outside ASNs (international feeders)
 */

import { countryToFlag } from './ripestat.js';

/**
 * Analyze BGP routes to find border crossings and domestic peering.
 *
 * @param {Array} routes - Raw BGP route objects from RIPEstat
 * @param {Set} countryASNs - Set of ASN strings belonging to the country
 * @param {Function} onProgress - Progress callback
 * @returns {{ outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, validObservations }}
 */
export function analyzeGateways(routes, countryASNs, onProgress) {
  const seen = new Set();
  const outsideCounts = new Map();
  const iigCounts = new Map();
  const localISPCounts = new Map();
  const edgeIntl = new Map();      // "outside|iig" → count
  const edgeDomestic = new Map();  // "local-isp|iig" → count

  let validObservations = 0;
  const total = routes.length;

  for (let idx = 0; idx < routes.length; idx++) {
    const rt = routes[idx];
    const target = rt.target_prefix;
    const sourceId = rt.source_id;
    const pathRaw = rt.path || [];

    // Clean path: deduplicate consecutive ASNs (AS prepending), convert to string
    const path = [];
    for (const x of pathRaw) {
      const s = String(x).trim();
      if (/^\d+$/.test(s) && (path.length === 0 || path[path.length - 1] !== s)) {
        path.push(s);
      }
    }

    if (!target || !sourceId || path.length < 2) continue;

    const key = `${target}|${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    validObservations++;

    // Walk backwards from origin
    let i = path.length - 1;
    while (i >= 0 && countryASNs.has(path[i])) {
      i--;
    }

    const outside = i >= 0 ? path[i] : null;
    const iig = (i + 1) < path.length ? path[i + 1] : null;
    const origin = path[path.length - 1];

    if (outside && iig) {
      outsideCounts.set(outside, (outsideCounts.get(outside) || 0) + 1);
      iigCounts.set(iig, (iigCounts.get(iig) || 0) + 1);
      const intlKey = `${outside}|${iig}`;
      edgeIntl.set(intlKey, (edgeIntl.get(intlKey) || 0) + 1);

      // Domestic edge: origin → IIG
      if (origin !== iig && countryASNs.has(origin)) {
        localISPCounts.set(origin, (localISPCounts.get(origin) || 0) + 1);
        const domKey = `${origin}|${iig}`;
        edgeDomestic.set(domKey, (edgeDomestic.get(domKey) || 0) + 1);
      } else if (origin === iig) {
        localISPCounts.set(origin, (localISPCounts.get(origin) || 0) + 1);
      }
    }

    if (onProgress && idx % 10000 === 0) {
      onProgress({
        step: 4, totalSteps: 4,
        message: `Processing routes (${idx.toLocaleString()}/${total.toLocaleString()})...`,
        progress: idx / total,
      });
    }
  }

  return { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, validObservations };
}

/**
 * Build visualization data with license-aware classification.
 *
 * @param {Object} analysis - Result from analyzeGateways()
 * @param {Object} asnInfo - ASN → { name, holder, announced, country }
 * @param {Set} countryASNs - Set of country ASNs
 * @param {number} topEdges - Number of top edges per type to include
 * @param {Set} btrcLicensedASNs - Set of ASN strings from the BTRC IIG license list
 * @returns {{ nodes, edges, stats }}
 */
export function buildVisualizationData(analysis, asnInfo, countryASNs, topEdges = 1000, btrcLicensedASNs = new Set()) {
  const { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, validObservations } = analysis;

  // Sort and take top N edges per type
  const sortedIntl = [...edgeIntl.entries()].sort((a, b) => b[1] - a[1]).slice(0, topEdges);
  const sortedDomestic = [...edgeDomestic.entries()].sort((a, b) => b[1] - a[1]).slice(0, topEdges);

  // Pre-compute which tentative IIGs have domestic customers
  const iigsWithDomestic = new Set();
  for (const [edgeKey] of sortedDomestic) {
    iigsWithDomestic.add(edgeKey.split('|')[1]);
  }

  const nodeMap = {};
  const edges = [];

  function ensureNode(asn, type) {
    if (!nodeMap[asn]) {
      const info = asnInfo[asn] || {};
      const detectedCountry = info.country || '';
      const isBDRegistered = countryASNs.has(asn);
      const country = detectedCountry || (isBDRegistered ? 'BD' : '');

      // Reclassify tentative IIGs based on license list
      if (type === 'iig') {
        if (btrcLicensedASNs.has(asn)) {
          type = 'iig'; // Confirmed: in BTRC license list
        } else if (isBDRegistered && detectedCountry && detectedCountry !== 'BD') {
          type = 'offshore-peer'; // BD-registered but located abroad
        } else if (iigsWithDomestic.has(asn)) {
          type = 'detected-iig'; // Acting as gateway, not in known IIG list
        } else {
          type = 'local-isp'; // No domestic customers, demote
        }
      }

      nodeMap[asn] = {
        asn,
        type,
        licensed: btrcLicensedASNs.has(asn),
        name: info.name || info.holder || `AS${asn}`,
        description: info.holder || info.name || '',
        country,
        announced: info.announced || false,
        traffic: 0,
      };
    }
  }

  // International edges: outside → iig
  for (const [edgeKey, count] of sortedIntl) {
    const [source, target] = edgeKey.split('|');
    ensureNode(source, 'outside');
    ensureNode(target, 'iig');
    edges.push({ source, target, count, type: 'international' });
  }

  // Domestic edges: local-isp → iig
  for (const [edgeKey, count] of sortedDomestic) {
    const [source, target] = edgeKey.split('|');
    ensureNode(source, 'local-isp');
    ensureNode(target, 'iig');
    edges.push({ source, target, count, type: 'domestic' });
  }

  // Calculate traffic per node from included edges
  for (const edge of edges) {
    if (nodeMap[edge.source]) nodeMap[edge.source].traffic += edge.count;
    if (nodeMap[edge.target]) nodeMap[edge.target].traffic += edge.count;
  }

  // Calculate rankings per type
  const totalIntlTraffic = sortedIntl.reduce((s, [, c]) => s + c, 0) || 1;

  for (const ntype of ['outside', 'iig', 'detected-iig', 'offshore-peer', 'local-isp']) {
    const typed = Object.values(nodeMap)
      .filter(n => n.type === ntype)
      .sort((a, b) => b.traffic - a.traffic);
    typed.forEach((n, i) => {
      n.rank = i + 1;
      n.percentage = (n.traffic / totalIntlTraffic) * 100;
    });
  }

  const nodes = Object.values(nodeMap);

  return {
    nodes,
    edges,
    stats: {
      total_outside: nodes.filter(n => n.type === 'outside').length,
      total_iig: nodes.filter(n => n.type === 'iig').length,
      total_detected_iig: nodes.filter(n => n.type === 'detected-iig').length,
      total_offshore_peer: nodes.filter(n => n.type === 'offshore-peer').length,
      total_local_isp: nodes.filter(n => n.type === 'local-isp').length,
      total_edges: edges.length,
      total_intl_edges: edges.filter(e => e.type === 'international').length,
      total_domestic_edges: edges.filter(e => e.type === 'domestic').length,
      total_traffic: totalIntlTraffic,
      valid_observations: validObservations,
    },
  };
}
