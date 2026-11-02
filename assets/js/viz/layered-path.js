/**
 * One network's path out to the world, for the Layered View's path screen.
 *
 * The data has which gateways a network uses (domestic connections, network ->
 * gateway) and which networks abroad each gateway uses for all its customers
 * (international connections, network abroad -> gateway). It does not have
 * the second hop for one network's own routes, so a local network's "abroad"
 * column is its gateways' connections abroad, never "its routes go A -> B".
 * Shares use the same definitions as history/changes.json. No DOM access.
 */

import { sourceAsn, targetAsn, networksByAsn } from '../data/network-data.js';
import { friendlyName, countryName, NOT_COUNTRIES } from '../ui/names.js';
import { GATEWAY_TYPES } from '../ui/my-path.js';

export { GATEWAY_TYPES };

/** Networks abroad kept per gateway on a local network's path. */
export const ABROAD_PER_GATEWAY = 4;
/** Customers a gateway's path screen shows before "and N more". */
export const CUSTOMER_CAP = 8;

const byCountDesc = (a, b) => b.count - a.count || (a.node.asn < b.node.asn ? -1 : a.node.asn > b.node.asn ? 1 : 0);

/** Group edges by one end; each row's share is of all the edges given. */
function rowsBy(edges, keyOf, nodeMap) {
  const totals = new Map();
  let sum = 0;
  for (const e of edges) {
    const k = String(keyOf(e));
    totals.set(k, (totals.get(k) || 0) + (e.count || 0));
    sum += e.count || 0;
  }
  return [...totals.entries()]
    .filter(([asn]) => nodeMap[asn])
    .map(([asn, count]) => ({ node: nodeMap[asn], count, share: sum ? count / sum : 0 }))
    .sort(byCountDesc);
}

function roleOf(node, edges) {
  if (node.type === 'outside') return 'outside';
  if (!GATEWAY_TYPES.has(node.type)) return 'local';
  // An offshore company is a gateway only when other networks use it.
  if (node.type !== 'offshore-enterprise') return 'gateway';
  return edges.some(e => e.type === 'domestic' && String(targetAsn(e)) === node.asn) ? 'gateway' : 'local';
}

/** The path model for one network in one snapshot. */
export function buildPath(data, asn) {
  asn = String(asn);
  const nodeMap = networksByAsn(data.nodes);
  const node = nodeMap[asn];
  if (!node) return { status: 'missing' };
  const edges = data.edges || [];
  const domestic = edges.filter(e => e.type === 'domestic');
  const intl = edges.filter(e => e.type === 'international');
  const role = roleOf(node, edges);
  const abroadOf = (gw) => rowsBy(intl.filter(e => String(targetAsn(e)) === gw), sourceAsn, nodeMap);

  if (role === 'outside') {
    const gateways = rowsBy(intl.filter(e => String(sourceAsn(e)) === asn), targetAsn, nodeMap);
    return { status: 'found', role, node, gateways };
  }
  if (role === 'gateway') {
    const customers = rowsBy(domestic.filter(e => String(targetAsn(e)) === asn), sourceAsn, nodeMap);
    return { status: 'found', role, node, customers, customerTotal: customers.length, abroad: abroadOf(asn) };
  }

  const gateways = rowsBy(domestic.filter(e => String(sourceAsn(e)) === asn), targetAsn, nodeMap);
  const lines = [];
  const abroadCounts = new Map();
  for (const gw of gateways) {
    for (const row of abroadOf(gw.node.asn).slice(0, ABROAD_PER_GATEWAY)) {
      lines.push({ from: gw.node.asn, to: row.node.asn, share: row.share });
      const prev = abroadCounts.get(row.node.asn) || { node: row.node, count: 0 };
      prev.count += row.count;
      abroadCounts.set(row.node.asn, prev);
    }
  }
  const abroadSum = [...abroadCounts.values()].reduce((s, r) => s + r.count, 0);
  const abroad = [...abroadCounts.values()]
    .map(r => ({ ...r, share: abroadSum ? r.count / abroadSum : 0 }))
    .sort(byCountDesc);
  return { status: 'found', role, node, gateways, abroad, lines, abroadByGateway: abroadOf };
}

const REGION_SHORT = { EU: 'Europe', AP: 'Asia-Pacific' };

/** "Transit X (India)"; regions as "(Europe)", no country as just the name. */
export function nameWithCountry(node) {
  const cc = node.country;
  if (!cc || (NOT_COUNTRIES[cc] && !REGION_SHORT[cc])) return friendlyName(node);
  return `${friendlyName(node)} (${REGION_SHORT[cc] || countryName(cc)})`;
}

function mainly(rows) {
  const top = rows.slice(0, 2).map(r => nameWithCountry(r.node));
  return top.join(' and ');
}

/** One plain sentence that states the path's takeaway. */
export function pathSummary(path) {
  if (path?.status !== 'found') return '';
  const name = friendlyName(path.node);

  if (path.role === 'outside') {
    const n = path.gateways.length;
    if (n === 0) return `No connections from ${name} to Bangladeshi gateways were seen in this data.`;
    const top = friendlyName(path.gateways[0].node);
    if (n === 1) return `${name} connects to 1 Bangladeshi gateway, ${top}.`;
    return `${name} connects to ${n.toLocaleString('en-US')} Bangladeshi gateways; ${top} carries the most.`;
  }

  if (path.role === 'gateway') {
    const n = path.customerTotal;
    const lead = n === 1
      ? `1 local network reaches the world through ${name}`
      : `${n.toLocaleString('en-US')} local networks reach the world through ${name}`;
    return path.abroad.length
      ? `${lead}; its connections abroad go mainly through ${mainly(path.abroad)}.`
      : `${lead}.`;
  }

  if (!path.gateways.length) return `No gateway connections were seen for ${name} in this data.`;
  const top = path.gateways[0];
  const gw = friendlyName(top.node);
  const p = Math.round(top.share * 100);
  const lead = path.gateways.length === 1
    ? `All of ${name}'s routes go through ${gw}`
    : p >= 50
      ? `Most of ${name}'s routes (${p}%) go through ${gw}`
      : `The largest share of ${name}'s routes (${p}%) goes through ${gw}`;
  const abroad = path.abroadByGateway(top.node.asn);
  return abroad.length ? `${lead}, which connects abroad mainly through ${mainly(abroad)}.` : `${lead}.`;
}
