---
slug: ru-tonkosti
name: "Тонкости туризма (tonkosti.ru)"
publisher: "ООО «Тонкости продаж»"
urls:
  home: https://tonkosti.ru/Москва
  dataset: none
  api: none
  terms: https://tonkosti.ru/Авторские_права
family: commercial
kinds: [places-of-worship, parks-and-gardens, palaces-and-residences, castles-and-fortresses, art-museums, history-museums, squares-and-streets, architecture, famous-peoples-places, regional-food, science-and-nature-museums, towns-and-villages, festivals-and-events, world-heritage, markets, tombs-and-mausoleums, zoos-and-aquariums, specialty-museums, historic-houses, shops]
tier: regional
unit: { level: any }
row:
  identity: "the site's own page per place, a wiki title (/<Title>); no id exposed"
  wikidata_link: none
  coordinates: some
  languages: [ru]
  signal: "being written up on the city's page, or carrying the catalogue's «самое-самое» tag"
terms:
  licence: "the site's copyright page (Авторские права); the access table finds it silent on automated reading"
  database_right: unknown
  attribution: "Тонкости туризма"
  scraping: unknown
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date"
  volume: "a city page with sub-pages per theme; the Moscow sights catalogue runs to 19 pages"
  rate: unknown
scorecard:
  date: 2026-10-16
  completeness: 2
  identity: 0
  coordinates: 1
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 7
  verdict: curator-list
status: looked-at
issue: 1600
looked_at: 2026-10-16
---

# Тонкости туризма

A Russian-language travel guide to the whole world, written in Russia and laid out as a wiki: a
page per country, city and sight, and a magazine. Earlier surveys read it as the guide in Russian
for Samarkand, Yerevan, Isfahan, Havana and Zanzibar; this record was written on 2026-10-16
because the Moscow survey read it as a source from inside the country as well as its guide in
Russian.

**What it sorts its places into.** For Moscow: the city page, with sections on the sights, the
museums, the monasteries, the parks and estates, food, events and trips out of town, and sub-pages
per theme (museums, theatres, churches, monasteries, parks, estates, baths, boulevards, the metro,
Moscow City, the Arbat, the zoo, the river cruises). The sights page names its own top in prose
and tags a selection «самое-самое» in a catalogue of 19 pages, of which the survey read the first.
A place has a page of its own; some carry a map.

**Terms ([the access table](../site-access.md), 2026-10-02).** `tonkosti.ru`: `allowed`.
`robots.txt`: open; service paths, MediaWiki namespaces and query strings are closed, and one
agent (Riddler) is disallowed whole. Terms: silent on automated reading, at
https://tonkosti.ru/Авторские_права.

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total.

**What the survey measured.** Three pages by fetch, in Russian: Москва, Достопримечательности
Москвы and Праздники и события Москвы. The Moscow survey of 2026-10-16 counted it on 95 of the 197 entries of `db/catalogue-coverage/expectations/moscow.jsonl`. The
kinds in the front matter are those under which the survey filed two or more of the entries it is
named on.
