# Catalogue coverage

How much of what a traveller expects the catalogue holds, and which kind of experience it
lacks most. The decision is
[ADR-0081](../decisions/0081-a-kind-is-a-record-before-it-is-code-and-an-expectation-is-listed-before-the-catalogue-holds-it.md);
this document describes what exists.

It is a development tool. The maintainer and an agent read it, and it has no screen.

Catalogue Checks (`docs/tech/data-assertions.md`) asks whether the rows the catalogue holds
mean what the product says they mean. This asks the other question: what the catalogue does
not hold.

## The files

`db/catalogue-coverage/` is the source of truth. Every file is JSON Lines: one record per
line, changed through a pull request.

```
db/catalogue-coverage/
├── kinds.jsonl                  ← the register of kinds of experience, live and proposed
├── regions.jsonl                ← the surveyed regions
└── expectations/<region>.jsonl  ← what a traveller expects in that region
```

No directory is named `coverage/`: `.gitignore` ignores that name, and a file under it is
never committed.

### `kinds.jsonl`: the register

One record per kind of experience. A kind of dish, drink, festival, route or activity is a
kind like any other and has its own record.

| Field | Meaning |
|---|---|
| `slug` | The name an entry is filed under: lowercase words joined by dashes |
| `name` | The kind's name as a person reads it |
| `form` | What a member of the kind is: `place`, `work` (an object shown inside a venue), `food`, `drink`, `event`, `route`, `activity`, `title`, `person`, `species`, `object`, `sound` |
| `definition` | One sentence: what a traveller files under this kind |
| `status` | `live` when the product has the kind, `proposed` when the record is all there is |
| `experience_kind_id` | The `experience_kinds` row of a live kind of place; `null` otherwise |
| `issue` | The issue that owns building the kind, or `null` |
| `vision` | The heading that describes the kind in `docs/vision/PROPOSED-EXPERIENCE-CATEGORIES.md`, or `null` |

A record says what the kind is. It never says when the kind is built: that the kind is
planned is its `issue`, and priority, order and milestone live in that issue
(`docs/README.md` § Where things live).

`form` is why a kind of place and a kind of dish sit in one register and are still told
apart. The catalogue's records are places today, so a proposed kind whose form is `food` or
`event` asks for more than a new sync.

Works shown inside a venue are a live kind, `notable-works`, with no `experience_kinds` row:
the product holds them as treasures of the venue.

### `regions.jsonl`: the surveyed regions

| Field | Meaning |
|---|---|
| `slug` | Also the name of the region's list file |
| `name`, `country` | As a person reads them |
| `lat`, `lon`, `radius_km` | The centre and the reach of the survey: the city and the day trips a guide files under it |
| `surveyed` | The date the list was compiled, and so the date of its sitelinks and coordinates |

### `expectations/<region>.jsonl`: what a traveller expects there

One entry per thing two or more independent sources recommend in the region, whether or not
the product has a kind for it.

| Field | Meaning |
|---|---|
| `slug` | Unique within the region |
| `name`, `aliases` | For a person. Never used to match anything |
| `type` | What the thing is, in the vocabulary of `form` |
| `kinds` | The kinds of the register it is filed under. Empty when it is not sorted yet |
| `wikidata` | Its Wikidata id, or `null` |
| `same_as` | Other Wikidata items that are this same place: a building and the museum inside it |
| `unesco` | UNESCO's id of an inscribed World Heritage property, or `null` |
| `venue` | Where a work is shown, in words; `null` on anything but a work |
| `sources` | How many sources named it. Two or more |
| `sitelinks`, `lat`, `lon` | As Wikidata gave them on the region's `surveyed` date |
| `note` | Anything a later reader needs: why an entry lies outside the region's reach, which of two Wikidata items was taken |

An entry is identified by its identifiers. A match by name reports a place as missing when
the catalogue spells it differently: Sacsayhuamán is "Saqsaywaman" there (#1160).

Which source named an entry is not in the file. A guide's selection is its publisher's
(`docs/tech/filling-a-kind.md` § 5), so the committed entry carries the count and the record
of which sources stays under `docs/local/`.

## What the reader refuses

`readCoverageFiles` in `backend/src/services/catalogueCoverage/files.ts` reads the directory
whole. It collects every problem and throws them together as a `CoverageFilesError`, each
naming its file and line. Its spec, `files.test.ts`, covers each refusal and reads the
committed files, so a pull request with a wrong line fails the unit lane.

A line with several problems is reported with all of them, so the files are fixed in one
pass: an entry whose slug is already used is still checked against the register, and a list
no region names is still read. A line copied whole is one problem, the repeated slug.

It refuses:

- a line that is not JSON, lacks a field, has a field the format does not have, or has a value
  of the wrong shape;
- in the register: a slug used twice; a live kind of place with no `experience_kind_id`; a
  proposed kind, or a kind that holds no place, with one; two kinds claiming the same
  `experience_kind_id`;
- a region with no list, and a list with no region;
- in a list: a slug used twice; a Wikidata id used twice, as an entry's `wikidata` or in its
  `same_as`; a UNESCO id used twice; a kind the register does not have; the same kind twice on one entry; a kind whose
  `form` is not the entry's `type`; `lat` without `lon`; a `venue` on anything but a work;
- an entry with a UNESCO id that is not filed under `world-heritage`, and an entry filed there
  without one. `world-heritage` is the inscribed property itself, so one entry of a list
  carries its id. A component of a serial property, such as one temple of Kyoto's, is filed
  under what it is.

Two regions may hold the same place: Nara is a day trip from more than one city.

## Changing a list or the register

- **A list is written from the traveller's chair.** An entry is added or removed because of
  what independent sources recommend. A change of the catalogue never moves it: a place the
  catalogue stops holding stays on the list, which is how the loss is seen.
- **An identifier comes from a search and is checked.** A Wikidata id is taken from a lookup,
  never from memory, and its coordinates are checked against the region's centre. Wikivoyage
  listings carry wrong ids in places. Where Wikidata has two items for one place, the entry
  takes the one the Wikipedia articles are on and names the other in `same_as`: Raqchi's
  heritage-register item has no sitelinks, and the site's own has ten.
- **An entry outside the region's reach says so.** The reach is the place and its day trips.
  A longer trip a guide still files under the region stays on the list, with the distance and
  the reason in its `note`.
- **An entry is filed only under a kind that holds what it is.** When no kind fits, the entry
  stays unsorted. A new kind is a new record in the register, added in the same pull request
  as the entries that need it, with a definition a person could apply to the next entry.
- **A kind is never renamed by editing its slug in place** without changing every entry filed
  under it in the same change; the reader refuses the leftover.

## The tables

`coverage_kinds`, `coverage_regions`, `coverage_expectations` and
`coverage_expectation_kinds` hold a copy of the files, so that the comparison with the
catalogue is a join. They are declared in `db/init/01-schema.sql` and
`db/migrations/068-catalogue-coverage.sql`, which create them and load nothing.

- **One writer.** `replaceCoverage` in `backend/src/services/catalogueCoverage/load.ts`
  empties all four and fills them from what the reader returned, in one transaction. Nobody
  edits a row by hand: the next load would undo it.
- **Apart from `experience_kinds`.** That table is what a traveller browses by. A proposed
  kind lives only in `coverage_kinds`; a live kind's record there points at its
  `experience_kinds` row.
- **Keys are the files' slugs**, so a reload keeps every key.

The load also checks what the reader cannot see: that every `experience_kinds` row has a live
record under the catalogue's own name, and that no live record names a kind the catalogue
lacks. It checks before it deletes anything, and a load that fails for any reason leaves the
tables holding what they held.

## The commands

Both run against the active database, the one `npm run db:migrate` would use.

```bash
./scripts/catalogue-coverage.sh load                       # read the files, refuse a wrong line, replace the tables
./scripts/catalogue-coverage.sh report                     # print the report over what is loaded
./scripts/catalogue-coverage.sh report --region rome       # one region; the flag repeats
./scripts/catalogue-coverage.sh report --json              # the report as data
```

The report reads the tables, never the files: after a list changes, load before reporting.

## What the report says

`buildCoverageReport` in `backend/src/controllers/admin/catalogueCoverage/report.ts` decides,
from what `readCoverageFacts` (`reportQueries.ts`) read; `reportText.ts` writes it out.

**Where each expectation stands.** The first that applies:

| Verdict | Meaning |
|---|---|
| offered | The catalogue holds it under one of its identifiers and a reader sees it |
| held | The catalogue holds it and a reader does not: it waits for a curator, was refused, or no longer stands |
| unsorted | Absent, and filed under no kind yet |
| missing, kind proposed | Absent, and every kind it is filed under is only proposed |
| something else at its spot | Absent by identifier from a kind that exists, while an offered place stands within `SAME_SPOT_METRES` of it |
| missing, kind exists | Absent, a kind it is filed under exists, and nothing stands at its spot |

An identifier is the entry's Wikidata id, an id in its `same_as`, or its UNESCO id. A place is
offered when a kind's count would count it, and a work when it is passed and a museum a reader
may go to shows it: the report composes `countedMembershipSql` and `venuesShowingSql`, the
predicates the lists and counts use, and spells none of its own.

"Something else at its spot" is a list for a person and is never counted as found. It turns up
three things: the same place under another Wikidata item (Palazzo Barberini is the building,
and the catalogue holds the gallery inside it); a named point of a serial World Heritage row
(Tōshōdai-ji inside the monuments of ancient Nara); and a plain neighbour. When it is the same
place, the other item's id goes into the entry's `same_as`, and the next load finds it. It is
asked only of a place a live kind should hold: a square beside a fountain the catalogue holds
is a neighbour and nothing else.

**What the surveys expect of each proposed kind.** For every kind the product does not have:
how many expectations are filed under it, in how many regions, how many of them a reader
already sees through another kind, the most named examples, what a member of the kind is, and
its issue. Kinds asked for by the most regions come first. This is the evidence for what to
build next; it changes no priority (ADR-0081 decision 8).

**What each live kind lacks.** For every live kind: how many of the expectations filed under it
the kind itself offers, the absent ones at or over the kind's own sitelinks line by name, and
a count of the absent ones under it, which are the regional tier's to hold. The line is the
`enterSitelinks` the kind's source states, or the code's line for a monument and for a work.
Two kinds have none, and every absent entry of theirs is named: World Heritage, where being
inscribed is the whole rule, and Art Museums, which admits a museum through a work it holds,
so the museum's own sitelinks are not what the kind asks of it. An entry a reader
sees under another kind is still absent from this one, and the report says so.

## How the lists of 2026-10-01 were compiled

A list whose region carries `surveyed: 2026-10-01` comes from the first survey, which took one
place per macro-region of the Administrative world view. Each list was merged from five
sources: a model's own list written before anything was read, Wikivoyage's articles for the
place and its districts, the open pages of Rough Guides, Lonely Planet as far as a search of
its site shows it, and UNESCO's World Heritage and intangible heritage lists. Sites that
refuse automated reading were left alone.

Every entry was filed under kinds twice, independently: by an agent per region and by a
structured-decision model (#929). Where the two differed the entry was read by hand, and the
kinds they both lacked were added to the register. ADR-0081 has the numbers.
