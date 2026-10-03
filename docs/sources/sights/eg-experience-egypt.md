---
slug: eg-experience-egypt
name: "Experience Egypt"
publisher: "Egyptian Tourism Authority"
urls:
  home: https://www.experienceegypt.eg/en
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [archaeology, places-of-worship, tombs-and-mausoleums, neighbourhoods, palaces-and-castles, art-museums, landmarks, world-heritage, squares-and-streets, markets, entertainment-venues, historic-houses, public-art, parks-and-gardens]
tier: regional
unit: { level: country, code: EG, name: Egypt }
row:
  identity: unknown
  wikidata_link: unknown
  coordinates: unknown
  languages: [en, de, es, fr, it, ru, zh, cs, pl, uk]
  signal: "being given an attraction page under a destination, or named on a theme page"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Experience Egypt (Egyptian Tourism Authority)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: an events strip on the home page; no date on it"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: unknown
  coordinates: unknown
  names: 0
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: provisional
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Experience Egypt

The "official promotional website" of the Egyptian Tourism Authority, in ten languages, none of
them Arabic on the home page read. Looked at on 2026-10-02 because the Cairo survey read it as
the tourism authority's portal.

**What it sorts its places into.** "Where to go": The Nile, The Red Sea, The Med, Deserts &
Oases. "What to do": Sun & Sea, Archeological Sites, Spiritual Egypt, Museums, Cruising &
Sailing, Adventure & Outdoor, Ecotourism & Nature, Health & Wellness, Arts & Contemporary
Culture. "What's on": events. Only the home page was read for this record, so what a place's
page carries is not known here.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.experienceegypt.eg`:
`allowed` (robots open; no terms linked). `robots.txt`: open (The whole file: `User-agent: *` /
`Allow: /`. The bare host experienceegypt.eg does not answer). Terms: no terms page linked. No
terms link on the home page.

**What decides it.** Not decided: identity and coordinates were not looked at, so the verdict is
`provisional`. No licence is stated (footer: "ALL RIGHTS RESERVED© 2026"): ask first. The home
page shows a contact address, masked from a fetch.

**What the survey measured.** By fetch: the Cairo and Giza page and its three attraction pages,
the culture, gastronomy, festivals, galleries, shopping, cruising and heritage pages, and the
Fayoum, Ain Sukhna and Wadi al-Natrun pages. The Cairo survey of 2026-10-02 counted it on 110 of
the 198 entries of `db/catalogue-coverage/expectations/cairo.jsonl` (by type: place 74, food 13,
activity 8, work 6, event 4, drink 3, route 2). On 6 of them nothing else but the surveyor's own
list names the entry. Places among those: Museum of Modern Egyptian Art; Mahmoud Mokhtar Museum.
The kinds in the front matter are those under which the survey filed two or more of the entries
it is named on.
