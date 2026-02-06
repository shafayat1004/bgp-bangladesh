/**
 * Sankey Flow Diagram
 * Shows traffic volume flowing from Outside ASNs to Inside ASNs.
 */

let currentData = null;
let svg = null;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="sankey-svg"></svg>';
}

export function loadData(data) {
  currentData = data;
  render();
}

function render() {
  if (!currentData) return;
  const container = document.getElementById('viz-panel');
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg = d3.select('#sankey-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const margin = { top: 20, right: 20, bottom: 20, left: 20 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Take top edges to keep it clean
  const topEdges = currentData.edges.slice().sort((a, b) => b.count - a.count).slice(0, 50);

  // Build unique node lists
  const outsideASNs = [...new Set(topEdges.map(e => e.source?.asn || e.source))];
  const insideASNs = [...new Set(topEdges.map(e => e.target?.asn || e.target))];

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  // Calculate totals for sizing
  const outsideTotals = {};
  const insideTotals = {};
  topEdges.forEach(e => {
    const src = e.source?.asn || e.source;
    const tgt = e.target?.asn || e.target;
    outsideTotals[src] = (outsideTotals[src] || 0) + e.count;
    insideTotals[tgt] = (insideTotals[tgt] || 0) + e.count;
  });

  // Sort by total traffic
  outsideASNs.sort((a, b) => (outsideTotals[b] || 0) - (outsideTotals[a] || 0));
  insideASNs.sort((a, b) => (insideTotals[b] || 0) - (insideTotals[a] || 0));

  const totalTraffic = topEdges.reduce((s, e) => s + e.count, 0);
  const nodeWidth = 20;
  const nodePadding = 8;
  const columnX = { outside: 0, inside: w - nodeWidth };

  // Layout outside nodes
  let y = 0;
  const outsidePositions = {};
  const availableHeight = h - (outsideASNs.length - 1) * nodePadding;
  outsideASNs.forEach(asn => {
    const fraction = (outsideTotals[asn] || 1) / totalTraffic;
    const nodeH = Math.max(4, fraction * availableHeight);
    outsidePositions[asn] = { x: columnX.outside, y, h: nodeH };
    y += nodeH + nodePadding;
  });

  // Layout inside nodes
  y = 0;
  const insidePositions = {};
  const availableH2 = h - (insideASNs.length - 1) * nodePadding;
  insideASNs.forEach(asn => {
    const fraction = (insideTotals[asn] || 1) / totalTraffic;
    const nodeH = Math.max(4, fraction * availableH2);
    insidePositions[asn] = { x: columnX.inside, y, h: nodeH };
    y += nodeH + nodePadding;
  });

  // Draw links
  const linkGroup = g.append('g').attr('class', 'sankey-links');
  const outsideOffsets = {};
  const insideOffsets = {};

  topEdges.sort((a, b) => b.count - a.count).forEach(edge => {
    const src = edge.source?.asn || edge.source;
    const tgt = edge.target?.asn || edge.target;
    const srcPos = outsidePositions[src];
    const tgtPos = insidePositions[tgt];
    if (!srcPos || !tgtPos) return;

    const fraction = edge.count / totalTraffic;
    const bandWidth = Math.max(1, fraction * Math.min(availableHeight, availableH2));

    const srcOffset = outsideOffsets[src] || 0;
    outsideOffsets[src] = srcOffset + bandWidth;

    const tgtOffset = insideOffsets[tgt] || 0;
    insideOffsets[tgt] = tgtOffset + bandWidth;

    const x0 = srcPos.x + nodeWidth;
    const y0 = srcPos.y + srcOffset + bandWidth / 2;
    const x1 = tgtPos.x;
    const y1 = tgtPos.y + tgtOffset + bandWidth / 2;

    linkGroup.append('path')
      .attr('d', `M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`)
      .attr('fill', 'none')
      .attr('stroke', '#4fc3f7')
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', bandWidth)
      .on('mouseover', function () {
        d3.select(this).attr('stroke-opacity', 0.7);
        const srcName = nodeMap[src]?.name || `AS${src}`;
        const tgtName = nodeMap[tgt]?.name || `AS${tgt}`;
        d3.select('#tooltip')
          .html(`<div class="tooltip-title">${srcName} &rarr; ${tgtName}</div><div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${edge.count.toLocaleString()}</span></div>`)
          .style('display', 'block');
      })
      .on('mousemove', function (event) {
        d3.select('#tooltip').style('left', (event.pageX + 15) + 'px').style('top', (event.pageY + 15) + 'px');
      })
      .on('mouseout', function () {
        d3.select(this).attr('stroke-opacity', 0.3);
        d3.select('#tooltip').style('display', 'none');
      });
  });

  // Draw outside nodes
  outsideASNs.forEach(asn => {
    const pos = outsidePositions[asn];
    const node = nodeMap[asn];
    g.append('rect')
      .attr('x', pos.x).attr('y', pos.y)
      .attr('width', nodeWidth).attr('height', pos.h)
      .attr('fill', '#ef5350').attr('rx', 2);

    if (pos.h > 12) {
      g.append('text')
        .attr('x', pos.x + nodeWidth + 6).attr('y', pos.y + pos.h / 2)
        .attr('dy', '0.35em')
        .attr('fill', '#fff').attr('font-size', '10px')
        .text(node?.name || `AS${asn}`);
    }
  });

  // Draw inside nodes
  insideASNs.forEach(asn => {
    const pos = insidePositions[asn];
    const node = nodeMap[asn];
    g.append('rect')
      .attr('x', pos.x).attr('y', pos.y)
      .attr('width', nodeWidth).attr('height', pos.h)
      .attr('fill', '#66bb6a').attr('rx', 2);

    if (pos.h > 12) {
      g.append('text')
        .attr('x', pos.x - 6).attr('y', pos.y + pos.h / 2)
        .attr('dy', '0.35em').attr('text-anchor', 'end')
        .attr('fill', '#fff').attr('font-size', '10px')
        .text(node?.name || `AS${asn}`);
    }
  });

  // Labels
  g.append('text').attr('x', nodeWidth / 2).attr('y', -5).attr('text-anchor', 'middle').attr('fill', '#ef5350').attr('font-size', '12px').attr('font-weight', 'bold').text('Outside BD');
  g.append('text').attr('x', w - nodeWidth / 2).attr('y', -5).attr('text-anchor', 'middle').attr('fill', '#66bb6a').attr('font-size', '12px').attr('font-weight', 'bold').text('Inside BD');
}

export function destroy() {
  const container = document.getElementById('viz-panel');
  if (container) container.innerHTML = '';
}

export function highlightASN() {}
export function updateFilter() { render(); }
