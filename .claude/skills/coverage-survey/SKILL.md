---
name: coverage-survey
description: "Survey a Region for Catalogue Coverage: Compile the list of what a seasoned traveller expects in one region, from independent sources, and file every entry under a kind of the register."
---

# Survey a Region for Catalogue Coverage

Compile the list of what a seasoned traveller expects in one region and commit it as that region's survey list (ADR-0081). The list is the yardstick the catalogue is later measured against, so it is written as if the product did not exist.

## Arguments

$ARGUMENTS — required: the region to survey, as a guide would title its chapter ("Yerevan", "Tuscany", "Kansai"). A region already in `db/catalogue-coverage/regions.jsonl` is surveyed again: its list is rebuilt and the old one replaced.

## Prerequisites

Read `docs/tech/catalogue-coverage.md`: the file formats, what the reader refuses, and the rule for changing a list. Read `db/catalogue-coverage/kinds.jsonl`: the kinds an entry may be filed under.

## Ground rules

- **Do not look at the catalogue.** No query of the database, no reading of what a sync admits, until the list is written. A list shaped by what the catalogue holds measures nothing.
- **Names are facts; a guide's words are not.** Record the names of what a source recommends. Never copy a description.
- **A site that refuses automated reading is left alone.** A 403, a robots refusal or a page that needs a browser is recorded as "could not be read". No workaround, no browser, no bulk download.
- **An identifier comes from a lookup, never from memory.** That includes one a Wikivoyage listing carries: check it like any other.
- **Which commercial guide named what is not committed.** The committed entry carries how many sources named it. The record of which ones goes under `docs/local/`.

## Instructions

### 1. Fix the region

Decide the centre (latitude, longitude) and the reach in kilometres: the place itself and the day trips every guide files under it. Choose a slug: lowercase words joined by dashes. Say the three in one line to the user before going on; a wrong reach is cheaper to fix now than after the merge.

Create a working directory `docs/local/research/catalogue-coverage/<slug>/`. Everything this skill writes besides the committed list goes there.

### 2. Write your own list first

Before any fetch or search, write from your own knowledge what an experienced guide would send a first-time visitor to: the highlights a guide puts at the front of the chapter, and the next tier. Everything a guidebook recommends, not only sights: places, single works inside a venue (name the venue), dishes and drinks, festivals, routes and day trips, activities.

Save it as `01-own-list.md` in the working directory and do not edit it afterwards. It is one of the sources, and it is only independent if it was written first.

### 3. Read Wikivoyage

```bash
./scripts/catalogue-coverage.sh lookup wikivoyage "<Article>" --save docs/local/research/catalogue-coverage/<slug>/wikivoyage
```

Read the region's article, every district article it links, and the day-trip articles. The command prints each article's listings by section and the articles its Districts, Cities, Other destinations and Go next sections link; day trips are usually under Go next. `--save` keeps the wikitext, where dishes and festivals are named in prose.

Record what Wikivoyage names: the highlights and prose of the main article, and the See and Do listings of the district articles. A restaurant, bar or hotel listed by name is recorded only when another source also names it.

### 4. Read the open pages of commercial guides

Find the publisher's own open pages for the region with a web search and read two guides where two can be read; a third that can be read is one more source, never a reason to stop early. A publisher with no page for the region counts for what its country pages name in this region. Ask each page for the names of what it recommends and nothing else.

Rough Guides' pages have been readable. Lonely Planet's are drawn by script and show only navigation to a fetch: take the names a search restricted to its site returns, and mark the source as partial. Fodor's and Frommer's have answered 403. Record for each guide what was read and what could not be.

### 5. Read UNESCO's lists

The World Heritage properties in or beside the region, each with UNESCO's own id, and the country's elements on the Intangible Cultural Heritage lists that a visitor to this region would meet. UNESCO is a source like the others: it names the property, and the components the property's own page lists.

### 6. Merge

One entry per thing, with the sources that named it. Keep an entry when two or more sources name it; the single-source ones stay in the working directory.

Give each entry a `type`, in the vocabulary `docs/tech/catalogue-coverage.md` § `kinds.jsonl` lists for `form`: a statue outdoors is a `place`, an object shown inside a venue is a `work` with its `venue`, a ride or a class is an `activity`. A thing that is both a place and something to do is one entry: a `place` when a traveller goes to see it (a singing fountain), an `activity` when the doing is the point (a ride on a children's railway).

An entry belongs to this region when a source presents it as part of the place or as a trip from it. A sight a country-wide page lists, days away, belongs to its own region's list, however many sources name it.

### 7. Find the identifiers

```bash
./scripts/catalogue-coverage.sh lookup search "<name>" "<another name>"
./scripts/catalogue-coverage.sh lookup facts <lat> <lon> Q… Q…
```

For every place and work, `search` lists the Wikidata items the name could be; choose from what it returned or leave the identifier empty. A dish, a drink, a festival, a route or an activity gets an identifier when the search finds its item plainly, and none otherwise. Then `facts`, with the region's centre, prints each chosen item's label, sitelinks, distance from the centre and classes. An item far outside the reach, or whose label is another thing, was the wrong choice.

Where Wikidata has two items for one place, the entry takes the one the Wikipedia articles are on and names the other in `same_as`: a building and the institution inside it, or a site and its heritage-register record. An item with no sitelinks beside a twin with many is the wrong choice; search the name again before keeping it.

An entry farther from the centre than the reach stays on the list when it passed the test of step 6, with the distance and the reason in its `note`. An item Wikidata gives no coordinates has `lat` and `lon` null. When Wikidata's coordinates are plainly not the place's, keep the identifier, leave `lat` and `lon` null, and say so in the `note`.

An inscribed World Heritage property is one entry of the list, with its `unesco` id, filed under `world-heritage`; no second entry carries that id. A component of a serial property, one temple among Kyoto's, is an entry of its own when sources name it, filed under what it is, with no `unesco` id.

### 8. File every entry under kinds

For each entry choose the kinds of the register a traveller would look for it under: usually one, two when they would truly look in both. A kind may be given only when its `form` is the entry's `type`.

When no kind fits, leave the entry unsorted and note what kind is missing. If two or more entries miss the same kind, add a record to `kinds.jsonl` as `proposed`, with a definition a person could apply to the next entry, and file them under it. Do not stretch a kind to cover what it does not define.

### 9. Write the list

Add the region's line to `db/catalogue-coverage/regions.jsonl` and write `db/catalogue-coverage/expectations/<slug>.jsonl`, one entry per line, the most-named first. Fill `sitelinks`, `lat` and `lon` from step 7's `facts`.

Write the per-source record, which source named which entry, to `sources.jsonl` in the working directory. It is never committed.

### 10. Check, and report

```bash
npx vitest run --root backend src/services/catalogueCoverage/files.test.ts
./scripts/catalogue-coverage.sh load
./scripts/catalogue-coverage.sh report --region <slug>
```

The spec reads the committed files and names every wrong line. The load and the report are the first look at the catalogue, which is why they come last.

Tell the user: how many entries, how many by type, which sources were read and which could not be, the kinds added to the register, the entries left unsorted, and what the report says for the region. Commit through `/commit`: the list and any register change together, as data, apart from code.
