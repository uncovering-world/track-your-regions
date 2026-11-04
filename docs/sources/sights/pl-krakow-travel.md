---
slug: pl-krakow-travel
name: "Krakow.travel"
publisher: "Krakowskie Biuro Festiwalowe (the City of Kraków's tourism portal)"
urls:
  home: https://krakow.travel/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: []
tier: regional
unit: { level: city, code: PL, name: Kraków }
row:
  identity: "a page per place of its guide, listed under category pages of every place of a type"
  wikidata_link: none
  coordinates: unknown
  languages: [en, pl]
  signal: none
terms:
  licence: "none named; the footer asserts copyright (\"Copyright 2016 Krakowskie Biuro Festiwalowe\")"
  database_right: unknown
  attribution: "Krakow.travel (the City of Kraków), named with a link to the page quoted"
  agent: allowed
  agent_rests_on: "site-access.md, krakow.travel, read 2026-11-04: robots.txt answers 404 to the fetch tool and to an ordinary client alike; no terms page is linked"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: unknown
  volume: "category pages of every place of a type, and a tours page"
  rate: none
scorecard:
  date: 2026-11-04
  completeness: unknown
  identity: 1
  coordinates: unknown
  names: unknown
  signal: 0
  terms: 1
  access: 1
  cadence: unknown
  total: unknown
  verdict: provisional
status: looked-at
issue: 2325
looked_at: 2026-11-04
---

# Krakow.travel

The City of Kraków's tourism portal. Looked at on 2026-11-04 because the Kraków survey (#2325)
read it as a source from inside the country, beside the Polish Tourism Organisation
([pl-poland-travel](pl-poland-travel.md)).

**What it sorts its places into.** Category pages of its guide, each listing every place of a
type, and a tours page.

**Terms ([the access table](../site-access.md), 2026-11-04).** `krakow.travel`: `allowed`. Its
`robots.txt` answers 404, to the fetch tool and to an ordinary client alike; no usage signal, and
`/.well-known/tdmrep.json` answers 404; no terms page is linked, only an accessibility statement.

**What the survey measured.** It read the guide's category pages and the tours page and counted
the portal on none of the 145 entries of `db/catalogue-coverage/expectations/krakow.jsonl`: a list
of every place of a type recommends nothing, and the tours page names almost no place. So it
carries no signal and no kinds.
