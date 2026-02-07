/**
 * Gateway Dominance Bar Chart
 * Horizontal stacked bars showing top gateways ranked by route count,
 * with upstream (international) vs downstream (domestic) traffic segments.
 */

import { countryToFlag, buildNodeTooltipHtml } from '../api/ripestat.js';

const TYPE_COLORS = {
  'iig': '#51cf66',
  'detected-iig': '#fcc419',
  'offshore-enterprise': '#17a2b8',
  'offshore-gateway': '#e64980',
  'local-company': '#4dabf7',
  'outside': '#ff6b6b',
};

const TYPE_LABELS = {
  'iig': 'IIG (Licensed)',
  'detected-iig': 'Detected Gateway',
  'offshore-enterprise': 'Offshore Enterprise',
  'offshore-gateway': 'Offshore Gateway',
  'local-company': 'Local Company',
  'outside': 'Outside BD',
};

let currentData = null;
let currentOptions = {};

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="bar-gateway-svg"></svg>';
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  render();
}

function render() {
  if (!currentData) return;
  const minTraffic = currentOptions.minTraffic !== undefined ? currentOptions.minTraffic : 0;
  const maxTraffic = currentOptions.maxTraffic !== undefined ? currentOptions.maxTraffic : Infinity;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3.select('#bar-gateway-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const tooltip = d3.select('#tooltip');

  // Build node lookup
  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  // Gateway types to include
  const gatewayTypes = new Set(['iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway']);

  // Compute upstream (international) and downstream (domestic) traffic per gateway
  const gwData = {};
  currentData.edges.forEach(e => {
    const src = e.source?.asn || e.source;
    const tgt = e.target?.asn || e.target;
    const count = e.count || 0;
    if (count < minTraffic || count > maxTraffic) return;

    // International edges: outside -> gateway (target is the gateway)
    if (e.type === 'international' || !e.type) {
      const tgtNode = nodeMap[tgt];
      if (tgtNode && gatewayTypes.has(tgtNode.type)) {
        if (!gwData[tgt]) gwData[tgt] = { upstream: 0, downstream: 0 };
        gwData[tgt].upstream += count;
      }
    }
    // Domestic edges: local-company -> gateway (target is the gateway)
    if (e.type === 'domestic') {
      const tgtNode = nodeMap[tgt];
      if (tgtNode && gatewayTypes.has(tgtNode.type)) {
        if (!gwData[tgt]) gwData[tgt] = { upstream: 0, downstream: 0 };
        gwData[tgt].downstream += count;
      }
    }
  });

  // Build sorted array of gateways
  const gateways = Object.entries(gwData)
    .map(([asn, d]) => ({
      asn,
      node: nodeMap[asn],
      upstream: d.upstream,
      downstream: d.downstream,
      total: d.upstream + d.downstream,
    }))
    .filter(d => d.node && d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 40); // Top 40 gateways

  if (gateways.length === 0) {
    svg.append('text').attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle').attr('fill', '#aaa').attr('font-size', '16px')
      .text('No gateway data available for current filter.');
    return;
  }

  // Layout
  const margin = { top: 50, right: 30, bottom: 40, left: 200 };
  const barHeight = 22;
  const barGap = 4;
  const chartHeight = gateways.length * (barHeight + barGap);
  const totalHeight = Math.max(height, chartHeight + margin.top + margin.bottom);
  svg.attr('height', totalHeight);

  const g = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.5, 3]).on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  const chartWidth = width - margin.left - margin.right;
  const maxTotal = Math.max(...gateways.map(d => d.total));

  const xScale = d3.scaleLinear().domain([0, maxTotal]).range([0, chartWidth]);

  // Title
  g.append('text')
    .attr('x', margin.left + chartWidth / 2).attr('y', 28)
    .attr('text-anchor', 'middle').attr('fill', '#e0e0e0').attr('font-size', '16px').attr('font-weight', 'bold')
    .text(`Top ${gateways.length} Gateways by Route Volume`);

  // Legend
  const legendG = g.append('g').attr('transform', `translate(${margin.left}, 38)`);
  legendG.append('rect').attr('width', 14).attr('height', 10).attr('fill', '#4fc3f7').attr('rx', 2);
  legendG.append('text').attr('x', 18).attr('y', 9).attr('fill', '#ccc').attr('font-size', '10px').text('Upstream (International)');
  legendG.append('rect').attr('x', 160).attr('width', 14).attr('height', 10).attr('fill', '#42a5f5').attr('rx', 2);
  legendG.append('text').attr('x', 178).attr('y', 9).attr('fill', '#ccc').attr('font-size', '10px').text('Downstream (Domestic)');

  // Bars
  gateways.forEach((gw, i) => {
    const y = margin.top + i * (barHeight + barGap);
    const color = TYPE_COLORS[gw.node.type] || '#888';
    const flag = gw.node.country ? countryToFlag(gw.node.country) : '';
    const name = gw.node.name || `AS${gw.asn}`;
    const truncName = name.length > 22 ? name.slice(0, 21) + '...' : name;
    const licensed = gw.node.licensed ? ' [L]' : '';

    // Label
    g.append('text')
      .attr('x', margin.left - 6).attr('y', y + barHeight / 2 + 4)
      .attr('text-anchor', 'end').attr('fill', color).attr('font-size', '11px')
      .text(`${flag} ${truncName}${licensed}`);

    // Upstream bar
    const upW = xScale(gw.upstream);
    g.append('rect')
      .attr('x', margin.left).attr('y', y)
      .attr('width', Math.max(0, upW)).attr('height', barHeight)
      .attr('fill', '#4fc3f7').attr('rx', 2)
      .attr('cursor', 'pointer')
      .on('mouseover', (event) => {
        tooltip.html(
          buildNodeTooltipHtml(gw.node, TYPE_LABELS) +
          `<div class="tooltip-row"><span class="tooltip-label">Upstream:</span><span class="tooltip-value">${gw.upstream.toLocaleString()}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Downstream:</span><span class="tooltip-value">${gw.downstream.toLocaleString()}</span></div>`
        ).style('display', 'block');
      })
      .on('mousemove', (event) => {
        if (window.innerWidth <= 900) return;
        tooltip.style('left', `${event.pageX + 15}px`).style('top', `${event.pageY + 15}px`);
      })
      .on('mouseout', () => tooltip.style('display', 'none'));

    // Downstream bar (stacked after upstream)
    const downW = xScale(gw.downstream);
    g.append('rect')
      .attr('x', margin.left + upW).attr('y', y)
      .attr('width', Math.max(0, downW)).attr('height', barHeight)
      .attr('fill', '#42a5f5').attr('rx', 2)
      .attr('cursor', 'pointer')
      .on('mouseover', (event) => {
        tooltip.html(
          buildNodeTooltipHtml(gw.node, TYPE_LABELS) +
          `<div class="tooltip-row"><span class="tooltip-label">Upstream:</span><span class="tooltip-value">${gw.upstream.toLocaleString()}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Downstream:</span><span class="tooltip-value">${gw.downstream.toLocaleString()}</span></div>`
        ).style('display', 'block');
      })
      .on('mousemove', (event) => {
        if (window.innerWidth <= 900) return;
        tooltip.style('left', `${event.pageX + 15}px`).style('top', `${event.pageY + 15}px`);
      })
      .on('mouseout', () => tooltip.style('display', 'none'));

    // Count label at end of bar
    g.append('text')
      .attr('x', margin.left + upW + downW + 6).attr('y', y + barHeight / 2 + 4)
      .attr('fill', '#aaa').attr('font-size', '10px')
      .text(gw.total.toLocaleString());

    // Type indicator dot
    g.append('circle')
      .attr('cx', margin.left - margin.left + 10).attr('cy', y + barHeight / 2)
      .attr('r', 4).attr('fill', color);
  });

  // X axis
  const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d3.format(','));
  g.append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top + gateways.length * (barHeight + barGap) + 4})`)
    .call(xAxis)
    .selectAll('text').attr('fill', '#aaa').attr('font-size', '9px');
  g.selectAll('.domain, .tick line').attr('stroke', '#444');

  // X axis label
  g.append('text')
    .attr('x', margin.left + chartWidth / 2)
    .attr('y', margin.top + gateways.length * (barHeight + barGap) + 36)
    .attr('text-anchor', 'middle').attr('fill', '#888').attr('font-size', '11px')
    .text('Route Count');
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  // Could highlight a specific bar -- for now just scroll into view via tooltip
}
export function updateFilter(minVal, maxVal) {
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render();
}
export function filterByTypes(activeTypes) {
  // Bar chart shows gateway types; could filter but all gateways are relevant here
}
