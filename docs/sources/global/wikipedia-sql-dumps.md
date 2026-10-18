---
slug: wikipedia-sql-dumps
name: English Wikipedia's structure, from its SQL dumps
publisher: Wikimedia Foundation and the English Wikipedia community
urls:
  home: https://dumps.wikimedia.org/enwiki/
  dataset: https://dumps.wikimedia.org/enwiki/
  api: https://dumps.wikimedia.org/enwiki/<date>/dumpstatus.json (the files and their checksums, once a job is done)
  terms: https://dumps.wikimedia.org/legal.html
family: global
kinds: [archaeology]
tier: world
unit: { level: any, code: none, name: "every English Wikipedia article and category" }
row:
  identity: "the page id and title, and the Wikidata item the page is about (`page_props.wikibase_item`)"
  wikidata_link: tag
  coordinates: none
  languages: [en]
  signal: "editorial category membership"
terms:
  licence: "CC BY-SA 4.0 and GFDL (Wikipedia's text); what is kept is titles, Wikidata ids and which category a page is filed under"
  database_right: not-asserted
  attribution: "English Wikipedia contributors, CC BY-SA 4.0 (given wherever a judgement read from the categories is shown)"
  scraping: not-needed
access:
  mode: dump
  format: "MySQL `INSERT` statements, gzipped, one table a file: `page`, `page_props`, `linktarget`, `categorylinks`"
  cadence: "twice a month; the 2026-10-01 dump's tables were done by 2026-10-08"
  volume: "6.9 GB gzipped for the four files of 2026-10-01"
  rate: "the dump host's rules (`docs/tech/dumps.md` § The host's rules): at most three connections, the bot User-Agent"
scorecard:
  date: 2026-10-18
  completeness: 2
  identity: 2
  coordinates: 0
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 1
  total: 11
  verdict: adoptable
status: adopted
issue: 1440
looked_at: 2026-10-18
---

# English Wikipedia's structure, from its SQL dumps

The structure the Archaeology run reads from English Wikipedia: which category an article is filed under, and what a category holds. Until now it was asked of the live Action API (`wikipedia-archaeological-museum-categories.md`). The dumps hold the same structure for every article and category of one date, so a walk over hundreds of categories needs no requests (#1440, ADR-0121).

**The terms.** The host's licence page (dumps.wikimedia.org/legal.html, read on 2026-10-18) says the dumps' "original textual content is licensed under" the GFDL and CC BY-SA 4.0. What the build keeps is titles, page ids, Wikidata ids and category membership. These are facts about the articles rather than their text. The project still credits English Wikipedia's contributors under CC BY-SA 4.0 wherever a judgement read from the categories is shown, as the live record does.

**Status.** `adopted` by #1440: the Archaeology run (`experience_sources` id 5) reads its category walk and its category vote from the copy when it reads Wikidata from the local subset and a copy is built (`wikipediaStructure.ts`), and the live API otherwise (`wikipedia-archaeological-museum-categories.md`).

**What is kept** is ADR-0121's: the articles and categories that are not redirects, their Wikidata items, the categories that are not hidden, and each article's and category's links to those. `docs/tech/dumps.md` § English Wikipedia's structure has the tables and the build.

**Scorecard notes.**
- **Completeness: 2.** Every article and category of the dump date.
- **Cadence: 1.** A dump trails the live wiki by days, up to about three weeks.
- **Names: 1.** English titles only.
