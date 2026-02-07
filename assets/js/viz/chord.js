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

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'detected-iig': '#fcc419', 'offshore-peer': '#ffa94d', 'local-isp': '#4dabf7', 'inside': '#51cf66' };
let currentData = null;
let currentOptions = {};
let chordASNList = [];
let chordIndexMap = {};
let chordRibbons = null;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="chord-svg"></svg>';
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
  const size = Math.min(container.clientWidth, container.clientHeight);
  const outerRadius = size / 2 - 70;
  const innerRadius = outerRadius - 20;

  const svg = d3.select('#chord-svg')
    .attr('width', container.clientWidth).attr('height', container.clientHeight);
  svg.selectAll('*').remove();
  const g = svg.append('g')
    .attr('transform', `translate(${container.clientWidth / 2},${container.clientHeight / 2})`);

  // Filter edges by traffic range (no arbitrary limits)
  const filteredEdges = currentData.edges
    .filter(e => e.count >= minTraffic && e.count <= maxTraffic)
    .sort((a, b) => b.count - a.count);
  const asnSet = new Set();
  filteredEdges.forEach(e => { asnSet.add(e.source?.asn || e.source); asnSet.add(e.target?.asn || e.target); });
  chordASNList = [...asnSet];
  const asnList = chordASNList;
  chordIndexMap = {};
  const indexMap = chordIndexMap;
  asnList.forEach((asn, i) => { indexMap[asn] = i; });
  const n = asnList.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  filteredEdges.forEach(e => {
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
  const arcs = g.append('g').selectAll('path').data(chords.groups).enter().append('path')
    .attr('class', 'chord-arc')
    .attr('data-asn', d => asnList[d.index])
    .attr('d', arc)
    .attr('fill', d => TYPE_COLORS[nodeMap[asnList[d.index]]?.type] || '#888')
    .attr('stroke', '#0a0e27')
    .on('mouseover', function (event, d) {
      const asn = asnList[d.index]; const node = nodeMap[asn];
      const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
      d3.select('#tooltip').html(`<div class="tooltip-title">${flag}${node?.name || `AS${asn}`}</div><div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${(node?.traffic || 0).toLocaleString()}</span></div>`).style('display', 'block');
      chordRibbons.attr('opacity', r => (r.source.index === d.index || r.target.index === d.index) ? 0.8 : 0.08);
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); chordRibbons.attr('opacity', 0.45); });

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
  chordRibbons = g.append('g').selectAll('path').data(chords).enter().append('path')
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
export function highlightASN(asn) {
  const idx = chordIndexMap[asn];
  if (idx === undefined || !chordRibbons) return;
  const svg = d3.select('#chord-svg');
  // Dim all arcs and ribbons
  svg.selectAll('.chord-arc').attr('opacity', 0.15);
  chordRibbons.attr('opacity', 0.05);
  // Highlight matching arc
  svg.selectAll(`.chord-arc[data-asn="${asn}"]`).attr('opacity', 1).attr('stroke', '#fff').attr('stroke-width', 2);
  // Highlight connected ribbons and their partner arcs
  chordRibbons.each(function(d) {
    if (d.source.index === idx || d.target.index === idx) {
      d3.select(this).attr('opacity', 0.8);
      const otherIdx = d.source.index === idx ? d.target.index : d.source.index;
      const otherASN = chordASNList[otherIdx];
      svg.selectAll(`.chord-arc[data-asn="${otherASN}"]`).attr('opacity', 1);
    }
  });
  // Click to clear
  svg.on('click.highlight', () => {
    svg.selectAll('.chord-arc').attr('opacity', 1).attr('stroke', '#0a0e27').attr('stroke-width', 1);
    chordRibbons.attr('opacity', 0.45);
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
  const svg = d3.select('#chord-svg');
  if (svg.empty()) return;
  svg.selectAll('.chord-arc').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    const node = currentData.nodes.find(n => n.asn === asn);
    return node && activeTypes.has(node.type) ? null : 'none';
  });
}
