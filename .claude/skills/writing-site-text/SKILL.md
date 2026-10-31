---
name: writing-site-text
description: Use when writing or reviewing any words a visitor of the BGP Bangladesh site sees or hears - headings, takeaway sentences, tooltips, glossary entries, the network details panel, banners, a status line, spoken chart labels, social or README copy - and especially text about shutdowns, outages, which networks stayed reachable, government, security-force or bank networks, licences, IGWs, direct links abroad, Starlink or satellite.
---

# Writing site text

The site is educational. It states what the routes show, where that comes
from and when, and lets people draw their own conclusions. It never accuses,
praises, ranks networks by how suspicious they look, or guesses at motives.
Naming a network that stayed reachable is fine and useful; judging it is not.

`CLAUDE.md` ("Plain, accurate words") and the `chart-views` skill cover
vocabulary (networks not nodes, routes not traffic, glossary terms). This
skill covers framing.

## The shape of a fact

Every claim about a network is one sentence of this shape:

> **[friendly name]** + **[what the routes showed]** + **[through whom]** +
> **[when]**, with the **[source]** next to it.

"Special Security Force: routes visible worldwide on 21 Jul 2024, carried by
ADN Telecom. Source: RIPEstat."

"Bangladesh Police: no routes visible from 18 Jul to 24 Jul 2024. Source:
RIPEstat routing history."

"CEL Telecom holds an international voice gateway (IGW) licence (BTRC list,
30 Oct 2024) and connects directly to Tata (routes seen today)."

## Section recipe

A section about shutdowns or who could stay connected has, in order:

1. A heading that asks the visitor's question ("Which networks stayed
   reachable from abroad?").
2. One takeaway sentence with the country-level numbers and dates.
3. Rows built the same way for every network, ordered by a neutral key
   (category, then name or route count). The same columns for a bank, a
   university, a security force and an ISP.
4. One note on what routes can't show: visible routes don't prove the service
   worked or who could use it; missing routes don't prove a network was
   offline inside Bangladesh; a route can linger after it stops being used.
5. Sources and freshness: RIPEstat with the timestamp, BTRC list dates, the
   operator's published file (Starlink's geofeed) with the date fetched.

## Words to use

| Say | Instead of |
|---|---|
| routes visible worldwide | online, had internet, stayed connected, kept access |
| no routes visible | went dark, was cut off, was offline, blackout |
| reached through X, carried by X | uses X, hides behind X |
| has its own licensed link abroad (IGW licence, BTRC list of 30 Oct 2024) | bypasses the gateways, loophole, backdoor |
| a network registered in Singapore | through Singapore, routed via Singapore (registered country is not location) |
| routes seen dropped from about 1,388 to 69 networks | the shutdown hit, the country went dark |
| unusually low: 210 networks visible (typical: about 1,385) | Bangladesh is offline, internet cut |

## Conditions

- **A reason or mechanism** (own link abroad, foreign upstream, a gateway kept
  carrying it) goes in only when the data shows that mechanism for that
  network. Otherwise write "the routes don't show why." The same goes for a
  section's intro: "these networks are reached another way" claims a
  mechanism for every row.
- **Country totals** go in the takeaway sentence, not in each row. A row
  describes its own network ("routes visible on 21 Jul"), not a contrast
  with everyone else ("while most of the country was dark").
- **"Typical" or "normal"** names how it is computed (for example "median of the last 30
  healthy days, leaving out days already marked as outages") wherever the
  number appears or one tap away.
- **Who could get online** is a question routes can't answer. Text says who
  could be *reached from abroad*, and says so plainly.
- **Legality, permission, exemptions and intent** stay off the site, including
  denials ("we don't claim this was legal" still raises the question).
  Licences are stated as facts with their dates.
- **Events** (a shutdown order, a cable cut) are attributed: "reported by The
  Daily Star, 19 Jul 2024", linked.

## Common mistakes (from test runs without this skill)

- "It points to a link that was not going through the usual commercial
  gateways": a guessed mechanism the data didn't show.
- "Starlink customers can still be reached ... if you want to know who can
  still get online": routes stretched into user access.
- "Kept routes visible ... while most of the country was dark": a row framed
  as a contrast, which reads as singling out.
- "Compared with the typical count over the past 30 days": a baseline stated
  without saying how outage days are handled.

## Review checklist

Read the text as someone who works at the network named. Every sentence
should be one they can check against public data and can't call unfair. Then
read it as someone in Bangladesh during a shutdown: it should tell them what
is reachable and what isn't, with dates, without telling them what to think.
