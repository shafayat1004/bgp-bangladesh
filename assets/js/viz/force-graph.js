/**
 * Force-Directed Network Graph Visualization
 * Explore connections, find clusters, discover relationships.
 */

let svg, g, simulation, nodes, links, tooltip;
let showLabels = true;
let highlightedNode = null;
let currentNodeSize = 15;
let currentData = null;
let minTraffic = 0;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<svg id="force-svg"></svg>';

  tooltip = d3.select('#tooltip');
}

export function loadData(data, options = {}) {
  currentData = data;
  minTraffic = options.minTraffic || 0;
  currentNodeSize = options.nodeSize || 15;
  showLabels = options.showLabels !== false;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg = d3.select('#force-svg')
    .attr('width', width)
    .attr('height', height);

  svg.selectAll('*').remove();

  // Defs for arrowhead
  svg.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 25)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('fill', '#4fc3f7')
    .attr('opacity', 0.6);

  // Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => g.attr('transform', event.transform));

  svg.call(zoom);
  svg.on('click', () => clearHighlight());

  g = svg.append('g');

  // Simulation
  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.asn).distance(150))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(40))
    .force('y', d3.forceY(d => d.type === 'outside' ? height * 0.7 : height * 0.3).strength(0.3));

  render();
}

function render() {
  if (!currentData || !g) return;

  const filteredEdges = currentData.edges.filter(e => e.count >= minTraffic);
  const usedNodes = new Set();
  filteredEdges.forEach(e => { usedNodes.add(e.source?.asn || e.source); usedNodes.add(e.target?.asn || e.target); });
  const filteredNodes = currentData.nodes.filter(n => usedNodes.has(n.asn));

  g.selectAll('*').remove();

  // Links
  links = g.append('g')
    .selectAll('path')
    .data(filteredEdges)
    .enter().append('path')
    .attr('class', 'link')
    .attr('stroke', '#4fc3f7')
    .attr('stroke-width', d => Math.max(0.5, Math.sqrt(d.count / 500)))
    .attr('marker-end', 'url(#arrowhead)');

  // Nodes
  nodes = g.append('g')
    .selectAll('g')
    .data(filteredNodes)
    .enter().append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragStart)
      .on('drag', dragging)
      .on('end', dragEnd));

  nodes.append('circle')
    .attr('r', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)))
    .attr('fill', d => d.type === 'inside' ? '#66bb6a' : '#ef5350')
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5);

  nodes.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => Math.max(5, Math.sqrt(d.traffic / 100) * (currentNodeSize / 10)) + 14)
    .text(d => d.name || `AS${d.asn}`)
    .style('display', showLabels ? 'block' : 'none');

  nodes.on('mouseover', showTooltipHandler)
    .on('mousemove', moveTooltipHandler)
    .on('mouseout', hideTooltipHandler)
    .on('click', highlightNodeHandler);

  simulation.nodes(filteredNodes).on('tick', ticked);
  simulation.force('link').links(filteredEdges);
  simulation.alpha(1).restart();
}

function ticked() {
  links.attr('d', d => {
    const s = typeof d.source === 'object' ? d.source : { x: 0, y: 0 };
    const t = typeof d.target === 'object' ? d.target : { x: 0, y: 0 };
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
    return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
  });
  nodes.attr('transform', d => `translate(${d.x},${d.y})`);
}

function showTooltipHandler(event, d) {
  if (!tooltip) return;
  tooltip.html(buildTooltipHtml(d)).style('display', 'block');
}

function moveTooltipHandler(event) {
  if (!tooltip) return;
  tooltip.style('left', (event.pageX + 15) + 'px').style('top', (event.pageY + 15) + 'px');
}

function hideTooltipHandler() {
  if (tooltip) tooltip.style('display', 'none');
}

function buildTooltipHtml(d) {
  return `
    <div class="tooltip-title">${d.name || `AS${d.asn}`}</div>
    <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${d.asn}</span></div>
    ${d.description ? `<div class="tooltip-row"><span class="tooltip-label">Org:</span><span class="tooltip-value">${d.description}</span></div>` : ''}
    <div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${d.type === 'inside' ? 'Inside BD (Gateway)' : 'Outside BD (Feeder)'}</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${d.traffic.toLocaleString()} routes</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Rank:</span><span class="tooltip-value">#${d.rank}</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(d.percentage || 0).toFixed(1)}%</span></div>
  `;
}

function highlightNodeHandler(event, d) {
  event.stopPropagation();
  if (highlightedNode === d.asn) {
    clearHighlight();
  } else {
    highlightedNode = d.asn;
    const connectedNodes = new Set([d.asn]);
    const connectedEdges = new Set();
    currentData.edges.forEach(e => {
      const src = e.source?.asn || e.source;
      const tgt = e.target?.asn || e.target;
      if (src === d.asn || tgt === d.asn) {
        connectedEdges.add(e);
        connectedNodes.add(src);
        connectedNodes.add(tgt);
      }
    });

    nodes.classed('highlighted', n => n.asn === d.asn).classed('dimmed', n => !connectedNodes.has(n.asn));
    links.classed('highlighted', e => connectedEdges.has(e)).classed('dimmed', e => !connectedEdges.has(e));

    document.querySelectorAll('.asn-item').forEach(el => el.classList.remove('highlighted'));
    const sidebarEl = document.getElementById(`asn-${d.asn}`);
    if (sidebarEl) sidebarEl.classList.add('highlighted');
  }
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

export function updateFilter(newMinTraffic) {
  minTraffic = newMinTraffic;
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
  d3.selectAll('.node-label').style('display', showLabels ? 'block' : 'none');
}

export function resetView() {
  if (svg) {
    svg.transition().duration(750).call(d3.zoom().transform, d3.zoomIdentity);
  }
  clearHighlight();
}

function dragStart(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragging(event, d) { d.fx = event.x; d.fy = event.y; }
function dragEnd(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

export function destroy() {
  if (simulation) simulation.stop();
  const container = document.getElementById('viz-panel');
  if (container) container.innerHTML = '';
}
