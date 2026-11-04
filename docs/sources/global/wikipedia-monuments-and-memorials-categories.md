---
slug: wikipedia-monuments-and-memorials-categories
name: English Wikipedia, the monuments-and-memorials categories by place
publisher: Wikimedia Foundation and the English Wikipedia community
urls:
  home: https://en.wikipedia.org/wiki/Category:Monuments_and_memorials_by_country
  dataset: https://dumps.wikimedia.org/enwiki/
  api: none
  terms: https://dumps.wikimedia.org/legal.html
family: global
kinds: [monuments-and-memorials]
tier: world
unit: { level: any, code: none, name: "the world, as the editors cut it by country, region and city" }
row:
  identity: "the article title, and the Wikidata item the article is about (`page_props.wikibase_item`)"
  wikidata_link: tag
  coordinates: none
  languages: [en]
  signal: "editorial category membership — a witness that the place is visited as a monument, not a statement of what it is"
terms:
  licence: "CC BY-SA 4.0 and GFDL (Wikipedia's text); what is read is titles, Wikidata ids and which category a page is filed under"
  database_right: not-asserted
  attribution: "English Wikipedia contributors, CC BY-SA 4.0 (given wherever a judgement read from the categories is shown)"
  agent: unknown
  agent_rests_on: "no line in site-access.md: read from the dump copy, not from pages an agent reads"
  program: allowed
  program_rests_on: "a published dump under its publisher's rules (ADR-0148): the copy of English Wikipedia's structure built from its SQL dumps (wikipedia-sql-dumps.md); titles and items are kept, not text"
  model: none
access:
  mode: dump
  format: "the copy of English Wikipedia's category structure (ADR-0121): `enwiki_categories`, `enwiki_category_links`, `enwiki_pages`, `enwiki_page_items`"
  cadence: "the copy's: twice a month upstream, rebuilt when a dump is taken"
  volume: "826 categories matching `^Monuments_and_memorials_(in|of)_`, filing 6,127 items directly (copy of 2026-10-01)"
  rate: none
scorecard:
  date: 2026-11-04
  completeness: 1
  identity: 2
  coordinates: 0
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 1
  total: 10
  verdict: adoptable-with-curator-pass
status: adopted
issue: 2171
looked_at: 2026-11-04
---

# English Wikipedia's shelf of monuments and memorials

The categories that name a monument Wikidata types as something else. Mount Rushmore is typed a
mountain, Patuxai a built structure and the Monument to the Battle of the Nations a heritage
ensemble; none carries a commemorative statement, so no class of Monuments & memorials reaches
them. English Wikipedia files each directly under a *Monuments and memorials in …* category:
*in South Dakota*, *in Laos*, *in Germany*. Adopted by #2171 as an **entrance** of the kind,
every arrival for a curator (`docs/tech/experiences.md` § Public art and Monuments & memorials,
**Monuments English Wikipedia files and Wikidata types as something else**).

## What was measured (2026-11-04)

On the copy of the structure of 2026-10-01 and the development subset of 2026-10-19, read-only:

| what | count |
|---|---|
| categories matching `^Monuments_and_memorials_(in\|of)_` | 826 |
| items filed directly under one of them | 6,127 |
| of those, at 15 Wikipedia editions or more | 317 |
| of the 317, in the catalogue under no kind | 106 |

By continent the raw tree is tilted: Europe and the US and Canada are 73% of its items with a
country, and Africa has country categories for 26 of its 54 countries. The fame line removes most
of that tilt — the measurement by continent is on #2171.

The entrance's own reading, reproduced in SQL with the rule's pinned lists (the war-memorial and
cenotaph closures, the memorial classes, the forms and the monument senses standing in for the
walked trees, and a year of readers summed over every edition):

| what | count |
|---|---|
| items no class or fact of the kind names | 3,655 |
| refused as places of worship (Abu Simbel, the Minaret of Jam, the Kyiv Pechersk Lavra) | 211 |
| refused by a kill (the Buddhas of Bamiyan, Majdanek, the Los Angeles Memorial Coliseum, ValuJet Flight 592, the Woodrow Wilson International Center for Scholars) | 113 |
| refused as a type rather than one place (the khachkar, the cairn, the deer stone, the chhatri) | 43 |
| refused as a museum's work (*David*) | 7 |
| refused as a ship or its wreck (USS Indianapolis, USS Oklahoma, AHS Centaur) | 6 |
| refused as lost | 2 |
| refused for having no point of their own (Last Address, the Bertha Benz Memorial Route) | 601 |
| passed by the rule | 2,672 |
| of those, over a world bar of the kind (18 editions, 83,332 readers, 16,683 with a guide's or Atlas Obscura's mark) | 199 |
| of the 199, already in another kind of the catalogue (Trafalgar Square, the Chapel Bridge, the Zytglogge) | 66 |

Among the 133 the bars would bring that no kind holds: Mount Rushmore, the Valley of Cuelgamuros,
the Monument to the Battle of the Nations, the Imam Khomeini Mausoleum, Pavlov's House, the Che
Guevara Mausoleum, Patuxai, Minar-e-Pakistan, Fort Breendonk, Schloss Hartheim and the Cellular
Jail — and California State Route 1, Long Island MacArthur Airport, the town of Maumere and
Wellington College, which a curator turns down. The surroundings tier was not reproduced: it is read
over the whole pass's pool.

## How it is read

**As an entrance, and nothing more.** The category names the candidate; the kind's own frame
decides it — the rule with the category in place of a class, the world bars over the kind's pool,
which these candidates do not join, and the surroundings tier. There is no bar of its own and no
guide's mark asked for (the maintainer's decision of 2026-11-04 on #2171): a guide is not trusted to
know every monument a traveller wants, and every arrival waits for a curator, whose note names the
category. A category is read only where it files the article directly; its subcategories file
their own.

## How the scorecard was read

`docs/tech/filling-a-kind.md` § 6.2 on its world-tier sense. **Signal 1**: being filed as a
monument is an editorial judgement that the place is visited as one, weaker than a class — the
shelf also files a khachkar, a cairn, a heavy cruiser, a road and an airport. **Coordinates 0** and
**names 1**: everything about the place is Wikidata's. **Completeness 1**: a country's shelf holds
what its editors filed there, and the trees outside Europe and North America are thin.

## Terms

As for the dumps (`wikipedia-sql-dumps.md`): the licence covers the article text, and no article
text is read — titles, Wikidata ids and category membership only. The category's title is what the
curator's note quotes as the reason the candidate was named.

## What this source cannot reach

- A monument whose English article is filed under other categories only (the Monument to the
  People's Heroes, the African Renaissance Monument).
- A monument with no English article; the other editions' trees are not held locally.
- Whether a wreck is one a visitor can reach: every ship and wreck is refused here (#2341).
