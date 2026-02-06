/**
 * Treemap Visualization - 3-layer model
 * Side-by-side treemaps for each layer.
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

const TYPE_CONFIG = {
  'iig': { color: '#51cf66', label: 'IIGs (Border Gateways)' },
  'local-isp': { color: '#4dabf7', label: 'Local ISPs' },
  'outside': { color: '#ff6b6b', label: 'Outside BD (International)' },
  'inside': { color: '#51cf66', label: 'Inside BD (Gateways)' },
};

let currentOptions = {};

let currentData = null;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<div id="treemap-container"></div>';
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
  
  const container = document.getElementById('treemap-container');
  if (!container) return;

  // Determine which types exist
  const types = [...new Set(currentData.nodes.map(n => n.type))].filter(t => TYPE_CONFIG[t]);
  const paneCount = types.length;

  container.style.display = 'flex';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.gap = '6px';
  container.style.padding = '6px';

  container.innerHTML = types.map(t =>
    `<div id="treemap-${t}" style="flex:1;position:relative;min-width:0;">
      <div style="position:absolute;top:4px;left:8px;z-index:1;color:${TYPE_CONFIG[t].color};font-weight:bold;font-size:12px;">${TYPE_CONFIG[t].label}</div>
    </div>`
  ).join('');

  types.forEach(t => renderTreemap(`treemap-${t}`, t));
}

function renderTreemap(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  const cfg = TYPE_CONFIG[type];
  const minTraffic = currentOptions.minTraffic || 0;

  const nodesOfType = currentData.nodes.filter(n => n.type === type && n.traffic >= minTraffic);
  if (nodesOfType.length === 0) return;

  const root = d3.hierarchy({ children: nodesOfType })
    .sum(d => d.traffic || 0)
    .sort((a, b) => b.value - a.value);

  d3.treemap().size([width, height]).padding(2).round(true)(root);

  const svg = d3.select(`#${containerId}`).append('svg').attr('width', width).attr('height', height);
  const colorScale = d3.scaleLinear()
    .domain([0, d3.max(nodesOfType, d => d.traffic)])
    .range([cfg.color + '44', cfg.color]);

  const cell = svg.selectAll('g').data(root.leaves()).enter().append('g')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  cell.append('rect')
    .attr('width', d => d.x1 - d.x0).attr('height', d => d.y1 - d.y0)
    .attr('fill', d => colorScale(d.data.traffic))
    .attr('stroke', '#0a0e27').attr('stroke-width', 1).attr('rx', 2)
    .on('mouseover', function (event, d) {
      d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2);
      const flag = d.data.country ? countryToFlag(d.data.country) + ' ' : '';
      d3.select('#tooltip').html(`
        <div class="tooltip-title">${flag}${d.data.name || `AS${d.data.asn}`}</div>
        <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${d.data.asn}</span></div>
        ${d.data.country ? `<div class="tooltip-row"><span class="tooltip-label">Country:</span><span class="tooltip-value">${flag}${d.data.country}</span></div>` : ''}
        <div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${d.data.traffic.toLocaleString()}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(d.data.percentage || 0).toFixed(1)}%</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Rank:</span><span class="tooltip-value">#${d.data.rank}</span></div>
      `).style('display', 'block');
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select(this).attr('stroke', '#0a0e27').attr('stroke-width', 1); d3.select('#tooltip').style('display', 'none'); });

  // Add text with better sizing and truncation
  cell.each(function(d) {
    const cellWidth = d.x1 - d.x0;
    const cellHeight = d.y1 - d.y0;
    const cellG = d3.select(this);

    if (cellWidth > 40 && cellHeight > 20) {
      const flag = d.data.country ? countryToFlag(d.data.country) + ' ' : '';
      let name = d.data.name || `AS${d.data.asn}`;
      
      // Adaptive text size and truncation based on cell size
      let fontSize = '9px';
      let maxChars = 18;
      if (cellWidth < 80) { fontSize = '8px'; maxChars = 10; }
      if (cellWidth < 60) { fontSize = '7px'; maxChars = 8; }
      
      if (name.length > maxChars) name = name.slice(0, maxChars - 2) + '..';
      
      cellG.append('text')
        .attr('x', 3).attr('y', 12)
        .attr('fill', '#fff')
        .attr('font-size', fontSize)
        .attr('font-weight', 'bold')
        .text(`${flag}${name}`);

      if (cellHeight > 30) {
        cellG.append('text')
          .attr('x', 3).attr('y', 23)
          .attr('fill', '#ffffffcc')
          .attr('font-size', '7px')
          .text(`${(d.data.percentage || 0).toFixed(1)}%`);
      }
    }
  });
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN() {}
export function updateFilter() { render(); }
