/**
 * Shared Playwright helpers for the dev scripts (scripts/dev/*.mjs) and the
 * end-to-end tests (tests-e2e/):
 *  - startServer(): serves the repo with caching off, so a reload always runs
 *    the code on disk
 *  - launchBrowser(): installed Chrome if present, else Playwright's Chromium
 *  - openSite(): the site loaded and ready to inspect (intro dismissed, the
 *    Network Graph CPU warning accepted, a chosen tab open, errors collected)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const OUTPUT_DIR = path.join(ROOT, '.dev-output');

export const TABS = ['force-graph', 'sankey', 'hierarchical', 'bar-gateway', 'bar-country', 'table'];

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'phone-landscape': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

// Console noise that is expected locally: the WASM build is not committed and
// there is no favicon.ico (the page uses an SVG icon).
const IGNORED_ERRORS = /wasm|favicon\.ico/i;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Serve the repo root. port 0 picks a free port. host '::' also listens on
 * the local network (both IPv4 and IPv6), e.g. to open the site on a phone.
 */
export function startServer({ port = 0, host = 'localhost' } = {}) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({ url: `http://localhost:${actual}/`, close: () => new Promise(r => server.close(r)) });
    });
  });
}

/** Installed Chrome when available (no download needed), else Playwright's Chromium. */
export async function launchBrowser({ headed = !!process.env.HEADED } = {}) {
  try {
    return await chromium.launch({ channel: 'chrome', headless: !headed });
  } catch {
    try {
      return await chromium.launch({ headless: !headed });
    } catch (err) {
      throw new Error(`No browser available. Install Chrome or run: npx playwright install chromium\n${err.message}`);
    }
  }
}

/**
 * Open the site in a fresh browser context.
 * options: viewport ('desktop' | 'phone' | 'phone-landscape', or an exact
 * { width, height }), tab (one of TABS), showIntro (leave the intro dialog
 * open), reducedMotion. Returns { page, context, errors, close }.
 */
export async function openSite(browser, baseUrl, { viewport = 'desktop', tab = 'hierarchical', showIntro = false, reducedMotion = 'no-preference' } = {}) {
  const size = typeof viewport === 'string' ? VIEWPORTS[viewport] : { viewport };
  if (!size) throw new Error(`Unknown viewport "${viewport}" (use ${Object.keys(VIEWPORTS).join(', ')})`);
  const context = await browser.newContext({ ...size, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !IGNORED_ERRORS.test(m.text())) errors.push(m.text()); });

  await context.addInitScript(({ tab, showIntro }) => {
    window.confirm = () => true;   // Network Graph CPU warning, live-fetch prompt
    try {
      localStorage.removeItem('bgp_bd_prefs');   // default filters every run
      localStorage.setItem('bgp_bd_active_tab', tab);
      if (showIntro) localStorage.removeItem('bgp_bd_modal_dismissed');
      else localStorage.setItem('bgp_bd_modal_dismissed', '1');
    } catch { /* storage unavailable */ }
  }, { tab, showIntro });

  await page.goto(baseUrl);
  await waitForView(page);
  return { page, context, errors, close: () => context.close() };
}

/** Wait until data is loaded and the active view has drawn. */
export async function waitForView(page) {
  await page.waitForFunction(() => !document.getElementById('timeline-bar').classList.contains('hidden'));
  await page.waitForFunction(() => document.querySelector('#viz-panel svg *, #viz-panel table, #viz-panel .bar-view'));
  await page.waitForTimeout(300);
}

/** Switch tab the way a user would and wait for it to draw. */
export async function switchTab(page, tab) {
  await page.click(`#tab-${tab}`);
  await waitForView(page);
}

/** Network Graph node positions keyed by ASN (layout coordinates). */
export function nodePositions(page) {
  return page.evaluate(() => {
    const m = {};
    d3.selectAll('#force-svg g.node').each(d => { m[d.asn] = [d.x, d.y]; });
    return m;
  });
}

/** Median and 90th-percentile movement between two nodePositions() results. */
export function movement(before, after) {
  const d = Object.keys(after).filter(k => before[k])
    .map(k => Math.hypot(after[k][0] - before[k][0], after[k][1] - before[k][1]))
    .sort((a, b) => a - b);
  const q = p => (d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1) : 0);
  return { shared: d.length, median: q(0.5), p90: q(0.9), moved: d.filter(v => v > 0.01).length };
}

/** Tiny --key value / --flag parser; comma lists become arrays. */
export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = Array.isArray(defaults[key]) ? next.split(',') : next;
    i++;
  }
  return out;
}

/** Does the committed/local data carry a baked Network Graph layout? */
export function dataHasBakedLayout(country = 'BD') {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'data', country, 'viz_data.json'), 'utf8');
    return text.includes('\n  "layout": ');
  } catch {
    return false;
  }
}
