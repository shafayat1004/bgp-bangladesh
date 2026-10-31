/**
 * Force-Directed Network Graph Visualization
 * Six network categories, coloured from assets/js/ui/colors.js.
 * Standard D3.js implementation.
 */

import { CATEGORY_LABELS } from '../ui/glossary.js';
import { countryToFlag, buildNodeTooltipHtml } from '../api/ripestat.js';
import { selectGraph, bandPosition, createSimulation, configureForces, hasBakedLayout, applyBakedPositions } from './force-layout.js';
import { makeChartAccessible } from '../ui/chart-a11y.js';
import { CATEGORY_COLORS, LINK_COLORS, INK, categoryColor } from '../ui/colors.js';


const TYPE_LABELS = CATEGORY_LABELS;

let svg, g, simulation, nodes, links, tooltip;
let showLabels = true;
let highlightedNode = null;
let currentNodeSize = 15;
let currentData = null;
let minTraffic = 100;
let maxTraffic = Infinity;
let renderedEdges = [];
let stopTimer = null;
let zoom = null;
let initialTransform = null;
let portrait = false;
let dragLinks = null;

// Space the edge legend takes at the bottom of the panel, kept clear when fitting.
const LEGEND_HEIGHT = 90;
const COMPACT_LEGEND_HEIGHT = 44;

const TYPE_LEGEND = [
  { color: CATEGORY_COLORS['local-company'], label: 'Local' },
  { color: CATEGORY_COLORS['iig'], label: 'IIG' },
  { color: CATEGORY_COLORS['detected-iig'], label: 'Detected' },
  { color: CATEGORY_COLORS['offshore-enterprise'], label: 'Offshore ent.' },
  { color: CATEGORY_COLORS['offshore-gateway'], label: 'Offshore gateway' },
  { color: CATEGORY_COLORS['outside'], label: 'International' },
];

// The layout flows left to right. On a portrait panel it is drawn transposed
// (flowing top to bottom) to use the screen's long side. sx/sy map a node's
// layout position to where it is drawn.
const sx = d => (portrait ? d.y : d.x);
const sy = d => (portrait ? d.x : d.y);

function linkPath(d) {
  const s = d.source;
  const t = d.target;
  if (!s || !t || isNaN(s.x) || isNaN(t.x)) return '';
  const dx = sx(t) - sx(s), dy = sy(t) - sy(s);
  const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
  return `M${sx(s)},${sy(s)}A${dr},${dr} 0 0,1 ${sx(t)},${sy(t)}`;
}

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<svg id="force-svg"></svg>';
  tooltip = d3.select('#tooltip');
}

export function loadData(data, options = {}) {
  currentData = data;
  minTraffic = options.minTraffic !== undefined ? options.minTraffic : 100;
  maxTraffic = options.maxTraffic !== undefined ? options.maxTraffic : Infinity;
  currentNodeSize = options.nodeSize || 15;
  showLabels = options.showLabels !== false;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  portrait = height > width;

  svg = d3.select('#force-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  g = svg.append('g');

  zoom = d3.zoom().scaleExtent([0.1, 5])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  svg.on('click', () => clearHighlight());

  const legendHeight = createLegend(width, height);

  simulation = createSimulation(d3);

  // Positions baked into the data by scripts/precompute_layout.mjs let the graph
  // appear settled without simulating.
  const baked = hasBakedLayout(data, minTraffic, maxTraffic);
  if (data.layout) applyBakedPositions(data.layout, data.nodes);
  render({ alpha: baked ? 0 : (data.layout ? 0.3 : 1) });

  initialTransform = baked
    ? fitTransform(simulation.nodes(), width, height - legendHeight)
    : d3.zoomIdentity.scale(0.6).translate(width * 0.33, height * 0.33);
  svg.call(zoom.transform, initialTransform);
}

/** Zoom transform that fits all nodes (with their radius) into the view. */
function fitTransform(nodeList, width, height) {
  if (!nodeList.length) return d3.zoomIdentity;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of nodeList) {
    const r = Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10));
    x0 = Math.min(x0, sx(d) - r); y0 = Math.min(y0, sy(d) - r);
    x1 = Math.max(x1, sx(d) + r); y1 = Math.max(y1, sy(d) + r);
  }
  const k = Math.min(5, Math.max(0.1, 0.95 * Math.min(width / (x1 - x0), height / (y1 - y0))));
  return d3.zoomIdentity
    .translate(width / 2 - k * (x0 + x1) / 2, height / 2 - k * (y0 + y1) / 2)
    .scale(k);
}

// Two-row legend for narrow panels (phones). Returns the height it takes.
function createCompactLegend(width, height) {
  const legend = svg.append('g')
    .attr('class', 'edge-legend')
    .attr('transform', `translate(8, ${height - COMPACT_LEGEND_HEIGHT})`);

  legend.append('rect')
    .attr('width', width - 16).attr('height', COMPACT_LEGEND_HEIGHT - 6)
    .attr('fill', INK.panel).attr('fill-opacity', 0.94)
    .attr('stroke', INK.line)
    .attr('rx', 4);

  const edgeTypes = [
    { label: 'International', stroke: LINK_COLORS.international, dash: 'none' },
    { label: 'Local', stroke: LINK_COLORS.domestic, dash: '4,2' },
  ];
  edgeTypes.forEach(({ label, stroke, dash }, i) => {
    const x = 8 + i * 120;
    legend.append('line').attr('x1', x).attr('y1', 12).attr('x2', x + 24).attr('y2', 12)
      .attr('stroke', stroke).attr('stroke-width', 2).attr('stroke-dasharray', dash);
    legend.append('text').attr('x', x + 29).attr('y', 15).attr('fill', INK.text).attr('font-size', '9px').text(label);
  });

  let x = 8;
  TYPE_LEGEND.forEach(({ color, label }) => {
    legend.append('circle').attr('cx', x + 4).attr('cy', 27).attr('r', 3.5).attr('fill', color).attr('stroke', INK.text).attr('stroke-width', 0.75);
    legend.append('text').attr('x', x + 10).attr('y', 30).attr('fill', INK.text).attr('font-size', '8px').text(label);
    x += label.length * 4.4 + 16;
  });
  return COMPACT_LEGEND_HEIGHT;
}

function createLegend(width, height) {
  if (width < 600) return createCompactLegend(width, height);
  const legend = svg.append('g')
    .attr('class', 'edge-legend')
    .attr('transform', `translate(20, ${height - 80})`);

  legend.append('rect')
    .attr('x', -10).attr('y', -10)
    .attr('width', 400).attr('height', 70)
    .attr('fill', INK.panel).attr('fill-opacity', 0.94)
    .attr('stroke', INK.line)
    .attr('rx', 4);

  legend.append('text')
    .attr('x', 0).attr('y', 0)
    .attr('fill', INK.muted)
    .attr('font-size', '11px')
    .attr('font-weight', 'bold')
    .text('Connections:');

  legend.append('line')
    .attr('x1', 0).attr('y1', 15)
    .attr('x2', 40).attr('y2', 15)
    .attr('stroke', LINK_COLORS.international)
    .attr('stroke-width', 2);
  legend.append('text')
    .attr('x', 45).attr('y', 19)
    .attr('fill', INK.text)
    .attr('font-size', '10px')
    .text('International (gateway to network abroad)');

  legend.append('line')
    .attr('x1', 0).attr('y1', 35)
    .attr('x2', 40).attr('y2', 35)
    .attr('stroke', LINK_COLORS.domestic)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '4,2');
  legend.append('text')
    .attr('x', 45).attr('y', 39)
    .attr('fill', INK.text)
    .attr('font-size', '10px')
    .text('Local (local company to gateway)');

  let legendX = 0;
  TYPE_LEGEND.forEach(({ color, label }) => {
    legend.append('circle').attr('cx', legendX + 5).attr('cy', 52).attr('r', 4).attr('fill', color).attr('stroke', INK.text).attr('stroke-width', 0.75);
    legend.append('text').attr('x', legendX + 12).attr('y', 56).attr('fill', INK.text).attr('font-size', '8px').text(label);
    legendX += label.length * 5 + 20;
  });
  return LEGEND_HEIGHT;
}

/**
 * Copy positions from the nodes currently in the simulation onto the next
 * dataset's nodes (matched by ASN) so the layout keeps its shape when the data
 * changes. Unmatched nodes lose any stale position and get placed in their band.
 * Exported for unit testing. Returns the number of matched nodes.
 */
export function carryOverPositions(prevNodes, nextNodes) {
  const prevByAsn = new Map();
  for (const n of prevNodes || []) {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) prevByAsn.set(n.asn, n);
  }
  let matched = 0;
  for (const n of nextNodes || []) {
    const p = prevByAsn.get(n.asn);
    if (p) {
      n.x = p.x;
      n.y = p.y;
      matched++;
    } else {
      delete n.x;
      delete n.y;
    }
    n.vx = 0;
    n.vy = 0;
  }
  return matched;
}

/**
 * Swap in a new dataset (e.g. a history snapshot) without rebuilding the view:
 * keeps the zoom, carries node positions over and only gently reheats the layout.
 */
export function updateData(data, options = {}) {
  if (!simulation || !g) { loadData(data, options); return; }
  if (options.minTraffic !== undefined) minTraffic = options.minTraffic;
  if (options.maxTraffic !== undefined) maxTraffic = options.maxTraffic;
  // Snapshots with baked positions were laid out from each other, so they line
  // up without simulating; otherwise keep the current layout and relax gently.
  const baked = hasBakedLayout(data, minTraffic, maxTraffic);
  if (baked) applyBakedPositions(data.layout, data.nodes);
  else carryOverPositions(simulation.nodes(), data.nodes);
  currentData = data;
  const prevHighlight = highlightedNode;
  highlightedNode = null;
  render({ alpha: baked ? 0 : 0.1 });
  if (prevHighlight) highlightASN(prevHighlight);
}

// Text label for screen readers, plus keyboard and button pan/zoom.
function describeChart(nodeList, edgeList) {
  const count = (...types) => nodeList.filter(n => types.includes(n.type)).length;
  const gateways = count('iig', 'inside', 'detected-iig');
  const [start, end] = portrait ? ['top', 'bottom'] : ['left', 'right'];
  const label = `Network graph of ${nodeList.length} networks and ${edgeList.length} connections. `
    + `${count('local-company', 'local-isp')} local companies on the ${start} reach the internet through `
    + `${gateways} gateways in the middle and ${count('outside')} international networks on the ${end}.`;
  makeChartAccessible(svg, { zoom, label, reset: resetView, onEscape: clearHighlight });
}

// alpha 0 draws the current positions as they are, without running the simulation.
function render({ alpha = 1 } = {}) {
  if (!currentData || !g) return;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  // Baked data has its own coordinate space (fitted by the zoom); otherwise use
  // the panel, with its sides swapped when the layout is drawn transposed.
  const width = currentData.layout ? currentData.layout.width
    : (portrait ? container.clientHeight : container.clientWidth);
  const height = currentData.layout ? currentData.layout.height
    : (portrait ? container.clientWidth : container.clientHeight);

  const selected = selectGraph(currentData, minTraffic, maxTraffic);
  renderedEdges = selected.edges;
  const filteredNodes = selected.nodes;

  // Pre-position nodes
  filteredNodes.forEach(d => {
    if (d.x === undefined || d.y === undefined) {
      [d.x, d.y] = bandPosition(d.type, width, height);
    }
  });

  g.selectAll('*').remove();

  links = g.append('g').selectAll('path')
    .data(renderedEdges)
    .enter().append('path')
    .attr('class', 'link')
    .attr('stroke', d => d.type === 'domestic' ? LINK_COLORS.domestic : LINK_COLORS.international)
    .attr('stroke-width', d => Math.max(0.5, Math.sqrt(d.count / 500)))
    .attr('stroke-dasharray', d => d.type === 'domestic' ? '4,2' : 'none');

  nodes = g.append('g').selectAll('g')
    .data(filteredNodes)
    .enter().append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .subject((event, d) => ({ x: sx(d), y: sy(d) }))
      .on('start', dragStart)
      .on('drag', dragging)
      .on('end', dragEnd));

  nodes.append('circle')
    .attr('r', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)))
    .attr('fill', d => categoryColor(d.type))
    .attr('stroke', INK.text)
    .attr('stroke-width', 1);

  const TOP_LABELS_PER_TYPE = 30;
  const labelASNs = new Set();
  const byType = {};
  filteredNodes.forEach(n => {
    if (!byType[n.type]) byType[n.type] = [];
    byType[n.type].push(n);
  });
  for (const type in byType) {
    byType[type].sort((a, b) => (b.traffic || 0) - (a.traffic || 0));
    byType[type].slice(0, TOP_LABELS_PER_TYPE).forEach(n => labelASNs.add(n.asn));
  }

  // A gentle reheat keeps nodes near their places, so labels can stay visible.
  const labelsDuringLayout = showLabels && alpha < 1;
  nodes.filter(d => labelASNs.has(d.asn))
    .append('text')
    .attr('class', 'node-label')
    .attr('dy', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)) + 14)
    .text(d => {
      const flag = d.country ? countryToFlag(d.country) : '';
      return `${flag} ${d.name || `AS${d.asn}`}`;
    })
    .style('display', labelsDuringLayout ? 'block' : 'none');

  nodes.on('mouseover', showTooltipHandler)
    .on('mousemove', moveTooltipHandler)
    .on('mouseout', hideTooltipHandler)
    .on('click', highlightNodeHandler);

  describeChart(filteredNodes, renderedEdges);

  configureForces(d3, simulation, { width, height, nodeCount: filteredNodes.length });
  simulation.nodes(filteredNodes).on('tick', ticked);
  simulation.force('link').links(renderedEdges);

  if (stopTimer) clearTimeout(stopTimer);
  if (alpha === 0) {
    simulation.stop();
    ticked();
    return;
  }

  simulation.alpha(alpha).restart();

  simulation.on('end', () => {
    if (showLabels) d3.selectAll('.node-label').style('display', 'block');
  });

  stopTimer = setTimeout(() => {
    if (simulation) {
      simulation.stop();
      if (showLabels) d3.selectAll('.node-label').style('display', 'block');
    }
  }, 4000);
}

function ticked() {
  nodes.attr('transform', d => `translate(${sx(d)},${sy(d)})`);
  links.attr('d', linkPath);
}

function buildTooltipHtml(d) {
  return buildNodeTooltipHtml(d, TYPE_LABELS);
}

function showTooltipHandler(event, d) { if (tooltip) tooltip.html(buildTooltipHtml(d)).style('display', 'block'); }
function moveTooltipHandler(event) {
  if (!tooltip) return;
  if (window.innerWidth <= 900) return;
  const offset = 15;
  let left = event.pageX + offset;
  let top = event.pageY + offset;
  
  const tooltipNode = tooltip.node();
  if (tooltipNode) {
    const rect = tooltipNode.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (left + rect.width > viewportWidth) left = event.pageX - rect.width - offset;
    if (top + rect.height > viewportHeight) top = event.pageY - rect.height - offset;
    
    left = Math.max(5, left);
    top = Math.max(5, top);
  }
  
  tooltip.style('left', `${left}px`).style('top', `${top}px`);
}
function hideTooltipHandler() { if (tooltip) tooltip.style('display', 'none'); }

function highlightNodeHandler(event, d) {
  event.stopPropagation();
  if (highlightedNode === d.asn) { clearHighlight(); return; }
  highlightedNode = d.asn;
  const connectedNodes = new Set([d.asn]);
  const connectedEdges = new Set();
  renderedEdges.forEach(e => {
    const src = e.source?.asn || e.source;
    const tgt = e.target?.asn || e.target;
    if (src === d.asn || tgt === d.asn) { connectedEdges.add(e); connectedNodes.add(src); connectedNodes.add(tgt); }
  });
  nodes.classed('highlighted', n => n.asn === d.asn).classed('dimmed', n => !connectedNodes.has(n.asn));
  links.classed('highlighted', e => connectedEdges.has(e)).classed('dimmed', e => !connectedEdges.has(e));
  document.querySelectorAll('.asn-item').forEach(el => el.classList.remove('highlighted'));
  const sidebarEl = document.getElementById(`asn-${d.asn}`);
  if (sidebarEl) { sidebarEl.classList.add('highlighted'); sidebarEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function clearHighlight() {
  highlightedNode = null;
  if (nodes) nodes.classed('highlighted', false).classed('dimmed', false);
  if (links) links.classed('highlighted', false).classed('dimmed', false);
  document.querySelectorAll('.asn-item').forEach(el => el.classList.remove('highlighted'));
}

export function highlightASN(asn) {
  if (!currentData) return;
  const node = currentData.nodes.find(n => n.asn === asn);
  if (node) highlightNodeHandler({ stopPropagation: () => {} }, node);
}

export function updateFilter(minVal, maxVal) {
  minTraffic = minVal !== undefined ? minVal : minTraffic;
  maxTraffic = maxVal !== undefined ? maxVal : maxTraffic;
  // Back on the baked filter: restore the baked layout; otherwise relax from the current one.
  if (hasBakedLayout(currentData, minTraffic, maxTraffic)) {
    applyBakedPositions(currentData.layout, currentData.nodes);
    render({ alpha: 0 });
  } else {
    render({ alpha: currentData?.layout ? 0.3 : 1 });
  }
}
export function setNodeSize(size) {
  currentNodeSize = size;
  if (nodes) {
    nodes.selectAll('circle').attr('r', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)));
    nodes.selectAll('text').attr('dy', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)) + 14);
  }
}
export function toggleLabelsVisibility() {
  showLabels = !showLabels;
  if (showLabels) {
    if (!simulation || simulation.alpha() < 0.1) {
      d3.selectAll('.node-label').style('display', 'block');
    }
  } else {
    d3.selectAll('.node-label').style('display', 'none');
  }
}
export function resetView() {
  if (!svg || !zoom) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  (reduced ? svg : svg.transition().duration(750)).call(zoom.transform, initialTransform || d3.zoomIdentity);
  clearHighlight();
}

export function filterByTypes(activeTypes) {
  if (!nodes || !links) return;
  const nodeTypeMap = {};
  currentData.nodes.forEach(n => { nodeTypeMap[n.asn] = n.type; });
  
  nodes.attr('display', d => activeTypes.has(d.type) ? null : 'none');
  links.attr('display', d => {
    const sAsn = (d.source && d.source.asn) ? d.source.asn : d.source;
    const tAsn = (d.target && d.target.asn) ? d.target.asn : d.target;
    
    const srcType = nodeTypeMap[sAsn];
    const tgtType = nodeTypeMap[tAsn];
    return (srcType && activeTypes.has(srcType) && tgtType && activeTypes.has(tgtType)) ? null : 'none';
  });
}

// Dragging moves only the dragged node and its own links. It never reheats the
// simulation: a click also starts a drag, and the rest of the layout should stay put.
function dragStart(event, d) {
  dragLinks = links.filter(l => l.source === d || l.target === d);
}

function dragging(event, d) {
  d.x = portrait ? event.y : event.x;
  d.y = portrait ? event.x : event.y;
  d.fx = d.x;   // hold it in place if a simulation is still settling
  d.fy = d.y;
  d3.select(this).attr('transform', `translate(${sx(d)},${sy(d)})`);
  dragLinks.attr('d', linkPath);
}

function dragEnd(event, d) {
  d.fx = null;
  d.fy = null;
  dragLinks = null;
}

export function destroy() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (simulation) simulation.stop();
  const c = document.getElementById('viz-panel');
  if (c) c.innerHTML = '';
}
