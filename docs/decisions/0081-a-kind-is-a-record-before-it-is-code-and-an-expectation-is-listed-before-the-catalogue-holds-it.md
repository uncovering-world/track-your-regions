# ADR-0081: A kind is a record before it is code, and an expectation is listed before the catalogue holds it

**Date:** 2026-10-01
**Status:** Draft

---

## Context

Nothing in the repository says how much of what a traveller expects the catalogue holds, or
which kind of experience it most lacks.

The one measure there was, the traveller's guide test (#1162, 2026-09-30), listed ten cities
and, under each, places of the five kinds the product has. It had two faults:

- **It was shaped by the catalogue.** A place a traveller would file under a kind the product
  lacks was left out by rule, so the test could not say what to build.
- **It matched by name.** Its first run reported Sacsayhuamán as missing while the catalogue
  held it under Wikidata's label, "Saqsaywaman" (#1160).

A survey on 2026-10-01 measured the development catalogue against what guides recommend in
seven places, one per macro-region of the Administrative world view: the Cusco region, Rome,
Kyoto, Cairo, Mexico City, Sydney and Auckland. For each, one list was compiled from five
sources: a model's own list written before anything was read, Wikivoyage, the open pages of
Rough Guides, Lonely Planet as far as a search of its site shows it, and UNESCO's lists. An
entry counted when two or more of them named it. That gave 1000 entries, matched by Wikidata
and UNESCO identifier:

| | entries |
|---|---|
| in the catalogue | 150 |
| only a named point inside a serial World Heritage row (Nijō Castle) | 17 |
| absent, though a kind exists for it | 181 |
| a place no kind exists for (Piazza Navona, Bondi Beach, the Zócalo) | 417 |
| not a place: a dish, a drink, a festival, a route, an activity | 235 |

Of the 181, 17 clear the 22-sitelink line the sync rules use. Within 60 km of Auckland the
catalogue held no row.

Other facts that shape the decision:

- `docs/vision/PROPOSED-EXPERIENCE-CATEGORIES.md` describes 34 kinds to come and names no
  expected object under any of them.
- A source is already a record before it is code ([ADR-0048](0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md)
  decision 7), in `docs/sources/`.
- Intent lives in issues, and no document keeps a roadmap beside them
  ([ADR-0079](0079-each-kind-of-project-information-has-one-home.md)).
- A guide's selection is its publisher's: the names are facts, the choice of them is not
  (`docs/tech/filling-a-kind.md` § 5).
- Filing the 1000 entries under kinds was done twice on 2026-10-01, by an agent per region and
  by a structured-decision model (TypeSafe's Jev, #929), each without seeing the other. They
  agreed on 92% of 980 entries, and on 99% of the 668 the model was 0.9 confident of or more.
  The disagreements were read one by one, and they named six kinds the register lacked.

## Decision

1. **A kind of experience is a record before it is code.** `db/catalogue-coverage/kinds.jsonl`
   holds one record per kind, live or proposed: a slug, a name, one sentence saying what a
   traveller files under it, and what a member of the kind is — a place, a work inside a venue,
   a dish, a drink, an event, a route, an activity. A kind of dish or of festival is a kind
   like any other, with a record of its own; there is no bucket for what is not a place.
2. **A proposed kind's record points at its issue, where it has one, and says nothing else
   about when.** The mark that a kind is planned is the number of the issue that owns it; a
   kind nobody has filed an issue for carries none. Priority, order and milestone stay in the
   issue (ADR-0079).
3. **What a traveller expects in a region is listed before the catalogue holds it.**
   `db/catalogue-coverage/expectations/<region>.jsonl` holds one entry per thing two or more
   independent sources recommend in a surveyed region, whether or not the product has a kind
   for it. An entry is filed under zero or more kinds of the register, and only under a kind
   that holds what the entry is. Zero kinds means the entry is waiting to be sorted.
4. **A list is written from the traveller's chair.** It is compiled from sources the catalogue
   is not filled from, and a change of the catalogue never moves it.
5. **An entry is identified by an identifier, never by a name.** Its Wikidata id, a UNESCO id
   for an inscribed property, and the ids of other Wikidata items that are the same place (a
   building and the museum inside it).
6. **The files are the source of truth.** They are text, one record per line, changed through a
   pull request like code. A database may hold a copy loaded from them, replaced whole on each
   load and never edited by hand.
7. **Which commercial guide named what is not published.** A committed entry carries how many
   sources named it. The record of which ones stays local.
8. **The measure recommends and the issue decides.** A report built on these files is evidence
   an issue cites: it orders the proposed kinds by what the surveys expect of them, and it
   changes no priority.
9. **It is a development tool.** The maintainer and an agent read it; it has no admin surface.

Amended while Draft, on review of the pull request that proposes it: decision 2 said a
proposed kind's record "points at its issue", as though each had one. Most proposed kinds have
no issue yet, so the decision now says "where it has one".

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the lists in local files | Nobody else can read them, nothing reviews a change, and the first one already carried a false miss for two days |
| List only what the five live kinds should hold | That is the older test: it cannot say which kind to build, which was most of what the survey found |
| One "not a place" bucket for dishes, festivals, routes and activities | They are kinds of experience the product means to have; one bucket hides which of them the surveys ask for |
| Match by name within a radius | Wikidata labels and guide spellings differ (Saqsaywaman), and a miss by name reads as a missing place |
| A committed SQLite file | Binary: a pull request cannot show what changed, and two branches cannot be merged |
| Database tables as the source of truth | The lists would live in one database and not travel with the repository; ADR-0048 rejected a table "before anything reads it" for the same reason |
| The kinds and their expected objects in issue bodies | A thousand entries are not readable there and no code can check them |
| YAML files | No YAML parser is a runtime dependency; a line of JSON per record needs none and diffs one record per line |
| Keep the kinds' list in the vision document alone | It has no slug to file an entry under and no place for the issue that owns a kind |

## Consequences

**Positive:**
- When a kind's turn comes, its test data exists: every expectation filed under it, in every
  surveyed region.
- The order in which kinds are built can rest on a count taken from independent sources.
- A place every guide names and the catalogue lacks is a line in a file, found again after
  every sync.
- A wrong line is refused before it is merged: the reader names the file and the line.

**Negative / Trade-offs:**
- A kind's name is written in two places for the live kinds, the register and
  `experience_kinds`. The load that copies the files into the database holds them together.
- The register and `PROPOSED-EXPERIENCE-CATEGORIES.md` both name the proposed kinds. The
  register is the list; the document keeps the descriptions and is named on each record.
- A list ages: sitelinks and coordinates are the survey date's, and a region is surveyed again
  to refresh them.
- Filing an entry under a kind is a judgement, and so is the register's vocabulary. The first
  filing changed the register six times.
- Lists compiled without a rule of size differ in length, from 57 entries to 222 in the first
  survey. A region's share is comparable with another's; the sums are not.

## References

- Related ADRs: [ADR-0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md),
  [ADR-0048](0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md),
  [ADR-0079](0079-each-kind-of-project-information-has-one-home.md)
- Related docs: `docs/tech/catalogue-coverage.md`, `docs/tech/filling-a-kind.md` § 5
- PR / issue: #1202 (the Epic), #1203
