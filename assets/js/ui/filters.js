/**
 * The sidebar filters: Min/Max Routes, the category checkboxes and circle
 * size. One filter state, saved in the preferences, that every view reads.
 *
 * main.js calls setupFilters() once, currentFilters() when it draws a view
 * from scratch, and applyFilters(view) after any draw (tab switch, date step,
 * resize) so the categories the visitor unticked stay hidden.
 */

import { loadPreferences, savePreferences } from './controls.js';
import { CATEGORY_LABELS } from './glossary.js';

export const DEFAULT_MIN_ROUTES = 100;
export const DEFAULT_NODE_SIZE = 15;

const ALL_TYPES = Object.keys(CATEGORY_LABELS);
const activeTypes = new Set(ALL_TYPES);

const el = (id) => document.getElementById(id);

/** The saved Min/Max Routes and circle size, for a view drawn from scratch. */
export function currentFilters() {
  const prefs = loadPreferences();
  return {
    minTraffic: prefs.minTraffic ?? DEFAULT_MIN_ROUTES,
    maxTraffic: prefs.maxTraffic ?? Infinity,
    nodeSize: prefs.nodeSize || DEFAULT_NODE_SIZE,
  };
}

/** Would the Min/Max Routes filter hide a network with this many routes? */
export function hiddenByRoutes(traffic) {
  const { minTraffic, maxTraffic } = currentFilters();
  return (traffic || 0) < minTraffic || (traffic || 0) > maxTraffic;
}

export const isTypeShown = (type) => activeTypes.has(type);

/** Re-apply the category checkboxes to a view that has just drawn. */
export function applyFilters(view) {
  if (activeTypes.size < ALL_TYPES.length) view?.filterByTypes?.(activeTypes);
}

/**
 * Move the Min/Max Routes sliders as if the visitor had, so the labels, saved
 * preferences and the view all follow.
 */
export function setRouteFilter(min, max) {
  const minSlider = el('filter-min-traffic');
  const maxSlider = el('filter-max-traffic');
  if (maxSlider) { maxSlider.value = Number.isFinite(max) ? max : maxSlider.max; maxSlider.dispatchEvent(new Event('input')); }
  if (minSlider) { minSlider.value = min; minSlider.dispatchEvent(new Event('input')); }
}

/** Tick a category's checkbox as if the visitor had. */
export function showType(type) {
  const cb = document.querySelector(`#type-filter-checks input[data-type="${type}"]`);
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
}

/**
 * Wire the sidebar filters. getView returns the open view's module, or null
 * before any data has loaded.
 */
export function setupFilters(getView) {
  const prefs = loadPreferences();
  const minSlider = el('filter-min-traffic');
  const minLabel = el('filter-min-traffic-label');
  const maxSlider = el('filter-max-traffic');
  const maxLabel = el('filter-max-traffic-label');
  const sizeSlider = el('filter-node-size');

  // The Max Routes slider's top end means "no limit".
  const noLimit = () => Number(maxSlider?.max ?? Infinity);
  const readMax = () => {
    const v = maxSlider ? parseInt(maxSlider.value) : Infinity;
    return v >= noLimit() ? Infinity : v;
  };
  const readMin = () => (minSlider ? parseInt(minSlider.value) : 0);

  const showMin = (v) => { if (minLabel) minLabel.textContent = v.toLocaleString(); };
  const showMax = (v) => {
    if (maxLabel) maxLabel.textContent = Number.isFinite(v) ? v.toLocaleString() : '∞';
    maxSlider?.setAttribute('aria-valuetext', Number.isFinite(v) ? v.toLocaleString() : 'No limit');
  };

  // A Min/Max Routes change: save it, redraw the open view, keep the categories.
  const routesChanged = (key, value) => {
    savePreferences({ ...loadPreferences(), [key]: value });
    const view = getView();
    if (view?.updateFilter) {
      view.updateFilter(readMin(), readMax());
      applyFilters(view);
    }
  };

  if (minSlider) {
    const { minTraffic } = currentFilters();
    minSlider.value = minTraffic;
    showMin(minTraffic);
    minSlider.addEventListener('input', () => {
      showMin(readMin());
      routesChanged('minTraffic', readMin());
    });
  }

  if (maxSlider) {
    const { maxTraffic } = currentFilters();
    maxSlider.value = Math.min(maxTraffic, noLimit());
    showMax(readMax());
    maxSlider.addEventListener('input', () => {
      showMax(readMax());
      routesChanged('maxTraffic', readMax());
    });
  }

  if (sizeSlider) {
    if (prefs.nodeSize) sizeSlider.value = prefs.nodeSize;
    sizeSlider.addEventListener('input', () => {
      const val = parseInt(sizeSlider.value);
      savePreferences({ ...loadPreferences(), nodeSize: val });
      getView()?.setNodeSize?.(val);
    });
  }

  document.querySelectorAll('#type-filter-checks input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) activeTypes.add(cb.dataset.type);
      else activeTypes.delete(cb.dataset.type);
      getView()?.filterByTypes?.(activeTypes);
    });
  });
}
