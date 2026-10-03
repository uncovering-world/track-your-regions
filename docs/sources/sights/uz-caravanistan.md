---
slug: uz-caravanistan
name: Caravanistan
publisher: "Alma Media BV (Mechelen, Belgium)"
urls:
  home: https://caravanistan.com/uzbekistan/center/samarkand/
  dataset: none
  api: none
  terms: https://caravanistan.com/terms-conditions/
family: commercial
kinds: [places-of-worship, tombs-and-mausoleums, famous-peoples-places, historic-colleges, day-trips-and-itineraries, history-museums, markets]
tier: regional
unit: { level: country, code: UZ, name: Uzbekistan }
row:
  identity: "none: a place is a heading or a paragraph inside its city's page"
  wikidata_link: none
  coordinates: some
  languages: [en]
  signal: "being written up on the city's page"
terms:
  licence: "CC BY-SA 4.0 (the site footer)"
  database_right: share-alike
  attribution: "Caravanistan, CC BY-SA 4.0"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "irregular: the Samarkand page was last modified 2025-05-20"
  volume: "one page per city or area"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 1
  names: 0
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: 6
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Caravanistan

A travel guide to Central Asia and the Silk Road, written since 2011 by two people, one from
Kazakhstan and one from Belgium, and owned by a Belgian company; it earns from matching
travellers with tour operators and from car rental. Looked at on 2026-10-02 because the
Samarkand survey read it as a guide written from inside the region. It is filed under Uzbekistan
because the pages read were Uzbekistan's; the guide has a chapter each for Kazakhstan,
Kyrgyzstan, Tajikistan, Turkmenistan and Uzbekistan.

**What it sorts its places into.** One long page per city. The Samarkand page runs History;
Things to see and do, with Architecture, Museums and two headings for things to do;
Accommodation and transport; Food; and Around Samarkand, a heading per outing. A place is a
paragraph, some with a link to a Google Maps place or an OpenStreetMap node.

**Terms ([the access table](../site-access.md), 2026-10-02).** `caravanistan.com`: `allowed`
(robots.txt redirects in a loop; terms silent on automated reading; content under CC BY-SA 4.0).
`robots.txt`: unavailable (https://caravanistan.com/robots.txt answers 301 to /robots.txt/,
which answers 301 back to /robots.txt: a loop. No file can be read. (RFC 9309 §2.3.1.2 lets a
crawler treat more than five redirects as an unavailable file.)). Terms: allow reuse, at
https://caravanistan.com/terms-conditions/. No sentence on robots, automated access, mining or
AI. Last updated 2 January 2026. The clause, as the table has it: "Caravanistan is licensed
under a Creative Commons Attribution-ShareAlike 4.0 International License." The Terms &
Conditions ("Last updated: January 02, 2026"), read for this record, are about bookings,
liability and what users post; no clause read there takes the footer's licence back.

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 6. It is
the one source of this family with an open licence, and the licence is share-alike: a record
with an identity would be a `hold` until the catalogue has answered what copying CC BY-SA text
binds (`docs/tech/filling-a-kind.md` § 5). A curator reading it and writing the catalogue's own
words copies nothing.

**What the survey measured.** It could be read: the Samarkand and Shahrisabz pages. The
Samarkand survey of 2026-10-02 counted it on 40 of the 94 entries of
`db/catalogue-coverage/expectations/samarkand.jsonl` (by type: place 35, route 2, drink 1,
activity 1, food 1). On 6 of them nothing else but the surveyor's own list names the entry. The
kinds in the front matter are those under which the survey filed two or more of the entries it
is named on.
