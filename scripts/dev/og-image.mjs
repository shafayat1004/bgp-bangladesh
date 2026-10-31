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
const WIDTH = 1200;
const HEIGHT = 630;
// First guess at the page around the chart (sidebar; title bar and tabs above,
// timeline and footer below). The window is then corrected by measuring, so a
// header change doesn't crop the image.
const SIDEBAR = 320;
const CHROME_HEIGHT = 161;

if (!dataHasBakedLayout()) console.warn('Warning: no baked layout in data/BD/viz_data.json; run `npm run layout` first for a settled graph.');

const server = await startServer();
const browser = await launchBrowser();
try {
  // Size the window so the chart area is exactly 1200x630, measuring and
  // reopening once if the guess was off.
  let viewport = { width: WIDTH + SIDEBAR, height: HEIGHT + CHROME_HEIGHT };
  let site, box;
  for (let attempt = 0; attempt < 2; attempt++) {
    site = await openSite(browser, server.url, { tab: 'force-graph', viewport });
    box = await site.page.locator('#viz-panel').boundingBox();
    const dw = WIDTH - Math.round(box.width);
    const dh = HEIGHT - Math.round(box.height);
    if (!dw && !dh) break;
    if (attempt === 1) throw new Error(`Chart area is ${Math.round(box.width)}x${Math.round(box.height)}, not ${WIDTH}x${HEIGHT}.`);
    viewport = { width: viewport.width + dw, height: viewport.height + dh };
    await site.close();
  }
  const { page } = site;
  await page.evaluate(() => document.querySelectorAll('.viz-nav').forEach(e => { e.style.visibility = 'hidden'; }));
  await page.screenshot({ path: OUT, clip: { x: box.x, y: box.y, width: WIDTH, height: HEIGHT } });
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
  await site.close();
} finally {
  await browser.close();
  await server.close();
}
