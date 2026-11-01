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

test('Network Graph draws baked positions without simulating', async () => {
  // A missing layout used to skip this test, which hid #32. CI bakes layouts
  // before running the tests, so this fails only when baking itself is broken.
  assert.ok(dataHasBakedLayout(), 'data/BD/viz_data.json has no baked layout (run npm run layout)');
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

test('history slider keeps the data table still: sort, page, scroll and row height', async () => {
  const site = await openSite(browser, server.url, { tab: 'table' });
  const { page } = site;
  await page.click('#table-head th[data-col="name"] button');
  await page.click('#page-next');
  await page.evaluate(() => { document.querySelector('.table-wrapper').scrollTop = 200; });
  const state = () => page.evaluate(() => ({
    sort: document.querySelector('#table-head th[aria-sort]:not([aria-sort="none"])')?.dataset.col,
    page: document.querySelector('.table-pagination span').textContent,
    scroll: document.querySelector('.table-wrapper').scrollTop,
    rowHeights: [...new Set([...document.querySelectorAll('#table-body tr.clickable-row')].map(r => Math.round(r.getBoundingClientRect().height)))],
    colWidths: [...document.querySelectorAll('#table-head th')].map(th => Math.round(th.getBoundingClientRect().width)),
  }));
  const before = await state();
  await page.click('#timeline-prev');
  await page.waitForFunction(() => document.getElementById('timeline-spinner').classList.contains('hidden'));
  await page.waitForTimeout(300);
  const after = await state();
  assert.equal(before.rowHeights.length, 1, 'rows should all be one height');
  assert.deepEqual(after, before);
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

// Visible words: networks and connections, routes not traffic (CLAUDE.md, issue #4).
const JARGON = /\b(nodes?|edges?|traffic)\b/i;
const visibleWords = (page) => page.evaluate(() => [
  document.body.innerText,
  ...[...document.querySelectorAll('svg text')].map(t => t.textContent),
  ...[...document.querySelectorAll('[aria-label], [title], [placeholder]')].map(el =>
    [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder')].filter(Boolean).join(' ')),
].join('\n'));

test('no graph jargon or "traffic" on screen, in any view or the intro', async () => {
  for (const viewport of ['desktop', 'phone']) {
    const site = await openSite(browser, server.url, { viewport, tab: 'hierarchical', showIntro: true });
    const { page } = site;
    const intro = await visibleWords(page);
    assert.doesNotMatch(intro, JARGON, `${viewport} intro: ${intro.match(JARGON)?.[0]}`);
    await page.keyboard.press('Escape');
    for (const tab of TABS) {
      await switchTab(page, tab);
      if (tab === 'table') await page.click('#table-body .row-toggle');
      const words = await visibleWords(page);
      const hit = words.split('\n').find(line => JARGON.test(line));
      assert.equal(hit, undefined, `${viewport} ${tab}: "${hit}"`);
    }
    await page.click('#table-show-edges');
    const hit = (await visibleWords(page)).split('\n').find(line => JARGON.test(line));
    assert.equal(hit, undefined, `${viewport} connections table: "${hit}"`);
    await site.close();
  }
});

const popover = (page) => page.evaluate(() => {
  const pop = document.querySelector('.term-popover');
  return pop && { title: pop.querySelector('.term-popover-title').textContent, expanded: document.querySelector('.term-help[aria-expanded="true"]')?.dataset.term };
});

test('glossary "?": opens on focus, example on request, Escape closes and returns focus', async () => {
  const site = await openSite(browser, server.url, { tab: 'table' });
  const { page } = site;
  await page.focus('#table-head th[data-col="percentage"] .term-help');
  assert.deepEqual(await popover(page), { title: 'Share', expanded: 'share' });

  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'term-example-btn', 'Tab moves into the popover');
  assert.equal(await page.evaluate(() => document.querySelector('.term-example').hidden), true);
  await page.keyboard.press('Enter');
  const example = await page.evaluate(() => ({ hidden: document.querySelector('.term-example').hidden, text: document.querySelector('.term-example').textContent }));
  assert.equal(example.hidden, false);
  assert.match(example.text, /share is \d+%/);

  await page.keyboard.press('Escape');
  assert.equal(await popover(page), null);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.term), 'share', 'focus goes back to the "?"');
  // The sort button next to it still works and the "?" didn't sort.
  assert.equal(await page.evaluate(() => document.querySelector('#table-head th[data-col="percentage"]').getAttribute('aria-sort')), 'none');
  await site.close();
});

test('glossary "?": hover opens, stays while the pointer is on the popover, closes on leaving', async () => {
  const site = await openSite(browser, server.url, { tab: 'bar-gateway' });
  const { page } = site;
  await page.hover('.legend-items .term-help[data-term="iig"]');
  await page.waitForTimeout(300);
  assert.equal((await popover(page))?.title, 'IIG (licensed gateway)');
  await page.hover('.term-popover .term-popover-title');
  await page.waitForTimeout(500);
  assert.notEqual(await popover(page), null, 'stays open over the popover');
  await page.mouse.move(900, 450);
  await page.waitForTimeout(500);
  assert.equal(await popover(page), null);
  await site.close();
});

test('glossary "?": tap opens and a tap elsewhere closes (phone sidebar)', async () => {
  const site = await openSite(browser, server.url, { viewport: 'phone', tab: 'bar-gateway' });
  const { page } = site;
  await page.tap('#mobile-menu-btn');
  await page.waitForTimeout(300);
  await page.tap('#stats-container .term-help[data-term="observations"]');
  await page.waitForTimeout(200);
  assert.equal((await popover(page))?.title, 'Route observations');
  const inside = await page.evaluate(() => {
    const r = document.querySelector('.term-popover').getBoundingClientRect();
    const s = document.getElementById('sidebar').getBoundingClientRect();
    return r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= 0;
  });
  assert.equal(inside, true, 'popover fits inside the sidebar');
  await page.tap('.site-name');
  await page.waitForTimeout(200);
  assert.equal(await popover(page), null);
  await page.tap('#stats-container .term-help[data-term="observations"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('active')), true, 'first Escape only closes the popover');
  await site.close();
});

test('header search: "/" focuses it, arrows and Enter choose, the view highlights the network', async () => {
  const site = await openSite(browser, server.url, { tab: 'hierarchical' });
  const { page } = site;
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-search');
  await page.keyboard.type('AS58717');
  const first = await page.evaluate(() => ({
    expanded: document.getElementById('site-search').getAttribute('aria-expanded'),
    text: document.querySelector('#site-search-list [role="option"]')?.textContent,
  }));
  assert.equal(first.expanded, 'true');
  assert.match(first.text, /Summit Communications Ltd\s+AS58717/);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.getElementById('site-search').getAttribute('aria-activedescendant')), 'site-search-opt-0');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('.hier-node[data-asn="58717"]').getAttribute('opacity')), '1');
  assert.equal(await page.evaluate(() => document.getElementById('site-search-list').hidden), true);

  // Escape closes the list, then clears the text.
  await page.keyboard.type(' ');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('site-search-list').hidden), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('site-search').value), '');
  // "/" typed into a text field is just text.
  await page.keyboard.type('a/b');
  assert.equal(await page.evaluate(() => document.getElementById('site-search').value), 'a/b');
  await site.close();
});

test('header search on a phone: button opens it, 16px text (no iOS zoom), choosing closes it', async () => {
  const site = await openSite(browser, server.url, { viewport: 'phone', tab: 'bar-gateway' });
  const { page } = site;
  await page.tap('#site-search-open');
  const opened = await page.evaluate(() => ({
    focus: document.activeElement.id,
    fontSize: getComputedStyle(document.getElementById('site-search')).fontSize,
  }));
  assert.deepEqual(opened, { focus: 'site-search', fontSize: '16px' });
  await page.keyboard.type('link3');
  await page.tap('#site-search-list [role="option"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    open: document.getElementById('top-bar').classList.contains('search-open'),
    focus: document.activeElement.id,
    tab: document.querySelector('[role=tab][aria-selected=true]').id,
    detail: !!document.querySelector('.detail-panel'),
  }));
  // Gateway Ranking only lists gateways, so a local company opens in the table.
  assert.deepEqual(after, { open: false, focus: 'site-search-open', tab: 'tab-table', detail: true });
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('table-search')).fontSize), '16px');
  await site.close();
});

test('header search: a network hidden by the Min Routes filter is still shown', async () => {
  const site = await openSite(browser, server.url, { tab: 'table' });
  const { page } = site;
  const small = await page.evaluate(async () => {
    const d = await fetch('data/BD/viz_data.json').then(r => r.json());
    return d.nodes.filter(n => n.traffic < 100).sort((a, b) => a.traffic - b.traffic)[0]?.asn;
  });
  assert.ok(small, 'data has a network under 100 routes');
  await page.focus('#site-search');
  await page.keyboard.type(small);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('filter-min-traffic').value), '0');
  assert.equal(await page.evaluate((asn) => !!document.querySelector(`#table-body tr[data-asn="${asn}"]`), small), true);
  await site.close();
});

const tooltipState = (page) => page.evaluate(() => {
  const tip = document.getElementById('tooltip');
  const close = tip.querySelector('.tooltip-close');
  const r = tip.getBoundingClientRect();
  return {
    open: tip.style.display === 'block',
    title: tip.querySelector('.tooltip-title')?.textContent || '',
    closeShown: getComputedStyle(close).display !== 'none',
    inWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
  };
});

test('tooltip: hover opens it inside the window, Escape and leaving close it (desktop)', async () => {
  const site = await openSite(browser, server.url, { tab: 'hierarchical' });
  const { page } = site;
  const box = await page.locator('#hier-svg g.hier-node').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  let tip = await tooltipState(page);
  assert.equal(tip.open, true);
  assert.notEqual(tip.title, '');
  assert.equal(tip.inWindow, true, 'tooltip stays inside the window');
  assert.equal(tip.closeShown, false, 'no close button on a hover tooltip');
  await page.keyboard.press('Escape');
  assert.equal((await tooltipState(page)).open, false, 'Escape closes it');

  await switchTab(page, 'bar-gateway');
  const row = await page.locator('.bar-row').first().boundingBox();
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.waitForTimeout(100);
  assert.equal((await tooltipState(page)).open, true, 'bar rows use the same tooltip');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(100);
  assert.equal((await tooltipState(page)).open, false, 'leaving the row closes it');
  await site.close();
});

test('tooltip: on phones the details sheet has a close button that closes it', async () => {
  for (const viewport of ['phone', 'phone-landscape']) {
    const site = await openSite(browser, server.url, { viewport, tab: 'hierarchical' });
    const { page } = site;
    await page.tap('#hier-svg g.hier-node');
    await page.waitForTimeout(500);   // the sheet lets taps through for 400 ms after opening
    const tip = await tooltipState(page);
    assert.equal(tip.open, true, `${viewport}: a tap opens the sheet`);
    assert.equal(tip.closeShown, true, `${viewport}: close button shown`);
    const size = await page.locator('#tooltip .tooltip-close').boundingBox();
    assert.ok(size.width >= 24 && size.height >= 24, `${viewport}: close button is at least 24px`);
    assert.equal(await page.getAttribute('#tooltip .tooltip-close', 'aria-label'), 'Close details');
    // A tap on the sheet itself must not reach the network underneath it.
    await page.tap('#tooltip .tooltip-title');
    await page.waitForTimeout(100);
    assert.deepEqual(await tooltipState(page), tip, `${viewport}: tapping the sheet leaves it as it was`);
    await page.tap('#tooltip .tooltip-close');
    await page.waitForTimeout(100);
    assert.equal((await tooltipState(page)).open, false, `${viewport}: the close button closes it`);

    await page.tap('#hier-svg g.hier-node');
    await page.waitForTimeout(500);
    await page.tap('#hier-svg', { position: { x: 3, y: 3 } });
    await page.waitForTimeout(100);
    assert.equal((await tooltipState(page)).open, false, `${viewport}: a tap elsewhere in the chart closes it`);
    await site.close();
  }
});
