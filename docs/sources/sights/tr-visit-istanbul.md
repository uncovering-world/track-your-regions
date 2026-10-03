---
slug: tr-visit-istanbul
name: "Visit Istanbul"
publisher: "İstanbul Büyükşehir Belediyesi, Turizm Şube Müdürlüğü (the metropolitan municipality, its tourism directorate)"
urls:
  home: https://visit.istanbul/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [places-of-worship, regional-food, parks-and-gardens, palaces-and-castles, archaeology, art-museums, architecture, historic-hotels-and-restaurants, landmarks, viewpoints, neighbourhoods, baths-and-spas, markets, theme-parks, history-museums]
tier: regional
unit: { level: city, code: TR-34, name: Istanbul }
row:
  identity: "none: a place is a heading inside a theme page"
  wikidata_link: none
  coordinates: none
  languages: [en, tr]
  signal: "being named on one of the theme pages"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Visit Istanbul (İstanbul Büyükşehir Belediyesi)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date"
  volume: "about thirty theme pages in the menu; Historical Places has 15 headings, Museums 25"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 0
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 6
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Visit Istanbul

The city's tourism portal, published by the metropolitan municipality. Looked at on 2026-10-02
because the Istanbul survey read it as one of its two sources from public bodies inside the
country.

**What it sorts its places into.** Theme pages, each a run of headings with a paragraph and a
picture. The menu: History & Architecture (Historical Places, Religious Heritage, Hidden Gems,
Bazaars, Nature, Cultural Heritage, Architecture); Art & Culture (Museums, Galleries); Like a
local (Balat, Kuzguncuk, Galata); Live Istanbul (Whats Happening, Theater & Stage, Concerts &
Gigs, Exhibitions, Festivals & Events); Enjoy (Istanbul With Children, Night Life); Taste (Sweet
Desire, Street Delicacies, Michelin Style, Bite & Drink, Global Cuisine, Vegan Food, Cocktail
Bar, Patisserie, Coffee Shops). Historical Places is cut into Palaces, Pavilions, Towers and
Castles. A place has no page, no id and no map point: it is a heading.

**Terms ([the access table](../site-access.md), 2026-10-02).** `visit.istanbul`: `allowed` (no
robots file (the address redirects to the home page); legal notice link is empty). `robots.txt`:
none (/robots.txt answers 302 to the home page: the site serves no robots file). Terms: no terms
page linked. The footer shows "Legal Notice" as a link with an empty address. Footer, read for
this record: "©2026 Telif Hakkı - İstanbul Büyükşehir Belediyesi Turizm Şube Müdürlüğü".

**What decides it.** Identity 0 and coordinates 0, so the verdict is `curator-list` whatever the
total of 6: a list a curator reads. The survey's notes say what it adds: the groves and gardens
residents use, the hans of the bazaar quarter, the minority houses of worship as a list of their
own. The page gives no address to write to; the rights holder is the municipality's tourism
directorate.

**What the survey measured.** It could be read: the home page and eleven theme pages;
`festival-events` names no event. The Istanbul survey of 2026-10-02 counted it on 105 of the 266
entries of `db/catalogue-coverage/expectations/istanbul.jsonl` (by type: place 90, food 12,
activity 2, drink 1). On 8 of them nothing else but the surveyor's own list names the entry.
Places among those: Church of St Mary of the Mongols; Ali Muhiddin Hacı Bekir; Hafız Mustafa
1864; Boukoleon Palace. The kinds in the front matter are those under which the survey filed two
or more of the entries it is named on.
