---
slug: mx-mexico-city-cdmx
name: "Mexico City, la guía oficial de los viajeros (mexicocity.cdmx.gob.mx)"
publisher: "Gobierno de la Ciudad de México"
urls:
  home: https://mexicocity.cdmx.gob.mx/
  dataset: none
  api: none
  terms: https://mexicocity.cdmx.gob.mx/terms-of-use/
family: tourism-board
kinds: [squares-and-streets, historic-hotels-and-restaurants, art-museums, neighbourhoods, archaeology, notable-works, parks-and-gardens, festivals-and-events, markets, places-of-worship, architecture, regional-food, entertainment-venues, history-museums, public-art, sports-venues, world-heritage, specialty-museums, famous-peoples-places, palaces-and-castles, science-and-nature-museums, tours-and-cruises, regional-drinks, historic-houses, theme-parks]
tier: regional
unit: { level: city, code: MX, name: "Mexico City" }
row:
  identity: "the site's page per venue (/venues/<slug>/); no id exposed"
  wikidata_link: none
  coordinates: some
  languages: [es, en, fr, zh]
  signal: "being one of its hundred 'experiencias imperdibles', sorted into eight circuits"
terms:
  licence: "none; terms of use: information may be printed, copied or stored for strictly personal use"
  database_right: reserved
  attribution: "Gobierno de la Ciudad de México"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: no date on the pages read"
  volume: "100 'experiencias imperdibles' in eight circuits; 63 venues with a point on the Centro Histórico circuit's page"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 2
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

# Mexico City, the city's guide for travellers

The city government's tourism site, in Spanish with English, French and Chinese editions. Looked
at on 2026-10-02 because the Mexico City survey read it as the city's own source.

**What it sorts its places into.** "Experiencias imperdibles", a hundred of them, in eight
circuits: Centro Histórico; Chapultepec y Paseo de la Reforma; Coyoacán y Xochimilco; Barrios
Modernos: Roma, Condesa y Polanco; San Ángel y sus alrededores; Sitios Religiosos y
Arqueológicos; Experiencias Únicas y Familiares; Mercados y Gastronomía. Beside them the night
city, food, sport, and numbered walking routes. A circuit's page is a map with a card per venue:
the copy of the Centro Histórico page the survey saved holds 63 points, each a latitude and
longitude with a link to the venue's own page (`/venues/<slug>/`). The site also keeps a
directory of every venue, which the survey counted for nothing.

**Terms ([the access table](../site-access.md), 2026-10-02).** `mexicocity.cdmx.gob.mx`:
`allowed` (terms silent on automated reading). `robots.txt`: open (`*`: /wp-admin/ only). Terms:
silent on automated reading, at https://mexicocity.cdmx.gob.mx/terms-of-use/. "you may print,
copy, or store information, provided that it is for strictly personal use" (fetch tool's
quotation, section VII). Nothing on automated access.

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total, which is
`unknown`: the one circuit page looked at carries a point on every card, and the other seven
were not looked at for points. It is the regional tier's shape with a cut the city made itself;
what it lacks is a number per venue. The terms allow storing for strictly personal use: ask
first.

**What the survey measured.** By fetch: the page of the hundred and its eight circuits, the
city's "top", the Day of the Dead page, the seasons, "Delicias chilangas", museums, the guide by
zones, the itinerary pages and the introduction of the night city; the venue directory, the PDF
guide and the calendar were not counted or not opened. The Mexico City survey of 2026-10-02
counted it on 166 of the 252 entries of `db/catalogue-coverage/expectations/mexico-city.jsonl`
(by type: place 130, work 11, event 9, activity 7, food 6, drink 2, route 1). On 7 of them
nothing else but the surveyor's own list names the entry. Places among those: Hemiciclo a
Juárez; Museo Nacional de las Intervenciones (ex-convento de Churubusco); Isla de las Muñecas
(Xochimilco); Churrería El Moro. The kinds in the front matter are those under which the survey
filed two or more of the entries it is named on.
