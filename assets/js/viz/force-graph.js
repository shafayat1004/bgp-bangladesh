/**
 * Force-Directed Network Graph Visualization
 * Supports 3-layer model: local-isp (blue), iig (green), outside (red).
 */

import { countryToFlag } from '../api/ripestat.js';

const TYPE_COLORS = {
  'outside': '#ff6b6b',
  'iig': '#51cf66',
  'local-isp': '#4dabf7',
  'inside': '#51cf66',  // backward compat
};

const TYPE_LABELS = {
  'outside': 'Outside BD (Intl Feeder)',
  'iig': 'IIG (Border Gateway)',
  'local-isp': 'Local ISP',
  'inside': 'Inside BD (Gateway)',
};

let svg, g, simulation, nodes, links, tooltip;
let showLabels = true;
let highlightedNode = null;
let currentNodeSize = 15;
let currentData = null;
let minTraffic = 0;
let renderedEdges = [];  // Track which edges are actually rendered

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<svg id="force-svg"></svg>';
  tooltip = d3.select('#tooltip');
}

export function loadData(data, options = {}) {
  currentData = data;
  minTraffic = options.minTraffic !== undefined ? options.minTraffic : 0;
  currentNodeSize = options.nodeSize || 15;
  showLabels = options.showLabels !== false;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg = d3.select('#force-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  // Arrowhead marker
  svg.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 25).attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .append('path').attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('fill', '#4fc3f7').attr('opacity', 0.6);

  const zoom = d3.zoom().scaleExtent([0.1, 5])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);
  svg.on('click', () => clearHighlight());

  g = svg.append('g');

  // Add edge type legend
  const legend = svg.append('g')
    .attr('class', 'edge-legend')
    .attr('transform', `translate(20, ${height - 80})`);

  legend.append('rect')
    .attr('x', -10).attr('y', -10)
    .attr('width', 220).attr('height', 70)
    .attr('fill', 'rgba(26, 31, 58, 0.9)')
    .attr('stroke', '#2a3f5f')
    .attr('rx', 4);

  legend.append('text')
    .attr('x', 0).attr('y', 0)
    .attr('fill', '#aaa')
    .attr('font-size', '11px')
    .attr('font-weight', 'bold')
    .text('Edge Types:');

  // International edge example
  legend.append('line')
    .attr('x1', 0).attr('y1', 15)
    .attr('x2', 40).attr('y2', 15)
    .attr('stroke', '#4fc3f7')
    .attr('stroke-width', 2);
  legend.append('text')
    .attr('x', 45).attr('y', 19)
    .attr('fill', '#ccc')
    .attr('font-size', '10px')
    .text('International (IIG ← Outside)');

  // Domestic edge example
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
    .text('Domestic (Local ISP → IIG)');

  // Node type legend
  legend.append('circle')
    .attr('cx', 5).attr('cy', 52)
    .attr('r', 4)
    .attr('fill', '#4dabf7');
  legend.append('text')
    .attr('x', 12).attr('y', 56)
    .attr('fill', '#ccc')
    .attr('font-size', '9px')
    .text('Local ISP');

  legend.append('circle')
    .attr('cx', 70).attr('cy', 52)
    .attr('r', 4)
    .attr('fill', '#51cf66');
  legend.append('text')
    .attr('x', 77).attr('y', 56)
    .attr('fill', '#ccc')
    .attr('font-size', '9px')
    .text('IIG');

  legend.append('circle')
    .attr('cx', 115).attr('cy', 52)
    .attr('r', 4)
    .attr('fill', '#ff6b6b');
  legend.append('text')
    .attr('x', 122).attr('y', 56)
    .attr('fill', '#ccc')
    .attr('font-size', '9px')
    .text('Outside');

  // 3-layer Y positioning
  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.asn).distance(120))
    .force('charge', d3.forceManyBody().strength(-150))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30))
    .force('y', d3.forceY(d => {
      if (d.type === 'local-isp') return height * 0.15;
      if (d.type === 'iig' || d.type === 'inside') return height * 0.5;
      return height * 0.85;
    }).strength(0.4));

  render();
}

function render() {
  if (!currentData || !g) return;

  renderedEdges = currentData.edges.filter(e => e.count >= minTraffic);
  const usedNodes = new Set();
  renderedEdges.forEach(e => {
    usedNodes.add(e.source?.asn || e.source);
    usedNodes.add(e.target?.asn || e.target);
  });
  const filteredNodes = currentData.nodes.filter(n => usedNodes.has(n.asn));

  g.selectAll('*').remove();

  // Links - color by type
  links = g.append('g').selectAll('path')
    .data(renderedEdges)
    .enter().append('path')
    .attr('class', 'link')
    .attr('stroke', d => d.type === 'domestic' ? '#42a5f5' : '#4fc3f7')
    .attr('stroke-width', d => Math.max(0.5, Math.sqrt(d.count / 500)))
    .attr('stroke-dasharray', d => d.type === 'domestic' ? '4,2' : 'none')
    .attr('marker-end', 'url(#arrowhead)');

  // Nodes
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

  nodes.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)) + 14)
    .text(d => {
      const flag = d.country ? countryToFlag(d.country) : '';
      return `${flag} ${d.name || `AS${d.asn}`}`;
    })
    .style('display', showLabels ? 'block' : 'none');

  nodes.on('mouseover', showTooltipHandler)
    .on('mousemove', moveTooltipHandler)
    .on('mouseout', hideTooltipHandler)
    .on('click', highlightNodeHandler);

  simulation.nodes(filteredNodes).on('tick', ticked);
  simulation.force('link').links(renderedEdges);
  simulation.alpha(1).restart();
}

function ticked() {
  links.attr('d', d => {
    const s = typeof d.source === 'object' ? d.source : { x: 0, y: 0 };
    const t = typeof d.target === 'object' ? d.target : { x: 0, y: 0 };
    const dx = t.x - s.x, dy = t.y - s.y;
    const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
    return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
  });
  nodes.attr('transform', d => `translate(${d.x},${d.y})`);
}

function buildTooltipHtml(d) {
  const flag = d.country ? countryToFlag(d.country) : '';
  return `
    <div class="tooltip-title">${flag} ${d.name || `AS${d.asn}`}</div>
    <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${d.asn}</span></div>
    ${d.description ? `<div class="tooltip-row"><span class="tooltip-label">Org:</span><span class="tooltip-value">${d.description}</span></div>` : ''}
    ${d.country ? `<div class="tooltip-row"><span class="tooltip-label">Country:</span><span class="tooltip-value">${flag} ${d.country}</span></div>` : ''}
    <div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${TYPE_LABELS[d.type] || d.type}</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${d.traffic.toLocaleString()} routes</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Rank:</span><span class="tooltip-value">#${d.rank}</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(d.percentage || 0).toFixed(1)}%</span></div>
  `;
}

function showTooltipHandler(event, d) { if (tooltip) tooltip.html(buildTooltipHtml(d)).style('display', 'block'); }
function moveTooltipHandler(event) {
  if (!tooltip) return;
  const offset = 15;
  let left = event.pageX + offset;
  let top = event.pageY + offset;
  
  // Get tooltip dimensions
  const tooltipNode = tooltip.node();
  if (tooltipNode) {
    const rect = tooltipNode.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust if going off right edge
    if (left + rect.width > viewportWidth) {
      left = event.pageX - rect.width - offset;
    }
    
    // Adjust if going off bottom edge
    if (top + rect.height > viewportHeight) {
      top = event.pageY - rect.height - offset;
    }
    
    // Ensure minimum positioning
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
  // Only highlight connections that are actually rendered (respects filter)
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

export function updateFilter(val) { minTraffic = val; render(); }
export function setNodeSize(size) {
  currentNodeSize = size;
  if (nodes) {
    nodes.selectAll('circle').attr('r', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)));
    nodes.selectAll('text').attr('dy', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)) + 14);
  }
}
export function toggleLabelsVisibility() { showLabels = !showLabels; d3.selectAll('.node-label').style('display', showLabels ? 'block' : 'none'); }
export function resetView() { if (svg) svg.transition().duration(750).call(d3.zoom().transform, d3.zoomIdentity); clearHighlight(); }

function dragStart(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragging(event, d) { d.fx = event.x; d.fy = event.y; }
function dragEnd(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

export function destroy() { if (simulation) simulation.stop(); const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
