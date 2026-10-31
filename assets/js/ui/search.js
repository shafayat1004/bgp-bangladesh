/**
 * Network search in the header: a combobox with a list of matches (ARIA 1.2
 * combobox pattern). Accepts "AS58717", "58717" or part of a company name.
 * "/" focuses it from anywhere; on phones a button opens it as a bar along
 * the top of the screen.
 */

import { friendlyName } from './names.js';
import { CATEGORY_LABELS, aboutNumber } from './glossary.js';

const LIMIT = 8;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The networks matching `query`, best first: exact ASN, then ASNs starting
 * with the number, then names starting with or containing the words; ties go
 * to the network with more routes. Exported for testing.
 */
export function searchNetworks(nodes, query, limit = LIMIT) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const digits = q.match(/^(?:as\s*)?(\d+)$/)?.[1];
  const wordStart = new RegExp(`(^|[^a-z0-9])${escapeRe(q)}`);

  const scored = [];
  for (const n of nodes || []) {
    let score = 0;
    if (digits) {
      if (n.asn === digits) score = 100;
      else if (n.asn.startsWith(digits)) score = 80;
      else if (n.asn.includes(digits)) score = 40;
    }
    const shown = friendlyName(n).toLowerCase();
    if (shown === q) score = Math.max(score, 90);
    else if (shown.startsWith(q)) score = Math.max(score, 70);
    else if (wordStart.test(shown)) score = Math.max(score, 60);
    else if (shown.includes(q) || (n.name || '').toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q)) {
      score = Math.max(score, 30);
    }
    if (score) scored.push({ node: n, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.node.traffic || 0) - (a.node.traffic || 0));
  return scored.slice(0, limit).map(s => s.node);
}

/**
 * Wire up the header search. getData() returns the snapshot on screen;
 * onSelect(node) is called with the chosen network.
 */
export function initSearch({ getData, onSelect }) {
  const bar = document.getElementById('top-bar');
  const input = document.getElementById('site-search');
  const list = document.getElementById('site-search-list');
  const status = document.getElementById('site-search-status');
  const openBtn = document.getElementById('site-search-open');
  const closeBtn = document.getElementById('site-search-close');
  if (!input || !list) return;

  let results = [];
  let active = -1;
  const isPhoneBar = () => openBtn && getComputedStyle(openBtn).display !== 'none';

  function setActive(i) {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    const li = list.children[i];
    if (li?.id) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function closeList() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function render() {
    const q = input.value.trim();
    results = searchNetworks(getData()?.nodes, q);
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (!q) { list.innerHTML = ''; closeList(); status.textContent = ''; return; }
    list.innerHTML = results.length
      ? results.map((n, i) => `<li role="option" id="site-search-opt-${i}" aria-selected="false" data-asn="${n.asn}">
          <span class="search-opt-name">${escapeHtml(friendlyName(n))}</span>
          <span class="search-opt-meta">AS${n.asn} · ${CATEGORY_LABELS[n.type] || n.type} · ${aboutNumber(n.traffic || 0)} routes</span>
        </li>`).join('')
      : `<li class="search-empty">No network matches "${escapeHtml(q)}"</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = results.length
      ? `${results.length} ${results.length === 1 ? 'network' : 'networks'} found. Use the up and down arrows to choose.`
      : 'No network found.';
  }

  function choose(i) {
    const node = results[i];
    if (!node) return;
    input.value = friendlyName(node);
    closeList();
    status.textContent = '';
    if (isPhoneBar()) closeBar();
    onSelect(node);
  }

  function openBar() {
    bar.classList.add('search-open');
    openBtn?.setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
  }

  function closeBar() {
    closeList();
    bar.classList.remove('search-open');
    openBtn?.setAttribute('aria-expanded', 'false');
    openBtn?.focus();
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden && results.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) render();
      if (results.length) setActive(Math.min(active + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      if (open) { e.preventDefault(); choose(active >= 0 ? active : 0); }
    } else if (e.key === 'Escape') {
      // Close the list, then clear the text, then (phones) close the bar.
      e.stopPropagation();
      if (!list.hidden) closeList();
      else if (input.value) { input.value = ''; status.textContent = ''; }
      else if (isPhoneBar()) closeBar();
    } else if (e.key === 'Tab') {
      closeList();
    }
  });

  // Keep focus in the box while clicking a result.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (li) choose([...list.children].indexOf(li));
  });
  input.addEventListener('blur', () => closeList());

  openBtn?.addEventListener('click', openBar);
  closeBtn?.addEventListener('click', closeBar);

  // "/" jumps to search, unless the user is typing somewhere or a dialog is open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (isPhoneBar()) openBar();
    else { input.focus(); input.select(); }
  });
}
