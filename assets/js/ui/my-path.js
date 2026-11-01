/**
 * "How do I reach the world?"
 * Turns the visitor's network (looked up from their IP address) into a short
 * story: which gateways it goes through and which international networks those
 * connect to, with shares of the routes seen.
 */

import { friendlyName } from './names.js';
import { sourceAsn, targetAsn, networksByAsn } from '../data/network-data.js';

const GATEWAY_TYPES = new Set(['iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway']);

const GATEWAY_LABELS = {
  'iig': 'a licensed international gateway (IIG)',
  'detected-iig': 'a detected gateway (it carries other networks\' routes abroad but isn\'t on the IIG licence list)',
  'offshore-enterprise': 'a Bangladeshi network based abroad',
  'offshore-gateway': 'a Bangladeshi network based abroad that carries other networks\' routes',
};

/** Sum counts per key and turn them into shares, largest first. */
function shares(edges, keyOf, nodeMap) {
  const totals = new Map();
  for (const e of edges) totals.set(keyOf(e), (totals.get(keyOf(e)) || 0) + (e.count || 0));
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .filter(([asn]) => nodeMap[asn])
    .map(([asn, count]) => ({ node: nodeMap[asn], count, share: sum ? count / sum : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Describe how a network reaches the world in this dataset. Pure; exported
 * for testing. Returns { status: 'missing' } or
 * { status: 'found', node, role, gateways, international }.
 */
export function describePath(data, asn) {
  const nodeMap = networksByAsn(data.nodes);
  const node = nodeMap[asn];
  if (!node) return { status: 'missing' };

  const src = sourceAsn;
  const tgt = targetAsn;

  // Domestic connections point from a network to the gateway it uses.
  const gateways = shares(
    data.edges.filter(e => e.type === 'domestic' && src(e) === asn), tgt, nodeMap);

  // International connections point from the international network to the
  // gateway. A gateway has its own; a local network goes through its gateways'.
  const viaGateways = GATEWAY_TYPES.has(node.type) ? new Set([asn]) : new Set(gateways.map(g => g.node.asn));
  const international = shares(
    data.edges.filter(e => e.type !== 'domestic' && viaGateways.has(tgt(e))), src, nodeMap);

  const role = node.type === 'outside' ? 'outside' : GATEWAY_TYPES.has(node.type) ? 'gateway' : 'local';
  return { status: 'found', node, role, gateways, international };
}

const pct = (share) => `${Math.round(share * 100)}%`;

function joinList(parts) {
  if (parts.length <= 1) return parts;
  const out = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(i === parts.length - 1 ? ' and ' : ', ');
    out.push(p);
  });
  return out;
}

/** "<strong>A</strong> (60% of its routes seen), <strong>B</strong> (30%)" as DOM nodes. */
function namedList(items, withShare) {
  return joinList(items.map((item, i) => {
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = friendlyName(item.node);
    span.append(strong);
    if (withShare) span.append(` (${pct(item.share)}${i === 0 ? ' of its routes seen' : ''})`);
    return span;
  }));
}

function para(parent, ...parts) {
  const p = document.createElement('p');
  p.append(...parts);
  parent.append(p);
  return p;
}

function strong(text) {
  const s = document.createElement('strong');
  s.textContent = text;
  return s;
}

/**
 * Show the story in the result element.
 *
 * @param {HTMLElement} el
 * @param {object} lookup        { asn, holder } from RIPEstat
 * @param {object} path          describePath() result
 * @param {object} opts
 *   hiddenBy      'filter' when the network exists but the Min/Max Routes
 *                 filter hides it
 *   onShowAll     called by the "show smaller networks" button
 */
export function renderMyPath(el, lookup, path, { hiddenBy, onShowAll } = {}) {
  el.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'my-path-card';
  el.append(card);

  const who = path.status === 'found' ? friendlyName(path.node) : (lookup.holder || `AS${lookup.asn}`);

  if (path.status === 'missing') {
    para(card, 'You\'re on ', strong(who), ` (AS${lookup.asn}).`);
    para(card, 'It isn\'t among the networks in this data. The data keeps only the busiest connections seen into Bangladesh, so small networks are left out, and so is any network if you\'re browsing from outside Bangladesh.');
    return;
  }

  const { node, role, gateways, international } = path;
  if (role === 'outside') {
    para(card, 'You\'re on ', strong(who), ` (AS${node.asn}), a network registered outside Bangladesh${node.country ? ` (${node.country})` : ''}. This site shows how networks in Bangladesh reach the world, so it has no path to show for yours.`);
  } else if (role === 'gateway') {
    para(card, 'You\'re on ', strong(who), ` (AS${node.asn}), ${GATEWAY_LABELS[node.type]}.`);
    if (international.length) {
      para(card, 'It connects straight to international networks, mostly ', ...namedList(international.slice(0, 3), true), '.');
    }
  } else {
    para(card, 'You\'re on ', strong(who), ` (AS${node.asn}), a local network.`);
    if (gateways.length) {
      para(card, 'It reaches the world through ', ...namedList(gateways.slice(0, 3), true), `${gateways.length > 3 ? `, and ${gateways.length - 3} more gateways` : ''}.`);
    } else {
      para(card, 'No gateway connections were seen for it in this data.');
    }
    if (international.length) {
      para(card, gateways.length > 1 ? 'Those gateways connect to the world mainly through ' : 'That gateway connects to the world mainly through ', ...namedList(international.slice(0, 3), false), '.');
    }
  }

  if (hiddenBy === 'filter') {
    para(card, `It's hidden by the Min/Max Routes filter right now (it has ${(node.traffic || 0).toLocaleString()} routes).`);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline btn-small';
    btn.textContent = 'Show smaller networks';
    btn.addEventListener('click', () => onShowAll?.());
    card.append(btn);
  } else if (role !== 'outside') {
    para(card, 'It\'s highlighted in the chart.').className = 'my-path-hint';
  }
}
