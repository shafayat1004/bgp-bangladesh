/**
 * Chord Diagram
 * Circular view of connections between ASNs with country flags.
 */

import { countryToFlag, buildNodeTooltipHtml, buildEdgeTooltipHtml } from '../api/ripestat.js';

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

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'detected-iig': '#fcc419', 'offshore-enterprise': '#17a2b8', 'offshore-gateway': '#e64980', 'local-company': '#4dabf7', 'inside': '#51cf66', 'offshore-peer': '#ffa94d', 'local-isp': '#4dabf7' };
const TYPE_LABELS = { 'outside': 'Outside BD', 'iig': 'IIG (Licensed)', 'detected-iig': 'Detected Gateway', 'offshore-enterprise': 'Offshore Enterprise', 'offshore-gateway': 'Offshore Gateway', 'local-company': 'Local Company', 'inside': 'Inside BD', 'offshore-peer': 'Offshore Peer', 'local-isp': 'Local ISP' };
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
  
  const svg = d3.select('#chord-svg')
    .attr('width', container.clientWidth).attr('height', container.clientHeight);
  svg.selectAll('*').remove();
  
  // Add zoom functionality
  const zoomGroup = svg.append('g');
  const zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .on('zoom', (event) => {
      zoomGroup.attr('transform', event.transform);
    });
  svg.call(zoom);
  
  const g = zoomGroup.append('g')
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
  
  // Dynamically adjust radius based on number of nodes
  // More nodes = relatively smaller radius, fewer nodes = much larger radius
  const baseRadius = size / 2 - 70;
  const radiusScale = n < 5 ? 1.6 : n < 10 ? 1.4 : n < 20 ? 1.2 : 1.0;
  const outerRadius = Math.min(baseRadius * radiusScale, size / 2 - 30);
  const innerRadius = outerRadius - Math.max(12, 30 - n * 0.8);
  
  // Dynamic font size and spacing based on number of nodes
  const fontSize = n < 5 ? 13 : n < 10 ? 12 : n < 20 ? 10 : 9;
  const labelDistance = n < 5 ? 15 : n < 10 ? 13 : n < 20 ? 10 : 8;
  
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
      const nodeData = node || { asn, name: `AS${asn}` };
      d3.select('#tooltip').html(buildNodeTooltipHtml(nodeData, TYPE_LABELS)).style('display', 'block');
      chordRibbons.attr('opacity', r => (r.source.index === d.index || r.target.index === d.index) ? 0.8 : 0.08);
    })
    .on('mousemove', moveTooltipSmart)
    .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); chordRibbons.attr('opacity', 0.45); });

  // Labels with flags
  g.append('g').selectAll('text').data(chords.groups).enter().append('text')
    .attr('class', 'chord-label')
    .attr('data-asn', d => asnList[d.index])
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('dy', '0.35em')
    .attr('transform', d => `rotate(${(d.angle * 180 / Math.PI - 90)}) translate(${outerRadius + labelDistance}) ${d.angle > Math.PI ? 'rotate(180)' : ''}`)
    .attr('text-anchor', d => d.angle > Math.PI ? 'end' : null)
    .attr('fill', '#ccc').attr('font-size', `${fontSize}px`)
    .text(d => {
      const asn = asnList[d.index]; const node = nodeMap[asn];
      const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
      const name = node?.name || `AS${asn}`;
      const maxLen = n < 5 ? 30 : n < 10 ? 25 : n < 20 ? 20 : 18;
      return `${flag}${name.length > maxLen ? name.slice(0, maxLen - 2) + '...' : name}`;
    });

  // Ribbons
  chordRibbons = g.append('g').selectAll('path').data(chords).enter().append('path')
    .attr('class', 'chord-ribbon')
    .attr('data-source', d => asnList[d.source.index])
    .attr('data-target', d => asnList[d.target.index])
    .attr('d', ribbon)
    .attr('fill', d => (TYPE_COLORS[nodeMap[asnList[d.source.index]]?.type] || '#888') + '55')
    .attr('stroke', '#4fc3f722').attr('opacity', 0.45)
    .on('mouseover', function (event, d) {
      d3.select(this).attr('opacity', 0.9);
      const sn = nodeMap[asnList[d.source.index]]; const tn = nodeMap[asnList[d.target.index]];
      d3.select('#tooltip').html(buildEdgeTooltipHtml(sn, tn, d.source.value)).style('display', 'block');
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
  
  // Build lookup map for performance
  const nodeTypeMap = {};
  currentData.nodes.forEach(n => { nodeTypeMap[n.asn] = n.type; });
  
  // Hide/show arcs
  svg.selectAll('.chord-arc').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    return nodeTypeMap[asn] && activeTypes.has(nodeTypeMap[asn]) ? null : 'none';
  });
  
  // Hide/show labels
  svg.selectAll('.chord-label').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    return nodeTypeMap[asn] && activeTypes.has(nodeTypeMap[asn]) ? null : 'none';
  });
  
  // Hide/show ribbons (hide if either source or target type is hidden)
  svg.selectAll('.chord-ribbon').attr('display', function() {
    const src = d3.select(this).attr('data-source');
    const tgt = d3.select(this).attr('data-target');
    const srcVisible = nodeTypeMap[src] && activeTypes.has(nodeTypeMap[src]);
    const tgtVisible = nodeTypeMap[tgt] && activeTypes.has(nodeTypeMap[tgt]);
    return (srcVisible && tgtVisible) ? null : 'none';
  });
}
