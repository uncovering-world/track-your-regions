---
slug: wikipedia-archaeological-sites-categories
name: English Wikipedia, the archaeological-sites categories by country
publisher: Wikimedia Foundation and the English Wikipedia community
urls:
  home: https://en.wikipedia.org/wiki/Category:Archaeological_sites_by_country
  dataset: https://en.wikipedia.org/wiki/Category:Archaeological_sites_by_country
  api: https://en.wikipedia.org/w/api.php
  terms: https://en.wikipedia.org/wiki/Wikipedia:Copyrights
family: global
kinds: [archaeology]
tier: world
unit: { level: any, code: none, name: "the world, as the editors themselves cut it by country and region" }
row:
  identity: "the article title, and the Wikidata item the article is about (`pageprops.wikibase_item`)"
  wikidata_link: tag
  coordinates: none
  languages: [en]
  signal: "editorial category membership — read as one vote, never as a door"
terms:
  licence: "CC BY-SA 3.0 (the article text); what is read is titles and Wikidata ids, which the licence does not reach"
  database_right: not-asserted
  attribution: "English Wikipedia (given wherever its judgement is shown)"
  scraping: not-needed
access:
  mode: api
  format: "MediaWiki Action API — `prop=categories` for one article's categories (the vote); `list=categorymembers` for the walk that was measured and not adopted"
  cadence: continuous
  volume: "1,236 categories under the root, 756 with articles; 9,440 articles carrying a Wikidata item; 905 at the place line (2026-09-15)"
  rate: "no quota published; the vote asks one question per fifty articles, a handful a run"
scorecard:
  date: 2026-09-15
  completeness: 1
  identity: 2
  coordinates: 0
  names: 1
  signal: 0
  terms: 2
  access: 2
  cadence: 2
  total: 10
  verdict: adoptable-with-curator-pass
status: adopted
issue: 895
looked_at: 2026-09-15
---

# English Wikipedia's shelf of archaeological sites

The museum door's category (`wikipedia-archaeological-museum-categories`) read for the digs,
and found to be a different thing: **a shelf that holds the living city beside the excavation**,
adopted by #895 as **one vote** in the site rule and refused as a door (ADR-0060 decisions 3
and 4).

## What was measured (2026-09-15)

The walk of `Category:Archaeological sites by country`, following every subcategory whose own
title reads `Archaeological sites in …` (the museum walk's rule), to four levels:

| what | count |
|---|---|
| categories read | 1,236 (the museum walk reads about 60) |
| articles carrying a Wikidata item | 9,440 |
| of those, at the place line (22 sitelinks) with a coordinate | 905 |
| already in the `archaeological site` class tree | 473 |
| **not in the tree — what a door would add** | **432** |
| of the 432, on the settlement branch | 190 |
| of the 432, stating a population | 251 |

The 432 by fame: Istanbul 290, Tbilisi 227, Yerevan 211, Sanaa 173, Thessaloniki 157,
Samarkand 149, Catania 139, Tabriz 133 — the editors file the city whose ground holds
antiquity beside the dig itself (Athens sits in `Archaeological sites in Attica`), and a
country nests its shelf by period and by type (`Bronze Age sites in Jordan`, `Historical parks
of Thailand`), which the strict rule does not follow and a looser one cannot tell from
`Heritage-listed buildings and structures by country`, a sibling at the root.

Read against OpenStreetMap on those 432: 233 carry a living-place object, 173 nothing this
kind reads, and 26 a ruin tag in the strict sense — Jerash (the city item carries
`historic=archaeological_site`), Lagash, Kilwa Kisiwani, Nola, Luni, Zvartnots, Qalhat,
Silbury Hill, Písac, Spiennes, Beit Guvrin, the Great Wall of Gorgan, beside Ashdod, six
castles under `ruins=yes` and the Tower of David. Of the places #895 opened with, the walk
names Jerash, Sukhothai, Ayutthaya and Nemrut; Ajanta and Sanchi are filed under no
archaeological-sites category at all (`Buddhist caves in Maharashtra`, `Rock-cut architecture
of India`).

## How it is read

**As the second vote for a living place the map named**, and nothing more (ADR-0060 decision
3): a candidate OpenStreetMap tags as a dig, with no class under the tree, that states a
population and is not World Heritage itself, has its own article's categories read — the
museum door's `fetchWikipediaCategories`, fifty titles a question, a handful of titles a run —
and `Archaeological sites in …` on it lifts the population veto. Jerash, Lagash, Kilwa
Kisiwani, Qalhat, Písac and León Viejo come in this way; Ashdod is the measured false
positive, one card for a curator. **The walk is not run.**

## How the scorecard was read

`docs/tech/filling-a-kind.md` § 6.2 on its world-tier sense. **Signal 0** because being on this
shelf is not a statement that the thing is a dig — the shelf holds Istanbul — where the museum
shelf's 1 is a real editorial judgement of what a museum is about. **Coordinates 0** and
**names 1** as for the museum shelf: everything about the place is Wikidata's. **Completeness
1**: a country's shelf holds what an editor filed there, by whatever period or type they
chose to nest it under.

## Terms

As for the museum categories: CC BY-SA 3.0 covers the article text, and no article text is
read — titles and Wikidata ids only. The category name is what the card quotes as the reason
the vote was given.

## What this source cannot reach

- A dig whose article is filed by period, type or culture and never under the country shelf
  (Ajanta, Sanchi).
- A dig with no English article, or one filed under the living town's article alone (Gerasa
  under "Jerash"): the vote is given to the town's item, which is what the map named.
