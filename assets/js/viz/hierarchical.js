/**
 * Hierarchical Layered View
 * Top: Local ISPs | Middle: Gateways | Bottom: Outside ASNs
 */

import { CATEGORY_LABELS, CATEGORY_PLURALS } from '../ui/glossary.js';
import { countryToFlag } from '../ui/names.js';
import { buildNodeTooltipHtml, buildEdgeTooltipHtml, showTooltip, moveTooltip, endHover } from '../ui/tooltip.js';
import { makeChartAccessible } from '../ui/chart-a11y.js';
import { CATEGORY_COLORS, LINK_COLORS, INK } from '../ui/colors.js';
import { sourceAsn, targetAsn, networksByAsn } from '../data/network-data.js';
import { DEFAULT_MIN_ROUTES } from '../ui/filters.js';

const TYPE_COLORS = CATEGORY_COLORS;
const TYPE_LABELS = CATEGORY_PLURALS;

let currentData = null;
let currentOptions = {};
let highlightedASN = null; // Track which ASN is currently highlighted
let savedTransform = null; // Preserve zoom/pan across re-renders
let zoom = null;
let fittedTransform = null; // The "whole picture" view, used by Reset View

const BOX_W = 70;
const BOX_H = 28;
const CELL_W = BOX_W;      // boxes touch horizontally
const CELL_H = BOX_H + 2;  // minimal vertical spacing
const LAYER_PAD = 12;      // space between a layer's title and the next layer
const FIT_MARGIN = 12;     // screen pixels kept free around the fitted picture

/**
 * Pick how many boxes go in each row so the whole picture, zoomed to fit, is as
 * large as possible on a width x height panel. Exported for unit testing.
 */
export function chooseColumns(layerSizes, width, height, titleHeight) {
  const maxN = Math.max(1, ...layerSizes);
  let best = { cols: 1, scale: 0 };
  for (let cols = 1; cols <= maxN; cols++) {
    const contentW = cols * CELL_W + CELL_W / 2;  // zigzag rows are offset by half a cell
    const contentH = layerSizes.reduce((sum, n) => sum + titleHeight + Math.ceil(n / cols) * CELL_H + LAYER_PAD, 0);
    const scale = Math.min(width / contentW, height / contentH);
    if (scale > best.scale) best = { cols, scale };
  }
  return best;
}

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="hier-svg"></svg>';
  savedTransform = null; // Reset on fresh init
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  savedTransform = null; // Reset zoom for new data
  highlightedASN = null;
  render();
}

/** Swap in a new snapshot, keeping the current pan/zoom and highlight. */
export function updateData(data, options = {}) {
  currentData = data;
  currentOptions = { ...currentOptions, ...options };
  render();
}

export function resetView() {
  if (!zoom || !fittedTransform) return;
  const svg = d3.select('#hier-svg');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  (reduced ? svg : svg.transition().duration(750)).call(zoom.transform, fittedTransform);
}

function render() {
  if (!currentData) return;
  const options = currentOptions;
  const minTraffic = options.minTraffic ?? DEFAULT_MIN_ROUTES;
  const maxTraffic = options.maxTraffic ?? Infinity;

  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3.select('#hier-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const g = svg.append('g');
  zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => {
    g.attr('transform', event.transform);
    savedTransform = event.transform; // Persist zoom state across re-renders
  });
  svg.call(zoom);

  const nodeMap = networksByAsn(currentData.nodes);

  const hasDomestic = currentData.edges.some(e => e.type === 'domestic');
  const hasLocalISP = currentData.nodes.some(n => n.type === 'local-company');

  // Filter edges by traffic range (handle undefined/null traffic as 0)
  const filteredIntl = currentData.edges
    .filter(e => (e.type === 'international' || !e.type) && (e.count || 0) >= minTraffic && (e.count || 0) <= maxTraffic)
    .sort((a, b) => b.count - a.count);
  const filteredDom = hasDomestic 
    ? currentData.edges.filter(e => e.type === 'domestic' && (e.count || 0) >= minTraffic && (e.count || 0) <= maxTraffic).sort((a, b) => b.count - a.count)
    : [];

  const usedASNs = new Set();
  [...filteredIntl, ...filteredDom].forEach(e => {
    usedASNs.add(sourceAsn(e));
    usedASNs.add(targetAsn(e));
  });

  // Determine layers (top to bottom: Local Companies → IIGs → Detected → Offshore → Outside)
  const layers = [];
  const filterNodes = (type) => currentData.nodes.filter(n => n.type === type && usedASNs.has(n.asn) && (n.traffic || 0) >= minTraffic && (n.traffic || 0) <= maxTraffic).sort((a, b) => (b.traffic || 0) - (a.traffic || 0));
  
  if (hasLocalISP) {
    const localCompanies = currentData.nodes.filter(n => n.type === 'local-company' && usedASNs.has(n.asn) && (n.traffic || 0) >= minTraffic && (n.traffic || 0) <= maxTraffic).sort((a, b) => (b.traffic || 0) - (a.traffic || 0));
    if (localCompanies.length > 0) layers.push({ type: 'local-company', nodes: localCompanies });
  }

  const iigs = currentData.nodes.filter(n => n.type === 'iig' && usedASNs.has(n.asn) && (n.traffic || 0) >= minTraffic && (n.traffic || 0) <= maxTraffic).sort((a, b) => (b.traffic || 0) - (a.traffic || 0));
  if (iigs.length > 0) layers.push({ type: 'iig', nodes: iigs });

  const detectedIigs = filterNodes('detected-iig');
  if (detectedIigs.length > 0) layers.push({ type: 'detected-iig', nodes: detectedIigs });

  const offshoreEnt = filterNodes('offshore-enterprise');
  if (offshoreEnt.length > 0) layers.push({ type: 'offshore-enterprise', nodes: offshoreEnt });

  const offshoreGw = filterNodes('offshore-gateway');
  if (offshoreGw.length > 0) layers.push({ type: 'offshore-gateway', nodes: offshoreGw });

  const outside = filterNodes('outside');
  if (outside.length > 0) layers.push({ type: 'outside', nodes: outside });

  // Size the rows to the panel's shape, then zoom so the whole picture fills it.
  // Layer titles are sized for the fitted zoom so they stay readable; that
  // changes the layout height, so fit twice.
  const layerSizes = layers.map(l => l.nodes.length);
  const availW = width - 2 * FIT_MARGIN;
  const availH = height - 2 * FIT_MARGIN;
  let titleSize = 14;
  let fit = chooseColumns(layerSizes, availW, availH, titleSize + 8);
  titleSize = Math.min(48, Math.max(14, 13 / fit.scale));
  fit = chooseColumns(layerSizes, availW, availH, titleSize + 8);
  const maxNodesPerRow = fit.cols;
  const minSpacing = CELL_W;
  const boxW = BOX_W;
  const boxH = BOX_H;
  const w = maxNodesPerRow * CELL_W + CELL_W / 2;

  // Position each layer with multi-row zigzag layout
  const positions = {};
  let currentLayerY = 0;

  layers.forEach((layer, li) => {
    const nodeCount = layer.nodes.length;
    const nodesPerRow = Math.min(maxNodesPerRow, nodeCount);
    const numRows = Math.ceil(nodeCount / nodesPerRow);
    const rowSpacing = CELL_H;
    const layerHeight = numRows * rowSpacing;

    // Layer title above its rows
    currentLayerY += titleSize + 8;
    g.append('text')
      .attr('class', 'hier-layer-title')
      .attr('x', 0)
      .attr('y', currentLayerY - 6)
      .attr('fill', INK.text)
      .attr('font-size', `${titleSize}px`)
      .attr('font-weight', 'bold')
      .text(TYPE_LABELS[layer.type] || layer.type);

    // Layout nodes in zigzag pattern
    layer.nodes.forEach((n, i) => {
      const row = Math.floor(i / nodesPerRow);
      const colInRow = i % nodesPerRow;
      const actualNodesInThisRow = Math.min(nodesPerRow, nodeCount - row * nodesPerRow);

      // Calculate horizontal spacing for this row
      const rowWidth = actualNodesInThisRow * minSpacing;
      const startX = (w - CELL_W / 2 - rowWidth) / 2;
      
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
    currentLayerY += layerHeight + LAYER_PAD;
  });

  // Fit the whole picture to the panel; keep the user's pan/zoom if they have one.
  const k = fit.scale;
  fittedTransform = d3.zoomIdentity
    .translate((width - k * w) / 2, (height - k * currentLayerY) / 2)
    .scale(k);
  svg.call(zoom.transform, savedTransform || fittedTransform);

  const layerSummary = layers.map(l => `${l.nodes.length} ${TYPE_LABELS[l.type] || l.type}`).join(', ');
  makeChartAccessible(svg, {
    zoom,
    label: `Layered view, from local companies at the top to international networks at the bottom: ${layerSummary}. Lines connect each network to the gateways it uses.`,
    reset: resetView,
    onEscape: clearHighlight,
  });

  // Draw edges (use filtered edges with adaptive curves for multi-row layout)
  const allEdges = [...filteredIntl, ...filteredDom];
  const maxCount = Math.max(...allEdges.map(e => e.count), 1);

  allEdges.forEach(edge => {
    const src = sourceAsn(edge);
    const tgt = targetAsn(edge);
    const srcPos = positions[src];
    const tgtPos = positions[tgt];
    if (!srcPos || !tgtPos) return;

    const opacity = 0.08 + (edge.count / maxCount) * 0.45;
    const strokeW = Math.max(0.5, (edge.count / maxCount) * 3.5);
    const color = edge.type === 'domestic' ? LINK_COLORS.domestic : LINK_COLORS.international;

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
        showTooltip(buildEdgeTooltipHtml(nodeMap[src], nodeMap[tgt], edge.count, edge.type || 'international'), event);
      })
      .on('mousemove', moveTooltip)
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
        endHover(); 
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
      .attr('fill', color + '33').attr('stroke', color).attr('stroke-width', 1.5).attr('rx', 4);

    const flag = n.country ? countryToFlag(n.country) : '';
    const displayName = n.name || `AS${n.asn}`;
    const truncated = displayName.length > 10 ? displayName.slice(0, 9) + '…' : displayName;

    group.append('text').attr('x', boxW / 2).attr('y', boxH / 2 - 3).attr('text-anchor', 'middle')
      .attr('fill', INK.text).attr('font-size', '8px').attr('font-weight', 'bold')
      .text(`${flag} ${truncated}`);

    group.append('text').attr('x', boxW / 2).attr('y', boxH / 2 + 9).attr('text-anchor', 'middle')
      .attr('fill', INK.muted).attr('font-size', '7px')
      .text(`${(n.percentage || 0).toFixed(1)}%`);

    group.on('mouseover', function (event) {
      showTooltip(buildNodeTooltipHtml(n, CATEGORY_LABELS), event);
    })
    .on('mousemove', moveTooltip)
    .on('mouseout', function () { endHover(); })
    .on('click', function (event) {
      event.stopPropagation();
      highlightASN(asn);
    });
  }

  // Keep a highlight across re-renders (filter changes, history snapshots).
  if (highlightedASN) {
    if (positions[highlightedASN]) highlightASN(highlightedASN);
    else highlightedASN = null;
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
  svg.on('click.highlight', clearHighlight);
}

function clearHighlight() {
  highlightedASN = null; // Clear the highlighted ASN
  const svg = d3.select('#hier-svg');
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
  
  const byAsn = networksByAsn(currentData.nodes);
  const isShown = (asn) => activeTypes.has(byAsn[asn]?.type);
  
  svg.selectAll('.hier-node').attr('display', function() {
    const asn = d3.select(this).attr('data-asn');
    return isShown(asn) ? null : 'none';
  });
  svg.selectAll('.hier-link').attr('display', function() {
    const src = d3.select(this).attr('data-source');
    const tgt = d3.select(this).attr('data-target');
    return isShown(src) && isShown(tgt) ? null : 'none';
  });
}
