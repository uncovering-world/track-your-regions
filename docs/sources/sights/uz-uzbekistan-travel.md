---
slug: uz-uzbekistan-travel
name: "Uzbekistan.travel, the National Tourist Information Center"
publisher: "State Unitary Enterprise \"National PR-centre\" (Tashkent), established by presidential decree PD-5326 of February 2018"
urls:
  home: https://uzbekistan.travel/en/
  dataset: none
  api: none
  terms: https://uzbekistan.travel/ru/polzovatelskoe-soglashenie/
family: tourism-board
kinds: [places-of-worship, tombs-and-mausoleums, regional-food, historic-colleges, famous-peoples-places, world-heritage, intangible-heritage]
tier: regional
unit: { level: country, code: UZ, name: Uzbekistan }
row:
  identity: "the site's own page per place (/en/o/<slug>/); no id exposed"
  wikidata_link: none
  coordinates: some
  languages: [uz, ru, en, zh, es, ar, it, pt, ja, tr, de, ms, hi, fr]
  signal: "being listed under Attractions, the state's own selection, sorted into sections"
terms:
  licence: "the site's own License Agreement (May 2020): one-time private or commercial use of its digital content for the purposes it lists; its user agreement bars automated scripts for mass copying"
  database_right: reserved
  attribution: "none stated; the rights holder is the National PR-centre"
  scraping: reserved
access:
  mode: scrape
  format: html
  cadence: "unknown: place pages carry no date"
  volume: "36 places on the Attractions page read; 8 linked from the Samarkand page"
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

# Uzbekistan.travel

The state's tourism site, run by the National PR-centre, a state unitary enterprise set up in
2018 "to show the world all the beauty of our country" (its About page). Looked at on 2026-10-02
because the Samarkand survey read it as its one source from a public body inside the country.

**What it sorts its places into.** A page per city (`/en/i/<city>/`, sixteen cities in the menu)
with "Top attractions", "Gifts and souvenirs", "Kitchen" and "Photo zones"; a page per region
(`/en/r/<region>/`); and Attractions (`/en/c/attractions/`), whose sections are Landmarks &
Attractions, Mysterious Uzbekistan, Recreation areas, Resorts, Mausoleums, Madrasah, Mosques,
Monuments, Museums, National parks and reserves, Ziyarat places, Amusement parks, Natural areas,
Palaces, Craftsmen of Uzbekistan, Sanatoriums, Theaters, Thematic parks, Touristic villages and
Yurt Camps. "Ziyarat places", the pilgrimage places, is a section of its own, which the survey's
notes remark on. A place has its own page (`/en/o/<slug>/`): on the one read, Registan Square, a
text and a Google Maps embed whose address carries the point. The pages exist in fourteen
languages.

**Terms ([the access table](../site-access.md), 2026-10-02).** `uzbekistan.travel`: `allowed`
(no robots file; user agreement forbids automated scripts for mass copying). `robots.txt`: none
(/robots.txt answers 301 to /ru/robots.txt/, which answers 404). Terms: bar mass copying by
script, at https://uzbekistan.travel/ru/polzovatelskoe-soglashenie/. User agreement, in a list
of what users may not do; the bar is on automated scripts for mass copying, not on automated
reading as such. The agreement also lets visitors use the site's data for lawful purposes
without special permission (fetch tool's reading). The footer also links a licence agreement
(/ru/licenzionnoe-soglashenie/), not read. The clause, as the table has it: "Использовать
автоматизированные скрипты для массового копирования материалов." Read for this record on
2026-10-02, beside the table: the English License Agreement (`/en/license-agreement/`, "latest
version … May 2020"), which the table lists as not read. "The company is the owner of exclusive
rights both to the site as a whole and to its individual parts, including all types of Digital
content: logos, trademark names, texts, articles, … programs, databases." Its content "CAN be
used … for websites, Newspapers, magazines and TV shows that provide positive/neutral coverage
of Uzbekistan"; the grant is "the right to one-time private and / or commercial use". Footer:
"Copyright © 2018-2026 National PR-centre".

**What decides it.** Identity 0: a page per place and no id, so by § 6.2 of
`docs/tech/filling-a-kind.md` the verdict is `curator-list`, whatever the total of 7: a list a
curator reads. The licence allows reuse on a condition a catalogue cannot promise (coverage the
publisher finds positive or neutral), so the terms are 1, ask first. The address to write to:
info@nationalprcentre.com, 18 Oybek St., Tashkent 100015.

**What the survey measured.** It could be read: the Samarkand and Shakhrisabz city pages, the
Samarkand region page, the Ziyarat places section, three place pages and two theme pages;
`/en/c/samarkand/` answered 404. Two counts were withdrawn in the second pass: one taken from
the Ziyarat index, a directory, and one from a search that carried the name. The Samarkand
survey of 2026-10-02 counted it on 35 of the 94 entries of
`db/catalogue-coverage/expectations/samarkand.jsonl` (by type: place 25, food 7, activity 2,
event 1). On 1 of them nothing else but the surveyor's own list names the entry. Places among
those: Amankutan gorge. The kinds in the front matter are those under which the survey filed two
or more of the entries it is named on.
