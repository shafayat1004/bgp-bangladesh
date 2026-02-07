## Licensed IIGs in Bangladesh

An **IIG** (International Internet Gateway) is a licensed operator that provides the “internet gateway” function for routing **international** internet traffic. The Bangladesh Telecommunication Regulatory Commission’s IIG guidelines describe IIGs as the gateway used for routing international incoming/outgoing internet data traffic (and also mention ISPs/BWA operators being connected to global internet through IIGs). 

From the BTRC document titled **“List of International Internet Gateway (IIG) Service Providers License”**, the listed IIG licensees are: 

1. Bangladesh Telecommunications Company Limited
2. Mango Teleservices Limited
3. Maxnet Online
4. I-TEL Limited
5. Global Fair Communications Limited
6. Level-3 Carrier Limited
7. Windstream Communication Limited
8. BD Hub Limited
9. 1Asia Alliance Communication Limited
10. Fiber@Home Global Limited
11. Bangladesh Submarine Cable Company Limited
12. Greenmax Technologies Limited
13. Radiant Communications Limited
14. Rego Communications Limited
15. Planet Internet Gateway Limited
16. Peerex Networks Limited
17. Summit Communications Limited
18. Toron Limited
19. Max Hub Limited
20. Aamra Technologies Limited
21. Intraglobe Communications Limited
22. Startek Telecom Limited
23. Cybergate Limited
24. Delta Infocom Limited
25. Exabyte Limited
26. Sky Tel Communication Limited
27. BD Link Communication Limited
28. ADN International Gateway Limited
29. Equitel Communication Limited
30. Velocity Networks Limited
31. Earth Telecommunication (PVT) Limited
32. NovoCom Limited
33. Coronet Corporation Limited
34. Virgo Communications Limited

Important caveat: that document shows **issue dates (2008–2013)**; it doesn’t, by itself, prove which licenses are **currently active vs cancelled/expired/transferred**. 
For “current status”, BTRC points licensees to its **LIMS portal** (they mention issuing e-licenses / related steps there). ([BTRC][1])

---

## How to detect if someone “in the BGP network” is unlicensed

First, one key point: **BGP cannot directly tell you whether someone is licensed by BTRC.**
What BGP *can* tell you is **who is acting like a gateway/transit network** (by observing AS paths and prefix origination), and then you **cross-check that operator** against the official IIG licensee list / BTRC records.

### The concepts you need (quick, but precise)

* **BGP (Border Gateway Protocol):** how networks exchange “reachability” info on the internet.
* **AS (Autonomous System):** one administrative network on the internet (an ISP/backbone), identified by an…
* **ASN (Autonomous System Number):** e.g., ASXXXXX.
* **Prefix:** an IP block (e.g., `103.10.0.0/22`) that an ASN announces in BGP.
* **AS path:** the list of ASNs a route advertisement passes through. The **last ASN** in the path is typically the **origin ASN** for that prefix.
* **Transit/upstream:** if many Bangladeshi ASNs’ paths go through the same ASN right before reaching foreign ASNs, that ASN is behaving like a “gateway/transit”.

### Practical detection method (what you can actually do)

#### Step 1) Build an “allowed IIG” reference set

1. Start with the **licensee names** above. 
2. Map each company → **their ASNs and prefixes** using:

   * **WHOIS / RIR records** (for BD, usually APNIC allocations)
   * Public network directories like PeeringDB (often lists ASNs and peering info)
3. Store this as an allowlist, e.g.:

   * `allowed_iig_org_names[]`
   * `allowed_iig_asns[]` (once you discover them)

> Why you need mapping: BTRC licensing is by **company**, but BGP works by **ASNs**.

#### Step 2) Identify who is acting as the “international gateway” in observed AS paths

Use public BGP collectors (they passively collect BGP routes from many networks):

* RIPE NCC **RIS** is a routing data collection platform for BGP. ([RIPE Network Coordination Center][2])
* CAIDA’s **BGPStream** provides APIs (including a Python API) to process BGP data programmatically. ([bgpstream.caida.org][3])

What to compute:

* Pick a set of **Bangladesh-origin prefixes** (or all BD ASNs).
* For each prefix, collect AS paths from RIS/Route collectors.
* For each path, find:

  * the **last Bangladesh-based ASN** before it exits to a foreign ASN
  * (heuristic: the ASN right before the first clearly non-BD upstream)
* Count frequency. The ASNs that appear repeatedly as the “exit hop” are the ones **behaving like gateways/transit**.

Now compare these “exit-hop ASNs” against your `allowed_iig_asns[]` mapping.

* If an ASN looks like a gateway but **is not** mapped to any licensed IIG operator → **flag for investigation**.

#### Step 3) Separate “unlicensed IIG” suspicion from “routing security incidents”

Sometimes what looks suspicious is actually:

* **Route leak** (accidental transit)
* **Hijack / mis-origination** (someone announcing a prefix they shouldn’t)

To check *that* side, use **RPKI origin validation**:

* **RPKI (Resource Public Key Infrastructure)** lets prefix holders publish ROAs (Route Origin Authorisations) saying “these prefixes may be originated by these ASNs”. Other networks can validate announcements against ROAs. ([RIPE Network Coordination Center][4])

If you see a flagged ASN *originating* prefixes that fail RPKI, that’s strong evidence of a routing problem (not necessarily licensing, but definitely actionable).

#### Step 4) What evidence you should collect before calling someone “unlicensed”

Because licensing is legal/regulatory, treat your result as: **“appears to be acting as an IIG in BGP”** until confirmed.

Minimum evidence bundle:

* Sample AS paths showing the ASN repeatedly used as an “international exit”
* WHOIS org name + admin contact
* PeeringDB entry (if any)
* Whether they have foreign upstreams/transit relationships
* RPKI validity for their originated routes (Valid/Invalid/NotFound)
* Cross-check: does the org appear in the BTRC IIG list? 

---

## One quick question so I can tailor this correctly

When you say “detect if someone in the BGP network is unlicensed”, do you mean:

1. **Country-wide detection**: “list the ASNs acting as BD international exit points, then compare to licensed IIGs”, **or**
2. **Case-based**: “I have a specific prefix / traceroute / AS-path and want to check if that path goes through an unlicensed gateway”?

If you share **one example** (a prefix or AS path), I’ll show exactly how to classify the “gateway ASN” and what checks to run on it.

[1]: https://lims.btrc.gov.bd/ "Bangladesh Telecommunication Regulatory Commission"
[2]: https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/?utm_source=chatgpt.com "Routing Information Service (RIS)"
[3]: https://bgpstream.caida.org/docs/api?utm_source=chatgpt.com "APIs"
[4]: https://www.ripe.net/manage-ips-and-asns/resource-management/rpki/bgp-origin-validation/?utm_source=chatgpt.com "BGP Origin Validation"
