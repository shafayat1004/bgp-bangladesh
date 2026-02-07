/**
 * Hierarchical Layered View
 * Top: Local ISPs | Middle: Gateways | Bottom: Outside ASNs
 */

import { countryToFlag, buildNodeTooltipHtml, buildEdgeTooltipHtml } from '../api/ripestat.js';

function moveTooltipSmart(event) {
  const tooltip = d3.select('#tooltip');
  const tooltipNode = tooltip.node();
  if (!tooltipNode) return;
  // On mobile, tooltip is a CSS bottom sheet
  if (window.innerWidth <= 900) return;
  
  const rect = tooltipNode.getBoundingClientRect();
  let left = event.pageX + 15;
  let top = event.pageY + 15;
  
  if (left + rect.width > window.innerWidth) left = event.pageX - rect.width - 15;
  if (top + rect.height > window.innerHeight) top = event.pageY - rect.height - 15;
  left = Math.max(5, left);
  top = Math.max(5, top);
  
  tooltip.style('left', `${left}px`).style('top', `${top}px`);
}

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'detected-iig': '#fcc419', 'offshore-enterprise': '#17a2b8', 'offshore-gateway': '#e64980', 'local-company': '#4dabf7', 'inside': '#51cf66', 'offshore-peer': '#ffa94d', 'local-isp': '#4dabf7' };
const TYPE_LABELS = { 'local-company': 'Local Companies (Origin Networks)', 'iig': 'IIGs (Licensed Gateways)', 'detected-iig': 'Detected Gateways', 'offshore-enterprise': 'Offshore Enterprises', 'offshore-gateway': 'Offshore Gateways', 'outside': 'Outside BD (International Feeders)', 'inside': 'Inside BD (Gateways)', 'local-isp': 'Local ISPs', 'offshore-peer': 'BD Offshore Peers' };

let currentData = null;
let currentOptions = {};
let highlightedASN = null; // Track which ASN is currently highlighted

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="hier-svg"></svg>';
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  render();
}

function render() {
  if (!currentData) return;
  const options = currentOptions;
  const minTraffic = options.minTraffic !== undefined ? options.minTraffic : 100;
  const maxTraffic = options.maxTraffic !== undefined ? options.maxTraffic : Infinity;
  
  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3.select('#hier-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const g = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);
  
  // Start zoomed out to show the entire dense layout
  const initialScale = 0.3;
  svg.call(zoom.transform, d3.zoomIdentity.scale(initialScale).translate(width / 2 / initialScale, height / 2 / initialScale));

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const hasDomestic = currentData.edges.some(e => e.type === 'domestic');
  const hasLocalISP = currentData.nodes.some(n => n.type === 'local-company' || n.type === 'local-isp');

  // Filter edges by traffic range (no arbitrary limits)
  const filteredIntl = currentData.edges
    .filter(e => (e.type === 'international' || !e.type) && e.count >= minTraffic && e.count <= maxTraffic)
    .sort((a, b) => b.count - a.count);
  const filteredDom = hasDomestic 
    ? currentData.edges.filter(e => e.type === 'domestic' && e.count >= minTraffic && e.count <= maxTraffic).sort((a, b) => b.count - a.count)
    : [];

  const usedASNs = new Set();
  [...filteredIntl, ...filteredDom].forEach(e => {
    usedASNs.add(e.source?.asn || e.source);
    usedASNs.add(e.target?.asn || e.target);
  });

  // Determine layers (top to bottom: Local Companies → IIGs → Detected → Offshore → Outside)
  const layers = [];
  const filterNodes = (type) => currentData.nodes.filter(n => n.type === type && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
  
  if (hasLocalISP) {
    const localCompanies = currentData.nodes.filter(n => (n.type === 'local-company' || n.type === 'local-isp') && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
    if (localCompanies.length > 0) layers.push({ type: 'local-company', nodes: localCompanies });
  }

  const iigs = currentData.nodes.filter(n => (n.type === 'iig' || n.type === 'inside') && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
  if (iigs.length > 0) layers.push({ type: 'iig', nodes: iigs });

  const detectedIigs = filterNodes('detected-iig');
  if (detectedIigs.length > 0) layers.push({ type: 'detected-iig', nodes: detectedIigs });

  const offshoreEnt = filterNodes('offshore-enterprise');
  if (offshoreEnt.length > 0) layers.push({ type: 'offshore-enterprise', nodes: offshoreEnt });

  const offshoreGw = filterNodes('offshore-gateway');
  if (offshoreGw.length > 0) layers.push({ type: 'offshore-gateway', nodes: offshoreGw });

  const outside = filterNodes('outside');
  if (outside.length > 0) layers.push({ type: 'outside', nodes: outside });

  const margin = { top: 60, bottom: 60, left: 40, right: 40 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const boxW = 70;  // Slightly narrower boxes
  const boxH = 28;  // Slightly shorter boxes

  // Pack nodes VERY densely - zero spacing, maximize nodes per row
  const minSpacing = boxW;
  const maxNodesPerRow = Math.max(50, Math.floor(w / minSpacing));  // At least 50 per row

  // Position each layer with multi-row zigzag layout
  const positions = {};
  let currentLayerY = margin.top;
  
  layers.forEach((layer, li) => {
    const nodeCount = layer.nodes.length;
    const nodesPerRow = Math.min(maxNodesPerRow, nodeCount);
    const numRows = Math.ceil(nodeCount / nodesPerRow);
    const rowSpacing = boxH + 2;  // Extremely minimal vertical spacing
    const layerHeight = numRows * rowSpacing;
    
    // Draw layer label at the top of this layer's vertical space
    g.append('text')
      .attr('x', margin.left)
      .attr('y', currentLayerY - 8)
      .attr('fill', TYPE_COLORS[layer.type])
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text(TYPE_LABELS[layer.type] || layer.type);

    // Layout nodes in zigzag pattern
    layer.nodes.forEach((n, i) => {
      const row = Math.floor(i / nodesPerRow);
      const colInRow = i % nodesPerRow;
      const actualNodesInThisRow = Math.min(nodesPerRow, nodeCount - row * nodesPerRow);
      
      // Calculate horizontal spacing for this row
      const rowWidth = actualNodesInThisRow * minSpacing;
      const startX = margin.left + (w - rowWidth) / 2;
      
      // Zigzag: even rows left-to-right, odd rows offset by half-spacing for zigzag effect
      let x;
      if (row % 2 === 0) {
        // Even row: normal left-to-right
        x = startX + colInRow * minSpacing + minSpacing / 2;
      } else {
        // Odd row: offset by half-spacing for zigzag, and optionally reverse order
        const offset = minSpacing / 2;
        x = startX + colInRow * minSpacing + minSpacing / 2 + offset;
      }
      
      const y = currentLayerY + row * rowSpacing + boxH / 2;
      positions[n.asn] = { x, y, type: layer.type };
    });
    
    // Move to next layer's vertical position (minimal spacing between layers)
    currentLayerY += layerHeight + 20;
  });

  // Draw edges (use filtered edges with adaptive curves for multi-row layout)
  const allEdges = [...filteredIntl, ...filteredDom];
  const maxCount = Math.max(...allEdges.map(e => e.count), 1);

  allEdges.forEach(edge => {
    const src = edge.source?.asn || edge.source;
    const tgt = edge.target?.asn || edge.target;
    const srcPos = positions[src];
    const tgtPos = positions[tgt];
    if (!srcPos || !tgtPos) return;

    const opacity = 0.08 + (edge.count / maxCount) * 0.45;
    const strokeW = Math.max(0.5, (edge.count / maxCount) * 3.5);
    const color = edge.type === 'domestic' ? '#4dabf7' : '#4fc3f7';

    // Calculate control points for smoother curves in multi-row layout
    const dx = tgtPos.x - srcPos.x;
    const dy = tgtPos.y - srcPos.y;
    const midY = (srcPos.y + tgtPos.y) / 2;
    
    // Add horizontal offset to control points for better curve separation
    const horizontalOffset = Math.abs(dx) > 100 ? dx * 0.3 : 0;
    const cp1x = srcPos.x + horizontalOffset;
    const cp1y = srcPos.y + dy * 0.25;
    const cp2x = tgtPos.x - horizontalOffset;
    const cp2y = tgtPos.y - dy * 0.25;

    g.append('path')
      .attr('class', 'hier-link').attr('data-source', src).attr('data-target', tgt)
      .attr('d', `M${srcPos.x},${srcPos.y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${tgtPos.x},${tgtPos.y}`)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-opacity', opacity).attr('stroke-width', strokeW)
      .attr('data-original-opacity', opacity).attr('data-original-width', strokeW)  // Store originals
      .on('mouseover', function (event) {
        const link = d3.select(this);
        const originalWidth = parseFloat(link.attr('data-original-width'));
        link.attr('stroke-opacity', 0.9).attr('stroke-width', originalWidth + 2);
        d3.select('#tooltip').html(buildEdgeTooltipHtml(nodeMap[src], nodeMap[tgt], edge.count, edge.type || 'international')).style('display', 'block');
      })
      .on('mousemove', moveTooltipSmart)
      .on('mouseout', function () { 
        const link = d3.select(this);
        const linkSrc = link.attr('data-source');
        const linkTgt = link.attr('data-target');
        
        // Check if this link should stay highlighted
        if (highlightedASN && (linkSrc === highlightedASN || linkTgt === highlightedASN)) {
          // Restore to highlighted state
          const originalWidth = parseFloat(link.attr('data-original-width'));
          link.attr('stroke-opacity', 0.95).attr('stroke-width', originalWidth + 2);
        } else {
          // Restore to original state
          const originalOpacity = parseFloat(link.attr('data-original-opacity'));
          const originalWidth = parseFloat(link.attr('data-original-width'));
          link.attr('stroke-opacity', originalOpacity).attr('stroke-width', originalWidth);
        }
        d3.select('#tooltip').style('display', 'none'); 
      });
  });

  // Draw nodes
  for (const [asn, pos] of Object.entries(positions)) {
    const n = nodeMap[asn];
    if (!n) continue;
    const color = TYPE_COLORS[pos.type];
    const group = g.append('g').attr('class', 'hier-node').attr('data-asn', asn)
      .attr('transform', `translate(${pos.x - boxW / 2},${pos.y - boxH / 2})`).attr('cursor', 'pointer');

    group.append('rect').attr('width', boxW).attr('height', boxH)
      .attr('fill', color + '25').attr('stroke', color).attr('stroke-width', 1.5).attr('rx', 4);

    const flag = n.country ? countryToFlag(n.country) : '';
    const displayName = n.name || `AS${n.asn}`;
    const truncated = displayName.length > 10 ? displayName.slice(0, 9) + '...' : displayName;

    group.append('text').attr('x', boxW / 2).attr('y', boxH / 2 - 3).attr('text-anchor', 'middle')
      .attr('fill', '#fff').attr('font-size', '8px').attr('font-weight', 'bold')
      .text(`${flag} ${truncated}`);

    group.append('text').attr('x', boxW / 2).attr('y', boxH / 2 + 9).attr('text-anchor', 'middle')
      .attr('fill', '#aaa').attr('font-size', '7px')
      .text(`${(n.percentage || 0).toFixed(1)}%`);

    group.on('mouseover', function (event) {
      d3.select('#tooltip').html(buildNodeTooltipHtml(n, TYPE_LABELS)).style('display', 'block');
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); })
    .on('click', function (event) {
      event.stopPropagation();
      highlightASN(asn);
    });
  }
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  highlightedASN = asn; // Store the highlighted ASN
  const svg = d3.select('#hier-svg');
  // Dim everything more (lower opacity)
  svg.selectAll('.hier-node').attr('opacity', 0.08);
  svg.selectAll('.hier-link')
    .attr('stroke-opacity', 0.01)
    .style('pointer-events', 'none'); // Disable hover on dimmed links
  
  // Highlight matching node (full visibility)
  svg.selectAll(`.hier-node[data-asn="${asn}"]`).attr('opacity', 1);
  
  // Highlight connected links and their partner nodes (full visibility)
  svg.selectAll('.hier-link').each(function() {
    const link = d3.select(this);
    const src = link.attr('data-source');
    const tgt = link.attr('data-target');
    if (src === asn || tgt === asn) {
      // Use stored original width instead of current width to prevent accumulation
      const originalWidth = parseFloat(link.attr('data-original-width')) || 1;
      link.attr('stroke-opacity', 0.95)
        .attr('stroke-width', originalWidth + 2)
        .style('pointer-events', 'all'); // Re-enable hover on highlighted links
      const other = src === asn ? tgt : src;
      svg.selectAll(`.hier-node[data-asn="${other}"]`).attr('opacity', 1);
    }
  });
  
  // Click to clear
  svg.on('click.highlight', () => {
    highlightedASN = null; // Clear the highlighted ASN
    svg.selectAll('.hier-node').attr('opacity', 1);
    svg.selectAll('.hier-link').each(function() {
      const link = d3.select(this);
      // Restore original values from stored attributes
      const originalOpacity = parseFloat(link.attr('data-original-opacity'));
      const originalWidth = parseFloat(link.attr('data-original-width'));
      link.attr('stroke-opacity', originalOpacity)
        .attr('stroke-width', originalWidth)
        .style('pointer-events', 'all'); // Re-enable all hover events
    });
    svg.on('click.highlight', null);
  });
}
export function updateFilter(minVal, maxVal) { 
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render(); 
}
export function filterByTypes(activeTypes) {
  if (!currentData) return;
  const svg = d3.select('#hier-svg');
  if (svg.empty()) return;
  
  // Build lookup map for performance
  const nodeTypeMap = {};
  currentData.nodes.forEach(n => { nodeTypeMap[n.asn] = n.type; });
  
  svg.selectAll('.hier-node').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    return nodeTypeMap[asn] && activeTypes.has(nodeTypeMap[asn]) ? null : 'none';
  });
  svg.selectAll('.hier-link').attr('display', function() {
    const src = d3.select(this).attr('data-source');
    const tgt = d3.select(this).attr('data-target');
    return (nodeTypeMap[src] && activeTypes.has(nodeTypeMap[src]) && nodeTypeMap[tgt] && activeTypes.has(nodeTypeMap[tgt])) ? null : 'none';
  });
}
