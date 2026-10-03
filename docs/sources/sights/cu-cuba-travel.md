---
slug: cu-cuba-travel
name: "Cuba Travel, Portal del Turismo de Cuba"
publisher: "Ministerio de Turismo de Cuba (the access table's reading; the pages read for this record name no publisher)"
urls:
  home: https://www.cuba.travel/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [squares-and-streets, beaches-and-swimming, regional-food, historic-hotels-and-restaurants, festivals-and-events, entertainment-venues, palaces-and-castles, public-art, art-museums, neighbourhoods, architecture, intangible-heritage, parks-and-gardens, regional-drinks, world-heritage, places-of-worship, history-museums, viewpoints, famous-peoples-places, historic-houses, towns-and-villages, shows-and-performances, outdoor-activities, live-music-venues]
tier: regional
unit: { level: country, code: CU, name: Cuba }
row:
  identity: "none: a place is an entry on a theme page of its destination"
  wikidata_link: none
  coordinates: address-only
  languages: [es, en, fr, de, ru]
  signal: "being listed on a destination's theme page"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Cuba Travel"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date"
  volume: "16 destinations on the home page; Havana has a destination page and theme pages under it"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 1
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 7
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Cuba Travel

The country's tourism portal, in Spanish with English, French, German and Russian editions.
Looked at on 2026-10-02 because the Havana survey read it as its source from a public body
inside the country, and it named more of the survey's list than any guide.

**What it sorts its places into.** Sixteen destinations, from Pinar del Río to Baracoa, each
with "Sobre" pages (geography, nature, society, history, and a cultural scene of music, cinema,
literature, visual arts, dance, theatre and architecture) and "Qué hacer" pages. The themes of
"¿Qué hacer en Cuba?" are Sol y Playa, Cultura, Ciudad, Excursiones, Náutica, Naturaleza, Salud,
Eventos and Golf. Havana's Cultura page, the one read for the row, is a list under the headings
"Programa Cultural de la Oficina del Historiador", "Museos" and "Centros culturales y Casas de
la Música": each museum with its founding date, collections, opening hours, street address and
telephone, and no page, id or map point of its own.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.cuba.travel`: `allowed`
(robots open; no terms linked). `robots.txt`: open (`*` disallows DotNetNuke system folders,
user and docs paths and query parameters; other groups carry crawl delays of 2 and 5 for named
bots). Terms: no terms page linked. No terms link in the footer.

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 7. With
no licence stated the terms are 1: ask first. The Havana page gives info@habana.infotur.tur.cu;
the site's own contact is a form (`/topnavigation/contacto`).

**What the survey measured.** It could be read: the Havana destination page and sixteen
sub-pages. Its restaurant page, a directory of some three hundred places, was never counted, and
neither was the Cultura page above where it was the only page naming a thing. `cubatravel.cu`,
the other address, refused the survey's connection and this record's. The Havana survey of
2026-10-02 counted it on 105 of the 192 entries of
`db/catalogue-coverage/expectations/havana.jsonl` (by type: place 79, food 8, activity 7, event
7, drink 3, route 1). On 24 of them nothing else but the surveyor's own list names the entry.
Places among those: Acuario Nacional de Cuba; Cueva del Indio; Estadio Latinoamericano;
ExpoCuba; Iglesia de San Francisco de Paula. The kinds in the front matter are those under which
the survey filed two or more of the entries it is named on.
