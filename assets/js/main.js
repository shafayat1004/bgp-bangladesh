/**
 * Main Application Orchestrator
 * Wires together: data loading, license-aware classification, UI, visualizations, live fetch, and ASN lookup.
 */

import { RIPEStatClient } from './api/ripestat.js';
import { analyzeGateways, buildVisualizationData, createAnalysisState, analyzeRoutesBatch, finalizeAnalysis } from './api/data-processor.js';
import { showModal, resetModal } from './ui/modal.js';
import { populateSidebar, setDataSourceLabel, getActiveTab, saveActiveTab, loadPreferences, savePreferences, showMyASNResult } from './ui/controls.js';
import { showProgress, updateProgress, hideProgress, showToast, onProgressCancel } from './ui/loading.js';
import { exportNodesCSV, exportEdgesCSV, exportJSON, exportRawRoutes } from './ui/export.js';
import { wasmSupported, createAnalysisWorker } from './wasm-bridge.js';

import * as ForceGraph from './viz/force-graph.js';
import * as Sankey from './viz/sankey.js';
import * as Hierarchical from './viz/hierarchical.js';
import * as Table from './viz/table.js';
import * as BarGateway from './viz/bar-gateway.js';
import * as BarCountry from './viz/bar-country.js';

const COUNTRY = 'BD';
let currentData = null;
let rawRoutes = null;  // Store raw BGP routes for export
let activeTab = 'force-graph';
let ripeClient = new RIPEStatClient();
let btrcLicensedASNs = new Set();
let wasmWorker = null;  // WASM analysis worker (created lazily)

// Type labels for toast/tooltip
const TYPE_LABEL_MAP = {
  'iig': 'IIG (Licensed Gateway)',
  'detected-iig': 'Detected Gateway',
  'offshore-enterprise': 'Offshore Enterprise',
  'offshore-gateway': 'Offshore Gateway',
  'local-company': 'Local Company',
  'outside': 'International Transit',
};

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
  try {
    const resp = await fetch('data/btrc_iig_licenses.json');
    if (resp.ok) {
      const raw = await resp.json();
      btrcLicensedASNs = new Set(Object.keys(raw).filter(k => !k.startsWith('_')));
      console.log(`Loaded ${btrcLicensedASNs.size} BTRC-licensed IIG ASNs`);
    }
  } catch (err) {
    console.warn('Could not load BTRC IIG license list:', err);
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

    let meta = {};
    if (metaResponse.ok) meta = await metaResponse.json();

    const dateStr = meta.last_updated
      ? new Date(meta.last_updated).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Unknown';

    setDataSourceLabel(`Static data from: ${dateStr}`);
    onDataLoaded();
  } catch (err) {
    console.error('Failed to load static data:', err);
    showToast('error', 'Failed to load static data. Check your connection and reload.');
  }
}

// ────────────────────────────────────────
// Data Loaded Handler
// ────────────────────────────────────────

function onDataLoaded() {
  if (!currentData) return;
  populateSidebar(currentData, (asn) => {
    const mod = vizModules[activeTab];
    if (mod?.highlightASN) mod.highlightASN(asn);
  });
  
  // Load with user's saved filter preference
  const prefs = loadPreferences();
  const defaultMinTraffic = prefs.minTraffic !== undefined ? prefs.minTraffic : 100;
  const defaultMaxTraffic = prefs.maxTraffic !== undefined ? prefs.maxTraffic : Infinity;
  switchTab(activeTab, { minTraffic: defaultMinTraffic, maxTraffic: defaultMaxTraffic });
}

// ────────────────────────────────────────
// Tab Navigation
// ────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  highlightTab(activeTab);
}

function switchTab(tabId, options = {}) {
  if (!currentData) return;
  const prevMod = vizModules[activeTab];
  if (prevMod?.destroy) prevMod.destroy();
  activeTab = tabId;
  saveActiveTab(tabId);
  highlightTab(tabId);
  const mod = vizModules[tabId];
  if (mod) {
    mod.init('viz-panel');
    const prefs = loadPreferences();
    const loadOptions = {
      minTraffic: options.minTraffic !== undefined ? options.minTraffic : (prefs.minTraffic !== undefined ? prefs.minTraffic : 100),
      maxTraffic: options.maxTraffic !== undefined ? options.maxTraffic : (prefs.maxTraffic !== undefined ? prefs.maxTraffic : Infinity),
      nodeSize: prefs.nodeSize || 15,
      ...options
    };
    mod.loadData(currentData, loadOptions);
    
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

function highlightTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
}

// ────────────────────────────────────────
// Control Buttons
// ────────────────────────────────────────

function setupButtons() {
  document.getElementById('btn-fetch-live')?.addEventListener('click', fetchLiveData);

  document.getElementById('btn-revert-static')?.addEventListener('click', async () => {
    ripeClient.cancel();
    hideProgress();
    await loadStaticData();
    showToast('info', 'Reverted to static data.');
  });

  document.getElementById('btn-export-nodes')?.addEventListener('click', () => {
    if (currentData) { exportNodesCSV(currentData); showToast('success', 'Nodes CSV downloaded.'); }
  });
  document.getElementById('btn-export-edges')?.addEventListener('click', () => {
    if (currentData) { exportEdgesCSV(currentData); showToast('success', 'Edges CSV downloaded.'); }
  });
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (currentData) { exportJSON(currentData); showToast('success', 'JSON data downloaded.'); }
  });
  
  document.getElementById('btn-export-raw')?.addEventListener('click', () => {
    if (rawRoutes) {
      exportRawRoutes(rawRoutes);
      showToast('success', `Raw routes downloaded (${rawRoutes.length.toLocaleString()} routes, ~${(JSON.stringify(rawRoutes).length / 1024 / 1024).toFixed(1)}MB).`);
    } else {
      showToast('warning', 'No raw routes available. Click "Fetch Live Data" first to download raw routes.');
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

  document.getElementById('btn-toggle-labels')?.addEventListener('click', () => {
    const mod = vizModules[activeTab];
    if (mod?.toggleLabelsVisibility) mod.toggleLabelsVisibility();
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

  // Toggle menu
  mobileMenuBtn.addEventListener('click', () => {
    const isActive = sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
    mobileMenuBtn.classList.toggle('active');
    
    // Prevent body scroll when sidebar is open on mobile
    if (isActive && window.innerWidth <= 900) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  });

  // Close on overlay click
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('active');
    overlay.classList.remove('active');
    mobileMenuBtn.classList.remove('active');
    document.body.style.overflow = '';
  });

  // Close sidebar when clicking on sidebar items (for better mobile UX)
  sidebar.addEventListener('click', (e) => {
    // Close if clicking on ASN items or buttons
    if (e.target.closest('.asn-item') || e.target.closest('.tab-btn')) {
      if (window.innerWidth <= 900) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        mobileMenuBtn.classList.remove('active');
        document.body.style.overflow = '';
      }
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
      mobileMenuBtn.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Tap on viz panel dismisses tooltip on mobile
  const vizPanel = document.getElementById('viz-panel');
  if (vizPanel) {
    vizPanel.addEventListener('click', (e) => {
      if (window.innerWidth > 900) return;
      // Only dismiss if tapping on empty space (not a node/link)
      const target = e.target;
      if (target.tagName === 'svg' || target.classList.contains('viz-container') || target.id === 'viz-panel') {
        const tip = document.getElementById('tooltip');
        if (tip) tip.style.display = 'none';
      }
    });
  }
}

// ────────────────────────────────────────
// What's My ASN?
// ────────────────────────────────────────

async function detectMyASN() {
  const btn = document.getElementById('btn-my-asn');
  if (btn) { btn.disabled = true; btn.textContent = 'Detecting...'; }

  try {
    const result = await ripeClient.getMyASN();
    showMyASNResult(result);

    // Check if this ASN is in our data
    if (currentData) {
      const found = currentData.nodes.find(n => n.asn === result.asn);
      if (found) {
        const typeLabel = TYPE_LABEL_MAP[found.type] || found.type;
        showToast('success', `Your ASN (AS${result.asn}) is visible as a ${typeLabel}!`, 8000);
        const mod = vizModules[activeTab];
        if (mod?.highlightASN) mod.highlightASN(result.asn);
      } else {
        showToast('info', `Your ASN (AS${result.asn}) is not in the visible data. Your traffic likely routes through one of the ${currentData.stats.total_iig + (currentData.stats.total_detected_iig || 0)} gateways displayed. Try lowering the "Min Routes" filter to 0 to see smaller ISPs.`, 10000);
      }
    }
  } catch (err) {
    showMyASNResult({ error: `Could not detect your ASN: ${err.message}` });
    showToast('error', `ASN detection failed: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "What's My ASN?"; }
  }
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
  const searchInput = document.getElementById('search-asn');

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
    const defaultMax = prefs.maxTraffic !== undefined ? prefs.maxTraffic : 40000;
    maxTrafficSlider.value = defaultMax;
    if (maxTrafficLabel) {
      maxTrafficLabel.textContent = defaultMax >= 40000 ? '∞' : defaultMax.toLocaleString();
    }
    
    maxTrafficSlider.addEventListener('input', () => {
      const minVal = minTrafficSlider ? parseInt(minTrafficSlider.value) : 0;
      const maxVal = parseInt(maxTrafficSlider.value);
      const isInfinity = maxVal >= 40000;
      
      if (maxTrafficLabel) {
        maxTrafficLabel.textContent = isInfinity ? '∞' : maxVal.toLocaleString();
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

  // ASN Search
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = e.target.value.trim().toLowerCase();
        if (!query || !currentData) return;

        // Normalize search: strip "AS" prefix if present for ASN matching
        const normalizedQuery = query.replace(/^as/i, '');

        // Search for matching ASNs
        const matches = currentData.nodes.filter(n => 
          n.asn.includes(normalizedQuery) ||
          (n.name || '').toLowerCase().includes(query) ||
          (n.description || '').toLowerCase().includes(query)
        );

        if (matches.length > 0) {
          const mod = vizModules[activeTab];
          if (mod?.highlightASN) {
            mod.highlightASN(matches[0].asn);
            showToast('info', `Found: ${matches[0].name || `AS${matches[0].asn}`}${matches.length > 1 ? ` (+${matches.length - 1} more)` : ''}`, 3000);
          }
        } else if (query.length > 2) {
          showToast('warning', 'No matching ASN found in visible data', 2000);
        }
      }, 500);
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
      const typeLabel = TYPE_LABEL_MAP[node.type] || node.type;
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
    // Step 1: Country resources
    const { countryASNs, prefixes } = await ripeClient.getCountryResources(COUNTRY, (p) => updateProgress({ ...p, totalSteps: 5 }));

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
    updateProgress({ step: 3, totalSteps: 5, message: 'Finalizing gateway analysis...', progress: 0 });
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
    updateProgress({ step: 3, totalSteps: 5, message: 'Detecting offshore ASNs via geolocation...', progress: 0.85 });
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
    updateProgress({ step: 5, totalSteps: 5, message: 'Building visualization...', progress: 0.5 });
    const vizData = buildVisualizationData(analysis, asnInfo, countryASNs, 1500, 2000, btrcLicensedASNs);
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
      
      if (currentData && vizModules[activeTab]) {
        vizModules[activeTab].destroy?.();
        vizModules[activeTab].init('viz-panel');
        vizModules[activeTab].loadData(currentData);
      }
    }
  }, 300);
});

// ────────────────────────────────────────
// Boot
// ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
