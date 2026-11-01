/**
 * Force Layout (shared)
 *
 * The network graph's force configuration, used both by the browser
 * (force-graph.js, with the global d3) and by scripts/precompute_layout.mjs
 * (with the d3-force package), so positions baked into the data match what the
 * browser would compute. Keep this module free of DOM access.
 */

// Bump when the forces below change so baked positions get recomputed.
export const LAYOUT_VERSION = 2;

// Coordinate space for baked positions; the browser fits it to the viewport.
export const LAYOUT_WIDTH = 3200;
export const LAYOUT_HEIGHT = 1000;

// The filter the baked layout is computed for (the UI's default view).
export const LAYOUT_MIN_TRAFFIC = 100;
export const LAYOUT_MAX_TRAFFIC = Infinity;

const asnOf = (end) => end?.asn || end;

/** Edges within the traffic range and the nodes they touch. */
export function selectGraph(data, minTraffic, maxTraffic) {
  const edges = data.edges.filter(e => e.count >= minTraffic && e.count <= maxTraffic);
  const used = new Set();
  edges.forEach(e => {
    used.add(asnOf(e.source));
    used.add(asnOf(e.target));
  });
  const nodes = data.nodes.filter(n => used.has(n.asn));
  return { nodes, edges };
}

/**
 * Where each category sits along the path traffic takes, as a fraction of the
 * width: local companies on the far left, gateways in the middle, the
 * international internet on the far right.
 */
export const FLOW_X = {
  'local-company': 0.08,
  'iig': 0.40,
  'detected-iig': 0.52,
  'offshore-enterprise': 0.68,
  'offshore-gateway': 0.76,
  'outside': 0.92,
};

const flowX = (type) => FLOW_X[type] ?? FLOW_X.outside;

/** Starting position for a node with no known position, inside its category's column. */
export function bandPosition(type, width, height, random = Math.random) {
  const jitter = (spread) => (random() - 0.5) * spread;
  return [width * flowX(type) + jitter(width * 0.05), height / 2 + jitter(height * 0.8)];
}

/** A simulation with the graph's decay settings but no forces yet. */
export function createSimulation(d3) {
  return d3.forceSimulation()
    .velocityDecay(0.55)
    .alphaDecay(0.02);
}

/** (Re)apply every force for a given coordinate space and node count. */
export function configureForces(d3, simulation, { width, height, nodeCount }) {
  simulation
    // Weak links: they should hint at connections, not drag the columns together.
    .force('link', d3.forceLink().id(d => d.asn).distance(180).strength(0.02))
    .force('charge', d3.forceManyBody()
      .strength(Math.max(-600, -350 - nodeCount * 2.5))
      .distanceMax(nodeCount > 500 ? 300 : 450))
    .force('collision', d3.forceCollide()
      .radius(d => Math.max(8, Math.sqrt(d.traffic / 100) * 2 + 5))
      .strength(nodeCount > 500 ? 0.5 : 0.9))
    // Strong pull to the category's column keeps the left-to-right flow readable.
    .force('x', d3.forceX(d => width * flowX(d.type)).strength(0.6))
    .force('y', d3.forceY(height / 2).strength(0.1));
  return simulation;
}

/** True when the data carries baked positions for this traffic filter. */
export function hasBakedLayout(data, minTraffic, maxTraffic) {
  const layout = data?.layout;
  if (!layout || layout.version !== LAYOUT_VERSION || !layout.positions) return false;
  const bakedMax = layout.maxTraffic === null ? Infinity : layout.maxTraffic;
  return layout.minTraffic === minTraffic && bakedMax === maxTraffic;
}

/**
 * Copy baked positions (data.layout.positions, keyed by ASN) onto nodes.
 * Returns the number of nodes positioned.
 */
export function applyBakedPositions(layout, nodes) {
  const positions = layout?.positions || {};
  let applied = 0;
  for (const n of nodes) {
    const p = positions[n.asn];
    if (!p) continue;
    n.x = p[0];
    n.y = p[1];
    n.vx = 0;
    n.vy = 0;
    applied++;
  }
  return applied;
}
