#!/usr/bin/env node
/**
 * Screenshot every view at desktop and phone sizes for visual review, and flag
 * console errors or sideways page scrolling.
 *
 * Usage: npm run screenshots [-- --tabs force-graph,hierarchical --viewports desktop,phone --out dir --slider-step]
 * Extra "tabs": intro (the intro dialog), sidebar (phone sidebar open).
 * --slider-step  also step the history slider back once, save
 *                "<viewport>-<tab>-after-step.png" and list UI elements that
 *                moved or resized (layout shifts the visitor would see).
 * Exits 1 when a page logs errors or scrolls sideways. Layout shifts are
 * reported but don't fail the run (yet: see issue #5).
 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, openSite, parseArgs, TABS, OUTPUT_DIR } from './lib/site.mjs';

const args = parseArgs(process.argv.slice(2), {
  tabs: [...TABS, 'intro'],
  viewports: ['desktop', 'phone', 'phone-landscape'],
  out: path.join(OUTPUT_DIR, 'screenshots'),
});

// Chrome and data-dependent UI that should hold still when the date changes.
const STABLE_SELECTORS = [
  '#tab-nav', '#timeline-slider', '#timeline-readout', '.viz-nav',
  '#table-head th', '#table-body tr', '#stats-container .stat-value',
];

function boxes(page) {
  return page.evaluate((selectors) => {
    const out = {};
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el, i) => {
        if (i >= 12) return;   // the first rows/headers are enough
        const r = el.getBoundingClientRect();
        if (r.width || r.height) out[`${sel} #${i + 1}`] = [r.x, r.y, r.width, r.height].map(Math.round);
      });
    }
    return out;
  }, STABLE_SELECTORS);
}

function shifts(before, after) {
  return Object.keys(before).filter(k => after[k]).flatMap(k => {
    const [x0, y0, w0, h0] = before[k];
    const [x1, y1, w1, h1] = after[k];
    const parts = [];
    if (Math.abs(x1 - x0) > 1 || Math.abs(y1 - y0) > 1) parts.push(`moved ${x1 - x0},${y1 - y0}px`);
    if (Math.abs(w1 - w0) > 1 || Math.abs(h1 - h0) > 1) parts.push(`resized ${w1 - w0}x${h1 - h0}px`);
    return parts.length ? [`${k}: ${parts.join(', ')}`] : [];
  });
}
fs.mkdirSync(args.out, { recursive: true });

const server = await startServer();
const browser = await launchBrowser();
const problems = [];
let shifted = 0;
try {
  for (const viewport of args.viewports) {
    for (const shot of args.tabs) {
      const tab = TABS.includes(shot) ? shot : 'hierarchical';
      const site = await openSite(browser, server.url, { viewport, tab, showIntro: shot === 'intro' });
      if (shot === 'sidebar') {
        // The sidebar is always open at desktop widths; there is no menu button.
        if (!(await site.page.isVisible('#mobile-menu-btn'))) { await site.close(); continue; }
        await site.page.click('#mobile-menu-btn');
        await site.page.waitForTimeout(400);
      }
      const file = path.join(args.out, `${viewport}-${shot}.png`);
      await site.page.screenshot({ path: file });
      const overflowX = await site.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const panel = await site.page.evaluate(() => {
        const r = document.getElementById('viz-panel').getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      });
      const issues = [...site.errors.map(e => `console: ${e}`), ...(overflowX ? ['page scrolls sideways'] : [])];
      console.log(`${issues.length ? 'FAIL' : 'ok  '} ${path.relative(process.cwd(), file)}  (chart area ${panel})`);
      issues.forEach(i => console.log(`       ${i}`));
      if (issues.length) problems.push(file);

      if (args['slider-step'] && TABS.includes(shot)) {
        const before = await boxes(site.page);
        await site.page.click('#timeline-prev');
        await site.page.waitForFunction(() => document.getElementById('timeline-spinner').classList.contains('hidden'));
        await site.page.waitForTimeout(400);
        const afterFile = path.join(args.out, `${viewport}-${shot}-after-step.png`);
        await site.page.screenshot({ path: afterFile });
        const moved = shifts(before, await boxes(site.page));
        console.log(`${moved.length ? 'SHIFT' : 'ok  '} ${path.relative(process.cwd(), afterFile)}${moved.length ? `  (${moved.length} element(s) moved after a date step)` : ''}`);
        moved.slice(0, 8).forEach(m => console.log(`       ${m}`));
        if (moved.length > 8) console.log(`       ... and ${moved.length - 8} more`);
        shifted += moved.length ? 1 : 0;
      }
      await site.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `\n${problems.length} screenshot(s) with problems.` : `\nAll screenshots saved to ${path.relative(process.cwd(), args.out)}.`);
if (shifted) console.log(`${shifted} view(s) shifted after a date step; see the SHIFT lines and compare the before/after screenshots.`);
process.exit(problems.length ? 1 : 0);
