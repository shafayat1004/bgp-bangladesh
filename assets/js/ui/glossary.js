/**
 * Glossary: plain-language explanations of the site's technical terms, and
 * the small "?" buttons that open them.
 *
 * This is the one place these explanations are written. Table headers, the
 * legend, the sidebar, detail panels and the intro all use it (and later the
 * Bangla translation, issue #16). Each term has one plain sentence; most also
 * have an example built from the snapshot on screen, which the visitor opens
 * with "New to this? Show me an example".
 *
 * The popover opens on hover, keyboard focus and tap, stays open while the
 * pointer is over it, and closes on Escape, a click elsewhere or leaving it
 * (WCAG 1.4.13).
 */

import { friendlyName, countryName } from './names.js';

// Category names, the same everywhere: tabs, legend, sidebar, table, tooltips.
export const CATEGORY_LABELS = {
  'local-company': 'Local company',
  'iig': 'IIG',
  'detected-iig': 'Detected gateway',
  'offshore-enterprise': 'Offshore enterprise',
  'offshore-gateway': 'Offshore gateway',
  'outside': 'International network',
  // Older snapshots
  'inside': 'Gateway',
  'offshore-peer': 'Offshore enterprise',
  'local-isp': 'Local company',
};

export const CATEGORY_PLURALS = {
  'local-company': 'Local companies',
  'iig': 'IIGs (licensed gateways)',
  'detected-iig': 'Detected gateways',
  'offshore-enterprise': 'Offshore enterprises',
  'offshore-gateway': 'Offshore gateways',
  'outside': 'International networks',
  'inside': 'Gateways',
  'offshore-peer': 'Offshore enterprises',
  'local-isp': 'Local companies',
};

const GATEWAY_TYPES = new Set(['iig', 'detected-iig', 'offshore-enterprise', 'offshore-gateway']);

// ── Reading the snapshot for examples ──

/** "2.6 million", "316,000": how people say a route count. Exported for testing. */
export function aboutNumber(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e5) return (Math.round(n / 1000) * 1000).toLocaleString('en-US');
  return Math.round(n).toLocaleString('en-US');
}

const ends = (e) => [e.source?.asn || e.source, e.target?.asn || e.target];

function biggest(data, type, keep = () => true) {
  let best = null;
  for (const n of data?.nodes || []) {
    if (n.type === type && keep(n) && (!best || (n.traffic || 0) > (best.traffic || 0))) best = n;
  }
  return best;
}

/** Networks of the given types connected to `asn`, busiest connection first. */
function neighbours(data, asn, types) {
  const byAsn = new Map((data?.nodes || []).map(n => [n.asn, n]));
  const found = new Map();
  for (const e of data?.edges || []) {
    const [a, b] = ends(e);
    const other = a === asn ? b : b === asn ? a : null;
    const n = other && byAsn.get(other);
    if (n && types.has(n.type)) found.set(other, Math.max(found.get(other) || 0, e.count || 0));
  }
  return [...found.entries()].sort((x, y) => y[1] - x[1]).map(([a]) => byAsn.get(a));
}

const LOCAL = new Set(['local-company']);
const INTL = new Set(['outside']);
const GATEWAYS = GATEWAY_TYPES;

const name = friendlyName;
const localCompanies = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'local company connects' : 'local companies connect'}`;
// "in the United States", "in India"
const THE = new Set(['US', 'GB', 'NL', 'AE', 'PH', 'CZ', 'BS', 'KY', 'MV', 'SC', 'VG']);
const inCountry = (cc) => `in ${THE.has(cc) ? 'the ' : ''}${countryName(cc)}`;
// geo_country is the main country abroad when more than a fifth of a
// network's located addresses are outside Bangladesh (update_bgp_data.py).
const abroad = (n) => n.geo_country && n.geo_country !== 'BD';

// ── The terms ──
// title: shown as the popover heading. ask: the "?" button's spoken name.
// short: one plain sentence (or two). example(data): built from the snapshot
// on screen, or null when it has nothing to show.

export const GLOSSARY = {
  'asn': {
    title: 'ASN (network number)',
    ask: 'What is an ASN?',
    short: 'Autonomous System Number: the ID number every network on the internet gets from an internet registry, written like AS58717.',
    example(data) {
      const g = biggest(data, 'iig');
      return g && `${name(g)} is AS${g.asn}. Company names change and are spelled in many ways, so networks are listed by number.`;
    },
  },
  'bgp': {
    title: 'BGP',
    ask: 'What is BGP?',
    short: 'Border Gateway Protocol: the system networks use to tell each other which internet addresses they can reach, and through whom.',
    example() {
      return 'When a Bangladeshi provider announces its addresses, its gateway passes the news to networks abroad, and they pass it on again, until the whole internet knows the way back to that provider.';
    },
  },
  'route': {
    title: 'Route',
    ask: 'What is a route?',
    short: 'A path to a block of internet addresses: the list of networks a connection passes through to reach them.',
    example(data) {
      const l = biggest(data, 'local-company');
      const g = l && neighbours(data, l.asn, GATEWAYS)[0];
      const i = g && neighbours(data, g.asn, INTL)[0];
      return i ? `One route seen here: ${name(i)} → ${name(g)} → ${name(l)}. A connection from abroad to ${name(l)}'s customers passes through those networks in that order.` : null;
    },
  },
  'routes-seen': {
    title: 'Routes seen',
    ask: 'What does "routes" count?',
    short: 'How many routes pass through a network, counted across all monitoring points. It measures how many paths use a network, not how much traffic flows through it.',
    example(data) {
      const g = biggest(data, 'iig');
      return g && `About ${aboutNumber(g.traffic || 0)} routes seen pass through ${name(g)}. A network with few routes can still carry a lot of video or downloads; route data can't show that, so it does not measure traffic.`;
    },
  },
  'observations': {
    title: 'Route observations',
    ask: 'What is a route observation?',
    short: 'One monitoring point seeing one route. RIPE runs hundreds of monitoring points around the world, so a widely seen route is counted many times.',
    example(data) {
      const n = data?.stats?.valid_observations;
      return n ? `This snapshot is built from ${aboutNumber(n)} observations of routes into Bangladesh.` : null;
    },
  },
  'connection': {
    title: 'Connection',
    ask: 'What is a connection?',
    short: 'Two networks are connected when routes were seen passing directly from one to the other. The site shows the busiest connections: up to 2,000 inside Bangladesh and 1,500 across the border.',
    example(data) {
      let top = null;
      for (const e of data?.edges || []) if (!top || e.count > top.count) top = e;
      if (!top) return null;
      const byAsn = new Map(data.nodes.map(n => [n.asn, n]));
      const [a, b] = ends(top).map(x => byAsn.get(x));
      return a && b ? `The busiest one here is between ${name(a)} and ${name(b)}, with about ${aboutNumber(top.count)} routes seen.` : null;
    },
  },
  'connection-type': {
    title: 'International and local connections',
    ask: 'What do international and local mean?',
    short: 'International: between a network abroad and a gateway in Bangladesh. Local: between a local company and the gateway it reaches the internet through.',
  },
  'transit': {
    title: 'Transit',
    ask: 'What is transit?',
    short: 'Carrying other networks\' routes onward so they can reach the rest of the internet. Gateways get transit from international networks and provide it to local companies.',
    example(data) {
      const g = biggest(data, 'iig');
      const intl = g ? neighbours(data, g.asn, INTL).slice(0, 2) : [];
      return intl.length ? `${name(g)} reaches the world through networks like ${intl.map(name).join(' and ')}.` : null;
    },
  },
  'local-company': {
    title: 'Local company',
    ask: 'What is a local company?',
    short: 'A network in Bangladesh that reaches the rest of the internet through a gateway: internet providers, mobile operators, universities, banks and other companies. A few also have their own link abroad.',
    example(data) {
      const l = biggest(data, 'local-company');
      const gws = l ? neighbours(data, l.asn, GATEWAYS).slice(0, 2) : [];
      return gws.length ? `${name(l)} has the most routes seen of any local company. It reaches the world through ${gws.map(name).join(' and ')}.` : null;
    },
  },
  'iig': {
    title: 'IIG (licensed gateway)',
    ask: 'What is an IIG?',
    short: 'International Internet Gateway: one of the companies BTRC, Bangladesh\'s telecom regulator, licenses to carry internet connections in and out of the country.',
    example(data) {
      const g = biggest(data, 'iig');
      const i = g && neighbours(data, g.asn, INTL)[0];
      return g && `${name(g)} (AS${g.asn}) is the biggest: about ${aboutNumber(g.traffic || 0)} routes seen pass through it. Local companies connect to it${i ? `, and it connects abroad to networks like ${name(i)}` : ''}.`;
    },
  },
  'igw': {
    title: 'IGW (voice gateway)',
    ask: 'What is an IGW?',
    short: 'International Gateway: a BTRC licence to carry international phone calls. IGW operators have their own links to carriers abroad, but the licence is for calls, not for carrying internet connections like an IIG.',
  },
  'abroad-link': {
    title: 'Own link abroad',
    ask: 'What is an own link abroad?',
    short: 'This network is seen right behind a network abroad, not only behind a Bangladeshi gateway: for example a hosting or attack-protection service announcing its addresses, or a voice gateway\'s own link. Routes over local exchanges such as BDIX don\'t show in this data.',
  },
  'detected-iig': {
    title: 'Detected gateway',
    ask: 'What is a detected gateway?',
    short: 'A Bangladeshi network that other Bangladeshi networks reach the internet through, like a gateway, but that isn\'t on BTRC\'s IIG licence list. It may be a new operator, part of a licensed one, or a gap in the list.',
    example(data) {
      const d = biggest(data, 'detected-iig');
      return d && `${name(d)} isn't on the licence list, and yet ${localCompanies(neighbours(data, d.asn, LOCAL).length)} through it in this snapshot.`;
    },
  },
  'offshore-enterprise': {
    title: 'Offshore enterprise',
    ask: 'What is an offshore enterprise?',
    short: 'Registered in Bangladesh, but more than a fifth of its IP addresses are located abroad, and no other Bangladeshi networks connect through it. Often a company that runs servers overseas.',
    example(data) {
      const e = biggest(data, 'offshore-enterprise', abroad);
      return e && `${name(e)} is registered in Bangladesh, but many of its IP addresses are located ${inCountry(e.geo_country)}.`;
    },
  },
  'offshore-gateway': {
    title: 'Offshore gateway',
    ask: 'What is an offshore gateway?',
    short: 'Registered in Bangladesh with more than a fifth of its IP addresses located abroad, and other Bangladeshi networks connect through it. It works like a gateway, but from outside the country.',
    example(data) {
      const o = biggest(data, 'offshore-gateway', abroad);
      return o && `${name(o)} is registered in Bangladesh and many of its IP addresses are located ${inCountry(o.geo_country)}, yet ${localCompanies(neighbours(data, o.asn, LOCAL).length)} through it.`;
    },
  },
  'outside': {
    title: 'International network',
    ask: 'What is an international network?',
    short: 'A network registered outside Bangladesh that carries routes into the country, usually a large international carrier.',
    example(data) {
      const i = biggest(data, 'outside');
      return i && `${name(i)}${i.country ? ` (${countryName(i.country)})` : ''} is the biggest: about ${aboutNumber(i.traffic || 0)} routes seen come in through it.`;
    },
  },
  'registered': {
    title: 'Registered country',
    ask: 'What does "Registered" mean?',
    short: 'The country on record with the internet registry that gave the network its number. It\'s where the network is officially listed, not necessarily where its equipment is.',
    example(data) {
      const i = biggest(data, 'outside', n => n.country);
      return i && `${name(i)} is registered ${inCountry(i.country)}. A few networks are registered to a region, such as Asia-Pacific, instead of one country.`;
    },
  },
  'ip-location': {
    title: 'IP location',
    ask: 'What does "IP location" mean?',
    short: 'Where the network\'s IP addresses are, according to a geolocation database (MaxMind GeoLite, via RIPEstat). A country other than Bangladesh means more than a fifth of its addresses are located there or elsewhere abroad.',
    example(data) {
      const e = biggest(data, 'offshore-enterprise', abroad) || biggest(data, 'offshore-gateway', abroad);
      return e && `${name(e)} is registered in Bangladesh, but the geolocation database places many of its addresses ${inCountry(e.geo_country)}, so its IP location is ${countryName(e.geo_country)}.`;
    },
  },
  'peering': {
    title: 'Peering location',
    ask: 'What does "Peering at" mean?',
    short: 'Where the network physically connects to other networks, such as an internet exchange or data centre, from PeeringDB. Shown for Bangladeshi networks whose IP addresses are abroad.',
    example(data) {
      const p = (data?.nodes || []).find(n => n.peering_details?.length);
      return p && `${name(p)} connects to other networks at ${p.peering_details[0]}.`;
    },
  },
  'share': {
    title: 'Share',
    ask: 'What does "Share" mean?',
    short: 'Of all the routes seen crossing Bangladesh\'s border, the percentage that cross through or start from this network. The shares of all gateways add up to 100%, and so do the shares of all international networks.',
    example(data) {
      const g = biggest(data, 'iig');
      const i = biggest(data, 'outside');
      return g && i ? `${name(g)}'s share is ${Math.round(g.percentage || 0)}%, and ${name(i)}'s is ${Math.round(i.percentage || 0)}%.` : null;
    },
  },
  'ripestat': {
    title: 'RIPEstat',
    ask: 'What is RIPEstat?',
    short: 'A free public service from RIPE NCC, the internet registry for Europe, the Middle East and Central Asia. It collects routes from monitoring points around the world; this site\'s data comes from it.',
  },
};

/** The example for a term from this snapshot, or null. Exported for testing. */
export function termExample(key, data) {
  try {
    // Names that end in "Ltd." shouldn't leave "Ltd.." at the end of a sentence.
    return GLOSSARY[key]?.example?.(data)?.replace(/\.\.(?=\s|$)/g, '.') || null;
  } catch { return null; }
}

/** HTML for a "?" button that explains `key`. Put it right after the term. */
export function termHelp(key) {
  const term = GLOSSARY[key];
  if (!term) throw new Error(`No glossary term "${key}"`);
  return `<button type="button" class="term-help" data-term="${key}" aria-label="${term.ask.replace(/"/g, '&quot;')}" aria-describedby="term-def-${key}" aria-expanded="false">?</button>`;
}

/** Fill a <dl> with the given terms (the intro's "Key concepts"); `notes` adds e.g. a colour. */
export function renderGlossaryList(dl, keys, notes = {}) {
  if (!dl) return;
  dl.innerHTML = keys.map(k => `<dt>${GLOSSARY[k].title}${notes[k] ? ` (${notes[k]})` : ''}</dt><dd>${GLOSSARY[k].short}</dd>`).join('');
}

/** Add a "?" after every element in static HTML marked data-glossary="<term>". */
export function addTermHelp(root) {
  root.querySelectorAll('[data-glossary]').forEach(el => {
    if (el.nextElementSibling?.classList.contains('term-help')) return;
    el.insertAdjacentHTML('afterend', termHelp(el.dataset.glossary));
  });
}

// ── Popover ──

let snapshot = null;
let open = null;          // { btn, pop, pinned }
let hoverTimer = null;
let refocusing = false;
let initialized = false;

/** The data on screen, for the examples. Call whenever it changes. */
export function setGlossaryData(data) {
  snapshot = data;
}

function closePopover({ returnFocus = false } = {}) {
  clearTimeout(hoverTimer);
  if (!open) return;
  const { btn, pop } = open;
  open = null;
  const hadFocus = pop.contains(document.activeElement);
  pop.remove();
  btn.setAttribute('aria-expanded', 'false');
  btn.removeAttribute('aria-controls');
  if ((returnFocus || hadFocus) && btn.isConnected) {
    refocusing = true;   // don't let this focus reopen it
    btn.focus({ preventScroll: true });
    refocusing = false;
  }
}

function place(btn, pop) {
  const r = btn.getBoundingClientRect();
  // Keep it inside the button's region: the sidebar (transformed and drawn
  // over the main area on phones) and the main area clip or cover it otherwise.
  const box = btn.closest('#sidebar, #main, dialog')?.getBoundingClientRect() || { left: 0, right: innerWidth };
  const margin = 8;
  const width = Math.min(320, box.right - box.left - 2 * margin);
  pop.style.width = `${width}px`;
  let left = Math.min(Math.max(r.left + r.width / 2 - width / 2, box.left + margin), box.right - margin - width);
  let top = r.bottom + 6;
  const h = pop.offsetHeight;
  if (top + h > innerHeight - margin && r.top - 6 - h > margin) top = r.top - 6 - h;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  // A transformed ancestor moves position:fixed; correct by what actually happened.
  const got = pop.getBoundingClientRect();
  pop.style.left = `${left + (left - got.left)}px`;
  pop.style.top = `${top + (top - got.top)}px`;
}

function openPopover(btn, { pinned = false } = {}) {
  clearTimeout(hoverTimer);
  if (open?.btn === btn) { open.pinned ||= pinned; return; }
  closePopover();
  const key = btn.dataset.term;
  const term = GLOSSARY[key];
  if (!term) return;

  const pop = document.createElement('div');
  pop.className = 'term-popover';
  pop.id = 'term-popover';
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-labelledby', 'term-popover-title');

  const title = document.createElement('p');
  title.className = 'term-popover-title';
  title.id = 'term-popover-title';
  title.textContent = term.title;
  const short = document.createElement('p');
  short.textContent = term.short;
  pop.append(title, short);

  const example = termExample(key, snapshot);
  if (example) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'term-example-btn';
    more.textContent = 'New to this? Show me an example';
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'term-popover-example');
    const ex = document.createElement('p');
    ex.className = 'term-example';
    ex.id = 'term-popover-example';
    ex.hidden = true;
    ex.textContent = example;
    more.addEventListener('click', () => {
      const show = ex.hidden;
      ex.hidden = !show;
      more.setAttribute('aria-expanded', String(show));
      more.textContent = show ? 'Hide the example' : 'New to this? Show me an example';
      if (open) open.pinned = true;
      place(btn, pop);
    });
    pop.append(more, ex);
  }

  // Right after the button, so Tab moves from the "?" into the popover.
  btn.after(pop);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', 'term-popover');
  open = { btn, pop, pinned };
  place(btn, pop);
}

const inOpen = (el) => open && el && (open.btn.contains(el) || open.pop.contains(el));

/** Set up the "?" buttons. Safe to call more than once. */
export function initGlossary() {
  if (initialized) return;
  initialized = true;

  // Spoken descriptions for the "?" buttons (aria-describedby), one per term.
  const defs = document.createElement('div');
  defs.hidden = true;
  defs.id = 'glossary-defs';
  defs.innerHTML = Object.entries(GLOSSARY).map(([k, t]) => `<span id="term-def-${k}">${t.short}</span>`).join('');
  document.body.append(defs);

  document.addEventListener('mouseover', (e) => {
    const btn = e.target.closest?.('.term-help');
    if (btn) {
      clearTimeout(hoverTimer);
      if (open?.btn !== btn) hoverTimer = setTimeout(() => openPopover(btn), 150);
    } else if (inOpen(e.target)) {
      clearTimeout(hoverTimer);
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (!open || open.pinned || !inOpen(e.target) || inOpen(e.relatedTarget)) {
      if (!open && e.target.closest?.('.term-help')) clearTimeout(hoverTimer);
      return;
    }
    if (open.pop.contains(document.activeElement)) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (open && !open.pinned) closePopover(); }, 300);
  });

  document.addEventListener('focusin', (e) => {
    const btn = e.target.closest?.('.term-help');
    if (btn && !refocusing) openPopover(btn);
  });
  document.addEventListener('focusout', (e) => {
    if (open && inOpen(e.target) && !inOpen(e.relatedTarget) && e.relatedTarget) closePopover();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.term-help');
    if (btn) {
      e.preventDefault();
      if (open?.btn === btn && open.pinned) closePopover();
      else openPopover(btn, { pinned: true });
      return;
    }
    if (open && !inOpen(e.target)) closePopover();
  });

  // Escape closes the popover first; a second Escape reaches the sidebar or dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closePopover({ returnFocus: inOpen(document.activeElement) });
  }, true);

  document.addEventListener('scroll', (e) => {
    if (!open || open.pop.contains(e.target)) return;
    const r = open.btn.getBoundingClientRect();
    if (!open.btn.isConnected || r.bottom < 0 || r.top > innerHeight) closePopover();
    else place(open.btn, open.pop);
  }, true);
  window.addEventListener('resize', () => closePopover());
}
