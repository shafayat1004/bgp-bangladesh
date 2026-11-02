/**
 * Layered View
 * "How do networks in Bangladesh reach the world?" as a page of boxes, one
 * layer per step from local companies at the top to international networks
 * at the bottom. It scrolls like a page: zooming makes the boxes bigger, rows
 * reflow and the page gets taller, so nothing pans sideways. Picking a
 * network opens its path.
 */

import { CATEGORY_LABELS, CATEGORY_PLURALS, GLOSSARY, termHelp } from '../ui/glossary.js';
import { friendlyName, countryToFlag } from '../ui/names.js';
import { buildNodeTooltipHtml, showTooltip, moveTooltip, endHover } from '../ui/tooltip.js';
import { CATEGORY_COLORS } from '../ui/colors.js';
import { sourceAsn, targetAsn } from '../data/network-data.js';
import { DEFAULT_MIN_ROUTES } from '../ui/filters.js';
import { findMyNetwork, myNetwork, lookupStatus, onMyNetwork, onLookupStatus } from '../ui/my-network.js';

/** Box sizes, smallest first. Zoom steps through them; rows reflow. */
export const ZOOM_LEVELS = [
  { id: 'names', label: 'Names only', minWidth: 110, height: 30 },
  { id: 'shares', label: 'Names and shares', minWidth: 150, height: 48 },
  { id: 'large', label: 'Large', minWidth: 210, height: 58 },
];
export const DEFAULT_ZOOM = 1;
/** Local companies shown before "Show N smaller local companies". */
export const LOCAL_CAP = 40;

const LAYER_ORDER = ['local-company', 'iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway', 'outside'];
const WHEEL_STEP_MS = 250;     // Ctrl/⌘ + wheel or trackpad pinch: one size step per 250 ms
const PINCH_STEP = 1.25;       // two-finger pinch: one step per 25% change in finger distance

/** Layer explanations: the first sentence of each category's glossary entry. */
const firstSentence = (text) => text.match(/^.*?\.(?=\s|$)/)?.[0] || text;

/**
 * The overview's layers, top to bottom, each with its networks by routes seen.
 * A network is shown when its routes seen are in the Min/Max range and it is
 * in at least one connection within that range. total is the layer's routes
 * seen. Pure; exported for testing.
 */
export function overviewLayers(data, { minTraffic = DEFAULT_MIN_ROUTES, maxTraffic = Infinity, activeTypes = null } = {}) {
  const inRange = (v) => (v || 0) >= minTraffic && (v || 0) <= maxTraffic;
  const used = new Set();
  for (const e of data.edges || []) {
    if (!inRange(e.count)) continue;
    used.add(String(sourceAsn(e)));
    used.add(String(targetAsn(e)));
  }
  const layers = [];
  for (const type of LAYER_ORDER) {
    if (activeTypes && !activeTypes.has(type)) continue;
    const nodes = (data.nodes || [])
      .filter(n => n.type === type && used.has(String(n.asn)) && inRange(n.traffic))
      .sort((a, b) => (b.traffic || 0) - (a.traffic || 0));
    if (!nodes.length) continue;
    layers.push({ type, total: nodes.reduce((s, n) => s + (n.traffic || 0), 0), nodes });
  }
  return layers;
}

/** The first box at least partly below the sticky zoom bar, and where it sits. */
export function anchorFor(scroller) {
  const top = scroller.getBoundingClientRect().top;
  const below = top + (scroller.querySelector('.layered-zoom')?.offsetHeight || 0);
  for (const box of scroller.querySelectorAll('.layered-box')) {
    const r = box.getBoundingClientRect();
    if (r.bottom > below) return { asn: box.dataset.asn, offset: r.top - top };
  }
  return null;
}

/** Scroll so the anchored box is back at the same place on screen. */
export function restoreAnchor(scroller, anchor) {
  if (!anchor) return false;
  const box = scroller.querySelector(`.layered-box[data-asn="${CSS.escape(anchor.asn)}"]`);
  if (!box) return false;
  scroller.scrollTop += box.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
  return true;
}

// ── View state ──

let currentData = null;
let currentOptions = {};
let activeTypes = null;        // null: every category shown
let zoomIndex = DEFAULT_ZOOM;
let showAllLocal = false;
let selectedAsn = null;
let lastWheelStep = 0;

/** Tells main.js not to redraw on a resize: the grid reflows by itself. */
export const reflows = true;

export function init(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
}

export function loadData(data, options = {}) {
  currentData = data;
  currentOptions = options;
  activeTypes = null;
  zoomIndex = DEFAULT_ZOOM;
  showAllLocal = false;
  selectedAsn = null;
  render({ scrollTop: 0 });
}

/** Swap in a new snapshot, keeping the zoom size, scroll, "show all" and selection. */
export function updateData(data, options = {}) {
  currentData = data;
  currentOptions = { ...currentOptions, ...options };
  render({ keepAnchor: true });
}

export function updateFilter(minVal, maxVal) {
  if (minVal !== undefined) currentOptions.minTraffic = minVal;
  if (maxVal !== undefined) currentOptions.maxTraffic = maxVal;
  render({ keepAnchor: true });
}

export function filterByTypes(types) {
  const key = (s) => (s ? [...s].sort().join(',') : '*');
  const next = types && types.size < LAYER_ORDER.length ? new Set(types) : null;
  if (key(next) === key(activeTypes)) return;   // the same filter again after a redraw
  activeTypes = next;
  render({ keepAnchor: true });
}

export function resetView() {
  const root = viewRoot();
  applyZoom(DEFAULT_ZOOM);
  if (root) root.scrollTop = 0;
}

export function destroy() {
  const c = document.getElementById('viz-panel');
  if (c) c.innerHTML = '';
}

/** Mark one network and bring it into view (opening the long tail if needed). */
export function highlightASN(asn) {
  if (!currentData) return;
  selectedAsn = String(asn);
  const find = () => viewRoot()?.querySelector(`.layered-box[data-asn="${CSS.escape(selectedAsn)}"]`);
  if (!find() && !showAllLocal) {
    showAllLocal = true;
    render({ keepAnchor: true });
  }
  markSelected(viewRoot());
  find()?.scrollIntoView({ block: 'center' });
}

/** Open a network's path. The path screen comes later; until then, select it. */
export function openPath(asn) {
  highlightASN(asn);
}

// ── Drawing ──

const viewRoot = () => document.querySelector('#viz-panel .layered-view');

function markSelected(root) {
  if (!root) return;
  root.querySelectorAll('.layered-box.selected').forEach(b => b.classList.remove('selected'));
  if (selectedAsn) root.querySelector(`.layered-box[data-asn="${CSS.escape(selectedAsn)}"]`)?.classList.add('selected');
}

/** Change the box size in place (no redraw), keeping the top box where it is. */
function applyZoom(index) {
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
  const root = viewRoot();
  if (!root || next === zoomIndex) { zoomIndex = next; return; }
  const anchor = anchorFor(root);
  zoomIndex = next;
  setZoomStyle(root);
  restoreAnchor(root, anchor);
}

function setZoomStyle(root) {
  const level = ZOOM_LEVELS[zoomIndex];
  for (const z of ZOOM_LEVELS) root.classList.toggle(`zoom-${z.id}`, z === level);
  root.style.setProperty('--box-min', `${level.minWidth}px`);
  root.style.setProperty('--box-h', `${level.height}px`);
  const label = root.querySelector('.layered-zoom-level');
  if (label) label.textContent = level.label;
  root.querySelector('[data-control="zoom-out"]')?.toggleAttribute('disabled', zoomIndex === 0);
  root.querySelector('[data-control="zoom-in"]')?.toggleAttribute('disabled', zoomIndex === ZOOM_LEVELS.length - 1);
}

function render({ keepAnchor = false, scrollTop = null } = {}) {
  const container = document.getElementById('viz-panel');
  if (!container || !currentData) return;
  const old = container.querySelector('.layered-view');
  const anchor = keepAnchor && old ? anchorFor(old) : null;
  const oldScroll = old ? old.scrollTop : 0;
  const active = document.activeElement;
  const focusedAsn = old?.contains(active) ? active.closest('.layered-box')?.dataset.asn : null;
  const focusedControl = old?.contains(active) ? active.closest('[data-control]')?.dataset.control : null;
  const rootFocused = old && active === old;

  const layers = withMine(overviewLayers(currentData, { ...currentOptions, activeTypes }));

  const root = document.createElement('div');
  root.className = 'layered-view';
  root.tabIndex = 0;
  root.setAttribute('role', 'region');
  const summary = layers.map(l => `${l.nodes.length.toLocaleString('en-US')} ${(CATEGORY_PLURALS[l.type] || l.type).toLowerCase()}`).join(', ');
  root.setAttribute('aria-label', `Layered view: ${summary || 'no networks'}`);

  root.append(zoomBar());

  const head = el('div', 'layered-head', root);
  el('h2', 'layered-title', head).textContent = 'How do networks in Bangladesh reach the world?';
  el('p', 'layered-summary', head).textContent =
    'Local companies connect to gateways, and gateways connect to international networks. Pick a network to see its path.';

  root.append(minePrompt());

  if (!layers.length) el('p', 'layered-empty', root).textContent = 'No networks match the current filters.';

  for (const layer of layers) {
    const section = el('section', 'layered-layer', root);
    section.dataset.type = layer.type;
    const h = el('h3', 'layered-layer-title', section);
    h.innerHTML = `<span class="layered-swatch" aria-hidden="true"></span>${CATEGORY_PLURALS[layer.type]} ${termHelp(layer.type)} <span class="layered-count">${layer.nodes.length.toLocaleString('en-US')}</span>`;
    h.querySelector('.layered-swatch').style.background = CATEGORY_COLORS[layer.type];
    const short = GLOSSARY[layer.type]?.short;
    if (short) el('p', 'layered-layer-note', section).textContent = firstSentence(short);

    const capped = layer.type === 'local-company' && !showAllLocal && layer.nodes.length > LOCAL_CAP;
    const grid = el('ul', 'layered-grid', section);
    for (const n of capped ? layer.nodes.slice(0, LOCAL_CAP) : layer.nodes) grid.append(box(n));

    if (layer.type === 'local-company' && layer.nodes.length > LOCAL_CAP) {
      const more = el('button', 'layered-more', section);
      more.type = 'button';
      more.dataset.control = 'more';
      more.textContent = capped
        ? `Show ${(layer.nodes.length - LOCAL_CAP).toLocaleString('en-US')} smaller local companies`
        : `Show only the ${LOCAL_CAP} biggest local companies`;
      more.addEventListener('click', () => {
        showAllLocal = !showAllLocal;
        render({ keepAnchor: true });
      });
    }
  }

  setZoomStyle(root);
  bindInput(root);
  container.replaceChildren(root);
  markSelected(root);

  if (scrollTop !== null) root.scrollTop = scrollTop;
  else if (!restoreAnchor(root, anchor)) root.scrollTop = oldScroll;

  // A redraw replaces the focused element; put focus back on its replacement.
  if (focusedAsn) root.querySelector(`.layered-box[data-asn="${CSS.escape(focusedAsn)}"]`)?.focus({ preventScroll: true });
  else if (focusedControl) root.querySelector(`[data-control="${focusedControl}"]`)?.focus({ preventScroll: true });
  else if (rootFocused) root.focus({ preventScroll: true });
}

const mineAsn = () => myNetwork()?.asn ?? null;

/**
 * Put the visitor's network first in its layer, even when the filters would
 * hide it (it is then marked as hidden elsewhere).
 */
function withMine(layers) {
  hiddenMine = false;
  const asn = mineAsn();
  const node = asn && currentData.nodes.find(n => String(n.asn) === asn);
  if (!node) return layers;
  let layer = layers.find(l => l.type === node.type);
  const shown = layer?.nodes.includes(node);
  if (!layer) {
    layer = { type: node.type, total: 0, nodes: [] };
    const at = layers.findIndex(l => LAYER_ORDER.indexOf(l.type) > LAYER_ORDER.indexOf(node.type));
    layers.splice(at === -1 ? layers.length : at, 0, layer);
  }
  layer.nodes = [node, ...layer.nodes.filter(n => n !== node)];
  hiddenMine = !shown;
  return layers;
}
let hiddenMine = false;

/**
 * "Is one of these yours?": the lookup offered inside the view, never run on
 * its own (it sends the visitor's IP address to ipify.org and RIPEstat). The
 * box keeps one height in every state, so nothing below it moves.
 */
function minePrompt() {
  const box = document.createElement('div');
  box.className = 'layered-mine';
  const text = el('div', 'layered-mine-text', box);
  text.setAttribute('aria-live', 'polite');
  const btn = el('button', 'btn btn-outline btn-small layered-mine-btn', box);
  btn.type = 'button';
  btn.dataset.control = 'mine';

  const status = lookupStatus();
  const mine = myNetwork();
  const node = mine && currentData.nodes.find(n => String(n.asn) === mine.asn);
  if (status === 'done' && mine) {
    const who = friendlyName(node || { name: mine.holder, asn: mine.asn });
    const p = el('p', '', text);
    p.append('You\'re on ', strongText(who), ` (AS${mine.asn}).`);
    if (node) {
      el('p', 'layered-mine-note', text).textContent = 'Marked YOURS below.';
      btn.textContent = 'Show its path';
      btn.addEventListener('click', () => openPath(mine.asn));
    } else {
      el('p', 'layered-mine-note', text).textContent = 'It isn\'t among the networks in this data.';
      btn.remove();
      // Focus was on the button; keep it in the box instead of losing it.
      text.tabIndex = -1;
      text.dataset.control = 'mine';
    }
    return box;
  }
  el('p', '', text).textContent = status === 'error'
    ? 'Couldn\'t look up your network. Try again.'
    : 'Is one of these yours?';
  el('p', 'layered-mine-note', text).textContent = 'Sends your IP address to ipify.org and RIPEstat to look it up.';
  btn.textContent = status === 'pending' ? 'Looking up your network…' : 'Find my network';
  // aria-disabled rather than disabled, so keyboard focus stays on it while waiting.
  if (status === 'pending') btn.setAttribute('aria-disabled', 'true');
  btn.addEventListener('click', () => { findMyNetwork().catch(() => {}); });
  return box;
}

function strongText(t) {
  const s = document.createElement('strong');
  s.textContent = t;
  return s;
}

// The lookup can finish (or start) from the sidebar too; redraw if this view is open.
onLookupStatus(() => { if (viewRoot()) render({ keepAnchor: true }); });
onMyNetwork(() => { if (viewRoot()) render({ keepAnchor: true }); });

function zoomBar() {
  const bar = document.createElement('div');
  bar.className = 'layered-zoom';
  bar.innerHTML = `
    <button type="button" class="layered-zoom-btn" data-control="zoom-out" aria-label="Smaller boxes">−</button>
    <span class="layered-zoom-level" aria-live="polite"></span>
    <button type="button" class="layered-zoom-btn" data-control="zoom-in" aria-label="Bigger boxes">+</button>`;
  bar.querySelector('[data-control="zoom-out"]').addEventListener('click', () => applyZoom(zoomIndex - 1));
  bar.querySelector('[data-control="zoom-in"]').addEventListener('click', () => applyZoom(zoomIndex + 1));
  return bar;
}

function box(n) {
  const li = document.createElement('li');
  const btn = el('button', 'layered-box', li);
  btn.type = 'button';
  btn.dataset.asn = n.asn;
  btn.style.setProperty('--cat', CATEGORY_COLORS[n.type]);
  const name = friendlyName(n);
  const flag = n.type === 'outside' && n.country ? `${countryToFlag(n.country)} ` : '';
  const mine = String(n.asn) === mineAsn();
  const share = `${(n.percentage || 0).toFixed(1)}% of routes seen${mine && hiddenMine ? ' (hidden by your filters elsewhere)' : ''}`;
  btn.setAttribute('aria-label', `${name}, ${CATEGORY_LABELS[n.type] || n.type}, ${share}${mine ? ', your network' : ''}`);
  btn.classList.toggle('mine', mine);
  const nameEl = el('span', 'layered-box-name', btn);
  if (mine) {
    const tag = el('span', 'layered-tag', nameEl);
    tag.textContent = 'YOURS';
    tag.setAttribute('aria-hidden', 'true');
  }
  nameEl.append(`${flag}${name}`);
  el('span', 'layered-box-share', btn).textContent = share;
  btn.addEventListener('click', () => openPath(n.asn));
  // Hover details for a mouse only: on touch the details sheet would cover the path.
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTooltip(buildNodeTooltipHtml(n, CATEGORY_LABELS), e); });
  btn.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') moveTooltip(e); });
  btn.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') endHover(); });
  return li;
}

function bindInput(root) {
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(zoomIndex + 1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyZoom(zoomIndex - 1); }
    else if (e.key === '0') { e.preventDefault(); applyZoom(DEFAULT_ZOOM); }
  });

  // Ctrl/⌘ + wheel, which is also what a trackpad pinch sends.
  root.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelStep < WHEEL_STEP_MS || e.deltaY === 0) return;
    lastWheelStep = now;
    applyZoom(zoomIndex + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  // Two-finger pinch on touch screens; one finger still scrolls the page.
  let pinchBase = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  root.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinchBase = dist(e.touches); }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchBase) return;
    e.preventDefault();
    const ratio = dist(e.touches) / pinchBase;
    if (ratio >= PINCH_STEP || ratio <= 1 / PINCH_STEP) {
      pinchBase = dist(e.touches);
      applyZoom(zoomIndex + (ratio > 1 ? 1 : -1));
    }
  }, { passive: false });
  root.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinchBase = 0; }, { passive: true });
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}
