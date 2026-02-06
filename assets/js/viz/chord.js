/**
 * Chord Diagram - 3-layer model
 * Circular view of connections between ASNs with country flags.
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

const TYPE_COLORS = { 'outside': '#ef5350', 'iig': '#66bb6a', 'local-isp': '#42a5f5', 'inside': '#66bb6a' };
let currentData = null;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="chord-svg"></svg>';
}

export function loadData(data) {
  currentData = data;
  render();
}

function render() {
  if (!currentData) return;
  const container = document.getElementById('viz-panel');
  if (!container) return;
  const size = Math.min(container.clientWidth, container.clientHeight);
  const outerRadius = size / 2 - 70;
  const innerRadius = outerRadius - 20;

  const svg = d3.select('#chord-svg')
    .attr('width', container.clientWidth).attr('height', container.clientHeight);
  svg.selectAll('*').remove();
  const g = svg.append('g')
    .attr('transform', `translate(${container.clientWidth / 2},${container.clientHeight / 2})`);

  // Take top edges for readability
  const topEdges = currentData.edges.slice().sort((a, b) => b.count - a.count).slice(0, 60);
  const asnSet = new Set();
  topEdges.forEach(e => { asnSet.add(e.source?.asn || e.source); asnSet.add(e.target?.asn || e.target); });
  const asnList = [...asnSet];
  const indexMap = {};
  asnList.forEach((asn, i) => { indexMap[asn] = i; });
  const n = asnList.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  topEdges.forEach(e => {
    const si = indexMap[e.source?.asn || e.source];
    const ti = indexMap[e.target?.asn || e.target];
    if (si !== undefined && ti !== undefined) matrix[si][ti] = e.count;
  });

  const nodeMap = {};
  currentData.nodes.forEach(nd => { nodeMap[nd.asn] = nd; });

  const chord = d3.chord().padAngle(0.04).sortSubgroups(d3.descending);
  const chords = chord(matrix);
  const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius);
  const ribbon = d3.ribbon().radius(innerRadius);

  // Arcs
  g.append('g').selectAll('path').data(chords.groups).enter().append('path')
    .attr('d', arc)
    .attr('fill', d => TYPE_COLORS[nodeMap[asnList[d.index]]?.type] || '#888')
    .attr('stroke', '#0a0e27')
    .on('mouseover', function (event, d) {
      const asn = asnList[d.index]; const node = nodeMap[asn];
      const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
      d3.select('#tooltip').html(`<div class="tooltip-title">${flag}${node?.name || `AS${asn}`}</div><div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${(node?.traffic || 0).toLocaleString()}</span></div>`).style('display', 'block');
      ribbons.attr('opacity', r => (r.source.index === d.index || r.target.index === d.index) ? 0.8 : 0.08);
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); ribbons.attr('opacity', 0.45); });

  // Labels with flags
  g.append('g').selectAll('text').data(chords.groups).enter().append('text')
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('dy', '0.35em')
    .attr('transform', d => `rotate(${(d.angle * 180 / Math.PI - 90)}) translate(${outerRadius + 8}) ${d.angle > Math.PI ? 'rotate(180)' : ''}`)
    .attr('text-anchor', d => d.angle > Math.PI ? 'end' : null)
    .attr('fill', '#ccc').attr('font-size', '9px')
    .text(d => {
      const asn = asnList[d.index]; const node = nodeMap[asn];
      const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
      const name = node?.name || `AS${asn}`;
      return `${flag}${name.length > 18 ? name.slice(0, 16) + '...' : name}`;
    });

  // Ribbons
  const ribbons = g.append('g').selectAll('path').data(chords).enter().append('path')
    .attr('d', ribbon)
    .attr('fill', d => (TYPE_COLORS[nodeMap[asnList[d.source.index]]?.type] || '#888') + '55')
    .attr('stroke', '#4fc3f722').attr('opacity', 0.45)
    .on('mouseover', function (event, d) {
      d3.select(this).attr('opacity', 0.9);
      const sn = nodeMap[asnList[d.source.index]]; const tn = nodeMap[asnList[d.target.index]];
      const sf = sn?.country ? countryToFlag(sn.country) + ' ' : '';
      const tf = tn?.country ? countryToFlag(tn.country) + ' ' : '';
      d3.select('#tooltip').html(`<div class="tooltip-title">${sf}${sn?.name || '?'} &harr; ${tf}${tn?.name || '?'}</div><div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${d.source.value.toLocaleString()}</span></div>`).style('display', 'block');
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select(this).attr('opacity', 0.45); d3.select('#tooltip').style('display', 'none'); });
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN() {}
export function updateFilter() { render(); }
