/**
 * Main Application Orchestrator
 * Wires together: data loading, 3-layer model, UI, visualizations, live fetch, and ASN lookup.
 */

import { RIPEStatClient } from './api/ripestat.js';
import { analyzeGateways, buildVisualizationData } from './api/data-processor.js';
import { showModal, resetModal } from './ui/modal.js';
import { populateSidebar, setDataSourceLabel, getActiveTab, saveActiveTab, loadPreferences, savePreferences, showMyASNResult } from './ui/controls.js';
import { showProgress, updateProgress, hideProgress, showToast, onProgressCancel } from './ui/loading.js';
import { exportNodesCSV, exportEdgesCSV, exportJSON, exportRawRoutes } from './ui/export.js';

import * as ForceGraph from './viz/force-graph.js';
import * as Sankey from './viz/sankey.js';
import * as Treemap from './viz/treemap.js';
import * as Chord from './viz/chord.js';
import * as Hierarchical from './viz/hierarchical.js';
import * as Table from './viz/table.js';

const COUNTRY = 'BD';
let currentData = null;
let rawRoutes = null;  // Store raw BGP routes for export
let activeTab = 'force-graph';
let ripeClient = new RIPEStatClient();

const vizModules = {
  'force-graph': ForceGraph,
  'sankey': Sankey,
  'treemap': Treemap,
  'chord': Chord,
  'hierarchical': Hierarchical,
  'table': Table,
};

// ────────────────────────────────────────
// Initialization
// ────────────────────────────────────────

async function init() {
  showModal();
  activeTab = getActiveTab();
  setupTabs();
  setupButtons();
  setupFilters();
  await loadStaticData();
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

    const model = meta.model === '3-layer' ? ' (3-layer)' : '';
    setDataSourceLabel(`Static data from: ${dateStr}${model}`);
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
        const typeLabel = found.type === 'iig' ? 'Border Gateway (IIG)' : 
                         found.type === 'local-isp' ? 'Local ISP' : 
                         found.type === 'outside' ? 'International Transit' : 'node';
        showToast('success', `Your ASN (AS${result.asn}) is visible as a ${typeLabel}!`, 8000);
        const mod = vizModules[activeTab];
        if (mod?.highlightASN) mod.highlightASN(result.asn);
      } else {
        showToast('info', `Your ASN (AS${result.asn}) is not in the visible data. Your traffic likely routes through one of the ${currentData.stats.total_iig} IIGs displayed (green nodes). Try lowering the Min Traffic filter to 0 to see smaller ISPs.`, 10000);
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
      const maxVal = maxTrafficSlider ? parseInt(maxTrafficSlider.value) : Infinity;
      
      if (minTrafficLabel) minTrafficLabel.textContent = minVal.toLocaleString();
      savePreferences({ ...loadPreferences(), minTraffic: minVal });
      
      const mod = vizModules[activeTab];
      if (mod?.updateFilter) mod.updateFilter(minVal, maxVal);
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
      if (mod?.updateFilter) mod.updateFilter(minVal, isInfinity ? Infinity : maxVal);
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

        // Search for matching ASNs
        const matches = currentData.nodes.filter(n => 
          n.asn.includes(query) ||
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
// Live Data Fetching (3-layer)
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
    const { countryASNs, prefixes } = await ripeClient.getCountryResources(COUNTRY, (p) => updateProgress(p));

    // Step 2: BGP routes
    const routes = await ripeClient.fetchBGPRoutes(prefixes, (p) => updateProgress(p));
    rawRoutes = routes;  // Store for raw export

    // Step 3: Process into 3-layer model (to identify which ASNs we actually need)
    updateProgress({ step: 3, totalSteps: 4, message: 'Processing 3-layer model...', progress: 0 });
    const analysis = analyzeGateways(routes, countryASNs, (p) => updateProgress(p));
    
    // Step 4: Fetch ASN names only for ASNs that appear in top edges (much more efficient)
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
    const asnInfo = await ripeClient.fetchASNInfo([...neededASNs], countryASNs, (p) => updateProgress(p));

    // Build visualization data
    const vizData = buildVisualizationData(analysis, asnInfo, countryASNs);
    updateProgress({ step: 4, totalSteps: 4, message: 'Done!', progress: 1, complete: true });

    currentData = vizData;
    setDataSourceLabel(`Live data from: ${new Date().toLocaleString()} (3-layer)`);
    onDataLoaded();

    hideProgress();
    showToast('success', `Live data loaded! ${analysis.validObservations.toLocaleString()} observations, ${vizData.stats.total_iig} IIGs, ${vizData.stats.total_local_isp} Local ISPs.`);

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
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentData && vizModules[activeTab]) {
      vizModules[activeTab].destroy?.();
      vizModules[activeTab].init('viz-panel');
      vizModules[activeTab].loadData(currentData);
    }
  }, 300);
});

// ────────────────────────────────────────
// Boot
// ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
