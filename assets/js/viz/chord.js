/**
 * Chord Diagram
 * Circular view of pairwise connections between ASNs.
 */

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
  const outerRadius = size / 2 - 60;
  const innerRadius = outerRadius - 20;

  const svg = d3.select('#chord-svg')
    .attr('width', container.clientWidth)
    .attr('height', container.clientHeight);
  svg.selectAll('*').remove();

  const g = svg.append('g')
    .attr('transform', `translate(${container.clientWidth / 2},${container.clientHeight / 2})`);

  // Take top edges for readability
  const topEdges = currentData.edges.slice().sort((a, b) => b.count - a.count).slice(0, 60);

  // Build matrix
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
    if (si !== undefined && ti !== undefined) {
      matrix[si][ti] = e.count;
    }
  });

  const nodeMap = {};
  currentData.nodes.forEach(nd => { nodeMap[nd.asn] = nd; });

  // Chord layout
  const chord = d3.chord().padAngle(0.04).sortSubgroups(d3.descending);
  const chords = chord(matrix);

  const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius);
  const ribbon = d3.ribbon().radius(innerRadius);

  // Arcs
  g.append('g').selectAll('path')
    .data(chords.groups)
    .enter().append('path')
    .attr('d', arc)
    .attr('fill', d => {
      const node = nodeMap[asnList[d.index]];
      return node?.type === 'inside' ? '#66bb6a' : '#ef5350';
    })
    .attr('stroke', '#0a0e27')
    .on('mouseover', function (event, d) {
      const asn = asnList[d.index];
      const node = nodeMap[asn];
      d3.select('#tooltip')
        .html(`<div class="tooltip-title">${node?.name || `AS${asn}`}</div><div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${(node?.traffic || 0).toLocaleString()}</span></div>`)
        .style('display', 'block');
      // Dim other chords
      ribbons.attr('opacity', r => (r.source.index === d.index || r.target.index === d.index) ? 0.8 : 0.1);
    })
    .on('mousemove', function (event) {
      d3.select('#tooltip').style('left', (event.pageX + 15) + 'px').style('top', (event.pageY + 15) + 'px');
    })
    .on('mouseout', function () {
      d3.select('#tooltip').style('display', 'none');
      ribbons.attr('opacity', 0.5);
    });

  // Labels
  g.append('g').selectAll('text')
    .data(chords.groups)
    .enter().append('text')
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('dy', '0.35em')
    .attr('transform', d => `rotate(${(d.angle * 180 / Math.PI - 90)}) translate(${outerRadius + 8}) ${d.angle > Math.PI ? 'rotate(180)' : ''}`)
    .attr('text-anchor', d => d.angle > Math.PI ? 'end' : null)
    .attr('fill', '#ccc')
    .attr('font-size', '9px')
    .text(d => {
      const asn = asnList[d.index];
      const node = nodeMap[asn];
      const name = node?.name || `AS${asn}`;
      return name.length > 20 ? name.slice(0, 18) + '...' : name;
    });

  // Ribbons
  const ribbons = g.append('g').selectAll('path')
    .data(chords)
    .enter().append('path')
    .attr('d', ribbon)
    .attr('fill', d => {
      const node = nodeMap[asnList[d.source.index]];
      return node?.type === 'inside' ? '#66bb6a44' : '#ef535044';
    })
    .attr('stroke', '#4fc3f744')
    .attr('opacity', 0.5)
    .on('mouseover', function (event, d) {
      d3.select(this).attr('opacity', 0.9);
      const srcName = nodeMap[asnList[d.source.index]]?.name || `AS${asnList[d.source.index]}`;
      const tgtName = nodeMap[asnList[d.target.index]]?.name || `AS${asnList[d.target.index]}`;
      d3.select('#tooltip')
        .html(`<div class="tooltip-title">${srcName} &harr; ${tgtName}</div><div class="tooltip-row"><span class="tooltip-label">Routes:</span><span class="tooltip-value">${d.source.value.toLocaleString()}</span></div>`)
        .style('display', 'block');
    })
    .on('mousemove', function (event) {
      d3.select('#tooltip').style('left', (event.pageX + 15) + 'px').style('top', (event.pageY + 15) + 'px');
    })
    .on('mouseout', function () {
      d3.select(this).attr('opacity', 0.5);
      d3.select('#tooltip').style('display', 'none');
    });
}

export function destroy() {
  const container = document.getElementById('viz-panel');
  if (container) container.innerHTML = '';
}

export function highlightASN() {}
export function updateFilter() { render(); }
