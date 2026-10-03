---
slug: jp-mapple
name: "Mapple Web (まっぷるウェブ)"
publisher: "Shobunsha (株式会社昭文社), publisher of the Mapple guidebooks"
urls:
  home: https://www.mapple.net/
  dataset: none
  api: none
  terms: https://www.mapple.net/term/
family: commercial
kinds: [places-of-worship, regional-food, festivals-and-events, parks-and-gardens, neighbourhoods, squares-and-streets, notable-works, seasonal-phenomena, towns-and-villages, palaces-and-castles, regional-drinks, art-museums, hiking-trails-and-walks, architecture, landmarks]
tier: regional
unit: { level: country, code: JP, name: Japan }
row:
  identity: "none for a place in the articles read; its spot database, a directory, was not read"
  wikidata_link: unknown
  coordinates: unknown
  languages: [ja]
  signal: "being named in an article by the guidebook's editors"
terms:
  licence: "none; terms, article 5: no reproduction, public transmission, translation or adaptation of the content"
  database_right: reserved
  attribution: "Mapple (Shobunsha)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "irregular: the article read was modified 2025-07-17"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Mapple Web

The website of a Japanese guidebook series, in Japanese, written by the series' editors. Looked
at on 2026-10-02 because the Kyoto survey read it as its Japanese-language guide. It is a
guidebook publisher's site; it has a record because it is the one source of the Kyoto list in
the country's own language, and its verdict is the one § 7.5 of `docs/tech/filling-a-kind.md`
gives the family.

**What it sorts its places into.** Articles: a basic guide to the city by season and by area,
model courses, area guides, selections by the editors, guides to shrines and temples and to
gardens. Beside them a database of spots, which the survey left unread as a directory.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.mapple.net`: `allowed`
(terms forbid reproduction; silent on automated reading). `robots.txt`: open (`*`: `Disallow:`
(empty); GumGum Verity has a crawl delay of 10, meta-externalagent is disallowed). Terms: silent
on automated reading, at https://www.mapple.net/term/. Article 5 forbids reproduction, public
transmission, translation and adaptation of the content; no article on crawlers, automated
access or AI (fetch tool's reading of the Japanese page).

**What decides it.** Identity 0 in the articles, so the verdict is `curator-list`; the total is
`unknown` because the coordinates were not looked at. The terms forbid reproduction and
adaptation: a curator reads it, and nothing of its text is taken.

**What the survey measured.** Seven articles read in Japanese, three of them by their headings
only. The Kyoto survey of 2026-10-02 counted it on 105 of the 246 entries of
`db/catalogue-coverage/expectations/kyoto.jsonl` (by type: place 68, event 11, food 10, activity
7, work 4, route 3, drink 2). On 1 of them nothing else but the surveyor's own list names the
entry. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.
