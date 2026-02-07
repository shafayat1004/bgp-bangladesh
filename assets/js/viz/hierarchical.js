/**
 * Hierarchical Layered View - 3-layer model
 * Top: Local ISPs | Middle: IIGs | Bottom: Outside ASNs
 */

import { countryToFlag } from '../api/ripestat.js';

function moveTooltipSmart(event) {
  const tooltip = d3.select('#tooltip');
  const tooltipNode = tooltip.node();
  if (!tooltipNode) return;
  
  const rect = tooltipNode.getBoundingClientRect();
  let left = event.pageX + 15;
  let top = event.pageY + 15;
  
  if (left + rect.width > window.innerWidth) left = event.pageX - rect.width - 15;
  if (top + rect.height > window.innerHeight) top = event.pageY - rect.height - 15;
  left = Math.max(5, left);
  top = Math.max(5, top);
  
  tooltip.style('left', `${left}px`).style('top', `${top}px`);
}

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'detected-iig': '#fcc419', 'offshore-peer': '#ffa94d', 'local-isp': '#4dabf7', 'inside': '#51cf66' };
const TYPE_LABELS = { 'local-isp': 'Local ISPs (Origin Networks)', 'iig': 'IIGs (Licensed Gateways)', 'detected-iig': 'Detected Gateways', 'offshore-peer': 'BD Offshore Peers', 'outside': 'Outside BD (International Feeders)', 'inside': 'Inside BD (Gateways)' };

let currentData = null;
let currentOptions = {};

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

  const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);
  const g = svg.append('g');

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const hasDomestic = currentData.edges.some(e => e.type === 'domestic');
  const hasLocalISP = currentData.nodes.some(n => n.type === 'local-isp');

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

  // Determine layers (top to bottom: Local ISPs → IIGs → Detected Gateways → Offshore Peers → Outside)
  const layers = [];
  if (hasLocalISP) {
    const localISPs = currentData.nodes.filter(n => n.type === 'local-isp' && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
    if (localISPs.length > 0) layers.push({ type: 'local-isp', nodes: localISPs });
  }

  const iigs = currentData.nodes.filter(n => (n.type === 'iig' || n.type === 'inside') && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
  if (iigs.length > 0) layers.push({ type: 'iig', nodes: iigs });

  const detectedIigs = currentData.nodes.filter(n => n.type === 'detected-iig' && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
  if (detectedIigs.length > 0) layers.push({ type: 'detected-iig', nodes: detectedIigs });

  const offshorePeers = currentData.nodes.filter(n => n.type === 'offshore-peer' && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
  if (offshorePeers.length > 0) layers.push({ type: 'offshore-peer', nodes: offshorePeers });

  const outside = currentData.nodes.filter(n => n.type === 'outside' && usedASNs.has(n.asn) && n.traffic >= minTraffic && n.traffic <= maxTraffic).sort((a, b) => b.traffic - a.traffic);
  if (outside.length > 0) layers.push({ type: 'outside', nodes: outside });

  const margin = { top: 60, bottom: 60, left: 40, right: 40 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const boxW = 80;
  const boxH = 32;

  // Position each layer
  const positions = {};
  layers.forEach((layer, li) => {
    const y = margin.top + (h / (layers.length - 1 || 1)) * li;
    const spacing = Math.min(w / layer.nodes.length, boxW + 8);
    const startX = margin.left + (w - layer.nodes.length * spacing) / 2;

    // Draw layer label
    g.append('text')
      .attr('x', margin.left).attr('y', y - boxH / 2 - 8)
      .attr('fill', TYPE_COLORS[layer.type]).attr('font-size', '12px').attr('font-weight', 'bold')
      .text(TYPE_LABELS[layer.type] || layer.type);

    layer.nodes.forEach((n, i) => {
      positions[n.asn] = { x: startX + i * spacing + spacing / 2, y, type: layer.type };
    });
  });

  // Draw edges (use filtered edges)
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

    g.append('path')
      .attr('class', 'hier-link').attr('data-source', src).attr('data-target', tgt)
      .attr('d', `M${srcPos.x},${srcPos.y - boxH / 2} C${srcPos.x},${(srcPos.y + tgtPos.y) / 2} ${tgtPos.x},${(srcPos.y + tgtPos.y) / 2} ${tgtPos.x},${tgtPos.y + boxH / 2}`)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-opacity', opacity).attr('stroke-width', strokeW)
      .on('mouseover', function (event) {
        d3.select(this).attr('stroke-opacity', 0.9).attr('stroke-width', strokeW + 2);
        const sn = nodeMap[src]; const tn = nodeMap[tgt];
        const sf = sn?.country ? countryToFlag(sn.country) + ' ' : '';
        const tf = tn?.country ? countryToFlag(tn.country) + ' ' : '';
        d3.select('#tooltip').html(`<div class="tooltip-title">${sf}${sn?.name || `AS${src}`} &rarr; ${tf}${tn?.name || `AS${tgt}`}</div><div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${edge.count.toLocaleString()}</span></div><div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${edge.type || 'international'}</span></div>`).style('display', 'block');
      })
      .on('mousemove', moveTooltipSmart)
      .on('mouseout', function () { d3.select(this).attr('stroke-opacity', opacity).attr('stroke-width', strokeW); d3.select('#tooltip').style('display', 'none'); });
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
      const f = n.country ? countryToFlag(n.country) + ' ' : '';
      d3.select('#tooltip').html(`
        <div class="tooltip-title">${f}${n.name || `AS${n.asn}`}</div>
        <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${n.asn}</span></div>
        ${n.country ? `<div class="tooltip-row"><span class="tooltip-label">Country:</span><span class="tooltip-value">${f}${n.country}</span></div>` : ''}
        <div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${n.traffic.toLocaleString()}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(n.percentage || 0).toFixed(1)}%</span></div>
      `).style('display', 'block');
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); });
  }
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  const svg = d3.select('#hier-svg');
  // Dim everything
  svg.selectAll('.hier-node').attr('opacity', 0.15);
  svg.selectAll('.hier-link').attr('stroke-opacity', 0.02);
  // Highlight matching node
  svg.selectAll(`.hier-node[data-asn="${asn}"]`).attr('opacity', 1);
  // Highlight connected links and their partner nodes
  svg.selectAll('.hier-link').each(function() {
    const link = d3.select(this);
    const src = link.attr('data-source');
    const tgt = link.attr('data-target');
    if (src === asn || tgt === asn) {
      link.attr('stroke-opacity', 0.8).attr('stroke-width', parseFloat(link.attr('stroke-width')) + 2);
      const other = src === asn ? tgt : src;
      svg.selectAll(`.hier-node[data-asn="${other}"]`).attr('opacity', 1);
    }
  });
  // Click to clear
  svg.on('click.highlight', () => {
    svg.selectAll('.hier-node').attr('opacity', 1);
    svg.selectAll('.hier-link').each(function() {
      // Reset to original opacity (stored as data or recalculate)
      d3.select(this).attr('stroke-opacity', null); // Will trigger re-render on next filter change
    });
    render(); // Simplest: just re-render to restore original state
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
  svg.selectAll('.hier-node').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    const node = currentData.nodes.find(n => n.asn === asn);
    return node && activeTypes.has(node.type) ? null : 'none';
  });
  svg.selectAll('.hier-link').attr('display', function() {
    const src = d3.select(this).attr('data-source');
    const tgt = d3.select(this).attr('data-target');
    const srcNode = currentData.nodes.find(n => n.asn === src);
    const tgtNode = currentData.nodes.find(n => n.asn === tgt);
    return (srcNode && activeTypes.has(srcNode.type) && tgtNode && activeTypes.has(tgtNode.type)) ? null : 'none';
  });
}
