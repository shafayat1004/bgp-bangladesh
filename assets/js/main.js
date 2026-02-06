/**
 * Main Application Orchestrator
 * Wires together: data loading, 3-layer model, UI, visualizations, live fetch, and ASN lookup.
 */

import { RIPEStatClient } from './api/ripestat.js';
import { analyzeGateways, buildVisualizationData } from './api/data-processor.js';
import { showModal, resetModal } from './ui/modal.js';
import { populateSidebar, setDataSourceLabel, getActiveTab, saveActiveTab, loadPreferences, savePreferences, showMyASNResult } from './ui/controls.js';
import { showProgress, updateProgress, hideProgress, showToast, onProgressCancel } from './ui/loading.js';
import { exportNodesCSV, exportEdgesCSV, exportJSON } from './ui/export.js';

import * as ForceGraph from './viz/force-graph.js';
import * as Sankey from './viz/sankey.js';
import * as Treemap from './viz/treemap.js';
import * as Chord from './viz/chord.js';
import * as Hierarchical from './viz/hierarchical.js';
import * as Table from './viz/table.js';

const COUNTRY = 'BD';
let currentData = null;
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
  
  // Load with default filter to reduce density
  const prefs = loadPreferences();
  const defaultMinTraffic = prefs.minTraffic !== undefined ? prefs.minTraffic : 1000;
  switchTab(activeTab, { minTraffic: defaultMinTraffic });
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
      minTraffic: options.minTraffic !== undefined ? options.minTraffic : prefs.minTraffic || 1000,
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
        showToast('info', `Your ASN (AS${result.asn}) is not in the top 300 connections shown. Your traffic likely routes through one of the ${currentData.stats.total_iig} IIGs displayed (green nodes).`, 10000);
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

  const trafficSlider = document.getElementById('filter-min-traffic');
  const trafficLabel = document.getElementById('filter-min-traffic-label');
  const sizeSlider = document.getElementById('filter-node-size');
  const searchInput = document.getElementById('search-asn');

  // Set default minimum traffic to reduce density
  if (trafficSlider) {
    const defaultMin = prefs.minTraffic !== undefined ? prefs.minTraffic : 1000;
    trafficSlider.value = defaultMin;
    if (trafficLabel) trafficLabel.textContent = defaultMin.toLocaleString();
    
    trafficSlider.addEventListener('input', () => {
      const val = parseInt(trafficSlider.value);
      if (trafficLabel) trafficLabel.textContent = val.toLocaleString();
      savePreferences({ ...loadPreferences(), minTraffic: val });
      const mod = vizModules[activeTab];
      if (mod?.updateFilter) mod.updateFilter(val);
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

    // Step 3: ASN names (for all unique ASNs in paths)
    const allASNs = new Set();
    routes.forEach(rt => {
      (rt.path || []).forEach(a => allASNs.add(String(a)));
    });
    const asnInfo = await ripeClient.fetchASNInfo([...allASNs].slice(0, 500), countryASNs, (p) => updateProgress(p));

    // Step 4: Process into 3-layer model
    updateProgress({ step: 4, totalSteps: 4, message: 'Processing 3-layer model...', progress: 0 });
    const analysis = analyzeGateways(routes, countryASNs, (p) => updateProgress(p));
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
