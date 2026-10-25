---
slug: atlas-obscura
name: Atlas Obscura's places, read as Wikidata's Atlas Obscura place ID
publisher: Atlas Obscura (the listing); the link to it is Wikidata's (P7772), under CC0
urls:
  home: https://www.atlasobscura.com/
  dataset: none (the links are read from the Wikidata JSON dump)
  api: none
  terms: https://www.atlasobscura.com/terms
family: commercial
kinds: [public-art, monuments-and-memorials, art-museums, archaeology, places-of-worship, bridges-and-engineering, towers, history-museums, science-and-nature-museums, specialty-museums]
tier: world
unit: { level: any, code: none, name: any }
row:
  identity: "Atlas Obscura's place slug (places/cadillac-ranch); Wikidata's P7772 carries it on 17,638 items in the dump of 2026-10-19, 16,334 of them with a coordinate"
  wikidata_link: P7772
  coordinates: most
  languages: [en]
  signal: "being listed: an editorial selection of curious and remarkable places, read as the presence of the identifier on an item"
terms:
  licence: "for the signal: Wikidata's CC0 statement; the site's own terms page answered 403 on 2026-10-25 and was not read"
  database_right: unknown
  attribution: "none needed for the Wikidata statement; nothing of the site is shown"
  agent: allowed
  agent_rests_on: "site-access.md, www.atlasobscura.com, read 2026-10-02: nothing refuses it"
  program: allowed
  program_rests_on: "read only as Wikidata's P7772 statements, CC0, from the dump; the site itself is not called"
  model: none
access:
  mode: dump
  format: "the P7772 statements of the Wikidata JSON dump"
  cadence: "continuous on Wikidata; monthly in the dump"
  volume: "17,638 items"
  rate: none
scorecard:
  date: 2026-10-25
  completeness: 1
  identity: 2
  coordinates: 1
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 12
  verdict: adoptable
status: looked-at
issue: 1977
looked_at: 2026-10-25
---

# Atlas Obscura, read through Wikidata

A guide to curious and remarkable places: odd museums, outsider art, follies, famous fountains
and murals, ruins and engineering. Looked at by #1977 as a signal of fame for the kinds where
Wikipedia's editions miss what a traveller goes to see. It is never read as a site. What the
catalogue would use is the fact that a Wikidata item carries an Atlas Obscura place ID. That
fact is a Wikidata statement under CC0, written by Wikidata's editors, and is read from the
dump.

**What was measured (2026-10-25)**, on the dump of 2026-10-19 and the canons of #1864:

- **On the canons.** Atlas Obscura marks 20 of the 34 Public art canon entries under the 22-edition
  line, and no other travel platform marks one it does not. Among them are the Crown Fountain
  (13 editions), Cadillac Ranch (10), the Kelpies (17), Salvation Mountain (10), Spoonbridge and
  Cherry (2), Escadaria Selarón (11) and Puppy in Bilbao (9). It also marks 11 of the 29
  Monuments & memorials entries the kind does not offer, among them the Monument to the Battle
  of the Nations, Patuxai and the Canadian National Vimy Memorial, and 13 of the 49 Art Museums
  entries the kind does not offer.
- **On the catalogue.** It sits on 48 % of the admitted Public art and 34 % of the admitted
  Monuments & memorials.
- **How selective it is.** Of the 16,334 places with a coordinate that carry it, a Wikivoyage
  edition uses 43.9 %, against 2.0 % of all places. Of the 1,050 sculptures, statues, murals and
  fountains among them, 64 have 20 or more Wikipedia editions, so as a gate for Public art it
  brings about a thousand places, the canon's misses among them.

**Completeness.** It is a selection, not a register. It is strongest in the United States
(5,775 of the places) and the United Kingdom (1,846), and the link is as complete as
Wikidata's editors made it: a place Atlas Obscura lists may lack the statement.

**Terms.** `robots.txt` on www.atlasobscura.com closes `/search`, `/admin` and editing paths
to every agent and leaves `/places/` open. The terms page answered 403 to the fetch on
2026-10-25, as it is noted in `site-access.md`, so no page of the site is counted on. The
score of 2 for terms is the Wikidata statement's: nothing of Atlas Obscura's is copied or shown.
