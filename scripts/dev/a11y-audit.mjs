#!/usr/bin/env node
/**
 * Accessibility audit with axe-core (WCAG 2.0-2.2 A/AA plus best practices)
 * across every view, the intro dialog, and the open phone sidebar.
 *
 * Usage: npm run audit:a11y [-- --viewports desktop,phone --tabs table,sankey]
 * Exits 1 when any violation is found. axe covers roughly a third of WCAG;
 * keyboard behaviour is covered by tests-e2e, and a screen reader pass is
 * still worth doing by hand for big changes.
 */
import path from 'node:path';
import { startServer, launchBrowser, openSite, parseArgs, TABS, ROOT } from './lib/site.mjs';

const AXE = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const args = parseArgs(process.argv.slice(2), { viewports: ['desktop', 'phone'], tabs: [...TABS] });

async function audit(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    const res = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return res.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      url: v.helpUrl,
      nodes: v.nodes.slice(0, 5).map(n => `${n.target.join(' ')}: ${(n.failureSummary || '').split('\n').slice(1).join(' ').trim()}`),
      count: v.nodes.length,
    }));
  }, TAGS);
}

const server = await startServer();
const browser = await launchBrowser();
let total = 0;
try {
  for (const viewport of args.viewports) {
    const states = [
      { name: 'intro dialog', tab: 'hierarchical', showIntro: true },
      ...args.tabs.map(tab => ({ name: tab, tab })),
      ...(viewport !== 'desktop' ? [{ name: 'sidebar open', tab: 'hierarchical', openSidebar: true }] : []),
    ];
    for (const state of states) {
      const site = await openSite(browser, server.url, { viewport, tab: state.tab, showIntro: state.showIntro });
      if (state.openSidebar) {
        await site.page.click('#mobile-menu-btn');
        await site.page.waitForTimeout(400);
      }
      const violations = await audit(site.page);
      total += violations.length;
      console.log(`${violations.length ? 'FAIL' : 'ok  '} ${viewport} / ${state.name}`);
      for (const v of violations) {
        console.log(`       [${v.impact}] ${v.id} x${v.count}: ${v.help}\n       ${v.url}`);
        v.nodes.forEach(n => console.log(`         - ${n}`));
      }
      await site.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(total ? `\n${total} violation type(s) found.` : '\nNo axe violations.');
process.exit(total ? 1 : 0);
