#!/usr/bin/env node
/**
 * Precompute Network Graph positions
 *
 * Runs the network graph's force layout to completion (same forces as the
 * browser, via assets/js/viz/force-layout.js) and stores the settled positions
 * in each data file under a top-level "layout" key, so the browser can draw the
 * graph immediately instead of simulating on every page load.
 *
 * Each history snapshot is seeded from the previous snapshot's positions so the
 * layout stays stable across the history slider. viz_data.json reuses the newest
 * snapshot's layout when the two files hold the same data.
 *
 * The "layout" block is appended as text at the end of the JSON so the rest of
 * the file (written by update_bgp_data.py) stays byte-for-byte unchanged.
 *
 * Usage:
 *   node scripts/precompute_layout.mjs [--country BD] [--force]
 *     --force   recompute files that already have a current layout
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as d3 from 'd3-force';

import {
  LAYOUT_VERSION, LAYOUT_WIDTH, LAYOUT_HEIGHT, LAYOUT_MIN_TRAFFIC, LAYOUT_MAX_TRAFFIC,
  selectGraph, bandPosition, createSimulation, configureForces,
} from '../assets/js/viz/force-layout.js';

const LAYOUT_KEY = '\n  "layout": ';
// Gentle reheat when most nodes already have a place; 0.3 moved the median node
// ~70px between snapshots, 0.1 ~30px while still settling newly added nodes.
const SEEDED_ALPHA = 0.1;

/** Deterministic PRNG so the same input always yields the same layout. */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296;
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Settle the layout for one dataset. previousPositions ({asn: [x, y]}) seeds
 * nodes that also appeared in the previous snapshot.
 */
export function computeLayout(data, previousPositions = null) {
  const { nodes, edges } = selectGraph(data, LAYOUT_MIN_TRAFFIC, LAYOUT_MAX_TRAFFIC);
  const random = lcg(1);
  let seeded = 0;
  const simNodes = nodes.map(n => {
    const prev = previousPositions?.[n.asn];
    if (prev) seeded++;
    const [x, y] = prev || bandPosition(n.type, LAYOUT_WIDTH, LAYOUT_HEIGHT, random);
    return { asn: n.asn, type: n.type, traffic: n.traffic, x, y };
  });
  const simEdges = edges.map(e => ({ source: e.source?.asn || e.source, target: e.target?.asn || e.target }));

  const simulation = createSimulation(d3).stop();
  configureForces(d3, simulation, { width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT, nodeCount: simNodes.length });
  simulation.nodes(simNodes);
  simulation.force('link').links(simEdges);
  simulation.alpha(seeded > 0 ? SEEDED_ALPHA : 1);
  let ticks = 0;
  while (simulation.alpha() >= simulation.alphaMin()) {
    simulation.tick();
    ticks++;
  }

  const positions = {};
  for (const n of simNodes) positions[n.asn] = [round1(n.x), round1(n.y)];
  return {
    layout: {
      version: LAYOUT_VERSION,
      width: LAYOUT_WIDTH,
      height: LAYOUT_HEIGHT,
      minTraffic: LAYOUT_MIN_TRAFFIC,
      maxTraffic: LAYOUT_MAX_TRAFFIC === Infinity ? null : LAYOUT_MAX_TRAFFIC,
      positions,
    },
    ticks,
    seeded,
  };
}

/** Remove a previously appended "layout" block, if any. */
export function stripLayoutBlock(text) {
  const i = text.lastIndexOf(',' + LAYOUT_KEY);
  return i === -1 ? text : text.slice(0, i) + '\n}';
}

/** Append (or replace) the "layout" block at the end of a JSON object's text. */
export function withLayoutBlock(text, layout) {
  const base = stripLayoutBlock(text).trimEnd();
  if (!base.endsWith('}')) throw new Error('Expected the JSON text to end with "}"');
  const meta = ['version', 'width', 'height', 'minTraffic', 'maxTraffic']
    .map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(layout[k])},`);
  const pos = Object.entries(layout.positions)
    .map(([asn, [x, y]]) => `      ${JSON.stringify(asn)}: [${x}, ${y}]`);
  const block = [
    '{',
    ...meta,
    '    "positions": {',
    pos.join(',\n'),
    '    }',
    '  }',
  ].join('\n');
  return `${base.slice(0, -1).trimEnd()},${LAYOUT_KEY}${block}\n}`;
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { text, data: JSON.parse(text) };
}

function writeLayout(file, text, layout) {
  const out = withLayoutBlock(text, layout);
  JSON.parse(out);  // never write a file the browser can't parse
  fs.writeFileSync(file, out);
}

const isCurrent = (data) => data.layout?.version === LAYOUT_VERSION;

function main(argv) {
  const args = argv.slice(2);
  const countryIdx = args.indexOf('--country');
  const country = (countryIdx !== -1 && args[countryIdx + 1] ? args[countryIdx + 1] : 'BD').toUpperCase();
  const force = args.includes('--force');

  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = path.join(projectDir, 'data', country);
  const historyDir = path.join(dataDir, 'history');
  const indexFile = path.join(historyDir, 'index.json');

  console.log(`[layout] Precomputing network graph positions for ${country}`);

  // History snapshots, oldest first, each seeded from the one before it.
  let previous = null;     // { file, text, data } of the newest processed snapshot
  const snapshots = fs.existsSync(indexFile) ? (readJson(indexFile).data.snapshots || []) : [];
  for (const snap of snapshots) {
    const file = path.join(historyDir, snap.file);
    if (!fs.existsSync(file)) {
      console.warn(`      Skipping ${snap.file}: listed in index.json but missing`);
      continue;
    }
    const current = readJson(file);
    if (isCurrent(current.data) && !force) {
      previous = current;
      continue;
    }
    const t0 = Date.now();
    const { layout, ticks, seeded } = computeLayout(current.data, previous?.data.layout?.positions);
    writeLayout(file, current.text, layout);
    console.log(`      ${snap.file}: ${Object.keys(layout.positions).length} nodes, ${seeded} seeded, ${ticks} ticks, ${Date.now() - t0} ms`);
    previous = readJson(file);
  }

  // viz_data.json: the latest data, normally identical to the newest snapshot.
  const vizFile = path.join(dataDir, 'viz_data.json');
  const viz = readJson(vizFile);
  if (isCurrent(viz.data) && !force) {
    console.log('      viz_data.json: layout already current');
    return;
  }
  if (previous && stripLayoutBlock(previous.text) === stripLayoutBlock(viz.text)) {
    writeLayout(vizFile, viz.text, previous.data.layout);
    console.log('      viz_data.json: reused the newest snapshot\'s layout');
    return;
  }
  const t0 = Date.now();
  const { layout, ticks, seeded } = computeLayout(viz.data, previous?.data.layout?.positions);
  writeLayout(vizFile, viz.text, layout);
  console.log(`      viz_data.json: ${Object.keys(layout.positions).length} nodes, ${seeded} seeded, ${ticks} ticks, ${Date.now() - t0} ms`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
