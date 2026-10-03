---
slug: cn-travel-china-guide
name: "Travel China Guide"
publisher: "TravelChinaGuide.com, a tour operator with headquarters in Xi'an, established 1998"
urls:
  home: https://www.travelchinaguide.com/cityguides/beijing/
  dataset: none
  api: none
  terms: https://www.travelchinaguide.com/tour/terms.htm
family: commercial
kinds: [entertainment-venues, squares-and-streets, festivals-and-events, landmarks, neighbourhoods, regional-food, shows-and-performances, historic-hotels-and-restaurants, markets, world-heritage, parks-and-gardens, art-museums, places-of-worship, natural-landmarks, shops, palaces-and-castles, intangible-heritage, towns-and-villages, tours-and-cruises, architecture, history-museums, outdoor-activities]
tier: regional
unit: { level: country, code: CN, name: China }
row:
  identity: "the guide's own page per attraction (/attraction/<city>/<slug>.htm); no id exposed"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "being named in one of its 'top ten' articles or its city guide"
terms:
  licence: "none; only booking terms are linked from the footer; a Terms of Use page reached from the privacy page reserves reproduction and storage"
  database_right: not-asserted
  attribution: TravelChinaGuide.com
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the Beijing attraction index says \"Last updated on Sep. 14, 2026\""
  volume: "142 attraction pages linked from the Beijing index"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 0
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Travel China Guide

The guide pages of a Chinese tour operator, in English: "the largest online tour operator in
China", headquartered in Xi'an (its About page). Looked at on 2026-10-02 because the Beijing
survey read it as one of two guides written by agencies inside the country.

**What it sorts its places into.** A city guide per city and, under `/attraction/<city>/`, an
index of the city's attractions with a page each: for Beijing 142 pages, under the headings Top
Attractions, Temples, Historical Sites, Modern Scenic Spots, Natural Beauties and Imperial
Gardens & Mausoleums. Beside the index, "top ten" articles, and pages on dining, nightlife,
shopping and temple fairs. The index read carries no Chinese names; no attraction page was
opened.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.travelchinaguide.com`:
`allowed` (only booking terms are linked). `robots.txt`: open (`*`: /cgi-bin/, /tour/demo/,
admin and test folders). Terms: silent on automated reading, at
https://www.travelchinaguide.com/tour/terms.htm. The only terms the footer links are "Booking
Terms", about tour bookings; no sentence on the website's content or on automated access. Read
for this record and not in the table: a second page, "Terms of Use" (`/terms_use.htm`), reached
from the privacy page and not from the footer. § 1, "Ownership and Copyright": "No part may be
reproduced, copied or transmitted, in any form or by any means (such as electronic, mechanical,
micro-copying, photocopying, recording, storage in a retrieval system or otherwise) without its
prior written permission. All rights are reserved. If you wish to use or license any material on
this site, please contact us." It reserves copying and storage; it does not name automated
reading.

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The terms are ask first, and they offer a licence:
the address is the site's contact page (`/contact_us.htm`).

**What the survey measured.** The city guide, the dining, nightlife, shopping and temple-fair
pages and four "top ten" articles, by fetch. The attraction index was read in the first pass and
withdrawn in the second, as a directory of everything: 92 counts with it. The Beijing survey of
2026-10-02 counted it on 87 of the 247 entries of
`db/catalogue-coverage/expectations/beijing.jsonl` (by type: place 63, activity 9, event 8, food
4, work 1, route 1, object 1). On 7 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.
