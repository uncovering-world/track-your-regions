---
slug: ir-itto
name: "itto.org (Iran Travel, Tourism and Touring)"
publisher: "\"Iran Travel, Tourism and Touring Online NGO\" since 2005, and before it \"Iran Tourism and Touring Organization\" (the footer)"
urls:
  home: https://itto.org/iran/
  dataset: none
  api: none
  terms: none
family: association
kinds: [places-of-worship, towns-and-villages, palaces-and-castles, historic-houses, parks-and-gardens, world-heritage, squares-and-streets]
tier: regional
unit: { level: country, code: IR, name: Iran }
row:
  identity: "the site's own page per attraction (/iran/attraction/<name>/); its categories carry a number, a place does not"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "being listed under 'Explore attractions in' a city, each with a category"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: itto.org
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date"
  volume: "6 attraction pages linked from the Isfahan city page"
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
  cadence: 0
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# itto.org

An Iranian tourism portal in English that calls itself the "Official website of IRAN travel
since 1995" and, in its footer, an "Online NGO". Looked at on 2026-10-02 because the Isfahan
survey read it as one of its sources written inside the country. It is filed as `association`:
by its own description it is an NGO, neither a public body nor a company.

**What it sorts its places into.** Destinations by city and province; a city page has a text, a
photo gallery and "Explore attractions in" the city, each attraction with a page of its own and
one or two categories. The categories on the Isfahan page: Cathedrals and Churches, Historical
Edifices, Historical Palaces, Historical Place: Squares, Iranian Gardens, Mosques, Natural
Attractions, Rivers. A category has a number in its address; a place has its name only. The city
page loads a Google map; no attraction page was opened.

**Terms ([the access table](../site-access.md), 2026-10-02).** `itto.org`: `allowed` (robots
open; no terms linked). `robots.txt`: open (`*`: `Allow: /`). Terms: no terms page linked. The
footer links a privacy policy only; the fetch tool read it: privacy matters only, no clause on
automated access or reuse. Footer, read for this record: "Copyright 1995-2005, Iran Tourism and
Touring Organization, 2005-2026 Iran Travel, Tourism and Touring Online NGO. All rights
reserved."

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. No licence is stated: ask first, at the address its
privacy notice gives, helpdesk [at] itto.org.

**What the survey measured.** Three pages by fetch: Isfahan city, Isfahan province and Kashan.
The Isfahan survey of 2026-10-02 counted it on 24 of the 149 entries of
`db/catalogue-coverage/expectations/isfahan.jsonl` (by type: place 24). On none of them is the
surveyor's own list the only other source. The kinds in the front matter are those under which
the survey filed two or more of the entries it is named on.
