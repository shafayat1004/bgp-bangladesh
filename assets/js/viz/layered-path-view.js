/**
 * The Layered View's path screen: one network's path out to the world at a
 * readable size, and what changed on it over the retained history.
 *
 * - A local network: its gateways (left) and those gateways' connections
 *   abroad (right), joined by lines whose width is the share.
 * - A gateway: the local networks that use it above it, its connections
 *   abroad below.
 * - An international network: the Bangladeshi gateways it connects to.
 *
 * While the date steps or plays, connections that appear are marked NEW and
 * ones that leave the data stay for GONE_TICKS snapshots marked GONE, then
 * collapse. Cards keep one order for the whole range so nothing swaps places.
 */

import {
  snapshotPos, connState, stableOrder, connEvents, fromTwoSnapshots,
} from '../data/changes.js';
import { buildPath, pathSummary, ABROAD_PER_GATEWAY, CUSTOMER_CAP } from './layered-path.js';
import { friendlyName, countryName, countryToFlag } from '../ui/names.js';
import { CATEGORY_LABELS, termHelp } from '../ui/glossary.js';
import { CATEGORY_COLORS, LINK_COLORS } from '../ui/colors.js';
import { formatTimestamp } from '../ui/timeline.js';

const ABROAD_CAP = 10;         // a gateway's connections abroad shown before "and N more"
const CHANGES_CAP = 12;        // change list entries shown before "Show all"
const COLUMN_ORDER = ['gateways', 'customers', 'abroad'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function roleFromHistory(history, asn) {
  let role = null;
  for (const c of history.byKey.values()) {
    if (c.kind === 'd' && c.source === asn) return 'local';
    if (c.target === asn) role = 'gateway';
    else if (c.kind === 'i' && c.source === asn && !role) role = 'outside';
  }
  return role;
}

/**
 * A local network's "abroad" column at every snapshot: for each of its
 * gateways present then, that gateway's ABROAD_PER_GATEWAY largest networks
 * abroad. Returns one synthetic connection per network abroad (its share is
 * the largest line into it) and the lines at `pos`.
 */
function abroadForLocal(history, gateways, pos) {
  const n = history.snapshots.length;
  const intoGateway = new Map();
  for (const c of history.byKey.values()) {
    if (c.kind !== 'i') continue;
    if (!intoGateway.has(c.target)) intoGateway.set(c.target, []);
    intoGateway.get(c.target).push(c);
  }
  const member = new Map();
  const lines = [];
  for (let p = 0; p < n; p++) {
    for (const g of gateways) {
      if (g.s0[p] === null || g.s0[p] === undefined) continue;
      const top = (intoGateway.get(g.target) || [])
        .filter(c => c.s0[p] !== null && c.s0[p] !== undefined)
        .sort((a, b) => b.s0[p] - a.s0[p] || cmp(a.source, b.source))
        .slice(0, ABROAD_PER_GATEWAY);
      for (const c of top) {
        if (!member.has(c.source)) member.set(c.source, Array(n).fill(null));
        const arr = member.get(c.source);
        arr[p] = Math.max(arr[p] ?? 0, c.s0[p]);
        if (p === pos) lines.push({ from: g.target, to: c.source, share: c.s0[p] });
      }
    }
  }
  const conns = [...member.entries()].map(([source, s0]) => ({ source, target: gateways[0]?.source, kind: 'x', s0, s1: s0 }));
  return { conns, lines };
}

/**
 * The path's cards at snapshot `pos` of `history`. Pure; exported for testing.
 * Returns { role, columns: { [name]: Card[] }, lines, events } where
 * Card = { asn, name, node, share, delta, state, since, fading } in the stable
 * order and events are this network's changes over the whole range.
 */
export function pathCards(path, history, pos, { asn, lookupNode = () => null } = {}) {
  asn = String(asn ?? path?.node?.asn);
  const role = path?.status === 'found' ? path.role : roleFromHistory(history, asn);
  const all = [...history.byKey.values()];
  const card = (conn, persp, partner) => {
    const node = lookupNode(partner);
    return { asn: partner, node, name: friendlyName(node || { asn: partner }), conn, ...connState(conn, pos, persp) };
  };
  const column = (conns, persp, partnerOf) => stableOrder(conns, persp)
    .map(c => card(c, persp, partnerOf(c)))
    .filter(c => c.state !== 'absent');
  const eventsFor = (conns, persp, partnerOf, name) =>
    connEvents(conns, persp).map(e => ({
      ...e, column: name, asn: partnerOf(e.conn), name: friendlyName(lookupNode(partnerOf(e.conn)) || { asn: partnerOf(e.conn) }),
    }));

  const columns = {};
  let lines = [];
  let events = [];
  const src = c => c.source;
  const tgt = c => c.target;
  if (role === 'local') {
    const gws = stableOrder(all.filter(c => c.kind === 'd' && c.source === asn), 's0');
    const abroad = abroadForLocal(history, gws, pos);
    columns.gateways = column(gws, 's0', tgt);
    // Which networks abroad make a gateway's top few shifts every few hours
    // while they stay in the data, so this column shows only the current
    // ones, without NEW/GONE marks or change list entries.
    columns.abroad = column(abroad.conns, 's0', src)
      .filter(c => c.state !== 'gone')
      .map(c => ({ ...c, state: 'present', since: null }));
    lines = abroad.lines;
    events = eventsFor(gws, 's0', tgt, 'gateways');
  } else if (role === 'gateway') {
    const customers = all.filter(c => c.kind === 'd' && c.target === asn);
    const abroad = all.filter(c => c.kind === 'i' && c.target === asn);
    columns.customers = column(customers, 's1', src);
    columns.abroad = column(abroad, 's0', src);
    events = [...eventsFor(customers, 's1', src, 'customers'), ...eventsFor(abroad, 's0', src, 'abroad')];
  } else if (role === 'outside') {
    const gws = all.filter(c => c.kind === 'i' && c.source === asn);
    columns.gateways = column(gws, 's1', tgt);
    events = eventsFor(gws, 's1', tgt, 'gateways');
  }
  events.sort((a, b) => a.pos - b.pos || COLUMN_ORDER.indexOf(a.column) - COLUMN_ORDER.indexOf(b.column));
  return { role, columns, lines, events };
}

// ── Drawing ──

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const when = (ts) => (ts ? formatTimestamp(ts) : 'this date');
const pct = (v) => `${Math.round(v)}%`;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

function regionLabel(cc) {
  return !cc || cc === 'Unknown' ? '' : countryName(cc);
}

/**
 * Draw the path screen into `container`. Returns { update(opts), destroy() };
 * update keeps the cards that stay, so shares grow and shrink in place.
 *
 * opts: { data, asn, ts, history, prevData, prevTs, filtersActive, mine,
 *         lookupNode, onBack(), onPick(asn), onJump(ts), onMarks(timestamps) }
 */
export function renderPathView(container, opts) {
  let o = opts;
  let emphasis = null;         // a card whose lines stay strong
  let showAllCustomers = false;
  let showAllAbroad = false;
  let showAllChanges = false;
  let role = null;
  const cardEls = new Map();   // "<column>:<asn>" -> <li>
  let resizeObserver = null;
  let lastLines = [];          // lines and gateways of the last draw, for redrawing lines
  let lastGateways = [];

  const root = el('div', 'layered-path');
  root.tabIndex = -1;
  root.setAttribute('role', 'region');
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); o.onBack(); }
  });

  const head = el('div', 'layered-path-head', root);
  const back = el('button', 'layered-back', head);
  back.type = 'button';
  back.innerHTML = '<span aria-hidden="true">←</span> All networks';
  back.addEventListener('click', () => o.onBack());
  const title = el('h2', 'layered-path-title', head);
  title.tabIndex = -1;

  const summary = el('p', 'layered-path-summary', root);
  const filtersNote = el('p', 'layered-path-note', root);
  const body = el('div', 'layered-path-body', root);
  const changes = el('section', 'layered-changes', root);

  container.replaceChildren(root);
  draw(true);
  title.focus({ preventScroll: true });

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => drawLines());
    resizeObserver.observe(root);
  }

  function model() {
    const asn = String(o.asn);
    let history = o.history;
    let pos = history ? snapshotPos(history, o.ts) : -1;
    const fromHistory = pos >= 0;
    if (!fromHistory) {
      // No change summary (or it doesn't have this date yet): compare with the
      // snapshot shown before, if any.
      const prev = o.prevData && o.prevData !== o.data && o.prevTs !== o.ts ? o.prevData : null;
      history = fromTwoSnapshots(prev, o.data, o.prevTs, o.ts || 'now');
      pos = history.snapshots.length - 1;
    }
    const path = buildPath(o.data, asn);
    const cards = pathCards(path, history, pos, { asn, lookupNode: o.lookupNode });
    return { asn, path, history, pos, fromHistory, cards };
  }

  function draw(first = false) {
    const m = model();
    const pickedNode = m.path.status === 'found' ? m.path.node : o.lookupNode(m.asn);
    const name = friendlyName(pickedNode || { asn: m.asn });
    root.setAttribute('aria-label', `Path of ${name}`);
    title.textContent = name;
    summary.textContent = m.path.status === 'found'
      ? pathSummary(m.path)
      : `${name} is not seen in the routes on ${when(o.ts)}.`;
    filtersNote.textContent = o.filtersActive ? 'Showing this network\'s whole path; your filters apply to the overview.' : '';
    filtersNote.hidden = !o.filtersActive;

    if (first || role !== m.cards.role) {
      role = m.cards.role;
      cardEls.clear();
      body.replaceChildren();
      buildSkeleton(m, pickedNode);
    }
    fillPicked(m, pickedNode);
    if (role === 'local') {
      reconcile('gateways', m.cards.columns.gateways, m, Infinity);
      reconcile('abroad', m.cards.columns.abroad, m, Infinity);
      const heading = body.querySelector('[data-heading="abroad"]');
      const gws = m.cards.columns.gateways.filter(c => c.state !== 'gone');
      heading.textContent = gws.length === 1 ? `${gws[0].name}'s connections abroad` : 'Their connections abroad';
    } else if (role === 'gateway') {
      reconcile('customers', m.cards.columns.customers, m, showAllCustomers ? Infinity : CUSTOMER_CAP);
      reconcile('abroad', m.cards.columns.abroad, m, showAllAbroad ? Infinity : ABROAD_CAP);
      moreButton('customers', m.cards.columns.customers.length, CUSTOMER_CAP, showAllCustomers, () => { showAllCustomers = !showAllCustomers; draw(); });
      moreButton('abroad', m.cards.columns.abroad.length, ABROAD_CAP, showAllAbroad, () => { showAllAbroad = !showAllAbroad; draw(); });
    } else if (role === 'outside') {
      reconcile('gateways', m.cards.columns.gateways, m, Infinity);
    }
    drawChanges(m);
    lastLines = m.cards.lines;
    lastGateways = m.cards.columns.gateways || [];
    requestAnimationFrame(drawLines);
  }

  function buildSkeleton(m, pickedNode) {
    const picked = el('div', 'layered-picked', null);
    picked.dataset.part = 'picked';
    if (role === 'local' || !role) {
      const graph = el('div', 'layered-path-graph', body);
      graph.append(picked);
      const cols = el('div', 'layered-path-cols', graph);
      for (const [key, label] of [['gateways', 'Gateways it uses'], ['abroad', 'Their connections abroad']]) {
        const col = el('div', 'layered-path-col', cols);
        const h = el('h3', 'layered-path-col-title', col);
        h.dataset.heading = key;
        h.textContent = label;
        el('ul', 'layered-cards', col).dataset.column = key;
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'layered-path-lines');
      svg.setAttribute('aria-hidden', 'true');
      graph.prepend(svg);
    } else if (role === 'gateway') {
      section('customers', 'Local networks that use it');
      body.append(picked);
      section('abroad', 'Its connections abroad');
    } else {
      body.append(picked);
      section('gateways', 'Bangladeshi gateways it connects to');
    }
    function section(key, label) {
      const sec = el('section', 'layered-path-section', body);
      const h = el('h3', 'layered-path-col-title', sec);
      h.dataset.heading = key;
      h.textContent = label;
      el('ul', `layered-cards layered-cards-grid`, sec).dataset.column = key;
      const more = el('button', 'layered-more', sec);
      more.type = 'button';
      more.dataset.more = key;
      more.hidden = true;
    }
  }

  function fillPicked(m, node) {
    const picked = body.querySelector('[data-part="picked"]');
    picked.replaceChildren();
    picked.style.setProperty('--cat', CATEGORY_COLORS[node?.type] || 'var(--border)');
    const line1 = el('div', 'layered-picked-name', picked);
    if (o.mine && String(o.mine) === m.asn) {
      const tag = el('span', 'layered-tag', line1);
      tag.textContent = 'YOURS';
    }
    line1.append(`${node?.type === 'outside' && node.country ? `${countryToFlag(node.country)} ` : ''}${friendlyName(node || { asn: m.asn })}`);
    const line2 = el('div', 'layered-picked-sub', picked);
    if (m.path.status !== 'found') {
      line2.textContent = `Not seen in the routes on ${when(o.ts)}`;
    } else {
      const cat = CATEGORY_LABELS[node.type] || node.type;
      line2.textContent = `${cat} · AS${node.asn} · ${(node.traffic || 0).toLocaleString('en-US')} routes seen`;
    }
  }

  function moreButton(key, total, cap, open, toggle) {
    const btn = body.querySelector(`[data-more="${key}"]`);
    if (!btn) return;
    btn.hidden = total <= cap;
    btn.textContent = open ? 'Show fewer' : `and ${(total - cap).toLocaleString('en-US')} more`;
    btn.onclick = toggle;
  }

  /** Update one column's cards in place: keep, add, mark leaving; keep the order. */
  function reconcile(column, cards, m, cap) {
    const list = body.querySelector(`[data-column="${column}"]`);
    if (!list) return;
    const shown = cards.slice(0, cap);
    const keep = new Set(shown.map(c => `${column}:${c.asn}`));
    for (const [key, li] of cardEls) {
      if (!key.startsWith(`${column}:`) || keep.has(key)) continue;
      cardEls.delete(key);
      leave(li);
    }
    let before = list.firstChild;
    for (const c of shown) {
      const key = `${column}:${c.asn}`;
      let li = cardEls.get(key);
      if (!li) {
        li = el('li', 'layered-card-item', null);
        cardEls.set(key, li);
      }
      fillCard(li, c, column, m);
      while (before && before.classList.contains('leaving')) before = before.nextSibling;
      if (li !== before) list.insertBefore(li, before);
      else before = before.nextSibling;
    }
  }

  // The one deliberate movement: a GONE card collapses after its last tick.
  function leave(li) {
    if (reducedMotion() || !li.isConnected) { li.remove(); return; }
    li.classList.add('leaving');
    const done = () => { li.remove(); drawLines(); };
    li.addEventListener('animationend', done, { once: true });
    setTimeout(done, 400);
  }

  function fillCard(li, c, column, m) {
    let btn = li.querySelector('.layered-card');
    if (!btn) {
      btn = el('button', 'layered-card', li);
      btn.type = 'button';
      btn.innerHTML = '<span class="layered-card-name"></span><span class="visually-hidden layered-card-extra"></span><span class="layered-card-row"></span>';
      btn.addEventListener('click', () => onCard(btn));
    }
    btn.dataset.asn = c.asn;
    btn.dataset.column = column;
    btn.style.setProperty('--cat', CATEGORY_COLORS[c.node?.type] || 'var(--border)');
    li.classList.toggle('gone', c.state === 'gone');
    li.classList.toggle('fading', c.fading);
    li.classList.toggle('new', c.state === 'new');

    const nameEl = btn.querySelector('.layered-card-name');
    nameEl.replaceChildren();
    if (c.state === 'new' || c.state === 'gone') {
      const tag = el('span', `layered-tag tag-${c.state}`, nameEl);
      tag.textContent = c.state === 'new' ? 'NEW' : 'GONE';
    }
    const label = el('span', 'layered-card-label', nameEl);
    if (c.node?.type === 'outside' && c.node.country) {
      const flag = el('span', '', label);
      flag.textContent = `${countryToFlag(c.node.country)} `;
      flag.setAttribute('aria-hidden', 'true');
    }
    label.append(c.name);

    const row = btn.querySelector('.layered-card-row');
    const sinceTs = c.since !== null ? m.history.snapshots[c.since] : null;
    const noShare = role === 'local' && column === 'abroad';
    if (c.state === 'gone') {
      row.replaceChildren(el('span', 'layered-card-sub', null));
      row.firstChild.textContent = `Not in this data since ${when(sinceTs)}`;
    } else if (noShare) {
      row.replaceChildren(el('span', 'layered-card-sub', null));
      row.firstChild.textContent = regionLabel(c.node?.country) || CATEGORY_LABELS[c.node?.type] || '';
    } else {
      let fill = row.querySelector('.layered-card-fill');
      if (!fill) {
        row.replaceChildren();
        const track = el('span', 'layered-card-track', row);
        track.setAttribute('aria-hidden', 'true');
        fill = el('span', 'layered-card-fill', track);
        el('span', 'layered-card-value', row);
        el('span', 'layered-card-delta', row);
      }
      fill.style.width = `${Math.max(0, Math.min(100, c.share))}%`;
      row.querySelector('.layered-card-value').textContent = pct(c.share);
      const d = c.delta;
      const delta = row.querySelector('.layered-card-delta');
      delta.replaceChildren();
      if (d !== null && Math.abs(d) >= 1) {
        const arrow = el('span', '', delta);
        arrow.textContent = d > 0 ? '▲ ' : '▼ ';
        arrow.setAttribute('aria-hidden', 'true');
        el('span', 'visually-hidden', delta).textContent = d > 0 ? 'up ' : 'down ';
        delta.append(`${d > 0 ? '+' : '−'}${Math.abs(d)} pts`);
      }
    }

    // Spoken extras after the name; everything visible is read as shown.
    const extra = [c.node ? CATEGORY_LABELS[c.node.type] || c.node.type : ''];
    if (c.state === 'gone') extra.push(`was ${pct(c.share)}`);
    else if (!noShare) extra.push(`share of ${shareOf(column, m)}:`);
    if (c.state === 'new') extra.push(`new on ${when(sinceTs)}`);
    btn.querySelector('.layered-card-extra').textContent = `, ${extra.filter(Boolean).join(', ')} `;
    if (role === 'local') btn.setAttribute('aria-pressed', String(emphasis === `${column}:${c.asn}`));
    else btn.removeAttribute('aria-pressed');
  }

  function shareOf(column, m) {
    const name = friendlyName(m.path.node || { asn: m.asn });
    if (role === 'gateway' && column === 'customers') return `${name}'s customer routes seen`;
    if (role === 'gateway' && column === 'abroad') return `${name}'s routes seen abroad`;
    if (role === 'outside') return `${name}'s routes seen into Bangladesh`;
    return `${name}'s routes seen`;
  }

  function onCard(btn) {
    const key = `${btn.dataset.column}:${btn.dataset.asn}`;
    if (role !== 'local') { o.onPick(btn.dataset.asn); return; }
    emphasis = emphasis === key ? null : key;
    for (const b of body.querySelectorAll('.layered-card')) {
      b.setAttribute('aria-pressed', String(emphasis === `${b.dataset.column}:${b.dataset.asn}`));
    }
    drawLines();
  }

  function drawLines() {
    const svg = body.querySelector('.layered-path-lines');
    const graph = body.querySelector('.layered-path-graph');
    if (!svg || !graph) return;
    const box = graph.getBoundingClientRect();
    svg.setAttribute('width', String(box.width));
    svg.setAttribute('height', String(box.height));
    const at = (column, asn) => {
      const li = cardEls.get(`${column}:${asn}`);
      return li && !li.classList.contains('leaving') ? li.getBoundingClientRect() : null;
    };
    const picked = body.querySelector('[data-part="picked"]').getBoundingClientRect();
    const [focusCol, focusAsn] = emphasis ? emphasis.split(':') : [null, null];
    const strong = (l) => !emphasis || (focusCol === 'gateways' ? l.from === focusAsn : l.to === focusAsn);
    const paths = [];
    // Trunk from the picked network down the left edge to each gateway it uses.
    for (const g of lastGateways) {
      if (g.state === 'gone') continue;
      const r = at('gateways', g.asn);
      if (!r) continue;
      const y = r.top + r.height / 2 - box.top;
      const w = Math.min(6, Math.max(1, g.share / 12));
      const op = !emphasis || (focusCol === 'gateways' && focusAsn === g.asn) ? 0.9 : 0.15;
      paths.push(`<path d="M4 ${picked.bottom - box.top} V${y} H${r.left - box.left}" fill="none" stroke="${LINK_COLORS.domestic}" stroke-width="${w}" stroke-dasharray="4 2" stroke-opacity="${op}"/>`);
    }
    for (const l of lastLines) {
      const a = at('gateways', l.from);
      const b = at('abroad', l.to);
      if (!a || !b) continue;
      const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
      const mx = (x1 + x2) / 2;
      const op = strong(l) ? 0.35 + Math.min(1, l.share / 100) * 0.5 : 0.08;
      paths.push(`<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${LINK_COLORS.international}" stroke-width="${Math.max(1, l.share / 9)}" stroke-opacity="${op}"/>`);
    }
    svg.innerHTML = paths.join('');
  }

  function drawChanges(m) {
    // Redrawn on every date step; keep focus on the entry that was focused.
    const focused = changes.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    changes.replaceChildren();
    changes.hidden = !m.fromHistory;
    o.onMarks?.(m.fromHistory ? [...new Set(m.cards.events.map(e => m.history.snapshots[e.pos]))] : []);
    if (!m.fromHistory) return;
    el('h3', 'layered-path-col-title', changes).textContent = 'Changes this week';
    const events = [...m.cards.events].reverse();   // newest first
    if (!events.length) {
      el('p', 'layered-changes-empty', changes).textContent = 'No gateway or connection changes in this range.';
    } else {
      const list = el('ol', 'layered-changes-list', changes);
      for (const e of showAllChanges ? events : events.slice(0, CHANGES_CAP)) {
        const li = el('li', e.pos === m.pos ? 'current' : '', list);
        const btn = el('button', 'layered-change', li);
        btn.type = 'button';
        const ts = m.history.snapshots[e.pos];
        btn.dataset.key = `${ts}|${e.column}|${e.asn}`;
        const time = el('time', '', btn);
        time.dateTime = ts;
        time.textContent = formatTimestamp(ts);
        const strong = el('strong', '', btn);
        strong.textContent = e.name;
        btn.append(` ${eventText(e)}`);
        btn.addEventListener('click', () => o.onJump?.(ts));
      }
      if (events.length > CHANGES_CAP) {
        const more = el('button', 'layered-more', changes);
        more.type = 'button';
        more.textContent = showAllChanges ? 'Show fewer changes' : `Show all ${events.length.toLocaleString('en-US')} changes`;
        more.dataset.key = 'more';
        more.addEventListener('click', () => { showAllChanges = !showAllChanges; drawChanges(model()); });
      }
    }
    if (focused) changes.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    const note = el('p', 'layered-cutoff', changes);
    note.innerHTML = `Shares are of routes seen. This data keeps only the busiest connections, so a small connection can leave it without stopping. ${termHelp('data-cutoff')}`;
  }

  function eventText(e) {
    if (e.kind === 'move') return `${pct(e.from)} → ${pct(e.to)}`;
    if (e.kind === 'disappear') return `no longer in this data (was ${pct(e.from)})`;
    const as = {
      gateways: 'appears as a gateway',
      customers: 'appears among the local networks using it',
      abroad: 'appears among its connections abroad',
    }[e.column];
    return `${as} (${pct(e.to)})`;
  }

  return {
    update(next) {
      o = { ...o, ...next };
      draw();
    },
    destroy() {
      resizeObserver?.disconnect();
      o.onMarks?.([]);
      root.remove();
    },
  };
}
