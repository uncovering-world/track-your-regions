# Catalogue coverage

How much of what a traveller expects the catalogue holds, and which kind of experience it
lacks most. The decision is
[ADR-0081](../decisions/0081-a-kind-is-a-record-before-it-is-code-and-an-expectation-is-listed-before-the-catalogue-holds-it.md);
this document describes what exists.

It is a development tool. The maintainer and an agent read it through the commands below.
One part of it has a screen: what each live kind lacks is a check in Catalogue Checks
(`docs/tech/data-assertions.md` § What travellers expect), so an admin sees a place every
guide names go missing after a run.

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
├── expectations/<region>.jsonl  ← what a traveller expects in that region
├── judgements.jsonl             ← why each gap between the lists and the catalogue stands, judged once (ADR-0116)
├── calibration-sources.jsonl    ← the reference lists a kind's tops are named by (#1864)
└── calibration/<kind>.jsonl     ← the tops a traveller expects of that live kind: what its fame line is checked on
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
| `in_venue` | `true` when a member exists only inside a place; `false` for a kind a traveller browses a region by |

A record says what the kind is. It never says when the kind is built: that the kind is
planned is its `issue`, and priority, order and milestone live in that issue
(`docs/README.md` § Where things live).

`form` is why a kind of place and a kind of dish sit in one register and are still told
apart. The catalogue's records are places today, so a proposed kind whose form is `food` or
`event` asks for more than a new sync.

Works shown inside a venue are a live kind, `notable-works`, with no `experience_kinds` row:
the product holds them as treasures of the venue.

`in_venue` tells the kinds apart on another line: where a traveller meets the member. A
museum, a beach or a festival is something a region is browsed by. The Pietà and the climb of
St Peter's dome are met on the basilica's own card, and nobody browses Rome by "climbs". The
kinds of what a place holds are `notable-works` and `on-site-activities`; the product has
the first as treasures and nothing yet for the second (#1214).

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
| `venue` | The place a work is shown in, or an activity or an event is held at, in words; `null` when it is tied to no one place, and always on a place |
| `sources` | How many sources named it. Two or more |
| `sitelinks`, `lat`, `lon` | As Wikidata gave them on the region's `surveyed` date |
| `note` | Anything a later reader needs: why an entry lies outside the region's reach, which of two Wikidata items was taken |

A field with no value is `null`, except `note`, which is `""`, and the lists, which are `[]`.
`unesco` is UNESCO's number written as a string. A line, in full:

```json
{"slug": "moray", "name": "Moray", "aliases": [], "type": "place", "kinds": ["archaeology"], "wikidata": "Q1814201", "same_as": [], "unesco": null, "venue": null, "sources": 4, "sitelinks": 18, "lat": -13.32925, "lon": -72.19644, "note": ""}
```

An entry is identified by its identifiers. A match by name reports a place as missing when
the catalogue spells it differently: Sacsayhuamán is "Saqsaywaman" there (#1160).

Which source named an entry is not in the file. A guide's selection is its publisher's
(`docs/tech/filling-a-kind.md` § 5), so the committed entry carries the count and the record
of which sources stays under `docs/local/`.

### `judgements.jsonl`: the ledger

One line per gap a person has judged
([ADR-0116](../decisions/0116-a-gap-the-catalogue-carries-is-judged-once-in-a-committed-ledger-by-cause.md)):
an entry of a region's list and the live kind that does not offer it, or a catalogue row the
region offers within its reach that no entry names (#1601). A judgement on an entry says why the
gap stands; one on a row says whether the row is worth a visit, or why it should not be offered.
Either way the report and the coverage check count it by cause and stop listing it as needing a
person. An entry filed under two live kinds has a gap, and a line, per kind: the Arch of
Constantine, offered by Archaeology and absent from Monuments & memorials, is judged under
Monuments & memorials alone,
and a run that lost it would show it bare under Archaeology. A row is judged once per region,
whatever kinds offer it.

| Field | Meaning |
|---|---|
| `region` | The surveyed region's slug |
| `entry` | The slug of the entry in that region's list, or `null` when the subject is a catalogue row |
| `kind` | The live kind whose gap is judged: the entry is filed under it and it does not offer the entry; `null` when the subject is a catalogue row |
| `row` | The Wikidata id of a catalogue row the region offers and no entry names (#1601), or `null` when the subject is an entry |
| `cause` | One of the closed vocabulary below |
| `issue` | The issue that owns the cause, or `null`; a `rule-defect` and a `door-missing` always name one |
| `judged` | The date of the judgement, which is the date of the catalogue it was made against |
| `note` | Why, in a sentence a later reader can check: what the run recorded, what Wikidata says, what stands beside it |

The causes, stated in the schema's `CHECK` and read from it by the files' reader:

| Cause | Meaning |
|---|---|
| `rule-defect` | A rule the product runs today should have admitted it: the Museo Soumaya, refused as a museum network although a cast of *The Gates of Hell* over the works line names it. On a row, the opposite: the rule that admitted it should not have, by what the row's classes and sitelinks say |
| `door-missing` | No rule the product runs would admit it yet: a museum with no work over the works line waits for the regional tier of Art Museums (#628) |
| `kind-missing` | A traveller looks for it under a kind the register has and the product does not; the note names the kind, and the entry is filed under it |
| `part-of-offered` | The catalogue offers the place it is part of: the Vatican Pinacoteca inside the Vatican Museums, a gallery of the Palace Museum |
| `offered-elsewhere` | A reader finds it under the kind the product's rules give it to: the Arch of Constantine under Archaeology, not Monuments & memorials (ADR-0102) |
| `not-a-must` | A visitor misses nothing by the kind not offering it: a commercial gallery, a printmaking workshop; on a row, a stump of brick in the Forum no guide sends anyone to |
| `worth-a-visit` | On a row only: a traveller would go although no guide names it, so the gap is the guides', not the catalogue's. The row is listed no more |

What a subject may be judged follows from what it is, and the schema's
`coverage_judgements_row_causes` and `coverage_judgements_entry_causes` state it beside the
reader: an offered row waits on no door, kind, part or other kind, so a row takes
`worth-a-visit`, `not-a-must` or `rule-defect` (the rule that admitted it should not have); an
entry a kind lacks is never `worth-a-visit`.

A line, in full:

```json
{"region": "rome", "entry": "villa-farnesina", "kind": "art-museums", "row": null, "cause": "rule-defect", "issue": 1614, "judged": "2026-10-16", "note": "Held and refused as a villa since 2026-08-07 although Raphael's Galatea, over the works line, names it."}
```

A judgement is about the catalogue's rules, never about the list: where a finding is the list's
fault, an identifier that is the wrong one of two items or a filing a traveller would not make,
the list is corrected and nothing is judged. A held entry that waits for a curator is not
judged either; the review queue answers it.

### `calibration-sources.jsonl` and `calibration/<kind>.jsonl`: the tops a traveller expects of a kind

A kind's fame line is chosen, and re-checked, on the kind's own calibration list, never copied
from another kind's (`docs/tech/filling-a-kind.md` § 2, #1864). One list per live kind of place,
named by the kind's slug; an entry is one place a traveller expects the kind to offer, identified
by its Wikidata item, and names the reference lists that call it a top. The register of those
lists is `calibration-sources.jsonl`, so a slug on an entry is one a person can read again.

| Field of the register | Meaning |
|---|---|
| `slug` | The name an entry names the list by |
| `name` | The list as a person reads it: *World Federation of Great Towers, members* |
| `url` | Where the list is read, or `null` for one assembled here, such as the coverage surveys |
| `read` | The date the list was read, which is the date of the membership it states |
| `note` | What of the list was left aside and why: the federation's skyscrapers wait for their own kind |

| Field of an entry | Meaning |
|---|---|
| `slug` | Unique within the kind's list |
| `name` | For a person. Never used to match anything |
| `wikidata` | Its Wikidata id; every entry has one |
| `sources` | The register's slugs of the lists that name it, one or more |
| `sitelinks` | Its Wikipedia editions when the list was compiled, counted by the code's own counter, `fetchWikipediaEditions` (`wikidataQueries.ts`; the subset's `subsetWikipediaEditions` where the subset keeps the item) — the measure a kind's line reads, never a query service's sitelink count, which adds Wikivoyage and Commons — or `null`, so the report can tell an absent top under the kind's editions line from one the kind's classes do not reach |
| `note` | Anything a later reader needs: why Wikidata's typing keeps the kind from reaching it |

A line, in full:

```json
{"slug": "cn-tower", "name": "CN Tower", "wikidata": "Q134883", "sources": ["asce-seven-wonders-modern-world"], "sitelinks": 79, "note": ""}
```

Which kinds have a list, and which reference lists each draws on, are the files and the
register themselves. A member read from a global list — the items Wikidata designates World
Heritage, the items four or more Wikivoyage editions use — is read from the whole of Wikidata
through the kind's classes, never from what the kind's run admitted, so a top the line cuts or
the rule refuses stays on the list. Each list draws on at least two independent sources,
Wikivoyage as one check; the reading a kind's line was chosen on is in its record in
`docs/sources/global/`.

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
  `form` is not the entry's `type`; `lat` without `lon`; a `venue` on a place; an entry filed
  under a kind that exists only inside a place and naming no `venue`;
- an entry with a UNESCO id that is not filed under `world-heritage`, and an entry filed there
  without one. `world-heritage` is the inscribed property itself, so one entry of a list
  carries its id. A component of a serial property, such as one temple of Kyoto's, is filed
  under what it is;
- in the register of reference lists: a slug used twice; in a calibration list: a file named by a
  slug the register of kinds lacks, by a kind only proposed, or by a kind that holds no place; a
  slug or a Wikidata id used twice in one list; an entry with no source, naming a source twice,
  or naming one `calibration-sources.jsonl` does not have; a list with no register beside it. A
  directory with no `calibration/` has calibrated nothing and may do without the register;
- in the ledger: a judgement that names both an entry and a row, or neither; an entry with no
  kind, under a kind the register lacks or only proposes, or under a kind the entry is not
  filed under; a catalogue row that names a kind; a cause outside the vocabulary; a row judged
  a cause only a gap waits on (`door-missing`, `kind-missing`, `part-of-offered`,
  `offered-elsewhere`); an entry judged `worth-a-visit`; a `rule-defect` or a `door-missing`
  with no issue; a region no list has; an entry its region's list does not hold; a gap or a row
  judged twice; an empty note. A directory with no `judgements.jsonl` has judged nothing and is
  not wrong.

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
- **A definition is held to every surveyed region.** It names what a traveller files under the
  kind wherever a list was compiled, not what the first region had: `places-of-worship` names a
  dargah, a terreiro and a state altar beside a church, because Delhi, Salvador and Beijing
  have them. When a survey has to stretch a kind that plainly means the thing, the definition
  is reworded in the same change, and the entries of every list that belong under the new
  wording are refiled with it.
- **What is shown or held at one place names it.** A work, an activity or an event tied to
  one place carries that place in `venue`: the Sound and Light show names the Giza pyramids
  and stays filed under shows, the kind a traveller looks for it under. An activity that does
  not exist apart from its place, the climb of a dome or the tour of an opera house, is filed
  under `on-site-activities`. A tea ceremony or a ride in a classic car, done at many places,
  names none.
- **Sources that repeat each other are one source.** A page copied from another, or two
  language editions of one article, count once towards an entry's `sources`.
- **A kind is never renamed by editing its slug in place** without changing every entry filed
  under it in the same change; the reader refuses the leftover.
- **A calibration list names what a traveller expects of the kind, from lists a person can read
  again.** An entry is added because a reference list names it, with that list's slug on it, and
  its item comes from a lookup, never from memory. A list is never filtered by the kind's
  own rule or line, nor drawn from what the kind admitted: a top the rule wrongly refuses must
  stay on the list for the report to show the refusal. What is plainly not of the kind, judged by
  name, is left aside and said in the register's `note`: the federation's skyscrapers are not
  towers, Al-Aqsa is not a square. An entry that falls out of the kind stays on the list, which is how the loss is seen.
  Two kinds may list one place; one list never lists one item twice.
- **A gap is judged once, in the ledger, and the judgement names its cause and its owner.** A
  defect gets an issue when none owns it yet, and the judgement names it; the next finding of
  the same cause names the same issue. A finding that turns out to be the list's fault corrects
  the list instead. A judgement is removed when the report calls it stale, or when the issue it
  names has closed.

## The tables

`coverage_kinds`, `coverage_regions`, `coverage_expectations`,
`coverage_expectation_kinds`, `coverage_judgements`, `coverage_calibration_sources`,
`coverage_calibration_entries` and `coverage_calibration_entry_sources` hold a copy of the
files, so that the comparison with the catalogue is a join. They are declared in
`db/init/01-schema.sql` and `db/migrations/068-catalogue-coverage.sql`, which create them and
load nothing; `069-coverage-kinds-in-venue.sql` adds `coverage_kinds.in_venue` to a database
that has them, `114-coverage-judgements.sql` the ledger's table,
`115-coverage-judgements-worth-a-visit.sql` the cause a row alone takes and the constraints on
what each subject may be judged, and `167-coverage-calibration-lists.sql` the calibration
tables.

- **One writer.** `replaceCoverage` in `backend/src/services/catalogueCoverage/load.ts`
  empties them all and fills them from what the reader returned, in one transaction. Nobody
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

A third subcommand reads the web and touches no database. It is what a survey looks things up
with, so that an identifier on a list is one a search returned and a distance confirmed:

```bash
./scripts/catalogue-coverage.sh lookup wikivoyage "Yerevan" --save <dir>   # what the article names, by section, and the articles it links
./scripts/catalogue-coverage.sh lookup search "Zvartnots Cathedral"        # the Wikidata items a name could be
./scripts/catalogue-coverage.sh lookup facts 40.18 44.51 Q17054090         # label, sitelinks, distance from that centre, coordinates, classes
```

It is `backend/src/scripts/catalogueCoverageLookup.ts`, and it names itself to Wikimedia through
`userAgent()` like every other outbound call.

## The two skills

`/coverage-survey <region>` compiles a region's list: the surveyor's own list written before
anything is read, Wikivoyage, the open pages of commercial guides, one of them in a language
visitors to the region read, a source written from inside the country, UNESCO's lists, then
the merge, the identifiers, the kinds, and the file. `/coverage-check` loads the lists, reads the
report and says what each finding asks for: a defect and its issue, a place to record under
`same_as`, an entry to sort, a proposed kind whose issue the surveys speak for. Both are
`SKILL.md` files under `.claude/skills/`, and the procedure is stated there and nowhere else.

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

An identifier is the entry's Wikidata id, an id in its `same_as`, or its UNESCO id, looked up
among the places by every id a place is known by (`KNOWN_AS_SQL`): the place's own
`external_id`, each membership's, since a run finds a place by the id on its membership
(ADR-0084), and the Wikidata items a membership resolves a site to, so a UNESCO-first place
Archaeology knows by its item is found by either. A place is offered when a kind's count would
count it, and a work when it is passed and a museum a reader
may go to shows it: the report composes `countedMembershipSql` and `venuesShowingSql`, the
predicates the lists and counts use, and spells none of its own.

"Something else at its spot" is a list for a person and is never counted as found. It turns up
three things: the same place under another Wikidata item (Palazzo Barberini is the building,
and the catalogue holds the gallery inside it); a named point of a serial World Heritage row
(Tōshōdai-ji inside the monuments of ancient Nara); and a plain neighbour. When it is the same
place, the other item's id goes into the entry's `same_as`, and the next load finds it. It is
asked only of a place a live kind should hold: a square beside a fountain the catalogue holds
is a neighbour and nothing else.

**How each live kind stands to its own calibration list** (#1864). For every live kind with a
list, how many of its tops a reader sees and how many more the kind admitted and a curator has
not read yet (the line let them through), each reference list's share (*World Federation of
Great Towers, members: 20 of 30*), and every miss by name, the most known first, with where it
stands, the first that applies:

| Standing | Meaning |
|---|---|
| refused | The latest real, closed run of one of the kind's active sources refused the item, with the reason the run recorded (`experience_sync_changes`, `filtered`: a refusal is never a membership row). Before held, because a rule change knocks out a top the catalogue already holds through that very refusal, and the reason is what the list is there to surface |
| admitted | The kind admits a place known by the item and a reader does not see it yet: it waits for a curator. Counted beside the offered, never named as a miss, since the line holds it |
| held | A catalogue place known by the item exists and this kind neither offers nor admits it: refused by name by an earlier run, or another kind alone offers it; the place is named |
| absent, under the editions line | Nothing holds it and no run named it, and the list's `sitelinks` are under the kind's editions line: the regional tier's |
| absent, not a candidate | Nothing holds it and no run named it, at or over the line, or with no count: the kind's classes do not reach it, or a candidate under the readers' line, which the run records nowhere |

A place is known by the same identifiers the survey lists match by (`KNOWN_AS_SQL`), and offered
by the same `countedMembershipSql`, in the kind the list belongs to. A kind's list is the whole
world's, so `--region` never narrows it.

**What the surveys expect of each proposed kind.** For every kind the product does not have:
how many expectations are filed under it, in how many regions, how many of them a reader
already sees through another kind, the most named examples, what a member of the kind is,
whether it exists only inside a place, and its issue. Kinds asked for by the most regions come first. This is the evidence for what to
build next; it changes no priority (ADR-0081 decision 8).

**What each live kind lacks.** For every live kind: how many of the expectations filed under it
the kind itself offers, the absent ones at or over the kind's own sitelinks line by name, and
a count of the absent ones under it, which are the regional tier's to hold. The line is the
`enterSitelinks` the kind's source states, or the code's line for a monument and for a work.
Two kinds have none, and every absent entry of theirs is named: World Heritage, where being
inscribed is the whole rule, and Art Museums, which admits a museum through a work it holds,
so the museum's own sitelinks are not what the kind asks of it. An entry a reader
sees under another kind is still absent from this one, and the report says so.

**What a person has judged.** Each absent entry of a kind carries the ledger's line on that
gap, where there is one; a line judges one entry under one kind, and the same entry absent
from another live kind is bare there. The text names the absent entries nobody has judged and
counts the judged by cause, with the issues the judgements name: `absent and judged: 100: 90
door-missing (#628); 6 rule-defect (#1614, #1617); 4 not-a-must`. A judgement whose kind
offers the entry now, over or under the line, is stale: its gap has closed, and the report
lists it as a line to remove from `judgements.jsonl`. Whether a judgement's issue has closed is
not the report's to know; the `/coverage-check` skill asks GitHub for the issues the ledger
names.

**What a region offers that no guide names** (#1601). The lists are the yardstick in the other
direction too. For every surveyed region, `UNNAMED_SQL` reads the offered places with an
offered, published point within the region's `radius_km` of its centre none of whose
identifiers (`KNOWN_AS_SQL`, the same ids `MATCHES_SQL` matches by) matches an identifier an
entry of the region names. Each
comes with the kinds that offer it, its own sitelinks as its source recorded them (a museum and
an inscribed property carry none), its distance from the centre, and the ledger's line on it
where a person has judged it by its Wikidata id. The text names the unjudged ones least known
first, the order that finds the junk fastest, counts the judged by cause, and lists the
findings that stand: a row judged `not-a-must` or `rule-defect` that a kind still offers, which
the kind's rule or a curator answers with a refusal or a raised line. A row judgement no
offered place within reach carries any more is stale and listed with the stale entry
judgements. A place only its source's id names, an inscribed property with no Wikidata item on
its membership, is listed apart and counted apart, since the ledger cannot key on it: it does
not wait for a person, and the count that waits reaches zero without it.

## In Catalogue Checks

`expected-and-well-known-yet-not-offered` (`dataAssertions/coverageAssertions.ts`) says
the report's *What each live kind lacks* in the panel: one row per live kind and absent entry
at or over that kind's line that nobody has judged, the most named first, then one row per stale
judgement, said as the line to remove; and one line per live kind saying how many of the
expected it offers, how many it lacks under the line, and how many of what it lacks are judged
under each cause, with their issues, and how many wait for a person. It runs `coverageReport()`
and decides nothing of its own, so the command and the panel cannot disagree. With nothing
loaded it reports nothing as missing and says the lists have not been loaded.

`offered-and-named-by-no-guide` (the same file, #1601) says the report's *What a region offers
that no guide names* the same way: one row per place a person judged not worth a visit that a
kind still offers, least known first within each region, then one row per row judgement no
offered place within reach carries, said as the line to remove; and one line per region saying
how many offered places no guide names, how many are judged under each cause and how many wait
for a person. The unjudged are counted there and listed by the command, where a person reads
them in order.

## How the lists of 2026-10-02 were compiled

A list whose region carries `surveyed: 2026-10-02` was compiled, or compiled again, under the
rules the `/coverage-survey` skill now states. The first survey, a day earlier, took one place
per macro-region of the Administrative world view and counted Lonely Planet from the results
of searches of its site. An audit found that such a count was often not a reading: the name
stood in the search tool's summary, or the search had carried the name. Those lists were
rebuilt from their sources and carry the later date.

Each list is merged from:

- a model's own list, written before anything was read;
- Wikivoyage's articles for the place, its districts and its day trips;
- the guides whose sites may be read, among them one in a language visitors to the region
  read, where that is not English;
- a source written from inside the country: a tourism board or a guide written by residents;
- UNESCO's State Party page and its intangible-heritage pages.

In these lists every count stands on a page that was fetched and names the thing. The skill
also lets a site that may be read, but draws its pages by script, count through the titles and
URLs of a search of it, as a partial source; no list needed that in the end.

Whether a site may be read was decided once per site, from its `robots.txt` and its terms as
fetched, and applied to every list alike; the verdicts are
[`docs/sources/site-access.md`](../sources/site-access.md), and the sources the surveys read
from inside each country have their records under
[`docs/sources/sights/`](../sources/sights/). On that date Rough Guides, Routard, and Lonely
Planet's Italian and Spanish sites could be read. Lonely Planet's English and French sites,
Bradt, Time Out, Rick Steves, Moon, Marco Polo and National Geographic could not: their
`robots.txt` or their terms bar robots, mining or use by AI. Routard's terms bar automated
extraction save with the publisher's leave, and its `robots.txt` gives that leave: it allows
`ClaudeBot` and `anthropic-ai`, Anthropic's agents, by name, which is the one case in which
the skill's rule reads a site in spite of such a clause. Uzbekistan's national tourism site
bars something narrower, "automated scripts for mass copying of materials", which is kept the
way a limit on the rate of requests is: a few pages, one at a time. With the English guides
refused, a list often lacks an English guidebook and rests more on the source from inside the
country and on the own list than a reader might expect. The
weakest entry a list has is one whose two sources are the own list and one other.

Every entry of the first survey was filed under kinds twice, independently: by an agent per
region and by a structured-decision model (#929). Where the two differed the entry was read by
hand, and the kinds they both lacked were added to the register. ADR-0081 has the numbers. An
entry added since was filed by the surveying agent alone.
