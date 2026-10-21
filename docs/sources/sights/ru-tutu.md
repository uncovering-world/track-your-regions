---
slug: ru-tutu
name: "Tutu.ru travel guide (Туту.ру, раздел «Путеводитель»)"
publisher: "ООО «Новые Туристические Технологии» (Moscow), licensee of www.tutu.ru; rights holder Globus Media LLC"
urls:
  home: https://www.tutu.ru/geo/rossiya/kurort/moscow/
  dataset: none
  api: none
  terms: https://www.tutu.ru/2read/legal_information/legal_tuturu/
family: commercial
kinds: [parks-and-gardens, art-museums, places-of-worship, history-museums, squares-and-streets, architecture, regional-food, palaces-and-castles, public-art, science-and-nature-museums, festivals-and-events, entertainment-venues, tours-and-cruises, world-heritage, markets, tombs-and-mausoleums, zoos-and-aquariums, city-gates-and-walls, towers, viewpoints, notable-works]
tier: regional
unit: { level: any }
row:
  identity: "the site's own page per sight (/geo/<country>/<city>/article/<slug>_sight/); no id exposed"
  wikidata_link: none
  coordinates: none
  languages: [ru]
  signal: "being numbered in a city's top list of sights, or written up in its city guide"
terms:
  licence: "the site's user agreement: its materials may not be reproduced or copied without the rights holder's leave; personal non-commercial use allowed"
  database_right: reserved
  attribution: "Туту.ру"
  scraping: reserved
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date"
  volume: "a sights list per city (13 numbered and 49 further sights for Moscow), a city guide page, a page per sight"
  rate: unknown
scorecard:
  date: 2026-10-16
  completeness: 1
  identity: 0
  coordinates: 0
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 5
  verdict: curator-list
status: looked-at
issue: 1600
looked_at: 2026-10-16
---

# Tutu.ru travel guide

The travel guide a Russian booking company keeps on its own site, beside its train, bus and air
tickets: a guide page per city, a numbered list of sights per city and a page per sight. Looked
at on 2026-10-16 because the Moscow survey read it as its source from inside the country, after
Moscow's own tourism portals (Russpass, Discover Moscow, mos.ru) turned out to be closed to
Anthropic's agents by their `robots.txt`.

**What it sorts its places into.** For Moscow: a page titled as a top 28 of sights, which numbers
13 and lists 49 more under "Больше достопримечательностей"; a city guide page with sections on
what to see, the parks, food, events and excursions; a page per sight, such as Red Square and the
Kremlin. A place has no id and no map point on the pages read.

**Terms ([the access table](../site-access.md), 2026-10-16).** `www.tutu.ru`:
`allowed` (closed paths not read). `robots.txt`: `User-Agent: *` with service paths and
`/geo/*?` closed; the guide pages read are open. Terms: the user agreement at
`/2read/legal_information/legal_tuturu/` has no clause on automated access, robots, scraping,
mining or AI. § 6.1 asks the user "не воспроизводить, не копировать, не повторять, не продавать и
не перепродавать", and § 6.3 bars "воспроизведение, копирование, переработка, распространение" of
the site's materials without the rights holder's leave, allowing personal non-commercial use. A
bar on copying, kept as such: names were recorded and no description copied.

**What decides it.** Identity 0 and coordinates 0, so the verdict is `curator-list` whatever the
total. The materials may not be reused without leave: ask first.

**What the survey measured.** Three pages by fetch, in Russian: the Moscow sights list, the Moscow
city guide, the Red Square and Kremlin page. The Moscow survey of 2026-10-16 counted it on 90 of the 197 entries of `db/catalogue-coverage/expectations/moscow.jsonl`. The
kinds in the front matter are those under which the survey filed two or more of the entries it is
named on.
