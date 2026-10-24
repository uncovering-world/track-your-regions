---
slug: wdpa-protected-planet
name: World Database on Protected Areas (WDPA, now within the WDPCA), on Protected Planet
publisher: UNEP-WCMC with IUCN (UN Environment Programme World Conservation Monitoring Centre)
urls:
  home: https://www.protectedplanet.net/
  dataset: unknown (the download pages were not read)
  api: unknown
  terms: https://www.protectedplanet.net/en/legal
family: global
kinds: [national-parks-and-reserves, parks-and-gardens, natural-landmarks, world-heritage]
tier: world
unit: { level: any, code: none, name: any }
row:
  identity: "the WDPA ID; Wikidata's P809 carries it on 120,839 items in the dump of 2026-10-19"
  wikidata_link: P809
  coordinates: all
  languages: [en, and each area's original name]
  signal: "the designation and the IUCN management category"
terms:
  licence: "UNEP-WCMC and IUCN terms and conditions: commercial use only with written permission; publication only where the data are not downloadable; no redistribution; no sub-licensing, including within derived works"
  database_right: reserved
  attribution: "UNEP-WCMC and IUCN (year), Protected Planet: <database>, <month year>, Cambridge, UK: UNEP-WCMC and IUCN. www.protectedplanet.net"
  scraping: unknown
access:
  mode: "unknown (the terms speak of versions downloaded; the download pages were not read)"
  format: unknown
  cadence: "monthly (the attribution names the month and year of the release)"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-25
  completeness: 2
  identity: 2
  coordinates: 2
  names: 1
  signal: 1
  terms: 0
  access: unknown
  cadence: 2
  total: unknown
  verdict: veto
status: refused
issue: 1977
looked_at: 2026-10-25
---

# World Database on Protected Areas

The world's register of protected areas, with each area's boundary, designation and management
category. Looked at by #1977 as the source of a national park's or a reserve's outline and
designation. Wikidata links it from 73,784 places in the pool of national parks and reserves,
from 4,861 parks and gardens and from 13 % of World Heritage Sites.

**Terms (read 2026-10-25 on the legal page).** The terms allow publishing the materials only
where "(a) the WDPCA and GD-PAME Data are not downloadable and (b) the proper attribution is
clearly visible". They forbid redistribution "in whole or in part" by any means, web services
and interactive maps that grant download access included. They also say the materials "may not
be sub-licensed in whole or in part including within Derivative Works", and they require written
permission for any commercial use.

**Verdict.** Refused (terms 0) for what the catalogue would take from it. An outline drawn
through the catalogue's vector tiles reaches the browser as data and travels in the catalogue's
public dumps, which is redistribution. A designation is already on Wikidata's item (P31 instance of, P814 IUCN protected areas category),
and the identifier P809 says the area is in the register. Both are read from the dump.
