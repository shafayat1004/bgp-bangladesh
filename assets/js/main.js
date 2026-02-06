/**
 * Main Application Orchestrator
 * Wires together all modules: data loading, UI, visualizations, and live fetch.
 */

import { RIPEStatClient } from './api/ripestat.js';
import { analyzeGateways, buildVisualizationData } from './api/data-processor.js';
import { showModal, resetModal } from './ui/modal.js';
import { populateSidebar, setDataSourceLabel, getActiveTab, saveActiveTab, loadPreferences, savePreferences } from './ui/controls.js';
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
  // Show educational modal
  showModal();

  // Restore preferences
  activeTab = getActiveTab();

  // Set up tab navigation
  setupTabs();

  // Set up control buttons
  setupButtons();

  // Set up filters
  setupFilters();

  // Load static data
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
    if (metaResponse.ok) {
      meta = await metaResponse.json();
    }

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

  // Populate sidebar
  populateSidebar(currentData, (asn) => {
    const mod = vizModules[activeTab];
    if (mod?.highlightASN) mod.highlightASN(asn);
  });

  // Initialize and load active visualization
  switchTab(activeTab);
}

// ────────────────────────────────────────
// Tab Navigation
// ────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Highlight active tab
  highlightTab(activeTab);
}

function switchTab(tabId) {
  if (!currentData) return;

  // Destroy previous
  const prevMod = vizModules[activeTab];
  if (prevMod?.destroy) prevMod.destroy();

  activeTab = tabId;
  saveActiveTab(tabId);
  highlightTab(tabId);

  // Initialize new
  const mod = vizModules[tabId];
  if (mod) {
    mod.init('viz-panel');
    mod.loadData(currentData);
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
  // Fetch Live Data
  document.getElementById('btn-fetch-live')?.addEventListener('click', fetchLiveData);

  // Revert to Static
  document.getElementById('btn-revert-static')?.addEventListener('click', async () => {
    ripeClient.cancel();
    hideProgress();
    await loadStaticData();
    showToast('info', 'Reverted to static data.');
  });

  // Export buttons
  document.getElementById('btn-export-nodes')?.addEventListener('click', () => {
    if (currentData) { exportNodesCSV(currentData); showToast('success', 'Nodes CSV downloaded.'); }
  });

  document.getElementById('btn-export-edges')?.addEventListener('click', () => {
    if (currentData) { exportEdgesCSV(currentData); showToast('success', 'Edges CSV downloaded.'); }
  });

  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (currentData) { exportJSON(currentData); showToast('success', 'JSON data downloaded.'); }
  });

  // Show intro again
  document.getElementById('btn-show-intro')?.addEventListener('click', () => {
    resetModal();
    showModal(true);
  });

  // Reset view
  document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    const mod = vizModules[activeTab];
    if (mod?.resetView) mod.resetView();
  });

  // Toggle labels
  document.getElementById('btn-toggle-labels')?.addEventListener('click', () => {
    const mod = vizModules[activeTab];
    if (mod?.toggleLabelsVisibility) mod.toggleLabelsVisibility();
  });
}

// ────────────────────────────────────────
// Filters
// ────────────────────────────────────────

function setupFilters() {
  const prefs = loadPreferences();

  const trafficSlider = document.getElementById('filter-min-traffic');
  const trafficLabel = document.getElementById('filter-min-traffic-label');
  const sizeSlider = document.getElementById('filter-node-size');

  if (trafficSlider) {
    if (prefs.minTraffic) trafficSlider.value = prefs.minTraffic;
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
    const { countryASNs, prefixes } = await ripeClient.getCountryResources(COUNTRY, (p) => updateProgress(p));

    // Step 2: BGP routes
    const routes = await ripeClient.fetchBGPRoutes(prefixes, (p) => updateProgress(p));

    // Step 3: ASN names
    const allASNs = new Set();
    routes.forEach(rt => {
      (rt.path || []).forEach(a => allASNs.add(String(a)));
    });
    const asnInfo = await ripeClient.fetchASNInfo([...allASNs].slice(0, 500), (p) => updateProgress(p));

    // Step 4: Process
    updateProgress({ step: 4, totalSteps: 4, message: 'Processing data...', progress: 0 });
    const { outsideCounts, insideCounts, edgeCounts, validObservations } = analyzeGateways(routes, countryASNs, (p) => updateProgress(p));

    const vizData = buildVisualizationData(outsideCounts, insideCounts, edgeCounts, asnInfo);
    updateProgress({ step: 4, totalSteps: 4, message: 'Done!', progress: 1, complete: true });

    // Update
    currentData = vizData;
    setDataSourceLabel(`Live data from: ${new Date().toLocaleString()}`);
    onDataLoaded();

    hideProgress();
    showToast('success', `Live data loaded! ${validObservations.toLocaleString()} observations processed.`);

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
