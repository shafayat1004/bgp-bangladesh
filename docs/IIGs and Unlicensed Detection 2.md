As of the latest available regulatory data (2024–2025), there are approximately 30+ licensed International Internet Gateways (IIGs) in Bangladesh.

### 1. List of Licensed IIGs in Bangladesh

The Bangladesh Telecommunication Regulatory Commission (BTRC) issues these licenses. Below are the major active IIG operators. *Note: This list is subject to change as the BTRC grants new licenses or cancels existing ones.*

**Major / Widely Known IIGs:**

* **Mango Teleservices Ltd.**
* **Summit Communications Ltd.**
* **Fiber@Home Global Ltd.**
* **Bangladesh Telecommunications Company Limited (BTCL)**
* **Bangladesh Submarine Cable Company Limited (BSCCL)**
* **Level3 Carrier Ltd.**
* **Aamra Technologies Ltd.**
* **Novocom Limited**
* **Global Fair Communications Ltd.**
* **Earth Telecommunication (Pvt.) Ltd.**

**Other Licensed IIG Operators:**

* Intraglobe Communications Ltd.
* MaxNet Online
* Peerex Networks Limited
* BD Hub Limited
* Cybergate Ltd.
* Delta Infocom Ltd.
* Equitel Communication Ltd.
* Sky Tel Communication Ltd.
* Velocity Networks Limited
* Radiant Communications Limited
* Greenland Technologies Ltd.
* Rego Communications Ltd.
* Bijoy Online Limited
* 1Asia Alliance Communication

---

### 2. How to Detect an Unlicensed BGP Peer

In the context of Bangladesh's regulatory framework, an "unlicensed peer" usually refers to an **ISP bypassing the IIG layer**.

**The Regulatory Rule:**

* **ISPs (Nationwide/Zonal)** are **strictly prohibited** from connecting directly to International Upstreams (like Tata, Cogent, Hurricane Electric). They *must* buy bandwidth from an IIG.
* **Only IIGs** are allowed to have BGP sessions with International Carriers.

If you suspect a network (ASN) is operating illegally (e.g., an ISP acting as an IIG without a license), you can detect it using the following technical analysis:

#### Method A: The "Upstream Check" (Easiest)

Use a BGP Looking Glass (like `bgp.he.net` or `qrator.net`) to inspect the target ASN's upstream peers.

1. **Search the Target ASN:** Enter the ASN of the ISP you want to check.
2. **Check "IPv4 Peers" or "Upstreams":** Look at who they are connected to.
* **Compliant (Legal):** Their upstreams are *only* Bangladeshi IIGs (e.g., ASN 58601 for Mango, ASN 17464 for Summit, etc.).
* **Non-Compliant (Likely Illegal):** You see direct sessions with international Tier-1 providers (e.g., Level3/Lumen, HE, SingTel, Bharti Airtel) *and* the target ASN is **not** on the list of licensed IIGs above.



#### Method B: Traceroute Analysis

Run a traceroute from a local network to an international destination (e.g., `8.8.8.8`).

1. **Analyze the Hops:** Look at the IP addresses/ASNs immediately leaving the Bangladesh network.
2. **The "Choke Point":** Traffic *must* pass through an IIG ASN before leaving the country.
* *Valid Path:* `Your ISP` -> `IIG (e.g., Summit)` -> `International Carrier (e.g., Tata)`
* *Invalid Path:* `Your ISP` -> `International Carrier (e.g., Tata)`
* If the trace jumps directly from a domestic ISP ASN to a foreign ASN without hitting a known IIG ASN, that ISP is bypassing the regulatory gateway (VoIP/Bypass fraud).



#### Method C: ROA & IRR Validity (Misuse of ASN)

Sometimes unlicensed operators will "hijack" or misuse an ASN to route traffic.

1. Check the **RPKI** status of the prefixes they are announcing.
2. If an ISP is announcing prefixes that belong to a different organization (or an international entity) without valid ROA (Route Origin Authorization), they may be illegally routing traffic (Grey traffic/SIM box termination).

### Summary Checklist for Validation

If you see a BGP peer in your table, ask these three questions:

1. **Is their ASN in the BTRC Licensed IIG list?** (If Yes -> Legal to peer internationally).
2. **If No**, are they **only** peering with domestic IIGs? (If Yes -> Legal ISP).
3. **If No** (they are peering with foreign ASNs directly), they are likely operating an illegal international gateway.