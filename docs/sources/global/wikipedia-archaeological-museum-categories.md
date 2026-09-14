---
slug: wikipedia-archaeological-museum-categories
name: English Wikipedia, the archaeological-museum categories by country
publisher: Wikimedia Foundation and the English Wikipedia community
urls:
  home: https://en.wikipedia.org/wiki/Category:Archaeological_museums_by_country
  dataset: https://en.wikipedia.org/wiki/Category:Archaeological_museums_by_country
  api: https://en.wikipedia.org/w/api.php
  terms: https://en.wikipedia.org/wiki/Wikipedia:Copyrights
family: global
kinds: [archaeology]
tier: world
unit: { level: any, code: none, name: "the world, as the editors themselves cut it by country" }
row:
  identity: "the article title, and the Wikidata item the article is about (`pageprops.wikibase_item`)"
  wikidata_link: tag
  coordinates: none
  languages: [en]
  signal: "editorial category membership + the place line"
terms:
  licence: "CC BY-SA 3.0 (the article text); what is read is titles and Wikidata ids, which the licence does not reach"
  database_right: not-asserted
  attribution: "English Wikipedia (given wherever its judgement is shown)"
  scraping: not-needed
access:
  mode: api
  format: "MediaWiki Action API — `list=categorymembers` for the subcategories, `generator=categorymembers` with `prop=pageprops&ppprop=wikibase_item` for the articles"
  cadence: continuous
  volume: "60 country categories; 776 articles carrying a Wikidata item at depth 1 (2026-09-13)"
  rate: "no quota published for a read of this size; the walk asks two questions per category and pauses a second between them"
scorecard:
  date: 2026-09-13
  completeness: 1
  identity: 2
  coordinates: 0
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 11
  verdict: adoptable
status: adopted
issue: 581
looked_at: 2026-09-13
---

# English Wikipedia's own shelf of archaeology museums

A category tree adopted as a **door**, not as a catalogue. It answers one question — is this
museum *about* archaeology — and nothing else: no coordinates, no description, no picture, no
opening hours. Those come from Wikidata, which is the other half of the pair
([`wikidata-archaeology`](wikidata-archaeology.md)); this source names the museum and that one
says where it is and what it is. The rule that reads them together is
[ADR-0058](../../decisions/0058-archaeology-is-one-kind-of-sites-and-museums.md) decision 2, and
neither source is adopted for this kind without the other.

**Why a second source at all.** Wikidata's class tree misses half the canon of archaeology
museums, and it misses it silently: the British Museum is typed `art museum, national museum`,
the Pergamon Museum `art museum, museum`, the National Museum of Iraq `national museum`, the
Bardo simply `museum`. A museum typed that way is in no pool of archaeology classes and, holding
no find the world has heard of, is named by nothing at all — so it is not refused, it is never
looked at. Wikipedia's editors have done the work the classes have not: they file the museum
under `Archaeological museums in <country>` because that is what it is about.

## What was measured (2026-09-13)

The walk of `Category:Archaeological museums by country`, through the Action API:

| what | count |
|---|---|
| country categories under the root | 60 |
| articles under them at depth 1 carrying a Wikidata item | 776 |
| of those, at or above the place line (22 sitelinks) | 75 |
| of those 75, with **no museum class on Wikidata** | 27 |
| of those 75, already typed archaeological (the class door has them) | 18 |
| of those 75, genuine additions — a museum class, not typed archaeological | 30 |

The root itself holds no article of its own, and a country nests regional categories a step
further (Greece has 15, `Archaeological museums in Crete` among them), which is why the walk
recurses — into the subcategories whose own title matches `Archaeological museums in|of …` and
no others, since a country category sits beside siblings belonging to other kinds
(`Byzantine museums in Greece`). Of the 16 articles in the Tunisia category, 16 carried a
Wikidata item.

**The table above counts depth 1 only, and the walk goes deeper**, which is why a run finds
museums the table does not hold: `Archaeological museums in the United Kingdom` files its museums
under England, Scotland, Wales and Northern Ireland rather than directly, so a British museum sits
a step below the count. Read that against the additions below — a country that nests is a country
under-counted here, not one the door misses.

**The 30 additions are not an anglophone list**, which is the obvious objection to reading an
English-language encyclopedia for the world: Israel 4, Germany 3, India 2, France 2, and one
each for Tunisia, Syria, Sweden, Poland, China, Malta, Japan, Ireland, Iraq, Iran, Indonesia,
Hungary, Egypt, Denmark, Colombia, Cambodia, Brazil, Azerbaijan and Austria — Ireland the only
anglophone country among them, the United Kingdom and the United States adding none, because
their museums already arrive by a class or by a find. The first run to use the door (dry run 113
of the Archaeology source) admitted 31 museums the other doors had not reached, of which 6 were
in the United Kingdom, Ireland or the United States.

**A category is a shelf, and the shelf holds the dig beside the building.** Those 27 members at
or above the line with no museum class are Pompeii (`archaeological site, ancient city`, 122
sitelinks), Chichén Itzá, Teotihuacan, Masada, Çatalhöyük, Hierapolis, Sforza Castle, Bodrum
Castle, the Cathedral of the Annunciation. Admitted unasked, each would be a museum pin on an
ancient city. So what comes in by this door is asked one thing of Wikidata — whether it is a
museum at all — and what fails that is sent to the site door rather than pinned; dry run 113
named 40 such rows, all of them at or above the place line, and said nothing about the rest,
which are a country's whole archaeology and would bury a curator's real refusals.

## How the scorecard was read

As for the two Wikidata records, § 6.2 of [`docs/tech/filling-a-kind.md`](../../tech/filling-a-kind.md)
is worded for the regional tier and is read here on its world-tier sense. Two scores are low on
purpose and neither is a reason to refuse the source, because what is adopted is the **pair**:

- **Coordinates 0.** A category names a museum; it says nothing about where it stands. Every
  coordinate this kind writes is Wikidata's `P625`, and a member Wikidata gives no coordinate of
  its own is refused by the same sentence every other kind refuses a placeless row with.
- **Completeness 1** — the kind with known gaps. A category holds what an editor filed there:
  the National Museum of Korea is typed `national museum` at 38 sitelinks and is filed under
  `History museums in South Korea` and `Art museums and galleries in Seoul`, so this door misses
  it exactly as the class door does.
- **Signal 1** is the criterion's own wording for an editorial cut — being listed is the signal.
  It is not a measured one, and it is not a fame ranking either: the fame line stays Wikidata's
  sitelink count, and this door has **no floor of its own**, since a country category holds that
  country's museums whatever the world has heard of them.
- **Identity 2** with a caveat the body owes: the article title is an identifier that editors
  move, so it is the Wikidata id the article carries that is kept, and the title only names the
  question.

## Terms

**CC BY-SA 3.0 covers the article text, and no article text is read.** The walk takes the titles
of pages and categories and the Wikidata id each article carries; the ids are Wikidata's and
CC0, and a title is the name of a thing. Nothing the share-alike condition reaches is stored, so
the `hold` that § 5 of [`filling-a-kind.md`](../../tech/filling-a-kind.md) places on a
share-alike source until the catalogue has answered what a derivative database would bind is not
raised here. Credit is given anyway, because the judgement being used is the editors': the
category name is what the run stores under `metadata.wikipediaCategories`, and it is what a
curator reads on a held museum's card as the reason. The Action API needs no permission for a
read of this size; it asks for the User-Agent every outbound call of this catalogue already
carries (`userAgent()`, #864).

## What this source cannot reach

- **A museum no editor has filed under the category**, which is a real gap rather than a rare
  one — the National Museum of Korea above, and every museum whose English article is a stub.
- **A museum with no English article at all.** The walk finds a museum *through* its article, so
  a row Wikidata answers for without an English sitelink is dropped rather than judged: the two
  reads disagree, and judging it would mean reading the categories of an article it does not
  have, finding none, and refusing the museum by name for a fact nobody stated.
- **Anything about the place.** Coordinates, classes, the picture and its credit, the sitelink
  count the line is read at: all of them are the Wikidata record's.

## The runs that adopted it

Dry run 113 of the Archaeology source (`experience_sources` row 5), 2026-09-13, on the
development stack — the first with this door open: the walk read **121 categories** and **1,148
articles carrying a Wikidata item** (19 without one, counted and skipped), about **1,060** of them
then asked for by id, the rest being rows the museum pool or the venue graph already carried; 31
museums admitted that no other road reached (the Bardo, the National Museum of Iraq, the Museo
del Oro, the Pergamon Museum among them), 40 sites, castles and cities refused to the site door
by the museum-class gate, and nothing lost that run 112 had admitted. The **776** in the volume
line and the table above is a different measurement of the same day — the articles with an item
that the 60 country categories hold **at depth 1** — and it is what the survey's own figures (75 at
or above the place line, 27 of them carrying no museum class) are counted against; the run walks
the subcategories those 60 nest, which is why it reads more. The numbers of both runs
are in [`wikidata-archaeology`](wikidata-archaeology.md), which is where the source row and its
lines are recorded; this record holds only what the category door itself contributed. No live run
has been made, so the kind holds no place a reader can be shown. The site door landed with #581's
second slice on 2026-09-14, so both halves of the kind are built and what it waits on is the
maintainer's first live run and a curator publishing what it brings (ADR-0058 decision 7).
