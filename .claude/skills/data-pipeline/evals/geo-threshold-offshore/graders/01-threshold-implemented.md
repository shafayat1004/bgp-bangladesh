---
type: llm
focus: trace
weight: 1
---

Changes the geolocation logic in scripts/update_bgp_data.py so locations under 5% of a network's addresses are ignored when choosing geo_country.
