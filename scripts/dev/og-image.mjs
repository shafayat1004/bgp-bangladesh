#!/usr/bin/env node
/**
 * Regenerate the social preview image (assets/img/og-image.png, 1200x630) from
 * the Network Graph. Run after visual changes to the graph; needs baked layout
 * data (npm run layout) so the graph is drawn settled.
 *
 * Usage: npm run og-image
 */
import path from 'node:path';
import { startServer, launchBrowser, openSite, ROOT, dataHasBakedLayout } from './lib/site.mjs';

const OUT = path.join(ROOT, 'assets', 'img', 'og-image.png');
const SIDEBAR = 320;
const CHROME_HEIGHT = 144;   // title bar + tabs above the chart, timeline + footer below

if (!dataHasBakedLayout()) console.warn('Warning: no baked layout in data/BD/viz_data.json; run `npm run layout` first for a settled graph.');

const server = await startServer();
const browser = await launchBrowser();
try {
  // Size the window so the chart area is exactly 1200x630.
  const site = await openSite(browser, server.url, {
    tab: 'force-graph',
    viewport: { width: 1200 + SIDEBAR, height: 630 + CHROME_HEIGHT },
  });
  const { page } = site;
  await page.evaluate(() => document.querySelectorAll('.viz-nav').forEach(e => { e.style.visibility = 'hidden'; }));
  const box = await page.locator('#viz-panel').boundingBox();
  if (Math.round(box.width) !== 1200 || Math.round(box.height) !== 630) {
    console.warn(`Chart area is ${Math.round(box.width)}x${Math.round(box.height)}, not 1200x630; adjust SIDEBAR/CHROME_HEIGHT.`);
  }
  await page.screenshot({ path: OUT, clip: { x: box.x, y: box.y, width: 1200, height: 630 } });
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
  await site.close();
} finally {
  await browser.close();
  await server.close();
}
