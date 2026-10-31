/**
 * Main Application Orchestrator
 * Wires together: data loading, license-aware classification, UI, visualizations, live fetch, and ASN lookup.
 */

import { RIPEStatClient } from './api/ripestat.js';
import { analyzeGateways, buildVisualizationData, computeShares, createAnalysisState, analyzeRoutesBatch, finalizeAnalysis } from './api/data-processor.js';
import { showModal, resetModal } from './ui/modal.js';
import { populateSidebar, setDataSourceLabel, getActiveTab, saveActiveTab, loadPreferences, savePreferences, showMyASNResult } from './ui/controls.js';
import { initTimeline, formatTimestamp } from './ui/timeline.js';
import { showProgress, updateProgress, hideProgress, showToast, onProgressCancel } from './ui/loading.js';
import { exportNodesCSV, exportEdgesCSV, exportJSON, exportRawRoutes } from './ui/export.js';
import { wasmSupported, createAnalysisWorker } from './wasm-bridge.js';
import { describePath, renderMyPath } from './ui/my-path.js';
import { initGlossary, setGlossaryData, addTermHelp, renderGlossaryList, CATEGORY_LABELS } from './ui/glossary.js';
import { initSearch } from './ui/search.js';
import { friendlyName } from './ui/names.js';

import * as ForceGraph from './viz/force-graph.js';
import * as Sankey from './viz/sankey.js';
import * as Hierarchical from './viz/hierarchical.js';
import * as Table from './viz/table.js';
import * as BarGateway from './viz/bar-gateway.js';
import * as BarCountry from './viz/bar-country.js';

const COUNTRY = 'BD';
let currentData = null;
let latestData = null;          // newest snapshot, used to restore "Latest" on the slider
let latestDateStr = 'Unknown';  // formatted label for the newest snapshot
let rawRoutes = null;  // Store raw BGP routes for export
let activeTab = 'hierarchical';
let ripeClient = new RIPEStatClient();
let btrcLicensedASNs = new Set();
let igwLicensedASNs = new Set();
let wasmWorker = null;  // WASM analysis worker (created lazily)
let forceGraphWarningShown = false;  // Track if CPU warning was shown for network graph

const vizModules = {
  'force-graph': ForceGraph,
  'sankey': Sankey,
  'hierarchical': Hierarchical,
  'table': Table,
  'bar-gateway': BarGateway,
  'bar-country': BarCountry,
};

// ────────────────────────────────────────
// Initialization
// ────────────────────────────────────────

async function init() {
  initGlossary();
  renderGlossaryList(document.getElementById('intro-terms'),
    ['asn', 'bgp', 'route', 'local-company', 'iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway', 'outside'],
    { 'local-company': 'blue', 'iig': 'green', 'detected-iig': 'amber', 'offshore-enterprise': 'cyan', 'offshore-gateway': 'pink', 'outside': 'red' });
  addTermHelp(document);
  initSearch({ getData: () => currentData, onSelect: (node) => focusNetwork(node.asn) });
  showModal();
  activeTab = getActiveTab();
  setupTabs();
  setupButtons();
  setupMobileMenu();
  setupFilters();
  setupTypeFilters();
  
  // Start WASM loading in parallel with data loading (non-blocking)
  if (wasmSupported) {
    createAnalysisWorker().then(w => {
      wasmWorker = w;
      if (w) console.log('[WASM] Route analysis worker ready');
    }).catch(() => {});
  }
  
  await loadLicenseData();
  await loadStaticData();
}

// ────────────────────────────────────────
// License Data Loading
// ────────────────────────────────────────

async function loadLicenseData() {
  const load = async (file) => {
    const resp = await fetch(file);
    if (!resp.ok) return new Set();
    return new Set(Object.keys(await resp.json()).filter(k => !k.startsWith('_')));
  };
  try {
    btrcLicensedASNs = await load('data/btrc_iig_licenses.json');
    console.log(`Loaded ${btrcLicensedASNs.size} BTRC-licensed IIG ASNs`);
  } catch (err) {
    console.warn('Could not load BTRC IIG license list:', err);
  }
  try {
    igwLicensedASNs = await load('data/btrc_igw_licenses.json');
  } catch (err) {
    console.warn('Could not load BTRC IGW license list:', err);
  }
}

// ────────────────────────────────────────
// Static Data Loading
// ────────────────────────────────────────

async function loadStaticData() {
  try {
    const [vizResponse, metaResponse] = await Promise.all([
      fetch(`data/${COUNTRY}/viz_data.json`),
      fetch(`data/${COUNTRY}/metadata.json`),
    ]);

    if (!vizResponse.ok) throw new Error('Failed to load visualization data');
    currentData = await vizResponse.json();
    latestData = currentData;

    let meta = {};
    if (metaResponse.ok) meta = await metaResponse.json();

    const dateStr = meta.last_updated
      ? new Date(meta.last_updated).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Unknown';
    latestDateStr = dateStr;

    setDataSourceLabel(`Static data from: ${dateStr}`);
    onDataLoaded();
    setupTimeline();
  } catch (err) {
    console.error('Failed to load static data:', err);
    showToast('error', 'Failed to load static data. Check your connection and reload.');
  }
}

// ────────────────────────────────────────
// History Time-Slider
// ────────────────────────────────────────

let timelineInitialized = false;

function setupTimeline() {
  if (timelineInitialized) return;  // bind listeners only once (revert re-loads static)
  timelineInitialized = true;
  initTimeline({
    country: COUNTRY,
    onSelectLatest: () => {
      currentData = latestData;
      setDataSourceLabel(`Static data from: ${latestDateStr}`);
      onDataLoaded({ inPlace: true });
    },
    onSelectSnapshot: (viz, ts) => {
      currentData = viz;
      setDataSourceLabel(`Snapshot: ${formatTimestamp(ts)}`);
      onDataLoaded({ inPlace: true });
    },
  });
}

// ────────────────────────────────────────
// Data Loaded Handler
// ────────────────────────────────────────

// inPlace: the active view may swap the data without a full rebuild (used by the
// history slider so the network graph keeps its layout between snapshots).
function onDataLoaded({ inPlace = false } = {}) {
  if (!currentData) return;
  // One share rule for every source; snapshots written before it counted a
  // gateway's domestic routes twice.
  computeShares(currentData);
  setGlossaryData(currentData);
  populateSidebar(currentData, (asn) => {
    const mod = vizModules[activeTab];
    if (mod?.highlightASN) mod.highlightASN(asn);
  });

  // Load with user's saved filter preference
  const prefs = loadPreferences();
  const defaultMinTraffic = prefs.minTraffic !== undefined ? prefs.minTraffic : 100;
  const defaultMaxTraffic = prefs.maxTraffic !== undefined ? prefs.maxTraffic : Infinity;

  const mod = vizModules[activeTab];
  if (inPlace && mod?.updateData) {
    // An open tooltip (a details sheet on phones) would still show the previous
    // date's numbers, so it closes.
    const tip = document.getElementById('tooltip');
    if (tip) tip.style.display = 'none';
    mod.updateData(currentData, { minTraffic: defaultMinTraffic, maxTraffic: defaultMaxTraffic });
    if (activeTypeFilters.size < 6 && mod.filterByTypes) {
      mod.filterByTypes(activeTypeFilters);
    }
    return;
  }
  switchTab(activeTab, { minTraffic: defaultMinTraffic, maxTraffic: defaultMaxTraffic });
}

// ────────────────────────────────────────
// Tab Navigation
// ────────────────────────────────────────

function setupTabs() {
  const tabs = [...document.querySelectorAll('.tab-btn')];
  tabs.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  // ARIA tabs pattern: arrow keys / Home / End move between tabs and open them.
  document.getElementById('tab-nav')?.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    tab.focus();
    switchTab(tab.dataset.tab);
  });
  highlightTab(activeTab);
}

function switchTab(tabId, options = {}) {
  if (!currentData) return;

  // Show CPU warning for network graph view (only once per session)
  if (tabId === 'force-graph' && !forceGraphWarningShown) {
    const confirmed = confirm(
      'Warning: The Network Graph draws over a thousand networks and their connections, ' +
      'so it needs a reasonably fast device to run smoothly.\n\n' +
      'Note: The "Min Routes" filter is set to 100 by default. ' +
      'To see every network, lower it to 0 in the sidebar.\n\n' +
      'Do you want to proceed?'
    );
    if (!confirmed) {
      return;  // Stay on current tab
    }
    forceGraphWarningShown = true;
  }

  const prevMod = vizModules[activeTab];
  if (prevMod?.destroy) prevMod.destroy();
  activeTab = tabId;
  saveActiveTab(tabId);
  highlightTab(tabId);
  const mod = vizModules[tabId];
  if (mod) {
    mod.init('viz-panel');
    mod.loadData(currentData, { ...savedLoadOptions(), ...options });

    // Capture current dimensions for resize detection
    const vizPanel = document.getElementById('viz-panel');
    if (vizPanel) {
      lastWidth = vizPanel.clientWidth;
      lastHeight = vizPanel.clientHeight;
    }

    // Re-apply type filter if not all types are selected
    if (activeTypeFilters.size < 6 && mod.filterByTypes) {
      mod.filterByTypes(activeTypeFilters);
    }
  }
}

// The user's saved filters, for a view drawn from scratch.
function savedLoadOptions() {
  const prefs = loadPreferences();
  return {
    minTraffic: prefs.minTraffic !== undefined ? prefs.minTraffic : 100,
    maxTraffic: prefs.maxTraffic !== undefined ? prefs.maxTraffic : Infinity,
    nodeSize: prefs.nodeSize || 15,
  };
}

function highlightTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const selected = btn.dataset.tab === tabId;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-selected', String(selected));
    btn.tabIndex = selected ? 0 : -1;
    if (selected) document.getElementById('viz-panel')?.setAttribute('aria-labelledby', btn.id);
  });
}

// ────────────────────────────────────────
// Control Buttons
// ────────────────────────────────────────

function setupButtons() {
  document.getElementById('btn-fetch-live')?.addEventListener('click', () => {
    const confirmed = confirm('Fetching the latest routes can take 15-20 minutes to complete. Do you want to proceed?');
    if (confirmed) {
      fetchLiveData();
    }
  });

  document.getElementById('btn-revert-static')?.addEventListener('click', async () => {
    ripeClient.cancel();
    hideProgress();
    await loadStaticData();
    showToast('info', 'Reverted to static data.');
  });

  document.getElementById('btn-export-nodes')?.addEventListener('click', () => {
    if (currentData) { exportNodesCSV(currentData); showToast('success', 'Networks CSV downloaded.'); }
  });
  document.getElementById('btn-export-edges')?.addEventListener('click', () => {
    if (currentData) { exportEdgesCSV(currentData); showToast('success', 'Connections CSV downloaded.'); }
  });
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (currentData) { exportJSON(currentData); showToast('success', 'JSON data downloaded.'); }
  });
  
  document.getElementById('btn-export-raw')?.addEventListener('click', () => {
    if (rawRoutes) {
      exportRawRoutes(rawRoutes);
      showToast('success', `Raw routes downloaded (${rawRoutes.length.toLocaleString()} routes, ~${(JSON.stringify(rawRoutes).length / 1024 / 1024).toFixed(1)}MB).`);
    } else {
      showToast('warning', 'No raw routes available. Click "Fetch Latest Routes" first to download raw routes.');
    }
  });

  document.getElementById('btn-show-intro')?.addEventListener('click', () => {
    resetModal();
    showModal(true);
  });

  document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    const mod = vizModules[activeTab];
    if (mod?.resetView) mod.resetView();
  });

  document.getElementById('btn-toggle-labels')?.addEventListener('click', (e) => {
    const mod = vizModules[activeTab];
    if (mod?.toggleLabelsVisibility) {
      mod.toggleLabelsVisibility();
      const btn = e.currentTarget;
      btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
    }
  });

  // Hover tooltips can be dismissed without moving the pointer (WCAG 1.4.13).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const tip = document.getElementById('tooltip');
    if (tip) tip.style.display = 'none';
  });

  // What's My ASN?
  document.getElementById('btn-my-asn')?.addEventListener('click', detectMyASN);
}

// ────────────────────────────────────────
// Mobile Menu
// ────────────────────────────────────────

function setupMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!mobileMenuBtn || !sidebar || !overlay) return;

  // Same breakpoint as the CSS: narrow screens and landscape phones.
  const isMobile = () => window.matchMedia('(max-width: 900px), (max-height: 500px)').matches;
  const main = document.getElementById('main');

  // On small screens the sidebar is an off-canvas panel: while closed it is
  // inert (out of the tab order and hidden from screen readers); while open the
  // page behind it is inert instead.
  const setOpen = (open, { moveFocus = false } = {}) => {
    sidebar.classList.toggle('active', open);
    overlay.classList.toggle('active', open);
    mobileMenuBtn.classList.toggle('active', open);
    mobileMenuBtn.setAttribute('aria-expanded', String(open));
    mobileMenuBtn.setAttribute('aria-label', open ? 'Close controls' : 'Open controls');
    sidebar.inert = isMobile() && !open;
    if (main) main.inert = isMobile() && open;
    // Prevent body scroll when sidebar is open on mobile
    document.body.style.overflow = open && isMobile() ? 'hidden' : '';
    if (moveFocus) (open ? sidebar.querySelector('button, input') : mobileMenuBtn)?.focus();
  };
  setOpen(false);

  mobileMenuBtn.addEventListener('click', () => {
    setOpen(!sidebar.classList.contains('active'), { moveFocus: true });
  });

  // Close on overlay click
  overlay.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('active') && isMobile()) {
      setOpen(false, { moveFocus: true });
    }
  });

  // Close sidebar when clicking on sidebar items (for better mobile UX)
  sidebar.addEventListener('click', (e) => {
    if ((e.target.closest('.asn-item') || e.target.closest('.tab-btn')) && isMobile()) {
      setOpen(false);
    }
  });

  // Handle window resize: closes the panel and refreshes the inert state
  // when crossing the mobile breakpoint.
  window.addEventListener('resize', () => {
    setOpen(sidebar.classList.contains('active') && isMobile());
  });

  // Tap on viz panel dismisses tooltip on mobile
  const vizPanel = document.getElementById('viz-panel');
  if (vizPanel) {
    vizPanel.addEventListener('click', (e) => {
      if (!isMobile()) return;
      // Only dismiss if tapping on empty space (not a node/link)
      const target = e.target;
      if (target.tagName === 'svg' || target.classList.contains('viz-container') || target.id === 'viz-panel') {
        const tip = document.getElementById('tooltip');
        if (tip) tip.style.display = 'none';
      }
    });
  }

  // On phones the tooltip is a bottom sheet. It sits just above the date bar
  // (--sheet-bottom in the CSS) so the date stays reachable while it is open.
  const timelineBar = document.getElementById('timeline-bar');
  if (timelineBar) {
    const placeSheet = () => {
      const rect = timelineBar.getBoundingClientRect();
      const bottom = rect.height ? Math.max(0, window.innerHeight - rect.top) : 0;
      document.documentElement.style.setProperty('--sheet-bottom', `${Math.round(bottom)}px`);
    };
    new ResizeObserver(placeSheet).observe(timelineBar);
    window.addEventListener('resize', placeSheet);
    placeSheet();
  }

  // A tap opens the sheet before the rest of that tap (its click) arrives. If
  // the sheet opens under the finger, the click would land on the sheet and
  // the tapped network would not be selected, so the sheet lets taps through
  // for a moment after it opens.
  const tip = document.getElementById('tooltip');
  if (tip) {
    let wasOpen = false;
    let timer = null;
    new MutationObserver(() => {
      const open = tip.style.display === 'block';
      if (open && !wasOpen && isMobile()) {
        tip.style.pointerEvents = 'none';
        clearTimeout(timer);
        timer = setTimeout(() => { tip.style.pointerEvents = ''; }, 400);
      }
      wasOpen = open;
    }).observe(tip, { attributes: true, attributeFilter: ['style'] });
  }
}

// ────────────────────────────────────────
// What's My ASN?
// ────────────────────────────────────────

async function detectMyASN() {
  const btn = document.getElementById('btn-my-asn');
  const resultEl = document.getElementById('my-asn-result');
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Looking up your network…'; }

  try {
    const lookup = await ripeClient.getMyASN();
    if (!currentData || !resultEl) return;
    showMyPath(lookup);
  } catch (err) {
    showMyASNResult({ error: `Could not find your network: ${err.message}` });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function showMyPath(lookup) {
  const path = describePath(currentData, lookup.asn);
  const { minTraffic, maxTraffic } = savedLoadOptions();
  const traffic = path.node?.traffic || 0;
  const hiddenBy = path.status === 'found' && (traffic < minTraffic || traffic > maxTraffic) ? 'filter' : null;
  renderMyPath(document.getElementById('my-asn-result'), lookup, path, {
    hiddenBy,
    onShowAll: () => {
      setRouteFilter(0, Infinity);
      showMyPath(lookup);
    },
  });
  if (path.status === 'found' && !hiddenBy) vizModules[activeTab]?.highlightASN?.(lookup.asn);
}

// Views that can show any network; Gateway Ranking only shows gateways and
// Country Origins none, so a search from there opens the network in the table.
const SHOWS_ANY_NETWORK = new Set(['force-graph', 'sankey', 'hierarchical', 'table']);
const GATEWAY_TYPES = new Set(['iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway']);

/** Show one network (from search): make sure filters don't hide it, then highlight it. */
function focusNetwork(asn) {
  const node = currentData?.nodes.find(n => n.asn === asn);
  if (!node) return;
  const name = friendlyName(node);

  const { minTraffic, maxTraffic } = savedLoadOptions();
  const notes = [];
  if ((node.traffic || 0) < minTraffic || (node.traffic || 0) > maxTraffic) {
    setRouteFilter(0, Infinity);
    notes.push('Min/Max Routes reset to show all networks');
  }
  if (!activeTypeFilters.has(node.type)) {
    const cb = document.querySelector(`#type-filter-checks input[data-type="${node.type}"]`);
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    notes.push(`${CATEGORY_LABELS[node.type]} shown again`);
  }

  const fits = SHOWS_ANY_NETWORK.has(activeTab) || (activeTab === 'bar-gateway' && GATEWAY_TYPES.has(node.type));
  if (!fits) switchTab('table');
  vizModules[activeTab]?.highlightASN?.(asn);
  showToast('info', `Showing ${name} (AS${asn}, ${CATEGORY_LABELS[node.type] || node.type})${notes.length ? `. ${notes.join('; ')}.` : ''}`, 4000);
}

// Move the Min/Max Routes sliders as if the user had, so labels, saved
// preferences and the view all follow.
function setRouteFilter(min, max) {
  const minSlider = document.getElementById('filter-min-traffic');
  const maxSlider = document.getElementById('filter-max-traffic');
  if (maxSlider) { maxSlider.value = Number.isFinite(max) ? max : maxSlider.max; maxSlider.dispatchEvent(new Event('input')); }
  if (minSlider) { minSlider.value = min; minSlider.dispatchEvent(new Event('input')); }
}

// ────────────────────────────────────────
// Filters
// ────────────────────────────────────────

function setupFilters() {
  const prefs = loadPreferences();

  const minTrafficSlider = document.getElementById('filter-min-traffic');
  const minTrafficLabel = document.getElementById('filter-min-traffic-label');
  const maxTrafficSlider = document.getElementById('filter-max-traffic');
  const maxTrafficLabel = document.getElementById('filter-max-traffic-label');
  const sizeSlider = document.getElementById('filter-node-size');

  // Min traffic filter
  if (minTrafficSlider) {
    const defaultMin = prefs.minTraffic !== undefined ? prefs.minTraffic : 100;
    minTrafficSlider.value = defaultMin;
    if (minTrafficLabel) minTrafficLabel.textContent = defaultMin.toLocaleString();
    
    minTrafficSlider.addEventListener('input', () => {
      const minVal = parseInt(minTrafficSlider.value);
      const rawMax = maxTrafficSlider ? parseInt(maxTrafficSlider.value) : 40000;
      const maxVal = rawMax >= 40000 ? Infinity : rawMax;
      
      if (minTrafficLabel) minTrafficLabel.textContent = minVal.toLocaleString();
      savePreferences({ ...loadPreferences(), minTraffic: minVal });
      
      const mod = vizModules[activeTab];
      if (mod?.updateFilter) {
        mod.updateFilter(minVal, maxVal);
        // Re-apply type filter after traffic filter update
        if (activeTypeFilters.size < 6 && mod.filterByTypes) {
          mod.filterByTypes(activeTypeFilters);
        }
      }
    });
  }

  // Max traffic filter
  if (maxTrafficSlider) {
    const defaultMax = prefs.maxTraffic !== undefined ? Math.min(prefs.maxTraffic, 40000) : 40000;
    maxTrafficSlider.value = defaultMax;
    if (maxTrafficLabel) {
      maxTrafficLabel.textContent = defaultMax >= 40000 ? '∞' : defaultMax.toLocaleString();
      maxTrafficSlider.setAttribute('aria-valuetext', defaultMax >= 40000 ? 'No limit' : defaultMax.toLocaleString());
    }
    
    maxTrafficSlider.addEventListener('input', () => {
      const minVal = minTrafficSlider ? parseInt(minTrafficSlider.value) : 0;
      const maxVal = parseInt(maxTrafficSlider.value);
      const isInfinity = maxVal >= 40000;
      
      if (maxTrafficLabel) {
        maxTrafficLabel.textContent = isInfinity ? '∞' : maxVal.toLocaleString();
        maxTrafficSlider.setAttribute('aria-valuetext', isInfinity ? 'No limit' : maxVal.toLocaleString());
      }
      savePreferences({ ...loadPreferences(), maxTraffic: isInfinity ? Infinity : maxVal });
      
      const mod = vizModules[activeTab];
      if (mod?.updateFilter) {
        mod.updateFilter(minVal, isInfinity ? Infinity : maxVal);
        // Re-apply type filter after traffic filter update
        if (activeTypeFilters.size < 6 && mod.filterByTypes) {
          mod.filterByTypes(activeTypeFilters);
        }
      }
    });
  }

  if (sizeSlider) {
    if (prefs.nodeSize) sizeSlider.value = prefs.nodeSize;
    sizeSlider.addEventListener('input', () => {
      const val = parseInt(sizeSlider.value);
      savePreferences({ ...loadPreferences(), nodeSize: val });
      const mod = vizModules[activeTab];
      if (mod?.setNodeSize) mod.setNodeSize(val);
    });
  }
}

// ────────────────────────────────────────
// Type Filters (new category checkboxes)
// ────────────────────────────────────────

let activeTypeFilters = new Set(['outside', 'iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway', 'local-company']);

function setupTypeFilters() {
  const container = document.getElementById('type-filter-checks');
  if (!container) return;

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const type = cb.dataset.type;
      if (cb.checked) activeTypeFilters.add(type);
      else activeTypeFilters.delete(type);
      applyTypeFilter();
    });
  });
}

function applyTypeFilter() {
  if (!currentData) return;
  const mod = vizModules[activeTab];
  if (mod?.filterByTypes) {
    mod.filterByTypes(activeTypeFilters);
  }
}

// Public: called from table module for cross-viz filtering
window._bgpHighlightASN = function(asn) {
  if (!currentData) return;
  // Switch to force-graph tab and highlight
  const targetTab = activeTab === 'table' ? 'force-graph' : activeTab;
  if (targetTab !== activeTab) {
    switchTab(targetTab);
  }
  const mod = vizModules[targetTab];
  if (mod?.highlightASN) {
    mod.highlightASN(asn);
    const node = currentData.nodes.find(n => n.asn === asn);
    if (node) {
      const typeLabel = CATEGORY_LABELS[node.type] || node.type;
      showToast('info', `Focused: ${node.name || `AS${asn}`} (${typeLabel})`, 3000);
    }
  }
};

// ────────────────────────────────────────
// WASM Result Conversion
// ────────────────────────────────────────

/**
 * Convert WASM analysis results (arrays of [key, value]) back into the Map-based
 * format expected by buildVisualizationData() and the rest of the pipeline.
 *
 * @param {Object} wasmData - { outsideCounts, iigCounts, localISPCounts, edgeIntl, edgeDomestic, directPeers, validObservations }
 * @param {Set} countryASNs
 * @returns {Object} Analysis object compatible with buildVisualizationData()
 */
function convertWasmResults(wasmData, countryASNs) {
  const outsideCounts = new Map(wasmData.outsideCounts);
  const iigCounts = new Map(wasmData.iigCounts);
  const localISPCounts = new Map(wasmData.localISPCounts);
  const edgeIntl = new Map(wasmData.edgeIntl);
  const edgeDomestic = new Map(wasmData.edgeDomestic);

  // Build directPeersMap from direct_peers pairs
  const directPeersMap = {};
  for (const [dpKey] of wasmData.directPeers) {
    const [a, b] = dpKey.split('|');
    if (countryASNs.has(b) && !countryASNs.has(a)) {
      if (!directPeersMap[b]) directPeersMap[b] = [];
      if (!directPeersMap[b].includes(a)) directPeersMap[b].push(a);
    }
    if (countryASNs.has(a) && !countryASNs.has(b)) {
      if (!directPeersMap[a]) directPeersMap[a] = [];
      if (!directPeersMap[a].includes(b)) directPeersMap[a].push(b);
    }
  }

  return {
    outsideCounts,
    iigCounts,
    localISPCounts,
    edgeIntl,
    edgeDomestic,
    directPeersMap,
    validObservations: wasmData.validObservations,
  };
}

// ────────────────────────────────────────
// Live Data Fetching
// ────────────────────────────────────────

async function fetchLiveData() {
  ripeClient = new RIPEStatClient();

  showProgress();
  onProgressCancel(() => {
    ripeClient.cancel();
    hideProgress();
    showToast('warning', 'Live data fetch cancelled. Showing previous data.');
  });

  try {
    // Step 1: Country resources (falls back to the committed cache if RIPEstat is down)
    const { countryASNs, prefixes, source: resourceSource } = await ripeClient.getCountryResources(COUNTRY, (p) => updateProgress({ ...p, totalSteps: 5 }));
    if (resourceSource === 'cache') {
      showToast('warning', 'RIPEstat is unavailable — using the last committed resource list. Live route data may be incomplete; revert to static data if needed.');
    }

    // Step 2: BGP routes — process incrementally as batches arrive
    // Use WASM Worker if available, otherwise fall back to JS
    const useWasm = !!wasmWorker;
    let analysisState = null;
    rawRoutes = [];  // Accumulate for raw export
    
    if (useWasm) {
      // WASM path: initialize worker with country ASNs
      await wasmWorker.init([...countryASNs]);
      console.log('[WASM] Route analyzer initialized, processing batches...');
    } else {
      // JS fallback
      analysisState = createAnalysisState();
    }
    
    // Collect WASM batch promises to ensure all are processed before finalizing
    const wasmBatchPromises = [];
    
    await ripeClient.fetchBGPRoutes(
      prefixes,
      (p) => updateProgress({ ...p, totalSteps: 5 }),
      (batchRoutes) => {
        rawRoutes.push(...batchRoutes);
        if (useWasm) {
          // Queue batch to WASM worker (off main thread)
          // Batches are serialized by the worker's message queue
          wasmBatchPromises.push(wasmWorker.processBatch(batchRoutes));
        } else {
          // JS fallback: process on main thread
          analyzeRoutesBatch(batchRoutes, countryASNs, analysisState);
        }
      }
    );
    
    // Wait for all WASM batch processing to complete
    if (useWasm && wasmBatchPromises.length > 0) {
      await Promise.all(wasmBatchPromises);
    }

    // Step 3: Finalize analysis
    updateProgress({ step: 3, totalSteps: 5, message: 'Finalizing gateway analysis…', progress: 0 });
    let analysis;
    if (useWasm) {
      const result = await wasmWorker.finalize();
      // Convert WASM output format to JS Map format expected by buildVisualizationData
      analysis = convertWasmResults(result.data, countryASNs);
      console.log(`[WASM] Analysis complete: ${analysis.validObservations.toLocaleString()} valid observations`);
    } else {
      analysis = finalizeAnalysis(analysisState, countryASNs);
    }
    
    // Step 3b: Fetch ASN names only for ASNs that appear in top edges
    const neededASNs = new Set();
    analysis.edgeIntl.forEach((_, key) => {
      const [src, tgt] = key.split('|');
      neededASNs.add(src);
      neededASNs.add(tgt);
    });
    analysis.edgeDomestic.forEach((_, key) => {
      const [src, tgt] = key.split('|');
      neededASNs.add(src);
      neededASNs.add(tgt);
    });
    const asnInfo = await ripeClient.fetchASNInfo([...neededASNs], countryASNs, (p) => updateProgress({ ...p, totalSteps: 5 }));

    // Step 3c: Fetch geolocation for BD-registered tentative IIGs (offshore detection)
    updateProgress({ step: 3, totalSteps: 5, message: 'Detecting offshore ASNs via geolocation…', progress: 0.85 });
    const tentativeIIGs = [];
    const sortedIntl = [...analysis.edgeIntl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1500);
    for (const [edgeKey] of sortedIntl) {
      const tgt = edgeKey.split('|')[1];
      if (countryASNs.has(tgt) && !btrcLicensedASNs.has(tgt) && !tentativeIIGs.includes(tgt)) {
        tentativeIIGs.push(tgt);
      }
    }
    const offshoreASNs = {};
    if (tentativeIIGs.length > 0) {
      const geoResults = await ripeClient.fetchGeoCountries(tentativeIIGs, (p) => updateProgress({ ...p, totalSteps: 5 }));
      for (const [asn, geoData] of Object.entries(geoResults)) {
        if (asnInfo[asn]) {
          asnInfo[asn].geo_country = geoData.dominant_country;
          asnInfo[asn].geo_breakdown = geoData.breakdown || [];
        }
        if (geoData.dominant_country !== 'BD') {
          offshoreASNs[asn] = geoData.dominant_country;
        }
      }
    }

    // Step 4: PeeringDB — fetch physical peering locations for offshore ASNs
    if (Object.keys(offshoreASNs).length > 0) {
      const peeringResults = await ripeClient.fetchPeeringDBLocations(
        offshoreASNs,
        analysis.directPeersMap || {},
        (p) => updateProgress(p)
      );
      for (const [asn, peering] of Object.entries(peeringResults)) {
        if (asnInfo[asn]) {
          asnInfo[asn].peering_country = peering.country;
          asnInfo[asn].peering_details = peering.details;
          asnInfo[asn].peering_source = peering.source;
        }
      }
    } else {
      updateProgress({ step: 4, totalSteps: 5, message: 'No offshore ASNs detected — skipping PeeringDB.', progress: 1, complete: true });
    }

    // Step 5: Build visualization data (license-aware, 6-category)
    updateProgress({ step: 5, totalSteps: 5, message: 'Building visualization…', progress: 0.5 });
    const vizData = buildVisualizationData(analysis, asnInfo, countryASNs, 1500, 2000, btrcLicensedASNs, igwLicensedASNs);
    updateProgress({ step: 5, totalSteps: 5, message: 'Done!', progress: 1, complete: true });

    currentData = vizData;
    setDataSourceLabel(`Live data from: ${new Date().toLocaleString()}`);
    onDataLoaded();

    hideProgress();
    const iigCount = vizData.stats.total_iig + (vizData.stats.total_detected_iig || 0);
    const offshoreCount = (vizData.stats.total_offshore_enterprise || 0) + (vizData.stats.total_offshore_gateway || 0);
    showToast('success', `Live data loaded! ${analysis.validObservations.toLocaleString()} observations, ${iigCount} gateways, ${offshoreCount} offshore, ${vizData.stats.total_local_company} Local Companies.`);

  } catch (err) {
    hideProgress();
    if (err.name === 'AbortError') {
      showToast('warning', 'Fetch cancelled.');
    } else {
      console.error('Live fetch failed:', err);
      showToast('error', `Live fetch failed: ${err.message}. Try again or use static data.`);
    }
  }
}

// ────────────────────────────────────────
// Window resize handler
// ────────────────────────────────────────

let resizeTimer;
let lastWidth = 0;
let lastHeight = 0;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const vizPanel = document.getElementById('viz-panel');
    if (!vizPanel) return;
    
    const currentWidth = vizPanel.clientWidth;
    const currentHeight = vizPanel.clientHeight;
    
    // Only re-render if dimensions changed significantly (>50px in either direction)
    // This prevents spurious re-renders when switching tabs or refocusing window
    const widthDiff = Math.abs(currentWidth - lastWidth);
    const heightDiff = Math.abs(currentHeight - lastHeight);
    
    if (widthDiff > 50 || heightDiff > 50) {
      lastWidth = currentWidth;
      lastHeight = currentHeight;
      
      // Redraw for the new size (e.g. a phone turned sideways), keeping the
      // user's filters.
      const mod = vizModules[activeTab];
      if (currentData && mod) {
        mod.destroy?.();
        mod.init('viz-panel');
        mod.loadData(currentData, savedLoadOptions());
        if (activeTypeFilters.size < 6) mod.filterByTypes?.(activeTypeFilters);
      }
    }
  }, 300);
});

// iOS Safari can leave the page scrolled after a pinch zoom, which puts the
// tabs under the status bar. The page itself never scrolls, so put it back
// once the zoom returns to normal (#31).
window.visualViewport?.addEventListener('resize', () => {
  if (window.visualViewport.scale <= 1.01 && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
});

// iOS Safari only applies :active (the press feedback touch screens get instead
// of hover) when the page listens for touchstart.
document.addEventListener('touchstart', () => {}, { passive: true });

// ────────────────────────────────────────
// Boot
// ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
