/**
 * Country Origins Bar Chart
 * Horizontal bars showing top origin countries of outside ASNs,
 * ranked by total route volume feeding into Bangladesh.
 */

import { countryToFlag } from '../api/ripestat.js';

let currentData = null;
let currentOptions = {};

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="bar-country-svg"></svg>';
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

  const svg = d3.select('#bar-country-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const tooltip = d3.select('#tooltip');

  // Build node lookup
  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  // Aggregate route volume by country of outside ASNs
  const countryVolume = {};  // country code -> { routes, asnCount, topASNs }
  currentData.edges.forEach(e => {
    if (e.type === 'domestic') return;
    const src = e.source?.asn || e.source;
    const count = e.count || 0;
    if (count < minTraffic || count > maxTraffic) return;

    const srcNode = nodeMap[src];
    if (!srcNode || srcNode.type !== 'outside') return;

    const cc = srcNode.country || 'Unknown';
    if (!countryVolume[cc]) {
      countryVolume[cc] = { routes: 0, asnCount: 0, asns: new Set(), topASNs: [] };
    }
    countryVolume[cc].routes += count;
    if (!countryVolume[cc].asns.has(src)) {
      countryVolume[cc].asns.add(src);
      countryVolume[cc].asnCount++;
    }
  });

  // Build top ASNs per country (for tooltip)
  for (const cc in countryVolume) {
    const countryASNs = [];
    currentData.nodes.forEach(n => {
      if (n.type === 'outside' && (n.country || 'Unknown') === cc) {
        countryASNs.push({ asn: n.asn, name: n.name, traffic: n.traffic || 0 });
      }
    });
    countryASNs.sort((a, b) => b.traffic - a.traffic);
    countryVolume[cc].topASNs = countryASNs.slice(0, 5);
    delete countryVolume[cc].asns; // Free the Set
  }

  // Sort countries by route volume
  const countries = Object.entries(countryVolume)
    .map(([cc, d]) => ({ cc, ...d }))
    .filter(d => d.routes > 0)
    .sort((a, b) => b.routes - a.routes)
    .slice(0, 30); // Top 30 countries

  if (countries.length === 0) {
    svg.append('text').attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle').attr('fill', '#aaa').attr('font-size', '16px')
      .text('No country data available for current filter.');
    return;
  }

  const totalRoutes = countries.reduce((s, d) => s + d.routes, 0);

  // Layout
  const margin = { top: 50, right: 80, bottom: 40, left: 120 };
  const barHeight = 24;
  const barGap = 5;
  const chartHeight = countries.length * (barHeight + barGap);
  const totalHeight = Math.max(height, chartHeight + margin.top + margin.bottom);
  svg.attr('height', totalHeight);

  const g = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.5, 3]).on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  const chartWidth = width - margin.left - margin.right;
  const maxRoutes = countries[0].routes;

  const xScale = d3.scaleLinear().domain([0, maxRoutes]).range([0, chartWidth]);

  // Color scale based on route volume
  const colorScale = d3.scaleSequential(d3.interpolateBlues)
    .domain([0, maxRoutes]);

  // Title
  g.append('text')
    .attr('x', margin.left + chartWidth / 2).attr('y', 28)
    .attr('text-anchor', 'middle').attr('fill', '#e0e0e0').attr('font-size', '16px').attr('font-weight', 'bold')
    .text('International Traffic Origins by Country');

  // Bars
  countries.forEach((c, i) => {
    const y = margin.top + i * (barHeight + barGap);
    const flag = c.cc !== 'Unknown' ? countryToFlag(c.cc) : '';
    const pct = ((c.routes / totalRoutes) * 100).toFixed(1);

    // Country label with flag
    g.append('text')
      .attr('x', margin.left - 8).attr('y', y + barHeight / 2 + 4)
      .attr('text-anchor', 'end').attr('fill', '#e0e0e0').attr('font-size', '12px')
      .text(`${flag} ${c.cc}`);

    // Bar
    const barW = xScale(c.routes);
    const barColor = d3.interpolateRgb('#1a4a7a', '#4fc3f7')(c.routes / maxRoutes);

    g.append('rect')
      .attr('x', margin.left).attr('y', y)
      .attr('width', Math.max(2, barW)).attr('height', barHeight)
      .attr('fill', barColor).attr('rx', 3)
      .attr('cursor', 'pointer')
      .on('mouseover', (event) => {
        const topASNsHtml = c.topASNs.map(a =>
          `<div class="tooltip-detail">&nbsp;&nbsp;AS${a.asn} ${a.name} (${(a.traffic || 0).toLocaleString()} routes)</div>`
        ).join('');
        tooltip.html(
          `<div class="tooltip-title">${flag} ${c.cc}</div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Total Routes:</span><span class="tooltip-value">${c.routes.toLocaleString()}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${pct}%</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">ASN Count:</span><span class="tooltip-value">${c.asnCount}</span></div>` +
          `<div class="tooltip-row"><span class="tooltip-label">Top ASNs:</span></div>` +
          topASNsHtml
        ).style('display', 'block');
      })
      .on('mousemove', (event) => {
        if (window.innerWidth <= 900) return;
        tooltip.style('left', `${event.pageX + 15}px`).style('top', `${event.pageY + 15}px`);
      })
      .on('mouseout', () => tooltip.style('display', 'none'));

    // Route count + percentage at end of bar
    g.append('text')
      .attr('x', margin.left + barW + 6).attr('y', y + barHeight / 2 + 4)
      .attr('fill', '#aaa').attr('font-size', '10px')
      .text(`${c.routes.toLocaleString()} (${pct}%)`);

    // ASN count inside bar (if bar is wide enough)
    if (barW > 60) {
      g.append('text')
        .attr('x', margin.left + barW - 6).attr('y', y + barHeight / 2 + 4)
        .attr('text-anchor', 'end').attr('fill', 'rgba(255,255,255,0.7)').attr('font-size', '9px')
        .text(`${c.asnCount} ASNs`);
    }
  });

  // X axis
  const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d3.format(','));
  g.append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top + countries.length * (barHeight + barGap) + 4})`)
    .call(xAxis)
    .selectAll('text').attr('fill', '#aaa').attr('font-size', '9px');
  g.selectAll('.domain, .tick line').attr('stroke', '#444');

  // X axis label
  g.append('text')
    .attr('x', margin.left + chartWidth / 2)
    .attr('y', margin.top + countries.length * (barHeight + barGap) + 36)
    .attr('text-anchor', 'middle').attr('fill', '#888').attr('font-size', '11px')
    .text('Route Count (International Edges)');
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {}
export function updateFilter(minVal, maxVal) {
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render();
}
export function filterByTypes(activeTypes) {}
