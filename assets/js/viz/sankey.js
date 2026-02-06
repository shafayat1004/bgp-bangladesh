/**
 * Sankey Flow Diagram - 3-layer model
 * Shows traffic: Local ISPs → IIGs → Outside ASNs
 */

import { countryToFlag } from '../api/ripestat.js';

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'local-isp': '#4dabf7', 'inside': '#51cf66' };

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
  const minTraffic = options.minTraffic || 0;
  
  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3.select('#sankey-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const margin = { top: 30, right: 30, bottom: 30, left: 30 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  // Check if we have 3-layer or 2-layer data
  const hasDomestic = currentData.edges.some(e => e.type === 'domestic');
  const hasLocalISP = currentData.nodes.some(n => n.type === 'local-isp');

  // Filter by minimum traffic - no arbitrary limits, only user-controlled filtering
  const intlEdges = currentData.edges
    .filter(e => (e.type === 'international' || !e.type) && e.count >= minTraffic)
    .sort((a, b) => b.count - a.count);
  const domEdges = hasDomestic 
    ? currentData.edges.filter(e => e.type === 'domestic' && e.count >= minTraffic).sort((a, b) => b.count - a.count)
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
    ? [{ asns: outsideSorted, x: 0, color: '#ef5350', label: 'Outside' },
       { asns: iigSorted, x: w / 2 - nodeWidth / 2, color: '#66bb6a', label: 'IIGs' },
       { asns: ispSorted, x: w - nodeWidth, color: '#42a5f5', label: 'Local ISPs' }]
    : [{ asns: outsideSorted, x: 0, color: '#ef5350', label: 'Outside' },
       { asns: iigSorted, x: w - nodeWidth, color: '#66bb6a', label: 'Inside BD' }];

  // Layout nodes in each column
  const positions = {};
  const totalTraffic = allEdges.reduce((s, e) => s + e.count, 0) || 1;

  columns.forEach(col => {
    const colTotal = col.asns.reduce((s, a) => s + a.total, 0) || 1;
    const padding = 6;
    const available = h - (col.asns.length - 1) * padding;
    let y = 0;

    col.asns.forEach(({ asn, total }) => {
      const fraction = total / colTotal;
      const nodeH = Math.max(3, fraction * available);
      positions[`${asn}_${col.label}`] = { x: col.x, y, h: nodeH, asn, color: col.color };
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

  drawEdges(intlEdges, 'Outside', columns.length > 2 ? 'IIGs' : 'Inside BD', '#4fc3f7');
  if (domEdges.length > 0) drawEdges(domEdges, 'Local ISPs', 'IIGs', '#4dabf7');

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

      g.append('rect').attr('x', pos.x).attr('y', pos.y)
        .attr('width', nodeWidth).attr('height', pos.h)
        .attr('fill', col.color).attr('rx', 2);

      if (pos.h > 10) {
        const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
        const textX = col.x === 0 ? col.x + nodeWidth + 5 : col.x - 5;
        const anchor = col.x === 0 ? 'start' : 'end';
        g.append('text').attr('x', textX).attr('y', pos.y + pos.h / 2).attr('dy', '0.35em')
          .attr('text-anchor', anchor).attr('fill', '#ddd').attr('font-size', '9px')
          .text(`${flag}${node?.name || `AS${asn}`}`);
      }
    });
  });
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN() {}
export function updateFilter() { render(); }
