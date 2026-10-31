#!/usr/bin/env node
/**
 * Screenshot every view at desktop and phone sizes for visual review, and flag
 * console errors or sideways page scrolling.
 *
 * Usage: npm run screenshots [-- --tabs force-graph,hierarchical --viewports desktop,phone --out dir]
 * Extra "tabs": intro (the intro dialog), sidebar (phone sidebar open).
 * Exits 1 when a page logs errors or scrolls sideways.
 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, openSite, parseArgs, TABS, OUTPUT_DIR } from './lib/site.mjs';

const args = parseArgs(process.argv.slice(2), {
  tabs: [...TABS, 'intro'],
  viewports: ['desktop', 'phone'],
  out: path.join(OUTPUT_DIR, 'screenshots'),
});
fs.mkdirSync(args.out, { recursive: true });

const server = await startServer();
const browser = await launchBrowser();
const problems = [];
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
      await site.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `\n${problems.length} screenshot(s) with problems.` : `\nAll screenshots saved to ${path.relative(process.cwd(), args.out)}.`);
process.exit(problems.length ? 1 : 0);
