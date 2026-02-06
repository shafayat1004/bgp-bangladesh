/**
 * Hierarchical Layered View
 * Clean top-to-bottom view: Inside BD ASNs (top) ← Outside BD ASNs (bottom).
 */

let currentData = null;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<svg id="hier-svg"></svg>';
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

  const svg = d3.select('#hier-svg').attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  // Zoom
  const zoom = d3.zoom().scaleExtent([0.3, 3]).on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  const g = svg.append('g');

  const margin = { top: 60, bottom: 60, left: 40, right: 40 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  // Top edges for clarity
  const topEdges = currentData.edges.slice().sort((a, b) => b.count - a.count).slice(0, 80);
  const usedASNs = new Set();
  topEdges.forEach(e => { usedASNs.add(e.source?.asn || e.source); usedASNs.add(e.target?.asn || e.target); });

  const insideNodes = currentData.nodes.filter(n => n.type === 'inside' && usedASNs.has(n.asn)).sort((a, b) => b.traffic - a.traffic);
  const outsideNodes = currentData.nodes.filter(n => n.type === 'outside' && usedASNs.has(n.asn)).sort((a, b) => b.traffic - a.traffic);

  const nodeMap = {};
  currentData.nodes.forEach(n => { nodeMap[n.asn] = n; });

  const topY = margin.top;
  const bottomY = height - margin.bottom;
  const boxW = 90;
  const boxH = 36;

  // Position inside nodes (top row)
  const insideSpacing = Math.min(w / insideNodes.length, boxW + 10);
  const insideStartX = margin.left + (w - insideNodes.length * insideSpacing) / 2;
  const insidePositions = {};
  insideNodes.forEach((n, i) => {
    insidePositions[n.asn] = { x: insideStartX + i * insideSpacing + insideSpacing / 2, y: topY };
  });

  // Position outside nodes (bottom row)
  const outsideSpacing = Math.min(w / outsideNodes.length, boxW + 10);
  const outsideStartX = margin.left + (w - outsideNodes.length * outsideSpacing) / 2;
  const outsidePositions = {};
  outsideNodes.forEach((n, i) => {
    outsidePositions[n.asn] = { x: outsideStartX + i * outsideSpacing + outsideSpacing / 2, y: bottomY };
  });

  // Draw edges
  const maxCount = topEdges[0]?.count || 1;
  topEdges.forEach(edge => {
    const src = edge.source?.asn || edge.source;
    const tgt = edge.target?.asn || edge.target;
    const srcPos = outsidePositions[src];
    const tgtPos = insidePositions[tgt];
    if (!srcPos || !tgtPos) return;

    const opacity = 0.1 + (edge.count / maxCount) * 0.5;
    const strokeW = Math.max(0.5, (edge.count / maxCount) * 4);

    g.append('path')
      .attr('d', `M${srcPos.x},${srcPos.y - boxH / 2} C${srcPos.x},${(srcPos.y + tgtPos.y) / 2} ${tgtPos.x},${(srcPos.y + tgtPos.y) / 2} ${tgtPos.x},${tgtPos.y + boxH / 2}`)
      .attr('fill', 'none')
      .attr('stroke', '#4fc3f7')
      .attr('stroke-opacity', opacity)
      .attr('stroke-width', strokeW)
      .on('mouseover', function (event) {
        d3.select(this).attr('stroke-opacity', 0.9).attr('stroke-width', strokeW + 2);
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
        d3.select(this).attr('stroke-opacity', opacity).attr('stroke-width', strokeW);
        d3.select('#tooltip').style('display', 'none');
      });
  });

  // Draw inside nodes (top)
  drawNodeRow(g, insideNodes, insidePositions, '#66bb6a', boxW, boxH, nodeMap);

  // Draw outside nodes (bottom)
  drawNodeRow(g, outsideNodes, outsidePositions, '#ef5350', boxW, boxH, nodeMap);

  // Row labels
  g.append('text').attr('x', margin.left).attr('y', topY - 15).attr('fill', '#66bb6a').attr('font-size', '13px').attr('font-weight', 'bold').text('Inside BD (Domestic Gateways)');
  g.append('text').attr('x', margin.left).attr('y', bottomY + boxH / 2 + 20).attr('fill', '#ef5350').attr('font-size', '13px').attr('font-weight', 'bold').text('Outside BD (International Feeders)');
}

function drawNodeRow(g, nodes, positions, color, boxW, boxH, nodeMap) {
  nodes.forEach(n => {
    const pos = positions[n.asn];
    if (!pos) return;

    const group = g.append('g')
      .attr('transform', `translate(${pos.x - boxW / 2},${pos.y - boxH / 2})`)
      .attr('cursor', 'pointer');

    group.append('rect')
      .attr('width', boxW).attr('height', boxH)
      .attr('fill', color + '33')
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('rx', 4);

    group.append('text')
      .attr('x', boxW / 2).attr('y', boxH / 2 - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff').attr('font-size', '9px').attr('font-weight', 'bold')
      .text(() => {
        const name = n.name || `AS${n.asn}`;
        return name.length > 12 ? name.slice(0, 11) + '...' : name;
      });

    group.append('text')
      .attr('x', boxW / 2).attr('y', boxH / 2 + 10)
      .attr('text-anchor', 'middle')
      .attr('fill', '#aaa').attr('font-size', '8px')
      .text(`${(n.percentage || 0).toFixed(1)}%`);

    group.on('mouseover', function (event) {
      d3.select('#tooltip').html(`
        <div class="tooltip-title">${n.name || `AS${n.asn}`}</div>
        <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${n.asn}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${n.traffic.toLocaleString()} routes</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(n.percentage || 0).toFixed(1)}%</span></div>
      `).style('display', 'block');
    })
    .on('mousemove', function (event) {
      d3.select('#tooltip').style('left', (event.pageX + 15) + 'px').style('top', (event.pageY + 15) + 'px');
    })
    .on('mouseout', function () {
      d3.select('#tooltip').style('display', 'none');
    });
  });
}

export function destroy() {
  const container = document.getElementById('viz-panel');
  if (container) container.innerHTML = '';
}

export function highlightASN() {}
export function updateFilter() { render(); }
