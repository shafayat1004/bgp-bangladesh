/**
 * Force-Directed Network Graph Visualization
 * Supports 5 node types: local-isp (blue), iig (green), detected-iig (amber), offshore-peer (orange), outside (red).
 * Standard D3.js implementation.
 */

import { countryToFlag, buildNodeTooltipHtml } from '../api/ripestat.js';

const TYPE_COLORS = {
  'outside': '#ff6b6b',
  'iig': '#51cf66',
  'detected-iig': '#fcc419',
  'offshore-enterprise': '#17a2b8',
  'offshore-gateway': '#e64980',
  'local-company': '#4dabf7',
  'inside': '#51cf66',  // backward compat
  'offshore-peer': '#ffa94d',  // backward compat
  'local-isp': '#4dabf7',  // backward compat
};

const TYPE_LABELS = {
  'outside': 'Outside BD (Intl Feeder)',
  'iig': 'IIG (Licensed Gateway)',
  'detected-iig': 'Detected Gateway',
  'offshore-enterprise': 'Offshore Enterprise',
  'offshore-gateway': 'Offshore Gateway',
  'local-company': 'Local Company',
  'inside': 'Inside BD (Gateway)',
  'offshore-peer': 'BD Offshore Peer',  // backward compat
  'local-isp': 'Local ISP',  // backward compat
};

let svg, g, simulation, nodes, links, tooltip;
let showLabels = true;
let highlightedNode = null;
let currentNodeSize = 15;
let currentData = null;
let minTraffic = 100;
let maxTraffic = Infinity;
let renderedEdges = [];
let stopTimer = null;

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

  svg = d3.select('#force-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  g = svg.append('g');

  const zoom = d3.zoom().scaleExtent([0.1, 5])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);
  
  svg.call(zoom.transform, d3.zoomIdentity.scale(0.6).translate(width * 0.33, height * 0.33));
  
  svg.on('click', () => clearHighlight());

  createLegend(height);

  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.asn).distance(180).strength(0.08))
    .force('charge', d3.forceManyBody().strength(-400).distanceMax(450))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => Math.max(8, Math.sqrt(d.traffic / 100) * 2 + 5)).strength(0.9))
    .force('x', d3.forceX(d => {
      if (d.type === 'local-company' || d.type === 'local-isp') return width * 0.15;
      if (d.type === 'iig' || d.type === 'inside') return width * 0.32;
      if (d.type === 'detected-iig') return width * 0.5;
      if (d.type === 'offshore-enterprise') return width * 0.68;
      if (d.type === 'offshore-gateway' || d.type === 'offshore-peer') return width * 0.78;
      return width * 0.88;
    }).strength(0.35))
    .force('y', d3.forceY(d => {
      if (d.type === 'local-company' || d.type === 'local-isp') return height * 0.1;
      if (d.type === 'iig' || d.type === 'inside' || d.type === 'detected-iig') return height * 0.35;
      if (d.type === 'offshore-enterprise' || d.type === 'offshore-gateway' || d.type === 'offshore-peer') return height * 0.65;
      return height * 0.9;
    }).strength(0.85))
    .velocityDecay(0.55)
    .alphaDecay(0.02);

  render();
}

function createLegend(height) {
  const legend = svg.append('g')
    .attr('class', 'edge-legend')
    .attr('transform', `translate(20, ${height - 80})`);

  legend.append('rect')
    .attr('x', -10).attr('y', -10)
    .attr('width', 400).attr('height', 70)
    .attr('fill', 'rgba(26, 31, 58, 0.9)')
    .attr('stroke', '#2a3f5f')
    .attr('rx', 4);

  legend.append('text')
    .attr('x', 0).attr('y', 0)
    .attr('fill', '#aaa')
    .attr('font-size', '11px')
    .attr('font-weight', 'bold')
    .text('Edge Types:');

  legend.append('line')
    .attr('x1', 0).attr('y1', 15)
    .attr('x2', 40).attr('y2', 15)
    .attr('stroke', '#4fc3f7')
    .attr('stroke-width', 2);
  legend.append('text')
    .attr('x', 45).attr('y', 19)
    .attr('fill', '#ccc')
    .attr('font-size', '10px')
    .text('International (Gateway - Outside)');

  legend.append('line')
    .attr('x1', 0).attr('y1', 35)
    .attr('x2', 40).attr('y2', 35)
    .attr('stroke', '#42a5f5')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '4,2');
  legend.append('text')
    .attr('x', 45).attr('y', 39)
    .attr('fill', '#ccc')
    .attr('font-size', '10px')
    .text('Domestic (Local Company - Gateway)');

  const typeLegend = [
    { color: '#4dabf7', label: 'Local Co.' },
    { color: '#51cf66', label: 'IIG' },
    { color: '#fcc419', label: 'Detected' },
    { color: '#17a2b8', label: 'Offshore Ent.' },
    { color: '#e64980', label: 'Offshore GW' },
    { color: '#ff6b6b', label: 'Outside' },
  ];
  let legendX = 0;
  typeLegend.forEach(({ color, label }) => {
    legend.append('circle').attr('cx', legendX + 5).attr('cy', 52).attr('r', 4).attr('fill', color);
    legend.append('text').attr('x', legendX + 12).attr('y', 56).attr('fill', '#ccc').attr('font-size', '8px').text(label);
    legendX += label.length * 5 + 20;
  });
}

function render() {
  if (!currentData || !g) return;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  renderedEdges = currentData.edges.filter(e => e.count >= minTraffic && e.count <= maxTraffic);
  const usedNodes = new Set();
  renderedEdges.forEach(e => {
    usedNodes.add(e.source?.asn || e.source);
    usedNodes.add(e.target?.asn || e.target);
  });
  const filteredNodes = currentData.nodes.filter(n => usedNodes.has(n.asn));

  // Pre-position nodes
  filteredNodes.forEach(d => {
    if (d.x === undefined || d.y === undefined) {
      if (d.type === 'local-company' || d.type === 'local-isp') {
        d.x = width * 0.15 + (Math.random() - 0.5) * width * 0.12;
        d.y = height * 0.1 + (Math.random() - 0.5) * 50;
      } else if (d.type === 'iig' || d.type === 'inside') {
        d.x = width * 0.32 + (Math.random() - 0.5) * width * 0.12;
        d.y = height * 0.35 + (Math.random() - 0.5) * 50;
      } else if (d.type === 'detected-iig') {
        d.x = width * 0.5 + (Math.random() - 0.5) * width * 0.12;
        d.y = height * 0.35 + (Math.random() - 0.5) * 50;
      } else if (d.type === 'offshore-enterprise') {
        d.x = width * 0.68 + (Math.random() - 0.5) * width * 0.12;
        d.y = height * 0.65 + (Math.random() - 0.5) * 50;
      } else if (d.type === 'offshore-gateway' || d.type === 'offshore-peer') {
        d.x = width * 0.78 + (Math.random() - 0.5) * width * 0.12;
        d.y = height * 0.65 + (Math.random() - 0.5) * 50;
      } else {
        d.x = width * 0.88 + (Math.random() - 0.5) * width * 0.1;
        d.y = height * 0.9 + (Math.random() - 0.5) * 50;
      }
    }
  });

  g.selectAll('*').remove();

  links = g.append('g').selectAll('path')
    .data(renderedEdges)
    .enter().append('path')
    .attr('class', 'link')
    .attr('stroke', d => d.type === 'domestic' ? '#42a5f5' : '#4fc3f7')
    .attr('stroke-width', d => Math.max(0.5, Math.sqrt(d.count / 500)))
    .attr('stroke-dasharray', d => d.type === 'domestic' ? '4,2' : 'none');

  nodes = g.append('g').selectAll('g')
    .data(filteredNodes)
    .enter().append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragStart)
      .on('drag', dragging)
      .on('end', dragEnd));

  nodes.append('circle')
    .attr('r', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)))
    .attr('fill', d => TYPE_COLORS[d.type] || '#888')
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5);

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

  nodes.filter(d => labelASNs.has(d.asn))
    .append('text')
    .attr('class', 'node-label')
    .attr('dy', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)) + 14)
    .text(d => {
      const flag = d.country ? countryToFlag(d.country) : '';
      return `${flag} ${d.name || `AS${d.asn}`}`;
    })
    .style('display', 'none');

  nodes.on('mouseover', showTooltipHandler)
    .on('mousemove', moveTooltipHandler)
    .on('mouseout', hideTooltipHandler)
    .on('click', highlightNodeHandler);

  const nodeCount = filteredNodes.length;
  const chargeStrength = Math.max(-600, -350 - nodeCount * 2.5);
  const distMax = nodeCount > 500 ? 300 : 450;
  const collStrength = nodeCount > 500 ? 0.5 : 0.9;

  simulation.force('charge').strength(chargeStrength).distanceMax(distMax);
  simulation.force('collision').strength(collStrength);

  simulation.nodes(filteredNodes).on('tick', ticked);
  simulation.force('link').links(renderedEdges);
  
  simulation.alpha(1).restart();
  
  simulation.on('end', () => {
    if (showLabels) d3.selectAll('.node-label').style('display', 'block');
  });

  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (simulation) {
      simulation.stop();
      if (showLabels) d3.selectAll('.node-label').style('display', 'block');
    }
  }, 4000);
}

function ticked() {
  nodes.attr('transform', d => `translate(${d.x},${d.y})`);
  
  links.attr('d', d => {
    const s = d.source;
    const t = d.target;
    if (!s || !t || isNaN(s.x) || isNaN(t.x)) return '';
    const dx = t.x - s.x, dy = t.y - s.y;
    const dr = Math.sqrt(dx * dx + dy * dy) * 1.5; 
    return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
  });
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
  render();
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
export function resetView() { if (svg) svg.transition().duration(750).call(d3.zoom().transform, d3.zoomIdentity); clearHighlight(); }

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

function dragStart(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragging(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnd(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

export function destroy() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (simulation) simulation.stop();
  const c = document.getElementById('viz-panel');
  if (c) c.innerHTML = '';
}
