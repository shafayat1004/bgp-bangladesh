/**
 * Chart Accessibility
 *
 * Gives a chart SVG a text label and ways to pan/zoom without a mouse drag:
 *  - the SVG is focusable: arrow keys pan, + and - zoom, 0 resets, Escape
 *    runs the chart's onEscape (e.g. clears a highlight)
 *  - on-screen buttons do the same with single clicks (WCAG 2.5.7)
 * Every chart's label points to the Data Table tab, the full text alternative.
 */

const KEY_HINT = 'Focus the chart and use the arrow keys to pan, plus and minus to zoom, and 0 to reset. The Data Table tab lists the same data as text.';
const PAN_STEP = 80;    // screen pixels per press
const ZOOM_STEP = 1.3;

const BUTTONS = [
  { action: 'zoom-in', symbol: '+', label: 'Zoom in' },
  { action: 'zoom-out', symbol: '−', label: 'Zoom out' },
  { action: 'left', symbol: '←', label: 'Pan left' },
  { action: 'up', symbol: '↑', label: 'Pan up' },
  { action: 'down', symbol: '↓', label: 'Pan down' },
  { action: 'right', symbol: '→', label: 'Pan right' },
  { action: 'reset', symbol: '↺', label: 'Reset view' },
];

const KEY_ACTIONS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '_': 'zoom-out', '0': 'reset',
};

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function run(svgNode, action) {
  const state = svgNode.__chartA11y;
  if (!state) return;
  if (action === 'reset') { state.reset(); return; }
  const svg = d3.select(svgNode);
  const target = prefersReducedMotion() ? svg : svg.transition().duration(200);
  const k = d3.zoomTransform(svgNode).k;
  // Pan moves the picture so the view travels in the arrow's direction.
  const pan = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[action];
  if (pan) state.zoom.translateBy(target, (pan[0] * PAN_STEP) / k, (pan[1] * PAN_STEP) / k);
  else if (action === 'zoom-in') state.zoom.scaleBy(target, ZOOM_STEP);
  else if (action === 'zoom-out') state.zoom.scaleBy(target, 1 / ZOOM_STEP);
}

/**
 * @param {d3.Selection} svg       the chart's <svg>
 * @param {object} opts
 *   zoom      the d3.zoom behaviour applied to the svg
 *   label     one or two sentences describing what the chart shows
 *   reset     function returning the chart to its initial view
 *   onEscape  optional, run when Escape is pressed on the chart
 *   toolbar   optional element to put the buttons in (default: a new group
 *             in the chart's container); includeReset false skips the reset
 *             button when that toolbar already has one
 */
export function makeChartAccessible(svg, { zoom, label, reset, onEscape, toolbar, includeReset = true }) {
  const node = svg.node();
  if (!node) return;
  node.__chartA11y = { zoom, reset, onEscape };
  svg.attr('role', 'img')
    .attr('tabindex', 0)
    .attr('aria-label', `${label} ${KEY_HINT}`);

  if (!node.__chartKeysBound) {
    node.__chartKeysBound = true;
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { node.__chartA11y?.onEscape?.(); return; }
      const action = KEY_ACTIONS[e.key];
      if (!action || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      run(node, action);
    });
  }

  const host = toolbar || node.parentElement;
  if (!host || host.querySelector('.viz-nav')) return;
  const group = document.createElement('div');
  group.className = toolbar ? 'viz-nav' : 'viz-controls viz-nav';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Chart view');
  for (const b of BUTTONS) {
    if (b.action === 'reset' && !includeReset) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viz-ctrl-btn';
    btn.dataset.action = b.action;
    btn.title = b.label;
    btn.setAttribute('aria-label', b.label);
    btn.innerHTML = `<span aria-hidden="true">${b.symbol}</span>`;
    // Look the svg up at click time: some charts replace it on re-render.
    btn.addEventListener('click', () => {
      const current = host.closest('#viz-panel')?.querySelector('svg[tabindex]') || node;
      run(current, b.action);
    });
    group.appendChild(btn);
  }
  host.appendChild(group);
}
