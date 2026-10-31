#!/usr/bin/env node
/**
 * Performance profile of the slow paths: opening the Network Graph, stepping
 * and dragging the history slider, clicking a node, and zooming, panning and
 * hovering over the graph.
 *
 * Usage: npm run profile [-- --viewport phone --json --check]
 *   --json   also write .dev-output/profile.json
 *   --check  exit 1 when a budget below is exceeded (use before committing
 *            changes to the graph, the slider or chart CSS)
 *
 * Numbers come from this machine; a mid-range phone is several times slower.
 * "Long tasks" are main-thread tasks over 50 ms (the page can't respond then).
 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, openSite, switchTab, parseArgs, nodePositions, movement, dataHasBakedLayout, OUTPUT_DIR } from './lib/site.mjs';

const BUDGETS = {
  'graph open: blocked ms': 500,
  'slider step: ms to painted (worst)': 600,
  'slider drag: longest task ms': 250,
  'node click: nodes moved': 0,
  'slider step with highlight: ms to painted': 600,
  'graph zoom: frame ms (90th percentile)': 33,
  'graph pan: frame ms (90th percentile)': 33,
  'graph hover: frame ms (90th percentile)': 33,
};

const args = parseArgs(process.argv.slice(2), { viewport: 'desktop' });

// Counts simulation ticks and long tasks inside the page.
function installProbe(page) {
  return page.evaluate(() => {
    if (window.__probe) return;
    window.__probe = { ticks: 0, lt: [], reset() { this.ticks = 0; this.lt = []; } };
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__probe.lt.push(e.duration))).observe({ type: 'longtask' });
    const orig = d3.forceSimulation;
    d3.forceSimulation = function (...a) {
      const sim = orig.apply(this, a);
      const on = sim.on;
      sim.on = function (name, fn) {
        if (fn && name === 'tick') return on.call(this, name, function (...x) { fn.apply(this, x); window.__probe.ticks++; });
        return on.apply(this, arguments);
      };
      return sim;
    };
  });
}

const probe = (page) => page.evaluate(() => {
  const lt = window.__probe.lt;
  return { ticks: window.__probe.ticks, longTasks: lt.length, blockedMs: Math.round(lt.reduce((a, b) => a + b, 0)), longestMs: Math.round(Math.max(0, ...lt)) };
});
const resetProbe = (page) => page.evaluate(() => window.__probe.reset());
const twoFrames = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// Time between animation frames while an input sequence runs.
async function frameTimes(page, run) {
  await page.evaluate(() => {
    window.__frames = { gaps: [], on: true };
    let last = performance.now();
    const loop = (t) => { window.__frames.gaps.push(t - last); last = t; if (window.__frames.on) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await run();
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    window.__frames.on = false;
    const gaps = window.__frames.gaps.slice(1).sort((a, b) => a - b);
    return { frames: gaps.length, p90Ms: Math.round(gaps[Math.floor(gaps.length * 0.9)]), worstMs: Math.round(gaps[gaps.length - 1]) };
  });
}

async function stepSlider(page, buttonId) {
  const t0 = Date.now();
  await page.click(`#${buttonId}`);
  await page.waitForFunction(() => document.getElementById('timeline-spinner').classList.contains('hidden'));
  await twoFrames(page);
  return Date.now() - t0;
}

const server = await startServer();
const browser = await launchBrowser();
const results = { viewport: args.viewport, bakedLayout: dataHasBakedLayout() };
try {
  // 1. Open the Network Graph from another tab.
  let site = await openSite(browser, server.url, { viewport: args.viewport, tab: 'hierarchical' });
  let { page } = site;
  await installProbe(page);
  await resetProbe(page);
  let t0 = Date.now();
  await switchTab(page, 'force-graph');
  await twoFrames(page);
  const msToPainted = Date.now() - t0;
  await page.waitForTimeout(4500);   // the graph stops simulating after 4 s at most
  results.graphOpen = { msToPainted, ...(await probe(page)) };

  // 2. Click the biggest gateway: only the highlight should change.
  const before = await nodePositions(page);
  const target = await page.evaluate(() => {
    let best = null;
    d3.selectAll('#force-svg g.node').each(function (d) { if (!best || d.traffic > best.t) best = { t: d.traffic, el: this }; });
    const r = best.el.querySelector('circle').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await page.mouse.click(target[0], target[1]);
  await page.waitForTimeout(1500);
  results.nodeClick = movement(before, await nodePositions(page));

  // 3. A slider step while that gateway (and its hundreds of links) is highlighted.
  await resetProbe(page);
  results.highlightedStep = { ms: await stepSlider(page, 'timeline-prev'), ...(await probe(page)) };
  await page.focus('#force-svg');
  await page.keyboard.press('Escape');   // clears the highlight
  await page.waitForTimeout(500);

  // 4. Three slider steps back on the Network Graph.
  results.sliderSteps = [];
  for (let i = 0; i < 3; i++) {
    const b = await nodePositions(page);
    await resetProbe(page);
    const ms = await stepSlider(page, 'timeline-prev');
    await page.waitForTimeout(1200);
    results.sliderSteps.push({ ms, ...(await probe(page)), drift: movement(b, await nodePositions(page)) });
  }

  // 5. Drag across ten snapshots, ~200 ms per snapshot like a user scrubbing.
  await page.evaluate(() => { const s = document.getElementById('timeline-slider'); s.value = s.max; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(1500);
  const box = await page.locator('#timeline-slider').boundingBox();
  const max = await page.evaluate(() => Number(document.getElementById('timeline-slider').max));
  const y = box.y + box.height / 2;
  const xAt = i => box.x + 8 + (box.width - 16) * i / max;
  await resetProbe(page);
  t0 = Date.now();
  await page.mouse.move(xAt(max), y);
  await page.mouse.down();
  for (let i = max; i >= Math.max(0, max - 10); i--) { await page.mouse.move(xAt(i), y, { steps: 3 }); await page.waitForTimeout(200); }
  await page.mouse.up();
  const dragMs = Date.now() - t0;
  await page.waitForFunction(() => document.getElementById('timeline-spinner').classList.contains('hidden'));
  await twoFrames(page);
  results.sliderDrag = { dragMs, caughtUpAfterMs: Date.now() - t0 - dragMs, ...(await probe(page)) };
  await site.close();

  // 6. Layered View slider step.
  site = await openSite(browser, server.url, { viewport: args.viewport, tab: 'hierarchical' });
  page = site.page;
  await installProbe(page);
  await resetProbe(page);
  results.layeredStep = { ms: await stepSlider(page, 'timeline-prev'), ...(await probe(page)) };
  await site.close();

  // 7. Wheel zoom, drag pan and hover over the Network Graph. Every frame
  // repaints all lines, so this is where costly strokes show up.
  site = await openSite(browser, server.url, { viewport: args.viewport, tab: 'force-graph' });
  page = site.page;
  await page.waitForTimeout(1000);
  const graph = await page.locator('#force-svg').boundingBox();
  const cx = graph.x + graph.width / 2, cy = graph.y + graph.height / 2;
  await page.mouse.move(cx, cy);
  results.graphZoom = await frameTimes(page, async () => {
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, i < 10 ? -60 : 60); await page.waitForTimeout(16); }
  });
  await page.waitForTimeout(300);   // zoom end restyles the dashes once
  results.graphPan = await frameTimes(page, async () => {
    await page.mouse.down();
    for (let i = 0; i < 40; i++) await page.mouse.move(cx + i * 5, cy + i * 2);
    await page.mouse.up();
  });
  results.graphHover = await frameTimes(page, async () => {
    for (let i = 0; i < 60; i++) await page.mouse.move(graph.x + 50 + i * (graph.width - 100) / 60, cy + Math.sin(i / 5) * graph.height / 4);
  });
  await site.close();
} finally {
  await browser.close();
  await server.close();
}

const r = results;
const rows = [
  ['graph open: ms to painted', r.graphOpen.msToPainted],
  ['graph open: simulation ticks', r.graphOpen.ticks],
  ['graph open: blocked ms', r.graphOpen.blockedMs],
  ['node click: nodes moved', r.nodeClick.moved],
  ['slider step with highlight: ms to painted', r.highlightedStep.ms],
  ['slider step: ms to painted (worst)', Math.max(...r.sliderSteps.map(s => s.ms))],
  ['slider step: simulation ticks (total)', r.sliderSteps.reduce((a, s) => a + s.ticks, 0)],
  ['slider step: median node drift (layout units)', r.sliderSteps.map(s => s.drift.median).join(' / ')],
  ['slider drag: caught up after release (ms)', r.sliderDrag.caughtUpAfterMs],
  ['slider drag: longest task ms', r.sliderDrag.longestMs],
  ['layered step: ms to painted', r.layeredStep.ms],
  ['graph zoom: frame ms (90th percentile)', r.graphZoom.p90Ms],
  ['graph pan: frame ms (90th percentile)', r.graphPan.p90Ms],
  ['graph hover: frame ms (90th percentile)', r.graphHover.p90Ms],
];
console.log(`Profile (${r.viewport}, baked layout in data: ${r.bakedLayout ? 'yes' : 'no - run npm run layout'})\n`);
let failed = 0;
for (const [name, value] of rows) {
  const budget = BUDGETS[name];
  const over = budget !== undefined && Number(value) > budget;
  if (over) failed++;
  console.log(`${over ? 'OVER' : '    '} ${name.padEnd(48)} ${String(value).padStart(10)}${budget !== undefined ? `   (budget ${budget})` : ''}`);
}
if (args.json) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'profile.json'), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), path.join(OUTPUT_DIR, 'profile.json'))}`);
}
if (args.check && failed) {
  console.log(`\n${failed} budget(s) exceeded.`);
  process.exit(1);
}
