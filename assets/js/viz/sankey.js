/**
 * Sankey Flow Diagram
 * Shows route flow: Local ISPs → Gateways → Outside ASNs
 */

import { countryToFlag, buildNodeTooltipHtml, buildEdgeTooltipHtml } from '../api/ripestat.js';

const TYPE_COLORS = { 'outside': '#ff6b6b', 'iig': '#51cf66', 'detected-iig': '#fcc419', 'offshore-enterprise': '#17a2b8', 'offshore-gateway': '#e64980', 'local-company': '#4dabf7', 'inside': '#51cf66', 'offshore-peer': '#ffa94d', 'local-isp': '#4dabf7' };
const TYPE_LABELS = { 'outside': 'Outside BD', 'iig': 'IIG (Licensed)', 'detected-iig': 'Detected Gateway', 'offshore-enterprise': 'Offshore Enterprise', 'offshore-gateway': 'Offshore Gateway', 'local-company': 'Local Company', 'inside': 'Inside BD', 'offshore-peer': 'Offshore Peer', 'local-isp': 'Local ISP' };

function moveTooltipSmart(event) {
  const tooltip = d3.select('#tooltip');
  const tooltipNode = tooltip.node();
  if (!tooltipNode) return;
  // On mobile, tooltip is a CSS bottom sheet
  if (window.innerWidth <= 900) return;
  
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
// Orientation persists across re-renders. Default to portrait on narrow screens.
let orientation = (typeof window !== 'undefined' && window.innerWidth <= 900) ? 'portrait' : 'landscape';
let svgZoom = null;
let fitTransform = null;

const NODE_THICKNESS = 18;  // node size along the flow axis

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="viz-controls" id="sankey-controls">
      <button type="button" class="viz-ctrl-btn" data-orient="landscape" title="Horizontal layout">&#8596; Landscape</button>
      <button type="button" class="viz-ctrl-btn" data-orient="portrait" title="Vertical layout">&#8597; Portrait</button>
      <button type="button" class="viz-ctrl-btn" id="sankey-fit" title="Fit the whole flow to the screen">&#9974; Fit</button>
    </div>
    <svg id="sankey-svg"></svg>`;
  container.querySelectorAll('#sankey-controls [data-orient]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (orientation === btn.dataset.orient) return;
      orientation = btn.dataset.orient;
      render();
    });
  });
  const fitBtn = container.querySelector('#sankey-fit');
  if (fitBtn) fitBtn.addEventListener('click', fitToView);
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  render();
}

function fitToView() {
  if (!svgZoom || !fitTransform) return;
  d3.select('#sankey-svg').transition().duration(300).call(svgZoom.transform, fitTransform);
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
  const isLandscape = orientation === 'landscape';

  // Reflect the active orientation in the toolbar
  const ctrls = document.getElementById('sankey-controls');
  if (ctrls) ctrls.querySelectorAll('[data-orient]').forEach(b => b.classList.toggle('active', b.dataset.orient === orientation));

  const svg = d3.select('#sankey-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();
  const g = svg.append('g');

  // Work in orientation-agnostic (flow, cross) coordinates, then map to screen.
  // flow = the direction the traffic flows across columns; cross = within-column.
  const toX = (flow, cross) => (isLandscape ? flow : cross);
  const toY = (flow, cross) => (isLandscape ? cross : flow);
  const thickness = NODE_THICKNESS;

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  // Check if we have domestic edges (full model) or international-only
  const hasDomestic = currentData.edges.some(e => e.type === 'domestic');
  const hasLocalISP = currentData.nodes.some(n => n.type === 'local-company' || n.type === 'local-isp');

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

  // Flow-axis span: how far apart the columns sit. Cross axis: where nodes stack.
  const margin = 36;
  const flowSpan = (isLandscape ? width : height) - margin * 2;
  const crossViewport = (isLandscape ? height : width) - margin * 2;

  // Column flow positions (Outside -> Gateways -> Local Companies)
  const columns = hasLocalISP && localISPASNs.length > 0
    ? [{ asns: outsideSorted, flow: 0, color: TYPE_COLORS.outside, label: 'Outside' },
       { asns: iigSorted, flow: flowSpan / 2 - thickness / 2, color: TYPE_COLORS.iig, label: 'Gateways' },
       { asns: ispSorted, flow: flowSpan - thickness, color: TYPE_COLORS['local-company'], label: 'Local Companies' }]
    : [{ asns: outsideSorted, flow: 0, color: TYPE_COLORS.outside, label: 'Outside' },
       { asns: iigSorted, flow: flowSpan - thickness, color: TYPE_COLORS.iig, label: 'Inside BD' }];

  // Layout nodes in each column along the cross axis
  const positions = {};
  const totalTraffic = allEdges.reduce((s, e) => s + e.count, 0) || 1;

  const maxNodes = Math.max(...columns.map(c => c.asns.length), 1);
  const minNodeLen = 8;     // min node size along the cross axis
  const padding = 4;
  const neededLen = maxNodes * (minNodeLen + padding);
  // The cross axis grows with node count and can exceed the viewport; the
  // initial fit + wide zoom-out range make the whole flow visible.
  const crossTotal = Math.max(crossViewport, neededLen);

  columns.forEach(col => {
    const colTotal = col.asns.reduce((s, a) => s + a.total, 0) || 1;
    const available = crossTotal - (col.asns.length - 1) * padding;
    let cross = 0;

    col.asns.forEach(({ asn, total }) => {
      const fraction = total / colTotal;
      const nodeLen = Math.max(minNodeLen, fraction * available);
      const nodeColor = (nodeMap[asn] && TYPE_COLORS[nodeMap[asn].type]) || col.color;
      positions[`${asn}_${col.label}`] = { flow: col.flow, cross, len: nodeLen, asn, color: nodeColor };
      cross += nodeLen + padding;
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

      const bandW = Math.max(2, (edge.count / totalTraffic) * crossTotal * 0.6);
      const srcOff = offsets[`${src}_${srcCol}_out`] || 0;
      offsets[`${src}_${srcCol}_out`] = srcOff + bandW;
      const tgtOff = offsets[`${tgt}_${tgtCol}_in`] || 0;
      offsets[`${tgt}_${tgtCol}_in`] = tgtOff + bandW;

      const f0 = srcPos.flow + thickness;
      const c0 = srcPos.cross + srcOff + bandW / 2;
      const f1 = tgtPos.flow;
      const c1 = tgtPos.cross + tgtOff + bandW / 2;
      const fm = (f0 + f1) / 2;
      const d = `M${toX(f0, c0)},${toY(f0, c0)} ` +
                `C${toX(fm, c0)},${toY(fm, c0)} ${toX(fm, c1)},${toY(fm, c1)} ` +
                `${toX(f1, c1)},${toY(f1, c1)}`;

      linkGroup.append('path')
        .attr('class', 'sankey-link')
        .attr('data-source', src).attr('data-target', tgt)
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', Math.max(1, bandW))
        .on('mouseover', function () {
          d3.select(this).attr('stroke-opacity', 0.6);
          d3.select('#tooltip').html(buildEdgeTooltipHtml(nodeMap[src], nodeMap[tgt], edge.count)).style('display', 'block');
        })
        .on('mousemove', moveTooltipSmart)
        .on('mouseout', function () { d3.select(this).attr('stroke-opacity', 0.35); d3.select('#tooltip').style('display', 'none'); });
    });
    if (skipped > 0) console.warn(`Sankey: Drew ${drawn} ${srcCol}→${tgtCol} edges, skipped ${skipped} (missing positions)`);
  }

  drawEdges(intlEdges, 'Outside', columns.length > 2 ? 'Gateways' : 'Inside BD', '#4fc3f7');
  if (domEdges.length > 0) drawEdges(domEdges, 'Local Companies', 'Gateways', '#4dabf7');

  // Draw nodes and labels
  columns.forEach(col => {
    // Column header
    const headFlow = col.flow + thickness / 2;
    const headCross = -14;
    g.append('text')
      .attr('x', toX(headFlow, headCross)).attr('y', toY(headFlow, headCross))
      .attr('text-anchor', isLandscape ? 'middle' : 'end')
      .attr('dy', isLandscape ? 0 : '0.35em')
      .attr('fill', col.color).attr('font-size', '12px').attr('font-weight', 'bold').text(col.label);

    col.asns.forEach(({ asn }) => {
      const key = `${asn}_${col.label}`;
      const pos = positions[key];
      if (!pos) return;
      const node = nodeMap[asn];

      const rx = toX(pos.flow, pos.cross);
      const ry = toY(pos.flow, pos.cross);
      const rw = isLandscape ? thickness : pos.len;
      const rh = isLandscape ? pos.len : thickness;

      g.append('rect').attr('class', 'sankey-node').attr('data-asn', asn)
        .attr('x', rx).attr('y', ry)
        .attr('width', rw).attr('height', rh)
        .attr('fill', pos.color).attr('rx', 2)
        .on('mouseover', function () {
          const nodeData = node || { asn, name: `AS${asn}` };
          d3.select('#tooltip').html(buildNodeTooltipHtml(nodeData, TYPE_LABELS)).style('display', 'block');
        })
        .on('mousemove', moveTooltipSmart)
        .on('mouseout', function () { d3.select('#tooltip').style('display', 'none'); });

      if (pos.len > 10) {
        const flag = node?.country ? countryToFlag(node.country) + ' ' : '';
        const labelText = `${flag}${node?.name || `AS${asn}`}`;
        if (isLandscape) {
          const isFirst = col.flow === 0;
          const lx = isFirst ? pos.flow + thickness + 5 : pos.flow - 5;
          const ly = pos.cross + pos.len / 2;
          g.append('text').attr('class', 'sankey-label').attr('data-asn', asn)
            .attr('x', lx).attr('y', ly).attr('dy', '0.35em')
            .attr('text-anchor', isFirst ? 'start' : 'end')
            .attr('fill', '#ddd').attr('font-size', '9px').text(labelText);
        } else if (pos.len > 36) {
          // Portrait: keep labels horizontal, centered above each (wide enough) bar
          g.append('text').attr('class', 'sankey-label').attr('data-asn', asn)
            .attr('x', pos.cross + pos.len / 2).attr('y', pos.flow - 3)
            .attr('text-anchor', 'middle')
            .attr('fill', '#ddd').attr('font-size', '9px').text(labelText);
        }
      }
    });
  });

  // Zoom hint (lives in content space, scales with the diagram)
  const hintFlow = flowSpan / 2;
  const hintCross = crossTotal + 22;
  g.append('text')
    .attr('x', toX(hintFlow, hintCross)).attr('y', toY(hintFlow, hintCross))
    .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', '11px')
    .text('Scroll to zoom • Drag to pan • Fit to reset');

  // Compute a fit-to-screen transform and a generous zoom-out range so the
  // entire flow is visible regardless of how many nodes there are.
  const contentW = isLandscape ? flowSpan : crossTotal;
  const contentH = isLandscape ? crossTotal : flowSpan;
  const pad = 40;
  const rawScale = Math.min((width - pad * 2) / (contentW || 1), (height - pad * 2) / (contentH || 1));
  const fitScale = Math.max(0.02, Math.min(1, rawScale));
  const tx = (width - contentW * fitScale) / 2;
  const ty = (height - contentH * fitScale) / 2;
  fitTransform = d3.zoomIdentity.translate(tx, ty).scale(fitScale);

  svgZoom = d3.zoom()
    .scaleExtent([Math.min(0.02, fitScale * 0.5), 4])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(svgZoom);
  svg.call(svgZoom.transform, fitTransform);  // apply initial fit
}

export function destroy() { const c = document.getElementById('viz-panel'); if (c) c.innerHTML = ''; }
export function highlightASN(asn) {
  if (!currentData) return;
  const svg = d3.select('#sankey-svg');
  // Dim everything more
  svg.selectAll('.sankey-node').attr('opacity', 0.08);
  svg.selectAll('.sankey-label').attr('opacity', 0.08);
  svg.selectAll('.sankey-link').attr('stroke-opacity', 0.01);
  // Highlight the matching node
  svg.selectAll(`.sankey-node[data-asn="${asn}"]`).attr('opacity', 1).attr('stroke', '#fff').attr('stroke-width', 2);
  svg.selectAll(`.sankey-label[data-asn="${asn}"]`).attr('opacity', 1).attr('fill', '#fff').attr('font-weight', 'bold');
  // Highlight connected links and their target/source nodes
  svg.selectAll(`.sankey-link[data-source="${asn}"], .sankey-link[data-target="${asn}"]`).each(function() {
    const link = d3.select(this);
    link.attr('stroke-opacity', 0.95).attr('stroke-width', parseFloat(link.attr('stroke-width')) + 1);
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
