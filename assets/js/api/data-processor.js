/**
 * Data Processor
 * Converts raw BGP routes into visualization-ready format with license-aware 6-category classification:
 *   - Local Companies (origin ASNs within the country)
 *   - IIGs (BTRC-licensed border gateway ASNs - https://github.com/shafayat1004/bgp-bangladesh/blob/main/docs/List%20of%20IIG%20Service%20Providers%20License.pdf)
 *   - Detected Gateways (acting as gateway but not in known IIG list - see above PDF for license source)
 *   - Offshore Enterprises (BD-registered, abroad, no downstream BD customers)
 *   - Offshore Gateways (BD-registered, abroad, has downstream BD customers)
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
  const edgeDomestic = new Map();  // "local-company|iig" → count
  const directPeers = new Map();   // "a|b" → count for direct adjacency

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

    // Track direct adjacency for BD ASNs
    for (let pi = 0; pi < path.length - 1; pi++) {
      const a = path[pi], b = path[pi + 1];
      if (countryASNs.has(a) || countryASNs.has(b)) {
        const dpKey = `${a}|${b}`;
        directPeers.set(dpKey, (directPeers.get(dpKey) || 0) + 1);
      }
    }

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
        step: 4, totalSteps: 5,
        message: `Processing routes (${idx.toLocaleString()}/${total.toLocaleString()})...`,
        progress: idx / total,
      });
    }
  }

  // Build direct peers map: for each BD ASN, list its non-BD upstream neighbors
  const directPeersMap = {};
  for (const [dpKey] of directPeers) {
    const [a, b] = dpKey.split('|');
    if (countryASNs.has(b) && !countryASNs.has(a)) {
      if (!directPeersMap[b]) directPeersMap[b] = new Set();
      directPeersMap[b].add(a);
    }
    if (countryASNs.has(a) && !countryASNs.has(b)) {
      if (!directPeersMap[a]) directPeersMap[a] = new Set();
      directPeersMap[a].add(b);
    }
  }
  // Convert sets to arrays
  const directPeersMapArray = {};
  for (const [asn, peers] of Object.entries(directPeersMap)) {
    directPeersMapArray[asn] = [...peers];
  }

  return { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, directPeersMap: directPeersMapArray, validObservations };
}

/**
 * Build visualization data with license-aware classification.
 *
 * @param {Object} analysis - Result from analyzeGateways()
 * @param {Object} asnInfo - ASN → { name, holder, announced, country }
 * @param {Set} countryASNs - Set of country ASNs
 * @param {number} topIntlEdges - Number of top international edges to include
 * @param {number} topDomesticEdges - Number of top domestic edges to include
 * @param {Set} btrcLicensedASNs - Set of ASN strings from the BTRC IIG license list
 * @returns {{ nodes, edges, stats }}
 */
export function buildVisualizationData(analysis, asnInfo, countryASNs, topIntlEdges = 1500, topDomesticEdges = 2000, btrcLicensedASNs = new Set()) {
  const { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, validObservations } = analysis;

  // Sort and take top N edges per type (separate limits for intl and domestic)
  const sortedIntl = [...edgeIntl.entries()].sort((a, b) => b[1] - a[1]).slice(0, topIntlEdges);
  const sortedDomestic = [...edgeDomestic.entries()].sort((a, b) => b[1] - a[1]).slice(0, topDomesticEdges);

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
      const geoCountry = info.geo_country || '';
      const detectedCountry = info.country || '';
      const isBDRegistered = countryASNs.has(asn);
      const country = detectedCountry || (isBDRegistered ? 'BD' : '');

      // Reclassify tentative IIGs based on license list + geolocation
      if (type === 'iig') {
        if (btrcLicensedASNs.has(asn)) {
          type = 'iig'; // Confirmed: in BTRC license list
        } else if (isBDRegistered && geoCountry && geoCountry !== 'BD') {
          // Offshore BD ASN - split by transit role
          if (iigsWithDomestic.has(asn)) {
            type = 'offshore-gateway'; // Abroad + selling transit (potential rogue)
          } else {
            type = 'offshore-enterprise'; // Abroad + no customers (harmless)
          }
        } else if (iigsWithDomestic.has(asn)) {
          type = 'detected-iig'; // Acting as gateway, not in known IIG list
        } else {
          type = 'local-company'; // No domestic customers, demote
        }
      }

      nodeMap[asn] = {
        asn,
        type,
        licensed: btrcLicensedASNs.has(asn),
        name: info.name || info.holder || `AS${asn}`,
        description: info.holder || info.name || '',
        country,
        geo_country: geoCountry,
        geo_breakdown: info.geo_breakdown || [],
        peering_country: info.peering_country || '',
        peering_details: info.peering_details || [],
        peering_source: info.peering_source || '',
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

  // Domestic edges: local-company → iig
  for (const [edgeKey, count] of sortedDomestic) {
    const [source, target] = edgeKey.split('|');
    ensureNode(source, 'local-company');
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

  for (const ntype of ['outside', 'iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway', 'local-company']) {
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
      total_offshore_enterprise: nodes.filter(n => n.type === 'offshore-enterprise').length,
      total_offshore_gateway: nodes.filter(n => n.type === 'offshore-gateway').length,
      total_local_company: nodes.filter(n => n.type === 'local-company').length,
      total_edges: edges.length,
      total_intl_edges: edges.filter(e => e.type === 'international').length,
      total_domestic_edges: edges.filter(e => e.type === 'domestic').length,
      total_traffic: totalIntlTraffic,
      valid_observations: validObservations,
    },
  };
}
