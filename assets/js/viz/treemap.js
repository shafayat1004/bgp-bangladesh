/**
 * Treemap Visualization
 * Shows market share of ASNs by area. Side-by-side: Inside BD vs Outside BD.
 */

let currentData = null;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<div id="treemap-container" style="display:flex;width:100%;height:100%;gap:8px;padding:8px;"></div>';
}

export function loadData(data) {
  currentData = data;
  render();
}

function render() {
  if (!currentData) return;
  const container = document.getElementById('treemap-container');
  if (!container) return;

  container.innerHTML = `
    <div id="treemap-inside" style="flex:1;position:relative;"><div class="treemap-label" style="position:absolute;top:4px;left:8px;z-index:1;color:#66bb6a;font-weight:bold;font-size:13px;">Inside BD (Domestic Gateways)</div></div>
    <div id="treemap-outside" style="flex:1;position:relative;"><div class="treemap-label" style="position:absolute;top:4px;left:8px;z-index:1;color:#ef5350;font-weight:bold;font-size:13px;">Outside BD (International Feeders)</div></div>
  `;

  renderTreemap('treemap-inside', 'inside', '#66bb6a', '#1b5e20');
  renderTreemap('treemap-outside', 'outside', '#ef5350', '#b71c1c');
}

function renderTreemap(containerId, type, color, darkColor) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;

  const nodes = currentData.nodes.filter(n => n.type === type && n.traffic > 0);

  const root = d3.hierarchy({ children: nodes })
    .sum(d => d.traffic || 0)
    .sort((a, b) => b.value - a.value);

  d3.treemap()
    .size([width, height])
    .padding(2)
    .round(true)(root);

  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const colorScale = d3.scaleLinear()
    .domain([0, d3.max(nodes, d => d.traffic)])
    .range([color + '66', color]);

  const cell = svg.selectAll('g')
    .data(root.leaves())
    .enter().append('g')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  cell.append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('fill', d => colorScale(d.data.traffic))
    .attr('stroke', '#0a0e27')
    .attr('stroke-width', 1)
    .attr('rx', 2)
    .on('mouseover', function (event, d) {
      d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2);
      d3.select('#tooltip')
        .html(`
          <div class="tooltip-title">${d.data.name || `AS${d.data.asn}`}</div>
          <div class="tooltip-row"><span class="tooltip-label">ASN:</span><span class="tooltip-value">AS${d.data.asn}</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Traffic:</span><span class="tooltip-value">${d.data.traffic.toLocaleString()} routes</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Share:</span><span class="tooltip-value">${(d.data.percentage || 0).toFixed(1)}%</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Rank:</span><span class="tooltip-value">#${d.data.rank}</span></div>
        `)
        .style('display', 'block');
    })
    .on('mousemove', function (event) {
      d3.select('#tooltip').style('left', (event.pageX + 15) + 'px').style('top', (event.pageY + 15) + 'px');
    })
    .on('mouseout', function () {
      d3.select(this).attr('stroke', '#0a0e27').attr('stroke-width', 1);
      d3.select('#tooltip').style('display', 'none');
    });

  // Labels for cells large enough
  cell.append('text')
    .attr('x', 4).attr('y', 14)
    .attr('fill', '#fff')
    .attr('font-size', d => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      return (w > 60 && h > 30) ? '10px' : '0px';
    })
    .attr('font-weight', 'bold')
    .text(d => d.data.name || `AS${d.data.asn}`);

  cell.append('text')
    .attr('x', 4).attr('y', 26)
    .attr('fill', '#ffffffcc')
    .attr('font-size', d => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      return (w > 60 && h > 40) ? '9px' : '0px';
    })
    .text(d => `${(d.data.percentage || 0).toFixed(1)}%`);
}

export function destroy() {
  const container = document.getElementById('viz-panel');
  if (container) container.innerHTML = '';
}

export function highlightASN() {}
export function updateFilter() { render(); }
