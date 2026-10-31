/**
 * End-to-end checks in a real browser for behaviour that has regressed before:
 * graph stability, history slider, keyboard access and the phone sidebar.
 * Run: npm run test:e2e   (uses installed Chrome, or `npx playwright install chromium`)
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer, launchBrowser, openSite, switchTab, nodePositions, movement, dataHasBakedLayout, TABS } from '../scripts/dev/lib/site.mjs';

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const transformOf = (page, svgId) => page.evaluate(id => document.querySelector(`#${id} > g`).getAttribute('transform'), svgId);

test('every view renders without console errors (desktop and phone)', async () => {
  for (const viewport of ['desktop', 'phone']) {
    const site = await openSite(browser, server.url, { viewport, tab: 'hierarchical' });
    for (const tab of TABS) await switchTab(site.page, tab);
    assert.deepEqual(site.errors, [], `${viewport}: ${site.errors.join('\n')}`);
    const overflowX = await site.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflowX, false, `${viewport}: page scrolls sideways`);
    await site.close();
  }
});

test('Network Graph draws baked positions without simulating', { skip: !dataHasBakedLayout() && 'no baked layout in data (run npm run layout)' }, async () => {
  const site = await openSite(browser, server.url, { tab: 'hierarchical' });
  const { page } = site;
  await page.evaluate(() => {
    window.__ticks = 0;
    const orig = d3.forceSimulation;
    d3.forceSimulation = function (...a) {
      const sim = orig.apply(this, a);
      const on = sim.on;
      sim.on = function (n, fn) { return (fn && n === 'tick') ? on.call(this, n, function (...x) { fn.apply(this, x); window.__ticks++; }) : on.apply(this, arguments); };
      return sim;
    };
  });
  await switchTab(page, 'force-graph');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__ticks), 0);
  await site.close();
});

test('clicking a node highlights it without moving any node', async () => {
  const site = await openSite(browser, server.url, { tab: 'force-graph' });
  const { page } = site;
  await page.waitForTimeout(4500);   // let an unbaked layout finish
  const before = await nodePositions(page);
  const point = await page.evaluate(() => {
    let best = null;
    d3.selectAll('#force-svg g.node').each(function (d) { if (!best || d.traffic > best.t) best = { t: d.traffic, el: this }; });
    const r = best.el.querySelector('circle').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await page.mouse.click(point[0], point[1]);
  await page.waitForTimeout(1000);
  assert.equal(movement(before, await nodePositions(page)).moved, 0);
  assert.equal(await page.locator('#force-svg g.node.highlighted').count(), 1);
  await site.close();
});

test('history slider keeps pan/zoom (Network Graph and Layered View)', async () => {
  for (const [tab, svgId] of [['force-graph', 'force-svg'], ['hierarchical', 'hier-svg']]) {
    const site = await openSite(browser, server.url, { tab });
    const { page } = site;
    await page.focus(`#${svgId}`);
    await page.keyboard.press('+');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    const zoomed = await transformOf(page, svgId);
    await page.click('#timeline-prev');
    await page.waitForFunction(() => document.getElementById('timeline-spinner').classList.contains('hidden'));
    await page.waitForTimeout(300);
    assert.equal(await transformOf(page, svgId), zoomed, `${tab} lost the user's pan/zoom`);
    await site.close();
  }
});

test('keyboard: skip link, tabs and chart pan/zoom', async () => {
  const site = await openSite(browser, server.url, { tab: 'hierarchical' });
  const { page } = site;
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'viz-panel');

  await page.focus('#tab-hierarchical');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const tabState = await page.evaluate(() => ({
    focused: document.activeElement.id,
    selected: document.querySelector('[role=tab][aria-selected=true]').id,
    panel: document.getElementById('viz-panel').getAttribute('aria-labelledby'),
  }));
  assert.deepEqual(tabState, { focused: 'tab-bar-gateway', selected: 'tab-bar-gateway', panel: 'tab-bar-gateway' });

  await switchTab(page, 'hierarchical');
  await page.focus('#hier-svg');
  const start = await transformOf(page, 'hier-svg');
  await page.keyboard.press('+');
  await page.waitForTimeout(400);
  assert.notEqual(await transformOf(page, 'hier-svg'), start, '+ should zoom');
  await page.keyboard.press('0');
  await page.waitForTimeout(900);
  assert.equal(await transformOf(page, 'hier-svg'), start, '0 should reset');
  await site.close();
});

test('data table sorts and expands rows from the keyboard', async () => {
  const site = await openSite(browser, server.url, { tab: 'table' });
  const { page } = site;
  await page.focus('#table-head th[data-col="traffic"] button');
  await page.keyboard.press('Enter');
  const sorted = await page.evaluate(() => ({
    ariaSort: document.querySelector('#table-head th[data-col="traffic"]').getAttribute('aria-sort'),
    focusCol: document.activeElement.closest('th')?.dataset.col,
  }));
  assert.equal(sorted.focusCol, 'traffic');
  assert.notEqual(sorted.ariaSort, 'none');
  await page.focus('#table-body .row-toggle');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-expanded')), 'true');
  await site.close();
});

test('phone sidebar: inert while closed, Escape closes and returns focus', async () => {
  const site = await openSite(browser, server.url, { viewport: 'phone', tab: 'hierarchical' });
  const { page } = site;
  assert.equal(await page.evaluate(() => document.getElementById('sidebar').inert), true);
  await page.focus('#mobile-menu-btn');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => ({
    expanded: document.getElementById('mobile-menu-btn').getAttribute('aria-expanded'),
    mainInert: document.getElementById('main').inert,
    focusInSidebar: !!document.activeElement.closest('#sidebar'),
  }));
  assert.deepEqual(open, { expanded: 'true', mainInert: true, focusInSidebar: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mobile-menu-btn');
  assert.equal(await page.evaluate(() => document.getElementById('sidebar').inert), true);
  await site.close();
});

test('intro dialog opens on first visit and closes with Escape', async () => {
  const site = await openSite(browser, server.url, { tab: 'hierarchical', showIntro: true });
  const { page } = site;
  assert.equal(await page.evaluate(() => document.getElementById('edu-modal').open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('edu-modal').open), false);
  await site.close();
});
