/**
 * Sankey Flow Diagram
 * Shows route flow: Local ISPs → Gateways → Outside ASNs
 */

import { countryToFlag } from '../api/ripestat.js';

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'detected-iig': '#fcc419', 'offshore-peer': '#ffa94d', 'local-isp': '#4dabf7', 'inside': '#51cf66' };
const TYPE_LABELS = { 'outside': 'Outside BD', 'iig': 'IIG (Licensed)', 'detected-iig': 'Detected Gateway', 'offshore-peer': 'Offshore Peer', 'local-isp': 'Local ISP', 'inside': 'Inside BD' };

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

let currentData = null;
let currentOptions = {};

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="sankey-svg"></svg>';
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

  const svg = d3.select('#sankey-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  // Add zoom/pan support
  const zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  const margin = { top: 30, right: 30, bottom: 30, left: 30 };
  const w = width - margin.left - margin.right;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  // Check if we have domestic edges (full model) or international-only
  const hasDomestic = currentData.edges.some(e => e.type === 'domestic');
  const hasLocalISP = currentData.nodes.some(n => n.type === 'local-isp');

  // Filter by traffic range - no arbitrary limits, only user-controlled filtering
  const intlEdges = currentData.edges
    .filter(e => (e.type === 'international' || !e.type) && e.count >= minTraffic && e.count <= maxTraffic)
    .sort((a, b) => b.count - a.count);
  const domEdges = hasDomestic 
    ? currentData.edges.filter(e => e.type === 'domestic' && e.count >= minTraffic && e.count <= maxTraffic).sort((a, b) => b.count - a.count)
    : [];

  // All edges for layout
  const allEdges = [...intlEdges, ...domEdges];

  // Collect unique ASNs per column
  const outsideASNs = [...new Set(intlEdges.map(e => e.source?.asn || e.source))];
  const iigASNs = [...new Set([
    ...intlEdges.map(e => e.target?.asn || e.target),
    ...domEdges.map(e => e.target?.asn || e.target),
  ])];
  const localISPASNs = hasLocalISP ? [...new Set(domEdges.map(e => e.source?.asn || e.source))] : [];

  // Calculate totals per ASN across relevant edges
  function calcTotals(asns, edges, getASN) {
    const totals = {};
    edges.forEach(e => {
      const asn = getASN(e);
      totals[asn] = (totals[asn] || 0) + e.count;
    });
    return asns.sort((a, b) => (totals[b] || 0) - (totals[a] || 0)).map(asn => ({ asn, total: totals[asn] || 0 }));
  }

  const outsideSorted = calcTotals(outsideASNs, intlEdges, e => e.source?.asn || e.source);
  const iigSorted = calcTotals(iigASNs, allEdges, e => e.target?.asn || e.target);
  const ispSorted = calcTotals(localISPASNs, domEdges, e => e.source?.asn || e.source);

  // Column positions
  const nodeWidth = 18;
  const columns = hasLocalISP && localISPASNs.length > 0
    ? [{ asns: outsideSorted, x: 0, color: TYPE_COLORS.outside, label: 'Outside' },
       { asns: iigSorted, x: w / 2 - nodeWidth / 2, color: TYPE_COLORS.iig, label: 'Gateways' },
       { asns: ispSorted, x: w - nodeWidth, color: TYPE_COLORS['local-isp'], label: 'Local ISPs' }]
    : [{ asns: outsideSorted, x: 0, color: TYPE_COLORS.outside, label: 'Outside' },
       { asns: iigSorted, x: w - nodeWidth, color: TYPE_COLORS.iig, label: 'Inside BD' }];

  // Layout nodes in each column
  const positions = {};
  const totalTraffic = allEdges.reduce((s, e) => s + e.count, 0) || 1;

  // Calculate dynamic height based on number of nodes
  const maxNodes = Math.max(...columns.map(c => c.asns.length));
  const minNodeHeight = 8; // Minimum height per node
  const padding = 4;
  const neededHeight = maxNodes * (minNodeHeight + padding);
  const h = Math.max(height - margin.top - margin.bottom, neededHeight);

  columns.forEach(col => {
    const colTotal = col.asns.reduce((s, a) => s + a.total, 0) || 1;
    const available = h - (col.asns.length - 1) * padding;
    let y = 0;

    col.asns.forEach(({ asn, total }) => {
      const fraction = total / colTotal;
      const nodeH = Math.max(minNodeHeight, fraction * available);
      const nodeColor = (nodeMap[asn] && TYPE_COLORS[nodeMap[asn].type]) || col.color;
      positions[`${asn}_${col.label}`] = { x: col.x, y, h: nodeH, asn, color: nodeColor };
      y += nodeH + padding;
    });
  });

  // Draw links
  const linkGroup = g.append('g').attr('class', 'sankey-links');
  const offsets = {};

  function drawEdges(edges, srcCol, tgtCol, color) {
    let drawn = 0, skipped = 0;
    edges.forEach(edge => {
      const src = edge.source?.asn || edge.source;
      const tgt = edge.target?.asn || edge.target;
      const srcPos = positions[`${src}_${srcCol}`];
      const tgtPos = positions[`${tgt}_${tgtCol}`];
      if (!srcPos || !tgtPos) {
        skipped++;
        return;
      }
      drawn++;

      const bandW = Math.max(2, (edge.count / totalTraffic) * h * 0.6);
      const srcOff = offsets[`${src}_${srcCol}_out`] || 0;
      offsets[`${src}_${srcCol}_out`] = srcOff + bandW;
      const tgtOff = offsets[`${tgt}_${tgtCol}_in`] || 0;
      offsets[`${tgt}_${tgtCol}_in`] = tgtOff + bandW;

      const x0 = srcPos.x + nodeWidth;
      const y0 = srcPos.y + srcOff + bandW / 2;
      const x1 = tgtPos.x;
      const y1 = tgtPos.y + tgtOff + bandW / 2;

      linkGroup.append('path')
        .attr('class', 'sankey-link')
        .attr('data-source', src).attr('data-target', tgt)
        .attr('d', `M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', Math.max(1, bandW))
        .on('mouseover', function () {
          d3.select(this).attr('stroke-opacity', 0.6);
          const sn = nodeMap[src]?.name || `AS${src}`;
          const tn = nodeMap[tgt]?.name || `AS${tgt}`;
          const sf = nodeMap[src]?.country ? countryToFlag(nodeMap[src].country) + ' ' : '';
          const tf = nodeMap[tgt]?.country ? countryToFlag(nodeMap[tgt].country) + ' ' : '';
          d3.select('#tooltip').html(`<div class="tooltip-title">${sf}${sn} &rarr; ${tf}${tn}</div><div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${edge.count.toLocaleString()}</span></div>`).style('display', 'block');
        })
        .on('mousemove', moveTooltipSmart)
        .on('mouseout', function () { d3.select(this).attr('stroke-opacity', 0.25); d3.select('#tooltip').style('display', 'none'); });
    });
    if (skipped > 0) console.warn(`Sankey: Drew ${drawn} ${srcCol}→${tgtCol} edges, skipped ${skipped} (missing positions)`);
  }

  drawEdges(intlEdges, 'Outside', columns.length > 2 ? 'Gateways' : 'Inside BD', '#4fc3f7');
  if (domEdges.length > 0) drawEdges(domEdges, 'Local ISPs', 'Gateways', '#4dabf7');

  // Add zoom hint
  g.append('text')
    .attr('x', w / 2)
    .attr('y', h + 25)
    .attr('text-anchor', 'middle')
    .attr('fill', '#666')
    .attr('font-size', '11px')
    .text('Scroll to zoom • Drag to pan');

  // Draw nodes and labels
  columns.forEach(col => {
    // Column label
    g.append('text').attr('x', col.x + nodeWidth / 2).attr('y', -10)
      .attr('text-anchor', 'middle').attr('fill', col.color).attr('font-size', '12px').attr('font-weight', 'bold').text(col.label);

    col.asns.forEach(({ asn }) => {
      const key = `${asn}_${col.label}`;
      const pos = positions[key];
      if (!pos) return;
      const node = nodeMap[asn];

      g.append('rect').attr('class', 'sankey-node').attr('data-asn', asn)
        .attr('x', pos.x).attr('y', pos.y)
        .attr('width', nodeWidth).attr('height', pos.h)
        .attr('fill', pos.color).attr('rx', 2)
        .on('mouseover', function (event) {
          const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
          const typeLabel = TYPE_LABELS[node?.type] || node?.type || '';
          const licenseBadge = node?.licensed ? ' <span style="color:#51cf66;font-size:9px">[BTRC]</span>' : '';
          d3.select('#tooltip').html(`
            <div class="tooltip-title">${flag}${node?.name || `AS${asn}`}${licenseBadge}</div>
            <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${asn}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${typeLabel}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${(node?.traffic || 0).toLocaleString()}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(node?.percentage || 0).toFixed(1)}%</span></div>
          `).style('display', 'block');
        })
        .on('mousemove', moveTooltipSmart)
        .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); });

      if (pos.h > 10) {
        const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
        const textX = col.x === 0 ? col.x + nodeWidth + 5 : col.x - 5;
        const anchor = col.x === 0 ? 'start' : 'end';
        g.append('text').attr('class', 'sankey-label').attr('data-asn', asn)
          .attr('x', textX).attr('y', pos.y + pos.h / 2).attr('dy', '0.35em')
          .attr('text-anchor', anchor).attr('fill', '#ddd').attr('font-size', '9px')
          .text(`${flag}${node?.name || `AS${asn}`}`);
      }
    });
  });
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  if (!currentData) return;
  const svg = d3.select('#sankey-svg');
  // Dim everything first
  svg.selectAll('.sankey-node').attr('opacity', 0.15);
  svg.selectAll('.sankey-label').attr('opacity', 0.15);
  svg.selectAll('.sankey-link').attr('stroke-opacity', 0.05);
  // Highlight the matching node
  svg.selectAll(`.sankey-node[data-asn="${asn}"]`).attr('opacity', 1).attr('stroke', '#fff').attr('stroke-width', 2);
  svg.selectAll(`.sankey-label[data-asn="${asn}"]`).attr('opacity', 1).attr('fill', '#fff').attr('font-weight', 'bold');
  // Highlight connected links and their target/source nodes
  svg.selectAll(`.sankey-link[data-source="${asn}"], .sankey-link[data-target="${asn}"]`).each(function() {
    const link = d3.select(this);
    link.attr('stroke-opacity', 0.7).attr('stroke-width', parseFloat(link.attr('stroke-width')) + 1);
    const other = link.attr('data-source') === asn ? link.attr('data-target') : link.attr('data-source');
    svg.selectAll(`.sankey-node[data-asn="${other}"]`).attr('opacity', 1);
    svg.selectAll(`.sankey-label[data-asn="${other}"]`).attr('opacity', 1);
  });
  // Click anywhere to clear
  svg.on('click.highlight', () => {
    svg.selectAll('.sankey-node').attr('opacity', 1).attr('stroke', null).attr('stroke-width', null);
    svg.selectAll('.sankey-label').attr('opacity', 1).attr('fill', '#ddd').attr('font-weight', null);
    svg.selectAll('.sankey-link').attr('stroke-opacity', 0.35);
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
  const svg = d3.select('#sankey-svg');
  if (svg.empty()) return;
  
  // Build lookup map for performance
  const nodeTypeMap = {};
  currentData.nodes.forEach(n => { nodeTypeMap[n.asn] = n.type; });
  
  svg.selectAll('.sankey-node').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    return nodeTypeMap[asn] && activeTypes.has(nodeTypeMap[asn]) ? null : 'none';
  });
  svg.selectAll('.sankey-label').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    return nodeTypeMap[asn] && activeTypes.has(nodeTypeMap[asn]) ? null : 'none';
  });
  svg.selectAll('.sankey-link').attr('display', function() {
    const src = d3.select(this).attr('data-source');
    const tgt = d3.select(this).attr('data-target');
    return (nodeTypeMap[src] && activeTypes.has(nodeTypeMap[src]) && nodeTypeMap[tgt] && activeTypes.has(nodeTypeMap[tgt])) ? null : 'none';
  });
}
