/**
 * Bar List
 * Shared drawing for the ranking tabs (Gateway Ranking, Country Origins): an
 * HTML ordered list with CSS bars instead of a zoomable SVG. It fits the panel
 * width, scrolls vertically like a page, and screen readers read each row.
 */

import { positionTooltip } from '../ui/tooltip.js';

/**
 * Draw (or redraw) a bar list into the panel, keeping the scroll position.
 *
 * @param {HTMLElement} container  the #viz-panel
 * @param {object} view
 *   title      question the chart answers (heading)
 *   summary    one sentence with the takeaway, in plain numbers
 *   label      accessible name for the scrolling region
 *   legend     optional [{ color, text }] for the bar segments
 *   rows       [{ key, rank, name, fullName, tag, tagColor, segments: [{ value, color }],
 *                 total, value, detail, tooltip }]
 *                value is the visible number, detail is extra text for screen
 *                readers, tooltip returns HTML for the shared hover tooltip
 *   max        value that fills a whole bar
 *   empty      message when there are no rows
 */
export function renderBarList(container, view) {
  const previous = container.querySelector('.bar-view');
  const scrollTop = previous ? previous.scrollTop : 0;
  container.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'bar-view';
  root.tabIndex = 0;   // scrollable regions must be reachable by keyboard
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', view.label);
  container.appendChild(root);

  const head = el('div', 'bar-view-head', root);
  el('h2', 'bar-view-title', head).textContent = view.title;
  if (view.summary) el('p', 'bar-view-summary', head).textContent = view.summary;
  if (view.legend?.length) {
    const legend = el('ul', 'bar-legend', head);
    for (const item of view.legend) {
      const li = el('li', '', legend);
      const swatch = el('span', 'bar-legend-swatch', li);
      swatch.style.background = item.color;
      swatch.setAttribute('aria-hidden', 'true');
      li.append(item.text);
    }
  }

  if (!view.rows.length) {
    el('p', 'bar-view-empty', root).textContent = view.empty;
    return;
  }

  const tooltip = d3.select('#tooltip');
  const list = el('ol', 'bar-list', root);
  for (const row of view.rows) {
    const li = el('li', 'bar-row', list);
    li.dataset.key = row.key;

    el('span', 'bar-rank', li).textContent = row.rank;

    const label = el('span', 'bar-label', li);
    const name = el('span', 'bar-name', label);
    name.textContent = row.name;
    if (row.fullName && row.fullName !== row.name) name.title = row.fullName;
    if (row.tag) {
      const tag = el('span', 'bar-tag', label);
      tag.textContent = row.tag;
      tag.style.setProperty('--tag-color', row.tagColor || 'var(--text-dim)');
    }

    const track = el('span', 'bar-track', li);
    track.setAttribute('aria-hidden', 'true');
    for (const seg of row.segments) {
      const s = el('span', 'bar-seg', track);
      s.style.width = `${view.max ? (seg.value / view.max) * 100 : 0}%`;
      s.style.background = seg.color;
    }

    el('span', 'bar-value', li).textContent = row.value;
    if (row.detail) el('span', 'visually-hidden', li).textContent = ` ${row.detail}`;

    if (row.tooltip) {
      li.addEventListener('mouseenter', () => tooltip.html(row.tooltip()).style('display', 'block'));
      li.addEventListener('mousemove', (event) => positionTooltip(event, tooltip));
      li.addEventListener('mouseleave', () => tooltip.style('display', 'none'));
    }
  }

  root.scrollTop = scrollTop;
}

/** Mark one row and scroll it into view; returns false if it isn't listed. */
export function highlightBarRow(container, key) {
  const rows = container.querySelectorAll('.bar-row');
  let found = null;
  rows.forEach(r => {
    const match = r.dataset.key === String(key);
    r.classList.toggle('highlighted', match);
    if (match) found = r;
  });
  found?.scrollIntoView({ block: 'nearest' });
  return !!found;
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}
