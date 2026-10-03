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
- **A site says whether it may be read, and the answer is taken once per site.** Before any page of a site, look it up in `docs/sources/site-access.md` and take the verdict its line gives; it is not judged again. A site the table does not hold: read its `robots.txt` and the page that states its conditions of use, decide by the rules below, write the clause quoted from the page into `access.md` in the working directory, and add the site's line to the table in the same change as the list. The site is refused, and nothing of it counts, when `robots.txt` disallows every agent or an Anthropic agent by name, or cannot be reached (a timeout, a failed certificate, a server error; an address that answers 404 or loses itself in redirects is an unavailable file, and one that redirects to a page holding no rules, such as the home page, is a file with no rules; both allow, RFC 9309 § 2.3.1); when every page answers 403 or a challenge, or redirects to a site that is refused; when it reserves text-and-data mining in a machine-readable way; or when its terms bar robots, automated access, scraping, mining or use by AI. One thing lifts a terms clause: where the clause bars extraction save with the publisher's leave, and the site's `robots.txt` allows an Anthropic agent by name (`ClaudeBot`, `Claude-User`, `Claude-SearchBot`, `anthropic-ai`), that is the leave, and the site may be read. A clause that bars only copying in bulk by script is no bar on reading, and is kept the way a limit on the rate of requests is: a few pages, one at a time. A clause seen in a search result is not a reading of the terms. Each country edition of a guide is its own publisher's site and is judged on its own.
- **A refusal is not worked around.** No other client or agent string, no browser, no bulk download, and no reading of the site through a search engine. A path `robots.txt` closes is not read, and a search result for a page on it counts for nothing. A page that answers 403 where the rest of the site answers is left unread, and the rest is read: UNESCO's property pages are such pages. A file that carries a no-copy flag is read as the fetch shows it or not at all. A limit on the rate of requests is kept: one page at a time, a few per site. Wikivoyage is the exception to the few: the `lookup` command reads it through Wikimedia's Action API, one request at a time, as Wikimedia's API etiquette asks.
- **A request names the project and nobody.** No personal e-mail address and no personal name in any request header. The one address a request may carry is the project's own contact, which the `lookup` command sends to Wikimedia as its User-Agent policy asks.
- **A source counts for an entry when you read it and it named the thing.** A page you fetched counts. So does the title or the URL of a result on the source's own site, from a search for the region or for a category of it, where the site's pages cannot be fetched for a technical reason. Three things do not: the search tool's summary, which is prose written by a model and blends pages; a search that contains the name of the thing, which finds the string wherever it is; and a page that lists everything of a kind, which is a directory and not a recommendation.
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

One of the guides is in a language visitors to the region read, when that is not English: French for West Africa, Portuguese for Brazil, Spanish for Cuba, Russian for Central Asia. Where the English guides are thin this is the guide that names the feasts, the dishes and what opened lately: in Dakar the three Muslim feasts and café Touba are on the list because the French guide names them.

Which guides may be read is decided by the ground rule, site by site, and it changes as publishers change their terms; `docs/tech/catalogue-coverage.md` § How the lists of 2026-10-02 were compiled says what the committed lists found. Where a site that may be read draws its pages by script and shows only navigation to a fetch, take the names that stand in the titles and URLs of the results a search restricted to that site returns for the region, and mark the source as partial. Record for each guide what was read and what could not be.

### 5. Read a source written from inside the country

A national or city tourism board, or a guide written by residents. It is counted like any other source, and it is where the places residents go and the sights opened since the foreign guides were last revised turn up. A directory of every restaurant, hotel or museum is not a recommendation and is not counted for them.

Look in `docs/sources/sights/` first: a record for the country names the sources an earlier survey read there, what they sort their places into and what they measured. Each source from inside the country that you read gets a record there, in the shape `docs/sources/README.md` states for `sights/`: a new one, or, where the record exists, the region's measurement added to its body. The record carries the counts once the list is merged (step 7), and is committed with the list.

### 6. Read UNESCO's lists

The World Heritage properties in or beside the region, each with UNESCO's own id, and the country's elements on the Intangible Cultural Heritage lists that a visitor to this region would meet. UNESCO is a source like the others: it names the property, and the components the property's own page lists. Its terms let an AI system retrieve single pages to answer a question, with UNESCO named as the source. The property pages have answered 403 while the State Party page was readable; a component whose page could not be read is not counted as named by UNESCO.

### 7. Merge

One entry per thing, with the sources that named it. Keep an entry when two or more sources name it; the single-source ones stay in the working directory.

Sources that repeat each other item for item are one source: a tour operator's page copied from Wikivoyage, or two language editions of one article. Count them once and say so in the record of step 10.

Your own list is one of the sources and counts as one. It may be the second source of an entry, never both: a thing only you named is not on the list, however sure you are of it.

Give each entry a `type`, in the vocabulary `docs/tech/catalogue-coverage.md` § `kinds.jsonl` lists for `form`: a statue outdoors is a `place`, an object shown inside a venue is a `work` with its `venue`, a ride or a class is an `activity`. A thing that is both a place and something to do is one entry: a `place` when a traveller goes to see it (a singing fountain), an `activity` when the doing is the point (a ride on a children's railway).

A work, an activity or an event tied to one place names it in `venue`, in words: the show given at a fort, the match at a stadium, the feast kept at one temple. One done at many places, a tea ceremony or a ride in a classic car, names none, and a place never does.

An entry belongs to this region when a source presents it as part of the place or as a trip from it. A sight a country-wide page lists, days away, belongs to its own region's list, however many sources name it.

### 8. Find the identifiers

```bash
./scripts/catalogue-coverage.sh lookup search "<name>" "<another name>"
./scripts/catalogue-coverage.sh lookup facts <lat> <lon> Q… Q…
```

For every place and work, `search` lists the Wikidata items the name could be; choose from what it returned or leave the identifier empty. A dish, a drink, a festival, a route or an activity gets an identifier when the search finds its item plainly, and none otherwise. Then `facts`, with the region's centre, prints each chosen item's label, sitelinks, distance from the centre and classes. An item far outside the reach, or whose label is another thing, was the wrong choice.

Where Wikidata has two items for one place, the entry takes the one the Wikipedia articles are on and names the other in `same_as`: a building and the institution inside it, or a site and its heritage-register record. An item with no sitelinks beside a twin with many is the wrong choice; search the name again before keeping it.

An entry farther from the centre than the reach stays on the list when it passed the test of step 7, with the distance and the reason in its `note`. An item Wikidata gives no coordinates has `lat` and `lon` null. When Wikidata's coordinates are plainly not the place's, keep the identifier, leave `lat` and `lon` null, and say so in the `note`.

An inscribed World Heritage property is one entry of the list, with its `unesco` id, filed under `world-heritage`; no second entry carries that id. A component of a serial property, one temple among Kyoto's, is an entry of its own when sources name it, filed under what it is, with no `unesco` id.

### 9. File every entry under kinds

For each entry choose the kinds of the register a traveller would look for it under: usually one, two when they would truly look in both. A kind may be given only when its `form` is the entry's `type`. A kind whose record says `in_venue` holds what exists only inside a place, and an entry filed under it names its `venue`: a single work under `notable-works`, and under `on-site-activities` what a visitor does there as part of the visit, such as climbing the dome or taking the tour of the house. What a traveller also browses a region by keeps its own kind and names the venue: a show stays a show.

When no kind fits, leave the entry unsorted and note what kind is missing. If two or more entries miss the same kind, add a record to `kinds.jsonl` as `proposed`, with a definition a person could apply to the next entry, and file them under it. Do not stretch a kind to cover what it does not define. When a kind plainly means the thing and its definition lacks the word, a dargah under places of worship, reword the definition in the same change so that it names it: a definition is held to every surveyed region, not to the first one.

### 10. Write the list

Add the region's line to `db/catalogue-coverage/regions.jsonl` and write `db/catalogue-coverage/expectations/<slug>.jsonl`, one entry per line, the most-named first. Fill `sitelinks`, `lat` and `lon` from step 8's `facts`.

Write the per-source record, which source named which entry, to `sources.jsonl` in the working directory, your own list and the source from inside the country each under a name of its own, and beside it how each source was read: fetched whole, fetched in part, or through searches of its site. It is never committed.

### 11. Check, and report

```bash
npx vitest run --root backend src/services/catalogueCoverage/files.test.ts
./scripts/catalogue-coverage.sh load
./scripts/catalogue-coverage.sh report --region <slug>
```

The spec reads the committed files and names every wrong line. The load and the report are the first look at the catalogue, which is why they come last.

Tell the user: how many entries, how many by type, which sources were read and which could not be, how many entries have your own list as one of only two sources and how many the source from inside the country, the kinds added to the register and the definitions reworded, the entries left unsorted, and what the report says for the region. Commit through `/commit`: the list and any register change together, as data, apart from code, and the new lines of `docs/sources/site-access.md` and the source records with them.
