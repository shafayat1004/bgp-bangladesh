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

/**
 * Create a fresh analysis accumulator for incremental route processing.
 * @returns {Object} Empty analysis state
 */
export function createAnalysisState() {
  return {
    seen: new Set(),
    outsideCounts: new Map(),
    iigCounts: new Map(),
    localISPCounts: new Map(),
    edgeIntl: new Map(),
    edgeDomestic: new Map(),
    directPeers: new Map(),
    validObservations: 0,
  };
}

/**
 * Process a batch of routes into an existing analysis state (incremental).
 * Can be called multiple times as batches arrive from the API.
 *
 * @param {Array} routes - Batch of raw BGP route objects from RIPEstat
 * @param {Set} countryASNs - Set of ASN strings belonging to the country
 * @param {Object} state - Analysis state from createAnalysisState() or a previous call
 * @returns {Object} The same state object, mutated with new data
 */
/**
 * Private-use, documentation and reserved ASNs: no registry record, owned by nobody.
 * @param {string} asn
 * @returns {boolean}
 */
export function isReservedASN(asn) {
  const n = Number(asn);
  return n === 0 || n === 23456 || (n >= 64496 && n <= 131071) || n >= 4200000000;
}

export function analyzeRoutesBatch(routes, countryASNs, state) {
  const { seen, outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, directPeers } = state;

  for (let idx = 0; idx < routes.length; idx++) {
    const rt = routes[idx];
    const target = rt.target_prefix;
    const sourceId = rt.source_id;
    const pathRaw = rt.path || [];

    // Skip private-use and reserved ASNs: they leak from someone's internal
    // routing (e.g. between a gateway and its customer) and belong to nobody.
    const path = [];
    for (const x of pathRaw) {
      const s = String(x).trim();
      if (!/^\d+$/.test(s) || (isReservedASN(s) && !countryASNs.has(s))) continue;
      if (path.length === 0 || path[path.length - 1] !== s) path.push(s);
    }

    if (!target || !sourceId || path.length < 2) continue;

    const key = `${target}|${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.validObservations++;

    for (let pi = 0; pi < path.length - 1; pi++) {
      const a = path[pi], b = path[pi + 1];
      if (countryASNs.has(a) || countryASNs.has(b)) {
        const dpKey = `${a}|${b}`;
        directPeers.set(dpKey, (directPeers.get(dpKey) || 0) + 1);
      }
    }

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

      if (origin !== iig && countryASNs.has(origin)) {
        localISPCounts.set(origin, (localISPCounts.get(origin) || 0) + 1);
        const domKey = `${origin}|${iig}`;
        edgeDomestic.set(domKey, (edgeDomestic.get(domKey) || 0) + 1);
      } else if (origin === iig) {
        localISPCounts.set(origin, (localISPCounts.get(origin) || 0) + 1);
      }
    }
  }

  return state;
}

/**
 * Finalize an analysis state into the result format expected by buildVisualizationData().
 * Builds the directPeersMap and converts internal Sets to Arrays.
 *
 * @param {Object} state - Accumulated analysis state
 * @param {Set} countryASNs - Set of ASN strings belonging to the country
 * @returns {{ outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, directPeersMap, validObservations }}
 */
export function finalizeAnalysis(state, countryASNs) {
  const { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, directPeers, validObservations } = state;

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
  const directPeersMapArray = {};
  for (const [asn, peers] of Object.entries(directPeersMap)) {
    directPeersMapArray[asn] = [...peers];
  }

  // Free the large seen set to reclaim memory
  state.seen.clear();

  return { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, directPeersMap: directPeersMapArray, validObservations };
}

/**
 * Analyze BGP routes to find border crossings and domestic peering.
 * Convenience wrapper that processes all routes at once (non-incremental).
 *
 * @param {Array} routes - Raw BGP route objects from RIPEstat
 * @param {Set} countryASNs - Set of ASN strings belonging to the country
 * @param {Function} onProgress - Progress callback
 * @returns {{ outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, validObservations }}
 */
export function analyzeGateways(routes, countryASNs, onProgress) {
  const state = createAnalysisState();

  // Process in chunks of 50k to allow progress updates
  const chunkSize = 50000;
  const total = routes.length;
  for (let start = 0; start < total; start += chunkSize) {
    const chunk = routes.slice(start, Math.min(start + chunkSize, total));
    analyzeRoutesBatch(chunk, countryASNs, state);

    if (onProgress) {
      const done = Math.min(start + chunkSize, total);
      onProgress({
        step: 4, totalSteps: 5,
        message: `Processing routes (${done.toLocaleString()}/${total.toLocaleString()})…`,
        progress: done / total,
      });
    }
  }

  return finalizeAnalysis(state, countryASNs);
}

/**
 * Classify a tentative IIG ASN into its final node type.
 *
 * @param {Object} args
 * @param {string} args.asn
 * @param {boolean} args.isBDRegistered
 * @param {string} args.geoCountry
 * @param {Set<string>} args.btrcLicensedASNs
 * @param {Set<string>} args.iigsWithDomestic
 * @returns {'iig'|'detected-iig'|'offshore-enterprise'|'offshore-gateway'|'local-company'}
 *
 * A gateway is a network other BD networks reach the world through. A BD
 * network that connects abroad directly but carries no other BD network stays
 * a local company; buildVisualizationData records that in abroad_link.
 */
export function classifyTentativeIIGType({ asn, isBDRegistered, geoCountry, btrcLicensedASNs, iigsWithDomestic }) {
  if (btrcLicensedASNs.has(asn)) return 'iig';
  if (isBDRegistered && geoCountry && geoCountry !== 'BD') {
    return iigsWithDomestic.has(asn) ? 'offshore-gateway' : 'offshore-enterprise';
  }
  if (iigsWithDomestic.has(asn)) return 'detected-iig';
  return 'local-company';
}

/**
 * Set each node's percentage: its routes crossing the border, as a share of all.
 * A route counts on the international network and gateway at the crossing
 * (international connections) and on the local network it starts from
 * (domestic connections it is the source of), so shares within one category
 * add up to at most 100%. Also corrects history snapshots written before this
 * rule, which added a gateway's domestic routes to its share.
 *
 * @param {{ nodes: Object[], edges: Object[] }} data
 * @returns {number} total routes crossing the border
 */
export function computeShares(data) {
  const id = (end) => end?.asn || end;
  const routes = new Map();
  const add = (asn, count) => routes.set(asn, (routes.get(asn) || 0) + count);
  let total = 0;
  for (const e of data.edges) {
    const count = e.count || 0;
    if (e.type === 'domestic') {
      add(id(e.source), count);
    } else {
      total += count;
      add(id(e.source), count);
      add(id(e.target), count);
    }
  }
  const denom = total || 1;
  for (const n of data.nodes) n.percentage = ((routes.get(n.asn) || 0) / denom) * 100;
  return total;
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
 * @param {Set} igwLicensedASNs - Set of ASN strings from the BTRC IGW (voice gateway) list
 * @returns {{ nodes, edges, stats }}
 */
export function buildVisualizationData(analysis, asnInfo, countryASNs, topIntlEdges = 1500, topDomesticEdges = 2000, btrcLicensedASNs = new Set(), igwLicensedASNs = new Set()) {
  const { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, validObservations } = analysis;

  // Sort and take top N edges per type (separate limits for intl and domestic)
  const sortedIntl = [...edgeIntl.entries()].sort((a, b) => b[1] - a[1]).slice(0, topIntlEdges);
  const sortedDomestic = [...edgeDomestic.entries()].sort((a, b) => b[1] - a[1]).slice(0, topDomesticEdges);

  // Which tentative gateways carry other BD networks. Use every domestic
  // connection, not just the drawn ones: a gateway's customers can all be
  // below the drawing cut-off.
  const iigsWithDomestic = new Set();
  for (const edgeKey of edgeDomestic.keys()) {
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

      // A licensed gateway stays one even when it is only seen reaching the
      // world through a sister network (BTCL AS45588 via AS17494).
      if (btrcLicensedASNs.has(asn)) {
        type = 'iig';
      } else if (type === 'iig') {
        // Reclassify tentative IIGs based on license list + geolocation
        type = classifyTentativeIIGType({
          asn,
          isBDRegistered,
          geoCountry,
          btrcLicensedASNs,
          iigsWithDomestic,
        });
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
        igw: igwLicensedASNs.has(asn),
        abroad_link: '',
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

  // A local company with its own link abroad: seen right behind a network
  // abroad, either as well as through gateways or only that way. (Routes over
  // local exchanges such as BDIX aren't visible to the route collectors.)
  const viaGateway = new Set([...edgeDomestic.keys()].map(k => k.split('|')[0]));
  for (const edge of edges) {
    const n = nodeMap[edge.target];
    if (edge.type === 'international' && n.type === 'local-company') {
      n.abroad_link = viaGateway.has(n.asn) ? 'also-abroad' : 'only-abroad';
    }
  }

  const nodes = Object.values(nodeMap);
  const totalIntlTraffic = computeShares({ nodes, edges }) || 1;

  // Calculate rankings per type
  for (const ntype of ['outside', 'iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway', 'local-company']) {
    const typed = nodes
      .filter(n => n.type === ntype)
      .sort((a, b) => b.traffic - a.traffic);
    typed.forEach((n, i) => {
      n.rank = i + 1;
    });
  }

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
