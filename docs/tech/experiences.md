# Experiences System

This document describes the current Experiences implementation: data model, assignment logic, curation, and API surface.

## Overview

Experiences are location-based entities linked to regions. The system supports:

- Public browsing and map visualization
- User visit tracking (experience-level and location-level)
- Flexible location model (0, 1, or many locations per experience)
- Curator workflows (reject/edit/assign/create)
- Multi-source ingestion (UNESCO, museums, monuments, places of worship, archaeology)

## Kinds and sources

Two words, decided apart in [ADR-0045](../decisions/0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md). A **kind** is what a traveller browses by — what they would call the thing in front of them: a World Heritage site, an art museum, an archaeology museum, a monument. Each kind is its own list, pin colour and count. A **source** is a list we read to fill a kind — the UNESCO API, a Wikidata query — and is not something a visitor sees. A kind may have several sources and a source may feed several kinds; a kind is offered to readers only once it has a sync of its own and a rule that says what complete means for it — a partial list other imports happened to fill is not offered. A place can belong to several kinds at once (Cologne Cathedral is a World Heritage site and a cathedral), and a visit recorded on the place is seen through every membership.

### Glossary

Four concepts, and the words this document and the code use for each (Epic #815 is the vocabulary landing in code; ADR-0045 is the decision):

| Word | What it is | Where it lives today | What the code calls it |
|---|---|---|---|
| **Kind** | What a traveller browses by — a World Heritage site, an art museum, an archaeology museum, a monument. Siblings: each its own list, pin colour and count, each with a sync of its own and its own rule of what complete means — a kind's sources are that sync's inputs (ADR-0045 §1, §2, §3) | `experience_kinds` (#822), and a place's membership in it is a row of `experience_kind_memberships`; a reader-facing row carries its kind off that membership (`rowKindJoinSql`, #819) | `kind_id`, `kind_name`, `kind_priority`, `kindId`; `experience_kinds`; the chip beside an object's name on a review card, the Discover pills and `?kind=`, the group headers, `kindColors.ts` |
| **Source** | A list we read to fill a kind — the UNESCO API, a Wikidata query — an input of the kind's sync, carrying its own gate (§3, §7); the sync and the rule of completeness are the kind's. A kind may have several; one source may feed several kinds | `experience_sources` — one row per source, the row the sync service is registered under, naming the kind it fills (`kind_id`, #822); named `experience_categories` until migration 055 (#819) | `experience_sources`, `source_id` on `experiences` (the row's identity arbiter until #755), on `experience_sync_logs`, on a membership and on the caches, the curator scope `'source'`, `requires_curation`, the admin panel's Sources tab and its routes (`/api/admin/sync/sources/…`) |
| **Tier** | Which of a kind's two fillings a source belongs to ([ADR-0048](../decisions/0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md)): the **world tier** — a global source ranks the world on one signal and a line is drawn, the Iconic badge is its (§5) — or the **regional tier** — a source native to its own unit (a country's register, a city's list, a curator) enumerates what the unit holds and the kind's rule cuts within it, no badge. A region's list is both together; the rules, the scorecard and the register of sources looked at are [filling-a-kind.md](filling-a-kind.md) and [`docs/sources/`](../sources/README.md) | Not a column yet: every source that exists — World Heritage, Art Museums, Public Art & Monuments, Places of worship, Archaeology — is world tier; the first regional source (#628) records its tier on its `experience_sources` row | — |
| **Type** | A distinction inside a kind whose members a traveller still browses together — cultural / natural / mixed, monument / sculpture, cathedral / church / chapel / monastery / mosque / temple / shrine / synagogue, site / museum — and none for an art museum (§1, #814) | `experiences.type`; the vocabularies in `frontend/src/utils/experienceTypes.ts` | `type`, `?type=`, `TYPE_COLORS`, `typeOptionsFor` |
| **Treasure type** | What kind of thing a work is, independent of its venue's kind and type | `treasures.treasure_type` | `treasure_type` |

**Every reader says which of the two it means** (#819). A reader that means the kind reads the membership's `kind_id` — through `rowKindJoinSql` / `rowKindSelectSql` (`backend/src/db/membership.ts`), which join the membership the row's own source brought and the kind it names, so a list row, a search result, a visit, a review card and the counts all carry `kind_id`, `kind_name` and `kind_priority`; the kinds are listed by `GET /api/experiences/kinds`. A reader that means the source reads the source row under its own name: migration 055 renamed `experience_categories` to `experience_sources` and every `category_id` that pointed at it to `source_id` (on `experiences`, `experience_sync_logs`, `curator_assignments`, `wikidata_query_cache`, `wikidata_cache_policy`), and the curator scope that names one is `'source'`. The word *category* is gone from the schema and the code, apart from the guards that remember the `experiences.category` column #814 retired; in the sections below *kind* is what a reader browses by, counts, admits and refuses, and *source* is a run, its gate, its cache, its log, its scope. The vision documents use the same words ([`EXPERIENCE-TYPE-AND-SIGNIFICANCE.md`](../vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md), [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md)).

**What the code holds today** is three tables for the two words (#822, ADR-0045 decision 4). `experience_kinds` is what a traveller browses by, five rows seeded under the ids of the sources that fill them — `World Heritage Sites` (1), `Art Museums` (2), `Public Art & Monuments` (3), `Places of worship` (4), `Archaeology` (5) — so a reader keyed on those ids reads the same colour and order either way and switching it (#819) is a join, not a renumbering. `experience_sources` is the source table — one row per sync service, with its endpoint, its config, its gate (`requires_curation`, ADR-0025), its `display_priority` (lower first) and the kind it fills (`kind_id`) — and it is what a run, its gate, its cache, its log, the curator scopes and the admin routes key on; what a reader browses by — the groups of the map-mode list, the Discover pills, the pin colour, the chip on a review card — reads the kind off the row's membership (#819). Five rows exist, each the only source of one kind:

- `UNESCO World Heritage Sites` (priority `1`) — fills World Heritage Sites
- `Art Museums` (priority `2`) — fills Art Museums with the works-first selection (ADR-0023); the row read "Top Art Museums", the selection rule's name, until migration 045 gave it the reader's (ADR-0045 §8, #818)
- `Public Art & Monuments` (priority `3`) — fills Public Art & Monuments
- `Places of worship` (priority `4`) — fills Places of worship from Wikidata through two doors, a place's own fame and the fame of a work it holds (ADR-0052, #753). Seeded by migration 050 with two things the three before it do not carry: its fame line on the row (`api_config.enterSitelinks` 22, `staySitelinks` 18, § Places of worship below) and `requires_curation = true`, so a community-edited source's first rows wait for a curator (ADR-0025)
- `Archaeology` (priority `5`) — fills Archaeology from Wikidata, sites and museums in one list, both doors built — museums from Wikidata and English Wikipedia, sites from Wikidata with OpenStreetMap as the second signal (ADR-0058, ADR-0059, #581, § Archaeology below). Seeded gated by migration 056, with **two** fame lines on the row rather than one: `enterSitelinks` 22 / `staySitelinks` 18 for a place, `findEnterSitelinks` 18 / `findStaySitelinks` 15 for a find, a find carrying fewer Wikipedia articles than the museum that shows it

`experiences.type` is the **type within a kind** (#814; the column was called `category` until then, the word the rest of the code used for the kind and its source until #819): one closed vocabulary per kind, `cultural` / `natural` / `mixed` for World Heritage and `monument` / `sculpture` for public art, `cathedral` / `church` / `chapel` / `monastery` / `mosque` / `temple` / `shrine` / `synagogue` for a place of worship, `site` / `museum` for Archaeology, and **NULL for an art museum** — an art museum and an archaeology museum are two kinds, not two types (ADR-0045 decision 1), while `museum` as an Archaeology type says which of that kind's two things this one is, the excavation or the museum of its finds (ADR-0058 decision 1). Until #814 every museum row carried the literal `art`, written by the museum sync, which is why the archaeological museums of Naples, Athens and Cyprus, the Church of Our Lady in Bruges and the Roman Forum, all admitted for one famous work, were typed `art` too (ADR-0045's context counts them against Wikidata as of its date). `utils/experienceTypes.ts` is the one place the vocabularies live: the dialogs offer a kind its own list and a museum none, and the review card explains a proposed type in the words of the vocabulary its value is from. A place is one row of `experiences` and each of its memberships in a kind is a row of `experience_kind_memberships` (below); a monument that is also a World Heritage point is still two places today — the Statue of Liberty is ids 382 and 11565 — and becomes one place with two memberships by #755's merge. Refusal as a curator-confirmed withdrawal of one membership (ADR-0045 decision 6) lands with #755 as well; today a refusal is the run's write on the membership, and the curator confirms or overrides it.

**"Holds treasures" is derived, never stored** (ADR-0052 decision 8). A place says how many things there are to look at inside it from the offered links themselves: `treasure_count` is counted per row beside the region read (`experienceRegionQuery.ts`), by the same predicates the treasures endpoint uses — `offeredLinkSql` for a link the source still places (ADR-0044) and the published state on both the link and the work (ADR-0025) — and `TreasuresInsideChip` draws it as "3 treasures inside" on the map-mode row, the Discover card and both hover cards. No column and no flag a run has to remember to keep in step. The chip is silent for the kinds whose row lists its holdings already — art museums (`kind_id` 2) and Archaeology (5), whose museums hold finds the row lists the same way — where the count is the point of the card rather than a side note; every other kind that links treasures gets it wherever the count is above zero. A church admitted for its own fame counts zero, one admitted for its *Pietà* counts it.

**How two rows become one place** is [ADR-0046](../decisions/0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md). A place has an identity of its own, assigned by us; a source's id — a Wikidata item, a World Heritage id — is a property of a membership, and for a serial World Heritage site identity is decided per location. Two signals are universal: an equal Wikidata item merges without a question, and coordinates within a threshold that grows with the place's extent plus a name at trigram similarity 0.5 or better produce a proposal a curator confirms through the same gate as every other open decision; distance alone proposes nothing, and each kind adds its threshold and any signal of its own. A merge keeps both rows in the history and can be undone. A second relation, **part of** (the Neues Museum on Museum Island, a monument on Red Square), comes from Wikidata's *part of* / *location* chains, from a site's boundary polygons once #714 sources them, or from geometry as a curator's proposal; a visit to the part marks the whole visited, never the reverse — and never across a serial World Heritage site, where a visit is recorded on the location and whether the site as a whole counts as visited is #768's decision. **The place and the membership exist since #822; the merge, the signals and "part of" do not**: `metadata.wikidataQid` is written by the syncs and read only to label or hide it on a curator's card (`fieldMeaning.tsx`), never to match one row with another; a source's id is still the place's key (`UNIQUE(source_id, external_id)`) rather than the membership's; and `user_visited_experiences` / `user_visited_locations` record a visit against the row, with no cascade (#823). The rows that the two signals already match are listed on #780 and #755.

### The place and its memberships (#822)

Three tables hold what one row held (ADR-0045 decision 4; the calls this slice took are ADR-0045 §5 and §7 read to the letter — the badge and the gate state are a membership's):

| Table | What it carries |
|---|---|
| `experiences` — the **place** | identity (`source_id` + `external_id`, the upsert's arbiter until #755 moves a source's id onto the membership — ADR-0046 decision 1), name, description, `type`, `location` and `boundary`, picture and credit, `tags`, `metadata`, what a source observes about the row (`missing_since`, `source_membership`, the provenance pointers) and what the world says of it (`existence`), the curator's claims on those fields, who decided a verdict and when (`state_decided_*`), the visit |
| `experience_kinds` — the **kind** | `name` as a traveller says it, `display_priority`; ids equal to the sources' until #819 |
| `experience_kind_memberships` — the **membership** | `experience_id` + `kind_id` (unique), `source_id` (the source that brought it — ADR-0045 decision 3: a kind may have several, and a run writes, refuses and badges only what its own source brought), `admission` and `admission_reason` (ADR-0024), `admitted_for` (the work that qualified a museum, ADR-0023 — the run's own bookkeeping, never a question for a curator), `is_iconic` (the world tier of the kind, decision 5), the curator's pins on those two (`curated_fields`, the shape the place's has), and the gate state of the arrival — `curation_state`, `published_at`, `pending_change_sync_log_id` (ADR-0025; per member, decision 7) |

What follows from the split, in the code as it stands:

- **A reader-facing read asks admission and the gate of the place through its memberships.** `db/membership.ts` is the one spelling: `placeAdmittedSql` (some membership admitted), `placeVisibleSql` (some membership passed) and `placeOfferedSql` (both, of *one* membership — the composition matters the day a place has two, since one membership admitted and another passed is offered by no single kind). `hideRefusedSql`, `hidePendingSql` and `experienceOfferedToReaderSql` in `db/readerPredicates.ts` delegate to them, so every list, count, search and map feed reads as it did — a place has exactly one membership today, and migration 046 refuses a database where it does not.
- **A run writes the membership beside the place** (`experienceUpsert.ts`): the kind read off the source, the source, `admitted_for`, and the gate state of the arrival — `pending` with no `published_at` under a gate, `auto` and now otherwise. The hold (a gated source may not overwrite what a reader can see) is a question about the memberships now, which is why the upsert became one transaction per object that locks the place in a statement of its own and reads the hold in the next — see § Change provenance. The admission writes (`admission.ts`), the held-proposal pointer and the curator-pass decay target the membership the run's own source brought.
- **A curator answers the membership** where the endpoint is keyed on the place — `/:id/publish`, `/:id/decline-held`, `/:id/admission` — through `membershipToAnswerSql`: the one waiting for a publish or a decline, the refused one for a verdict, the place's only one until #755 makes a second and its API names it. The publication and the verdict land on the membership; the content, and who decided and when, on the place.
- **Counts follow ADR-0046 decision 8** (`experienceCounts.ts`): a kind's count is of memberships — `/kinds`' `experience_count` and the tree's per-kind counts — and a region's count is of places; equal today, apart from the first merge.
- **Two catalogue checks state what every reader rests on**: `place-without-membership` and `membership-source-disagrees-with-row` (`experiences.source_id` and the membership's `source_id` name the same source on every row).
- **One gap, on purpose, until #755**: the hold asks whether a reader can see the *place*, so a gated second membership of a place another source made visible would be held by the upsert — and the pointer is set only on a visible membership of the run's own source, so that proposal would get no card. The shape arrives with the merge, whose design it is.

### What #819 switched, by what it meant

The inventory this section held — every reader of `category_id` on both stacks, tagged *kind* or *source* — was the checklist #819 was reviewed against; what is left of it is the shape each side took.

**Kind** — read off the membership the row's own source brought, one row per place (`rowKindJoinSql`; a place in two kinds, #755, decides whether a region's list shows it under both): the map-mode list's groups and headers, Discover's pills, lists, cards and hover, the address (`?kind=`, read as `?cat=` too for a link shared before), pin and card colours (`utils/kindColors.ts`, `experienceColors(kind_id, type)`), the treasures-inside marker (silent for kind 2), the counts (`GET /api/experiences/kinds`, `region-counts`' `kind_counts`), the type vocabulary per kind (`typeOptionsFor(kind_id)`), search results and the visit list (`?kindId=`), the review card's chip and the queue rows (`kind_name`, beside the row's `source_id` for the feed's source filter), the kind a curator picks when creating a place (`kindId`; the row is filed under that kind's own source).

**Source** — the source row under its own name: the admin sync panel and its routes (`/api/admin/sync/sources/:sourceId/…`), the fame line, the sync services and everything a run writes (`sourceId` in `SyncServiceConfig`, `experience_sync_logs.source_id`, the cache key of ADR-0047 on `wikidata_query_cache.source_id`), the gate and the curator scope (`curator_assignments.source_id`, `scope_type = 'source'` — the word migration 001 created it with, which #452 found the type still saying), the "New" window (`new_badge_days`, read through the membership's source), the catalogue checks and the e2e fixture.

## Core Data Model

### Main tables

- `experiences`: the place (`location`, optional `boundary`, the curator's claims, what a source observes about the row)
- `experience_kinds`: what a traveller browses by (ADR-0045 decision 1); five rows under the sources' ids
- `experience_kind_memberships`: a place's membership in a kind (ADR-0045 decision 4, #822) — the source that brought it, the admission verdict and its reason, `admitted_for`, the must-see badge, the curator's pins on those, and the gate state of the arrival
- `experience_regions`: assignment to regions (`assignment_type = auto | manual`)
- `user_visited_experiences`: per-user visit state
- `experience_sync_logs`: sync audit log by source (`source_id`)

### Location model

An experience can have zero, one, or many locations. Location-bound experiences (museums, monuments) have physical coordinates; non-location-bound ones (books, films) are tied to regions conceptually. Multi-location experiences (UNESCO serial nominations) have independently trackable child locations.

- `experience_locations`: locations per experience (0..N)
- `experience_location_regions`: region assignment per location
- `user_visited_locations`: per-user location visits

**Where a reader is told an object is** ([ADR-0028](../decisions/0028-a-reader-is-positioned-by-places-they-can-go-to.md)). An object carries a coordinate of its own, `experiences.location`, and its places carry theirs. They are independent answers, and they disagreed by more than a kilometre for 106 objects and by up to 191 km (#502) — a list row and a map pin naming different countries for the same site. Every reader-facing read now positions an object with `readerPositionSql()`: **the place nearest the object's own published coordinate**, falling back to that coordinate for an object with no visible place.

One rule, and no tolerance in it. For most objects — nine in ten on 2026-09-22 — the coordinate already *is* one of the places, so the distance is zero and nothing moves; of the rest the average move is 9.5 km, and the largest are the ones the issue was opened about — Wet Tropics of Queensland 191 km, Gondwana 171 km, Virgin Komi 144 km. The rule ADR-0028 first proposed — the coordinate when it matches a place to within ADR-0027's ten metres, the medoid otherwise — was measured and dropped: it is discontinuous, moving eight objects over 100 km because their coordinate misses a place by a few hundred metres, the worst of them 2068 km. Nearest is measured in metres, on `geography`, never in degrees: 42 multi-place objects sit above 60° — Struve Geodetic Arc's 34 points reach 70.7°N — where a degree of longitude is a third of a degree of latitude, and degree ordering was measured picking a further place for six objects. A tie is broken by `el.id`, so the two axes always name one place. The places considered are only those the same reader may see, so an object is never positioned at a point that reader is not shown — except that the caller which shows a curator an object the queue has not passed yet relaxes the same gate here, because a curator deciding a coordinate has to preview where publishing will put the pin rather than the anchor they are deciding against. It cost 25 ms on a whole-region read of Europe's 661 experiences and the 3725 places under them, measured 2026-08-19.

`experiences.location` is kept and stays visible to a curator: it is what the source published, and judging a coordinate needs both values. What it stops being is the object's position for a reader.

**A location is marked, never deleted.** When a run offers an experience without one of its
stored points, `locationWriter` sets `experience_locations.missing_since` and nulls the row's
`ordinal` instead of removing it. Deleting it would take the row's `user_visited_locations`
record and every `experience_location_regions` row with it — both are `ON DELETE CASCADE`,
manual assignments included — and a person's record of having stood somewhere is the one thing
no later run can rebuild. A source that offers the point again finds the same row by its
`(point, external_ref)` identity, clears `missing_since`, restores its ordinal, and sends it
for placement; the visit and any manual assignment were never touched.

**Identity's point half carries a ten-metre tolerance, and only inside a matching reference**
([ADR-0027](../decisions/0027-a-point-rewritten-more-precisely-is-the-same-point.md)). The writer
compared the geometry exactly until 2026-08-16, so a coordinate rewritten in its last float digits
was a different place — a withdrawal, an arrival, a pin off every reader-facing read and a card with
no true answer, for a point that never moved. It is the World Heritage list's own shape that makes
this a catalogue-scale risk rather than a curiosity: coordinates are published as degrees, minutes
and seconds, the conversion lands on six decimals, and **1642 of 6680 stored points sit on exactly
such a rounded value** — so one re-publication at full precision would have withdrawn a quarter of
the pins in a single run. The tolerance is `LOCATION_UNCHANGED_METERS`, the same ten metres the
experience's own coordinate already uses in `changeSet.ts`, and it is deliberately below the width of
the thing being pointed at: a source re-centring a park by two kilometres still reads as a move and
still raises a card, because that is editorial judgement about a place. The reference travels with
it — a tolerance alone would be a nearest-point search over an object's own points, and 4172 pairs of
points of one experience lie within a kilometre of each other, many at 0.000 m, since what separates
two rock-art shelters in one cliff is the component number rather than the metres. Where an incoming
point carries no reference the comparison stays exact, there being nothing to hold the tolerance to
one component. `samePointSql()` is the one fragment every site that asks composes, and only two do —
the relation the pairing is built from and the fast path's `matched` term. Everything else reads the
pairing — every statement after the one that decides it, which is the five arms that keep, resurrect,
insert, withdraw and hold, the statement that lets go of a spent pairing, and the lookup that decides
which point an arrival replaces. The lookup asks it for a reason of its own — the set it withdraws
from has to cover every row the mark will mark that a reader can see, or a run applies one it should
have held, and under a gate that takes a visible pin off the map with only an invisible arrival to
replace it. Cover the visible ones rather than equal the set: the lookup deliberately keeps a row whose
holding arrival the run is itself withdrawing — or a point moved twice before anyone published loses
the handle its replacement needs — and deliberately draws only on the rows a reader is actually
offered, which is all three of `missing_since IS NULL`, `existence <> 'lost'` and
`curation_state <> 'pending'` where the mark asks the first alone. A slot spent on a row nobody can
see leaves a visible pin unheld, and the `existence` term is the one easily missed: a point a curator
answered "no longer exists" on, offered again by the source, comes back with `missing_since` cleared
and that verdict deliberately untouched.
So a point cannot match for one statement and not another. The pairing is decided once per run and
materialised, not restated as a CTE by each arm: the keeping arm's own write moves a row off the
points it was near, so a re-decided pairing would change under the arms that follow it and leave a
row on the negative ordinal the parking step gave it, to collide with the next run. Because
the tolerance gave away the injectivity the exact comparison had for free, the arms read a pairing
made one row per point and one point per row, preferring the row that is not marked and then the
nearer one — which under a gate is not the same as preferring the row a reader can see, since a
`pending` arrival sitting on the source's own coordinate ties on the first term and wins on the
second. A row the slow path keeps adopts the source's coordinate; a row whose object changed in no
other way is matched by the fast path and keeps the value it has, so the catalogue goes on serving a
coordinate the source retired — within ten metres of the published one, which is a distance no
traveller can stand in the wrong place at, and cheaper than a transaction per object to chase the
last digits. A row the arm *did* move goes back for region placement whatever the distance, because a
region's edge is a line and a rewrite of a centimetre across one is a different country — and nothing
would revisit the row afterwards, the fast path matching its new coordinate on every later run. The
pairing is greedy, so where a source lists two points of one reference between ten and twenty metres
apart it can miss a pairing that exists, costing one withdrawal that did not happen (#549); no source
in the catalogue is shaped that way, its nine multi-reference points standing either a centimetre or
14 km apart. `db/migrations/026` collapses the pairs the old comparison
already wrote and names any pair it leaves standing: it deletes the marked row where no visit and no
region assignment hang off it, and the held pending arrival where no visit does — that row's `auto`
placements are spent knowingly, being recomputable and on no reader-facing read.

**A point that moved is a withdrawal plus an insert, and under a gated source the two halves
become visible at different moments** — so the withdrawal waits for the insert
([ADR-0025](../decisions/0025-per-source-curation-gate.md) decision 5). The insert lands
`pending`, invisible; applying the withdrawal in the same run would take the old pin off the map
while its replacement could not be seen. Measured 2026-08-11, 1119 of the catalogue's 1604
experiences hold exactly one point — 788 of 1272 UNESCO World Heritage Sites, all 128 Top Art
Museums, 203 of 204 Public Art & Monuments — so for most of them that is an object still in every
list with nothing on the map.

So `locationWriter` writes the pairing instead: `experience_locations.withdrawal_deferred_for_location_id`
sits on the **arrival** and names the point it replaces, so publishing the arrival reads the
pairing off the row it is publishing rather than searching for a partner. The held point keeps
`missing_since` NULL — every reader still sees it — and loses its `ordinal`, which is not
cosmetic: ordinals are unique per experience and every later run parks the positives at their
negatives before renumbering, so a held row that kept its number collides with its replacement's
the moment anything else about the object changes, and the whole write for that experience dies
on the unique key. NULL is also what that column already means for a row the source no longer
lists.

**Only a point a reader can actually see is a candidate to be held.** An unread point costs a
reader nothing when it goes, so it is withdrawn at once — and letting one compete to *be* the held
point builds a chain that no path can take apart. Traced end to end: a gated site shows `P(r1)`; a
run renumbers and moves it, so `A1(r2)` holds `P`; before anyone publishes, the next run moves it
again, `A2(r2)` matches `A1` by reference, and `P` is left over with no arrival — surviving only
because `A1` still names it. Publishing `A2` withdraws `A1` but `A1` keeps naming `P`, and `A1` can
then never be published (`missing_since IS NULL`), never be revisited by the statements that touch
offered rows only, and never be deleted (nothing in the backend deletes a location, so the foreign
key's `ON DELETE SET NULL` never fires). `P` stays visible beside `A2` for ever: two pins on a
one-point site, one at a coordinate the source retired two runs ago, recoverable only by
hand-written SQL. The release carries a second guard for the same failure — it clears the released
row's own pairing — so a chain arriving by some other route is repaired within one source interval
rather than never; prevention and floor, both deliberate.

The pairing has to be *created* here, because nothing else in the run knows it: the writer
returns aggregates, and the withdrawal `UPDATE` does not report the ids it marked. The key is
the reference — `external_ref` is populated on all but one stored location, and for museums and
landmarks it is the experience's own Wikidata id, so it cannot change while the experience does
not. Withdrawals and arrivals are numbered within a reference and paired by position, then
whatever the references could not pair is paired by position alone. All three imperfections in
the key therefore hold rather than apply, and each is a measured shape rather than a
hypothetical:

- **nine `(experience_id, external_ref)` pairs are duplicated**, across nine objects — a
  component crossing a border is listed once per country under one reference. The row numbers are
  what stop both withdrawn rows pairing to both arrivals, since each arrival can name only one
  point;
- **one location carries no reference at all** (8754, "Routes of Santiago de Compostela in
  France"), and it is that experience's only point — so the match is `IS NOT DISTINCT FROM`
  rather than `=`;
- **a renumbered component changes the reference itself**, so no match by reference is possible,
  and all but one of the single-point UNESCO sites carry a component reference. This is what the
  by-position pass is for, and a renumber does not even have to move the point to blank the map
  without it.

What that buys is a count rather than a hope: exactly `min(withdrawals, arrivals)` withdrawals
are held, so the points a reader can see after a run are
`min(what they could see before, what the source now offers)` — and therefore **never zero for an
experience the reader could already see a point of.** The qualifier is load-bearing: an experience
whose only point is a first arrival has nothing visible either way, because the arrival is gated,
and no withdrawal-pairing can conjure a pin the curator has not published. What the pairing
guarantees is that a run never empties a map that had something on it.

Stated that way rather than as "never below the source's list",
which is not what happens: an arrival is gated, so a run that adds more points than it drops
leaves the visible count below the new list, deliberately, until a curator answers. The cost is
holding a point the source really did drop until an unrelated arrival is published — the visible
mistake rather than the invisible one, which is the trade ADR-0025 decision 5 asks for.

A withdrawal with no arrival left to hold it is applied at once, exactly as before. So is one
whose arrival the source withdrew in turn, since that arrival can never be published — the
publish statement carries `missing_since IS NULL` — so the withdrawal statement clears the
pairing of every row it marks. That case takes one further run to take effect, because the
arrival still looks offered while the statement withdrawing it decides what to pass over. And a
pairing whose point the source starts offering again is dropped by a statement of its own: no
withdrawal is left to hold, and a pairing left standing would hide a point the source offers the
moment the arrival is published.

None of this changes an ungated run: every point such a run inserts lands `auto`, so the pairing
statement is skipped outright when the insert returned no `pending` row, and the two housekeeping
statements match nothing. Verified by running the same fixture on both sides of the commit:
identical return values and identical rows. `requires_curation` is false on World Heritage, Art Museums and Public Art & Monuments, the
sources that predate Places of worship, which is a fact about the data rather than a property to rely on — an
admin gates a source in one click, and from then on this paragraph describes only the sources they
left alone.

`missing_since` here is a machine observation, exactly as it is on an experience. What a reader
sees does not change, because a withdrawn point used to be deleted and so left every list the
moment a run stopped seeing it: the predicate `missing_since IS NULL` keeps it out
of the marker batch, the experience's own location list, `location_count`, the per-user visited
status, "mark all locations visited", the visit a viewed treasure records for its venue, and
region placement. Every one of them takes it from one fragment, `offeredLocationSql()`
(`db/readerPredicates.ts`), placement included: the fragments live in `db/` so the sync
services compose them too (#791).

Since [ADR-0026](../decisions/0026-a-run-records-what-a-container-holds.md) that fragment carries a
second term, `existence <> 'lost'`, and it is the location half of the pair an experience has
always had. A curator can now answer for a point, and one of the answers is that the component is
gone from the world; the source may go on listing it, and the run's `returned` arm clears
`missing_since` when it does — so without the term a demolished component comes back on the map.
Not a hypothetical: the catalogue's one withdrawal is a point that left and returned (#543).
`source_membership` is deliberately absent from the fragment, exactly as it is from an experience's
reads: `former` says the source stopped listing the point, and hiding on that would let a curator's
reading of a list remove a place that is still standing. What keeps a `former` point off the map is
its `missing_since`, which the verdict leaves standing. The "show what is gone" affordance is about
objects only — a reader who asks for lost experiences still gets no lost *points*, because a
withdrawn point has never been something a reader is shown. The rule is not "visits are exempt" but a line between two kinds of
statement. **Removing what a reader asked to remove** — clearing a visit, and the lookup of which
experience it belonged to — is unfiltered, because a record on a point they can no longer see could
otherwise never be cleared. **Recording** one is not, and stopped being so at ADR-0025: an id can be
guessed, and under a gate the thing being hidden is the row's existence, so "they were shown it"
became something the server has to check rather than assume. `markLocationVisited` resolves the row
through `offeredToReaderSql()`, which composes this fragment — so both of its terms bind there too,
and a curator's `lost` verdict makes a point unrecordable as well as unshown. **What the system decides on their behalf** carries the
filter: every read that puts a point on screen, the per-experience progress view included, and
equally the count that infers from what remains whether the experience-level visit record
should go with the last visible tick. So both unmark handlers hold an unfiltered DELETE beside
a filtered count, which is that one line drawn through a single handler.
That view counts offered points only because identity is the point together with the source's
reference: an edit to either — a component moved more than ten metres, a renumbered one — is a
withdrawal plus an insert, and the reader would otherwise meet the same place twice.
`getVisitedLocationIds` is not one of the unfiltered reads, and the argument that it could be — every
consumer uses it as a set-membership test over a list that is already filtered, so it draws no pin
and inflates no count — is not the one the code makes. It carries all four predicates: the curation
gate, the content gate, `admission`, and both terms of the offered fragment. It has to, because it
supplies the ticks a client draws while `getExperienceVisitedStatus` supplies the "n of m" a badge
reads: filter the two differently and they disagree about one traveller's own record, which a reader
meets as **3 of 2**. The consequence, which nothing else states, is that a tick on a component a
curator declared `lost` leaves this map. The
visit row itself is untouched by any of it, and the traveller's history is not lost either:
`visited-experiences/ids` carries no lifecycle predicate at all, deliberately, and a record of
somewhere that has since left the catalogue belongs there.

**`curation_state` does not get the same exemption, on the read or on the writers beside it, and
getting that wrong once is the reason this paragraph exists.** Issue #520 argued the opposite —
that none of `markLocationVisited`, `markAllLocationsVisited`, `markTreasureViewed`'s auto-mark, or
`getVisitedLocationIds` needed a `curation_state` gate, because "a `pending` location cannot have
been visited": nobody sees it, so nobody clicks it. That argument treats the write path as a
closed question the read paths already answered, and it is not — `markAllLocationsVisited` and
the treasure auto-mark each run their own `SELECT`/`INSERT ... SELECT` deciding *which* locations
count as "all" or "this venue's", independently of whatever a reader was shown, and
`markLocationVisited`'s single-mark lookup ran with no lifecycle predicate at all. Before this
gate, "mark all visited" on a museum with an unread new wing would write a visit to every one of
its `pending` points and answer `locationsMarked` with a count that disclosed the size of the
unread set; viewing one treasure would auto-mark every unread location of its venue the same way;
and a location id guessed or replayed against the single-mark endpoint would both write a
manufactured visit *and* echo the pending row's own name and its experience's name back in the
response — the one place a `pending` row's content reached a caller with no scope at all. All four
now carry `curation_state <> 'pending'`, on the container and on the location, unconditionally —
no curator relaxation, since these are a caller's own record, not one of the by-id reads
(`getExperience`, `getExperienceLocations`, `getExperienceTreasures`) —
and the read agrees with the (now-fixed) writers rather than assuming, as #520 did, that they could
never produce what it would otherwise have to filter.

**The same shape, one table over, twice.** The warning above — "the same reasoning would be wrong
again for a treasure's view, if repeated there" — was not hypothetical. A second review pass found
three more sites carrying exactly the pattern this section describes, none of them about a
location:

- `markVisited` (`experienceVisitController.ts`) verified an experience existed with no
  `curation_state` predicate at all, so a guessed id for a `pending` row got its name echoed back
  and a `user_visited_experiences` row written for a row no read had ever shown the caller — a
  thirteenth reader-facing read, reached by manufacturing history instead of by any GET. It now
  carries `experienceOfferedToReaderSql` — the refusal predicate as well as the gate, which is the
  experience-level half of what `markLocationVisited` carries and the whole of what
  `markNewBadgesSeen` does. The first attempt carried the gate alone and a later review found it:
  the same hole one column over, since a refused row is equally absent from every read and equally
  permanent in the visit record once written.
- The traveller's own record keeps `existence`, `admission` and `missing_since` exempt on purpose,
  and it is not the same exemption as a gate: someone who saw Palmyra before 2015, stood in a
  since-refused museum, or visited a since-withdrawn point still did those things, and a record of
  that cannot depend on what the row says today. The ids read (`getVisitedIds`), the one read of
  that record, filters on no axis; it needs no `curation_state` filter either, since a visit to a
  `pending` row could only be the manufactured kind `markVisited` no longer writes.
- `markTreasureViewed` had two more ungated lookups above the location auto-mark this section
  already covers: the treasure lookup itself (gated on its own `curation_state`, so a guessed
  treasure id 404s before its name could be echoed back or a `user_viewed_treasures` row written for
  it) and the link check that decides whether to auto-mark the venue (gated on the container's
  `curation_state` and the link's own, so a caller who could see the treasure but not this
  particular museum, or not this particular link, gets the auto-mark silently skipped rather than a
  `pending` experience marked visited and its name echoed back).

A fifth writer turned up after that list was written, which is the useful part of this section rather
than a footnote to it. `markNewBadgesSeen` records that a reader has seen an object's "new" chip and
answers with the ids it accepted, so unfiltered it confirmed that an unread row exists and wrote a
sighting of a chip that had never been on screen. It now carries `admission` and the gate, and
`existence` stays out for the reason above — a chip seen on something since lost was still seen.

So the rule is stated by **shape** and not as a list, in `db/readerPredicates.ts`'s own doctrine
block: **any statement that records a claim about a row and answers with something about that row
belongs to it** — a visit, a viewed work, a seen chip. Enumerating the writers is what let the fifth
exist: each of the four was fixed once, three came back carrying a different subset of the
predicates, and the sentence naming four was read as a closed set. `offeredToReaderSql` and
`linkedForReaderSql` are what "showable" means, in one place, so a call site cannot be written
carrying three of the four.

The same reasoning that was wrong for a location's visit was wrong again for an experience's, a
treasure's and a chip's, unchanged each time — which is the point of writing it down here rather than
trusting that reading the first fix would be enough to generalise it.

### Treasures (artworks/artifacts)

Treasures are independently trackable things inside venue experiences. Currently implemented for museum artworks. Treasures have a many-to-many relationship with venues via `experience_treasures` junction table; iconic treasures are called **highlights** (`is_iconic` flag). See [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md) for the full concept.

- `treasures`: globally unique treasures (artworks, artifacts), keyed by `external_id`
- `experience_treasures`: many-to-many junction linking treasures to venue experiences. A link
  carries `missing_since` (ADR-0044): set by a run that cleared the works coverage floor and no
  longer places the work here, cleared by any run that places it here again, never deleted — the
  row is what a viewed record points at. Every reader-facing read of a museum's works carries
  `offeredLinkSql` (`missing_since IS NULL`), including both publish statements; the two lookups
  that merely locate a global work through any link (`recordedTreasureSql`, the credit-waiting
  assertion) deliberately do not
- `user_viewed_treasures`: per-user treasure tracking

**Which venue a work belongs to is decided, not read.** A source names whatever holds the work —
often a curatorial department or an exhibition room, neither of which is a venue this catalogue
shows. `resolveVenue` walks `P361` to the nearest ancestor that passes the venue test, and
`placeArtwork` then decides between what ownership and location each say. Measured 2026-08-20, the
Louvre is the case that makes this load-bearing: for 113 of the 122 works shown there, no statement
names the museum at all — ownership names *Department of Paintings*, location names *Room 702* —
and read literally, those works have left the building. **So anything that compares one run's
contents against the last must compare placements, never statements.** Across the source that is
the difference between 138 withdrawn links and none.

**A work names every one of its makers** ([ADR-0040](../decisions/0040-a-work-names-every-one-of-its-makers.md), #720).
`treasures.artists` is a `VARCHAR(500)[]`, NOT NULL with an empty default, and public art carries
the same fact as `metadata.creators`. Measured against Wikidata on 2026-08-31, 30 of the 1232
stored works with a creator have more than one — up to the Moon Museum's six — and 19 of the 83
monuments with one, up to the Fountain of Cybele's seven. Which of them the catalogue held used to
be an accident of row order: the pool query carries five `OPTIONAL`s, so a work with two makers and
two images arrives four times and the parse kept the first, which is how *Morning in a Pine Forest*
came to be Savitsky's rather than Shishkin's and Savitsky's.

Three consequences worth stating, because each is a rule and not a detail:

- **The order is storage, not a claim.** SPARQL exposes no statement order at all, so whatever a
  query answers in is its planner's — and measured against a real run's cached answers, the banded
  pool returns the creators in *reverse* statement order on all eight multi-creator works sampled,
  which is also the whole of run 64's churn (the old parse kept the first row, and so the last
  statement) — and the narrow-class pool beside it, which carries no hint and an `ORDER BY`,
  answers in statement order in the very same run, so a work's stored order would otherwise
  depend on which query found it. The list is kept as it arrived, deduped by creator entity *and* by folded label
  (Q2415079, *The Washington Family*, names Edward Savage twice under two entities), and nothing
  sorts it. **Who leads is a curator's judgement**: the work edit endpoint writes the order and
  claims the column, and `work-makers-unconfirmed` in Catalogue Checks counts the works still
  waiting on one.
- **The diff compares the set and the writer's guard asks the same question.** At both levels:
  `workChanges` for a work, and `metadataChanges` for a monument's `metadata.creators`, which would
  otherwise be compared positionally and raise a held card over a reordering. A run that restates
  the same people in another order reports nothing and, for a work, writes nothing — and the write
  half asks the diff's *own* question rather than a second one that agrees most of the time:
  `sameLabelSet` is evaluated once in TypeScript and bound into the upsert as a boolean. Array
  containment was the obvious shape and is the wrong one, since it compares byte for byte where the
  fold normalises case, dashes and whitespace, and Postgres cannot fold the same way without ICU.
  Without the write half the record would say nothing changed while the row changed underneath it.
  A name added or dropped is `major`, as a re-attribution has always been.
- **A curator can correct it**, through `PATCH /api/experiences/:id/works/:treasureId/edit` and the
  dialog every surface that shows a curator a work opens (#731), which
  claims the column so a later run cannot take the correction back. Museum run 64 rewrote 22
  attributions, and every one of them is a multi-maker work, so the shape above removes that churn.
  What is left is a judgement rather than an ordering: the *Borghese Gladiator* is credited to
  Nicolas Cordier, who restored one of its arms in the 17th century, where Agasias of Ephesus
  carved the statue.

### Curation support

- `curator_assignments`: scoped permissions (`global`, `region`, `source`)
- `experience_rejections`: region-scoped hidden items for non-curators
- `experience_curation_log`: the audit trail — named rather than counted, for the reason
  the ASVS note beside its own list gives, and because a count above a list is what goes
  stale when something joins the row below it (this one had been left one short twice
  before it was dropped). The curator's own edits (`created`, `edited`, `rejected`,
  `unrejected`, `added_to_region`, `removed_from_region`), the answers to a source's
  proposal over a claim (`accepted_source`, `declined_source`) and to one a gate held
  (`declined_held`, the refusal; publishing records the other under `published`), the
  verdicts on a rule's refusal (`admission_confirmed`,
  `admission_overridden`), `published`, the lifecycle verdicts on the object
  (`marked_former`, `marked_lost`, `state_restored`, `missing_dismissed`) and on one of
  its points (the same four, `location_`-prefixed, plus `location_edited`), and the
  corrections to what an object *holds* rather than to the object — `work_edited`, a
  curator putting a work's makers, title, year or picture right (ADR-0040, ADR-0049). The list is
  closed by a CHECK in `db/init/01-schema.sql`, so an action cannot be recorded until it
  is named there. What one row *reads as* is `frontend/src/components/shared/curationLog.ts`
  — the chip's words for every action, and the line under it for those whose `details`
  carry something a reader wants — and both screens that name one of these rows with a
  chip take an act's words from there: an object's History and the admin panel's curator
  activity. The queue's `ProvenanceTrail` is the exception on purpose: it puts the two
  source verdicts in a sentence with the person who answered, which a chip's noun phrase
  cannot fill.
  The label table is keyed by `CurationLogAction` from `@tyr/shared/curationLog`, the one
  vocabulary both sides import, and `backend/src/db/curationLogActions.test.ts` holds that
  vocabulary to the schema's CHECK by a type (ADR-0065) — so an act without a label, or a
  label for an act that cannot happen, is a type error, where the nine that once printed
  their column value on screen were each added by widening the constraint while nothing
  compared the two lists

## Sync Architecture

Each source has a dedicated sync service in `backend/src/services/sync/`. All follow the same pattern: `syncX()`, `getXSyncStatus()`, `cancelXSync()`. In-memory progress is tracked via the `runningSyncs` Map; `finally` blocks use a captured `thisProgress` reference to avoid timer race conditions.

### Sync orchestrator

The generic sync lifecycle (progress init, already-running check, sync log creation, processing loop with cancel checks, final status, error handling, delayed cleanup) is implemented once in `syncOrchestrator.ts`, which holds the order of a run's phases while each phase's writes live in a module beside it (§ Shared modules). Each service provides a `SyncServiceConfig<T>` (`syncContract.ts`, with the shapes it returns) with domain-specific callbacks:

- **`fetchItems(progress, errorDetails)`** — Fetch and prepare items. Returns `{ items: T[], fetchedCount, filtered?, withdrawalSkippedReason? }`, where `filtered` names entities the source offered that this kind cannot hold — a Wikidata collection answering a museum query. Those are counted apart from errors and leave the run's status alone; genuine pre-processing failures still go to `errorDetails`. `withdrawalSkippedReason` is a collector's own verdict that it saw too little of the contents it holds to say what left (the museum run's works floor, ADR-0044): recorded on the log row, handed to every `processItem` through the context, and the run is `partial` while it stands.
- **`processItem(item, progress, context)`** — Process a single item and return a `ProcessItemResult`: the outcome (`'created'` / `'updated'` / `'unchanged'`), the change set, and whether the row had been flagged missing. `context` carries `dryRun`, so a service can skip its own writes in a preview, and `onLocationsChanged(experienceId)`, which a service calls **at the location write** to have the run place that experience before it ends. Called there rather than returned on the result on purpose: a service can throw after moving a point — the museum one upserts treasures afterwards — and a returned field would be lost with the throw while the point had already moved on disk. Throw to count as error.
- **`getItemName(item)`** / **`getItemId(item)`** — Display name and external ID for progress messages and error reporting.

Generic `getSyncStatus(sourceId)` and `cancelSync(sourceId)` replace per-service status/cancel functions. The controller dispatches via a registry map instead of if-else chains.

### Shared modules

Common sync logic lives in shared utility files:

- **`syncOrchestrator.ts`** — Generic sync lifecycle orchestration (`orchestrateSync<T>()`) — the order of a run's phases, and the one place that order is stated, since it is the contract: the changeset recorded before the log row is closed, the verdict set before anything that can reject, placement after both — plus `getSyncStatus()` and `cancelSync()` parameterized by the source's id (`source_id`), and `isCancellable()` — the single rule for whether a cancel would be acted on, which `cancelSync` enforces, the status endpoint reports as `cancellable`, and the admin panel disables its button on rather than re-deriving.
- **`syncContract.ts`** — What a sync service hands the orchestrator and gets back: `SyncServiceConfig<T>`, `FetchResult<T>`, `ProcessItemResult`, `SyncRunContext` and `FilteredEntity`. Its own module so the orchestrator's parts read those shapes without importing the module that runs the loop, which would be a cycle
- **`itemOutcome.ts`** — What one item leaves behind: its counters and its changeset row (`recordItemOutcome()`, `recordItemFailure()`, `recordFilteredEntities()`), with the word the row carries (`resolveChangeType`: `held`, `returned`, `conflict`, `contents`) and the one predicate behind the `held` word and counter (`wasHeld`). Writes nothing to the database
- **`admissionStep.ts`** — The admission step after the items, for a source that recomputes its membership (ADR-0024): restore, then the guarded sweep (`applyAdmissionSweep()`), then the must-see badge (`badgeAdmitted()`, ADR-0045 decision 5), whose clear runs only where the sweep ran. The writes are `admission.ts`'s
- **`runLog.ts`** — The run's log row: the changeset recorded or marked lost (`recordChangesetOrMark()`), the status it is closed with (`computeFinalStatus()`, where the three things called `partial` are told apart), its counters (`runCounters()`), the panel's completion line (`completionMessage()`), and the close of a failed or cancelled run (`recordSyncFailure()`)
- **`wikidataUtils.ts`** — SPARQL query execution with retry/backoff (`sparqlQuery()`), QID extraction, WKT point parsing, delay helper, and constants (endpoint URL, user agent, timeouts). Used by museum and landmark services.
- **`experienceUpsert.ts`** — The object upsert with curated_fields-aware conflict handling (`upsertExperienceRecord()`): one transaction per object that locks the place first (`lockSourcedExperience`, in a statement of its own), decides the hold and the `before` snapshot in the statement after it — a statement's snapshot predates the lock it waits for, `db/locks.ts` — writes the place and — in the same statement — its membership in the kind the run's source fills (#822), then the decay and the pointer on the same connection. Its preview (`dryRun`) asks the hold rule of the same memberships with one unlocked `SELECT`. Also the run's picture rule (`withShowablePicture`, ADR-0043). Re-exported from `syncUtils.ts`, so every sync service keeps one import.
- **`syncUtils.ts`** — Single-location write, delegating to `locationWriter.ts` (`upsertSingleLocation()`), and sync log CRUD (`createSyncLog()`, `updateSyncLog()`, and `annotateClosedSyncLog()` for the narrow status/`error_details` write a follow-up step needs). Used by every sync service — `unescoSyncService`, `museumSyncService`, `landmarkSyncService`, `worshipSyncService` and Archaeology's `writer.ts`. It deletes nothing: the FK-ordered per-source cleanup that force sync used lived here and is gone with it.
- **`locationWriter.ts`** — Writes an experience's locations so a point that has not moved keeps its row, and therefore its region assignments (`writeExperienceLocations()`). Identity is `(point, external_ref)`: the reference alone repeats across a transboundary component's per-country entries, and the point alone repeats across the sub-units of one named locality. A point the source stops offering is marked (`missing_since`, `ordinal` NULL) rather than deleted, and one offered again is found by the same identity and given its place back. Returns the rows inserted, moved or offered again — what the run then assigns — and how many it was the first to find missing. Two modules hold what its statements are built from, split out when the per-point diff took it past the guide's length limit: `locationPairing.ts` — identity (`samePointSql`, `claimedPointSql`), the guard that keeps a claimed column, and what a kept row's own columns say happened to it (`keptChanges`) — and `locationIncoming.ts`, the source's list before anything is known about the store (its CTE, its parameters, and the duplicates the source itself ships)
- **`placement.ts`** — Placing what a run moved, and reporting when that fails (`finishPlacement()`, `placeMovedExperiences()`, `recordPlacementFailure()`, `enterAssigningPhase()`, `terminalStatus()`). Split from the orchestrator because it is a separate responsibility: the loop runs a source's items, this decides where the objects that moved now belong, and it reaches for `regionAssignmentService`, `syncLogMarkers` and `annotateClosedSyncLog` — none of which the loop touches
- **`changeSet.ts`** — Pure diff between the stored row and the incoming record (`computeChangeSet()`). No database, no network. Normalises before comparing: JSONB by value rather than key order, country and tag arrays as sets, coordinates by distance (below 10 m is jitter, above 1 km is `major`), and `null`/`''`/absent as one absence. Two jsonb columns are reported **per part** rather than whole, because an answer is addressed to an entry: `metadata.<key>` for every metadata key that differs (ADR-0039), `nameLocal.<lang>` for every language of the local names that differs (#728). Also home to `claimKeyFor`, the one lookup its readers share — the queue (`reviewQueueConflicts.ts`, in its SQL spelling), `accept-source`, `decline-source` and publishing (`publishHeldFields.ts`) — for "which `curated_fields` entry protects this"
- **`changeRecorder.ts`** — Batched persistence of the per-object changeset (`recordSyncChanges()`, 500 rows per statement)
- **`missingDetection.ts`** — Whether absence may be acted on (`missingDetectionSkipReason()`) and the flagging itself (`flagMissingExperiences()`)
- **`syncLogMarkers.ts`** — The entries a run leaves in `error_details` that other code reads as facts (`CHANGESET_LOST_MARKER`, `ORPHANED_RUN_MARKER`, `PLACEMENT_FAILED_MARKER`) and the predicate that reads them (`CHANGESET_LANDED_SQL`). Written by the orchestrator and the startup sweep, read by the review queue and `accept-source` — one definition, because a run's status cannot answer whether its changeset landed
- **`fixtureSource.ts`** — Development-only source substitution via `SYNC_SOURCE_FIXTURE`; see § Change provenance below
- **`@tyr/shared/labels` and `labelFold.ts`** — The two rules a name is held to, and the one place each is decided: `foldLabel`, `sameLabel` and `tidyLabel` in the package both sides import (ADR-0065), the SQL spelling and the set comparison in `backend/src/services/sync/labelFold.ts`. `foldLabel` / `sameLabel` / `sameLabelSet` answer *whether two labels name the same thing* — NFKC, every Unicode dash to the plain one, whitespace collapsed, case folded — for the diffs, the makers' dedupe and the curator schema's repeat check. `tidyLabel` is the **store rule** (#835): what a row holds is the name as a person would type it — edges trimmed, a run of whitespace inside collapsed to one space, case and dashes untouched. Every source is a label service and a label service passes runs through (Wikidata's label for *St. John  on Patmos* carries two spaces; the World Heritage Centre's component names carried eighteen runs), and HTML collapses them on screen, so a reader who typed what they saw found nothing. Applied by every writer of a name **before its diff** — `upsertExperienceRecord` (the place's name, each language of its local names, the set-valued metadata lists such as `metadata.creators`), `writeExperienceLocations` (a point's name) and `upsertVenueTreasures` (a work's title and makers) — and by every curator schema before its bounds (`storedName` in `types/index.ts`: `editExperienceBodySchema`, `createManualExperienceBodySchema`, `editLocationBodySchema` and `editWorkBodySchema`), so a run compares tidied to tidied and reports no rename for a label it only tidied. Migration 047 brought the stored rows to it and `name-carries-whitespace-nobody-typed` in Catalogue Checks asks the rule of every row since, in its SQL spelling (`tidyLabelSql`). The drawing side imports the same two rules from the package (a form asks `tidyLabel` of what was typed and of what is stored, `foldLabel` of a maker list), so the two sides cannot drift; until #789 it held a copy, pinned from here by a test reading it as text

### Change provenance (issue #480, [ADR-0020](../decisions/0020-experience-lifecycle-and-run-changeset.md))

Every run records what it did to each object in `experience_sync_changes`: one row per
object created, changed, in conflict, held, missing, returned, failed, or filtered, with a
per-field diff in `changed_fields`. Rows that came through **unchanged are counted on the log, never stored** —
a UNESCO run would otherwise write a row of noise for nearly every site around the few dozen that carry
information. Four kinds of unchanged row are stored anyway, because each carries news the
counters cannot: `conflict`, where `curated_fields` refused the source's edit and the two now
disagree; `held`, where the source's gate refused it (below); `returned`, where an object
flagged `missing_since` is listed again — typically unmodified, after a transient source gap,
which is precisely when a field-change requirement would have hidden it; and one whose own fields
all came through while **what it holds** moved (next section).

`changed_fields` holds the value the source proposed for a field **even when the run refused to
write it**, and each entry says which of the two refusals it was: `curatedConflict` for a field a
curator had claimed, `held` for one the source's gate kept out (#519). Both flags are `false`
on a field the run applied. That is what makes a curator's later answer possible — "accept
source" for the first, publishing for the second — and without it the proposed value exists
nowhere. The two are never both true of one field: they are answered by different endpoints, so a
field carrying both would raise two contradictory cards over one value, and where both apply the
claim wins as the narrower and separately answerable reason.

**A field the import computes about its own run is not a field a person is asked about** (#571).
Two metadata keys are the run's own bookkeeping rather than facts about the object:
`artworkCount`, how many works the pass just placed in a venue, and `totalArtworkSitelinks`, the
sum of those works' sitelink counts — a fame measure the run records about the venue it just
filled. Nothing reads either one today: which museums are admitted and in what order is decided
inside the run, off live Wikidata (`museum/pipeline.ts`), never off the stored copy. They are named in
`SYNC_OWNED_METADATA_KEYS` (`changeSet.ts`), and both halves of the machinery read that one
constant, because a rule the diff and the write disagreed about is worse than either behaviour:

- **The diff leaves them out, on both sides.** A run that moved nothing else is `unchanged` and
  raises no card; a card a real change does raise carries only the real change. Both sides,
  because a key held out on one side only would still differ and still raise an entry of its own
  (ADR-0039). On a card filed before that, where the keys shared one catch-all payload, both sides
  mattered for a second reason: `publishHeldFields.ts` reads that payload's `old` as the list of
  keys the entry speaks for, so a counter named there was wiped back to the value the proposal was
  computed against the moment somebody published the field beside it.
- **The upsert writes them past the gate and past a `metadata` claim**, the way `last_seen_at`
  goes past both. Ignoring them in the diff alone would have been worse than the bug: the counter
  would freeze at whatever it read when the gate went up, with nothing left to report it and
  nothing able to correct it.

A sum over some 2500 works moves whenever anybody anywhere adds a language link to any painting a
museum holds, so under a gated source every move became a held proposal. Measured on run 64, 13
of the 15 held changes were `metadata`, and the Louvre's was in full
`totalArtworkSitelinks: 2363 → 2365` — while the row itself still stored 2363, four runs later.
One level down the same rule is already SQL: the treasures upsert writes `sitelinks_count`
unconditionally, "a measurement, not a judgement".

**The rule's general form** (#570, stated by the maintainer): *a person is asked only about what a
reader can eventually see; what the import works out on the way there is not a question.* The
keys below and one column fall under it:

- `sitelinksCount` on a landmark is the museums' fame sum one object up — how many Wikipedia
  editions have an article, read off Wikidata, moving with every translation anyone adds — and
  sixteen of its moves had reached curators' cards. In the set.
- `admittedFor` was held out the first time as "the reason the row exists and worth a look when
  it changes". It is the work with the most language links among the ones the pass placed —
  derived from the counter above — no reader sees it, and the look it was kept for is already
  taken by the admission rule, which re-runs against live data every pass and files a refusal
  card the moment a museum stops qualifying. It sat in the set until #822 moved it off the row
  altogether: the run writes it on the membership (`admitted_for`), migration 046 stripped it
  from every row, proposal and held decision, and it never enters `metadata` or this diff now —
  `changeSet.test.ts` pins the constant as *not* naming it.
- `wikidataClasses` and `wikidataArtwork` on a landmark are what the public-art rule read —
  every `P31` the entity carries, and whether an artwork class answered a building's veto — kept
  so that Catalogue Checks can ask what an admitted row is typed as (#754). The rule re-reads
  them every run and files its own refusal when they stop passing, so a change to them is never
  a curator's question. In the set.
- `tags` are labels the import derives from facts it also stores by name (`criterion_ii` from the
  criteria string, `in_danger` from the danger listing, `monument` from the landmark's type),
  and no reader-facing read returns the column — the by-id read did, rendered by nothing, and
  #570 took it out of the select so that the premise the gate bypass rests on is one a test can
  check rather than a sentence. The upsert writes them past the gate (there is
  nothing a reader can already see for the gate to protect — 3785 held rows in this database's
  log restated the row beside them), the diff compares them nowhere, and the card never shows
  them. Unlike the counters, a **claim** still holds them: a curator can set tags through the
  edit endpoint, and a person's deliberate write is not a measurement. A claimed value the source
  disagrees with is kept and not reported either — whichever value stands, no reader sees it.
  `publishHeldFields` keeps its tags arm for the cards earlier runs filed. One consequence is
  owned rather than hidden: the `in_danger` tag now moves ahead of the `metadata.inDanger` flag
  it mirrors while that flag is held for a curator, so the Catalogue Check comparing the two
  (`danger-flag-disagrees-with-its-tag`) leaves out a row whose held proposal holds the flag
  itself and has not been answered — the window in which the two are apart by design, invisible
  to readers because the badge follows the flag. The held flag and not the held row, since any
  held field sets the pointer and every UNESCO row on the dev database carries one; and the
  *unanswered* flag since #722, because a curator who refuses the proposed flag has closed the
  window and no card will come round to reconcile the halves (`docs/tech/data-assertions.md`).

### What a run did to an object's contents ([ADR-0026](../decisions/0026-a-run-records-what-a-container-holds.md))

An experience is a container: it has fields of its own, and it holds **contents** of two kinds —
points (`experience_locations`) and works (`experience_treasures`). `changed_fields` covers the
fields; `contents` covers the rest, keyed by kind:

```json
{"locations": {"added": [{"name": "Waldsiedlung Zehlendorf", "ref": "1239-006"}],
               "withdrawn": [], "returned": [],
               "changed": [{"item": {"name": "Coteaux", "ref": "1465-001"},
                            "fields": [{"field": "location", "significance": "major",
                                        "curatedConflict": true, "held": false,
                                        "old": {"lon": 4.0, "lat": 49.0},
                                        "new": {"lon": 4.0, "lat": 49.018}}]}]},
 "treasures": {"added": [{"name": "The Night Watch", "ref": "Q219831"}],
               "withdrawn": [], "returned": [], "changed": []}}
```

The fourth key is newer than the other three (ADR-0029 decision 7, narrowing ADR-0026's shape).
It answers a different question from them: those say what a container holds, and `changed` says
that something it already held is not what it was — a point that moved, a component renamed. Its
entries carry the object's own `FieldChange`, `significance` and `curatedConflict` included, which
ADR-0026 decision 2 could rule out while contents carried no claims and cannot now that they do.
What reaches it is narrower than it looks: a kept row is a paired row, and pairing is bounded at
ten metres except for a claimed one, so a `location` entry is a curator's corrected point with the
source still arguing about it, while an unclaimed move beyond the tolerance is a withdrawal and an
arrival. Works fill it the same way and are expected to fill it rarely: 120 works re-asked of
Wikidata eleven days after import differed in name, makers, year and image exactly zero times, which
says how often a card will appear rather than whether the run should be able to raise one. The
measurement is why the read is one query per museum rather than one per work —
`museum/treasureWriter.ts` takes the snapshot of every work it is about to write before writing
any of them, and compares it
against **what the source offered**, which is the pair the location writer's kept arm uses too
(`i.name`, `i.lon`, `i.lat`, not the row it wrote). Compared against the written row instead, a
claimed field would equal itself — the upsert's own `CASE` put the stored value back — and the one
case worth reporting would be the one that disappeared. Against the offer it reads as the refusal
it is, and carries `curatedConflict`.

Keyed rather than a column per kind, so a third kind of contents costs no migration. A kind the run
did nothing to is **absent**, and a run that moved nothing writes SQL `NULL` — not `{}`, and not a
jsonb `null`, either of which would read as "asked and found nothing".

Items are **named, never identified by id**: the record has to stay legible after the row it names
is renamed, the same reason each row keeps `name_snapshot`. Both halves are nullable, because most
UNESCO components carry a reference and no name of their own.

Where the numbers come from: `writeExperienceLocations` and `upsertVenueTreasures` each already
computed their delta and discarded it — the location writer returned ids for region placement, the
venue writer reduced its `RETURNING treasure_id` to a boolean for retiring a curator's pass. Both
now return it. `added`, `withdrawn` and `returned` are read off the statements that perform the
writes, so what the record says arrived is what arrived. `changed` cannot be and must not be: it is
the difference between what was stored and what the source offered, which is a comparison no writing
statement makes — the venue writer's comes from a snapshot query and the source's list, the location
writer's from the pairing's carried `old_*` against the incoming values. Where a claim holds, the
record and the write are *supposed* to disagree, and that disagreement is the whole content of the
entry.

Four things it deliberately does not say:

- **A held withdrawal is absent.** Where the gate is holding a withdrawal until its replacement is
  published, the point is still on the map with `missing_since IS NULL`; the run performed no
  withdrawal, and reporting one would tell a curator the opposite of what a reader sees. Same rule
  `unoffered` follows.
- **A held work withdrawal is absent, for the same reason.** A visible link whose work this run
  places at another museum where no reader can see it yet is passed over by the mark (ADR-0044
  decision 5), so the run performed no withdrawal there either, and the link is still on show.
  Nothing records *that* it is held — unlike a point's deferral, the hold is re-decided on every
  run from the run's proposal and the table.
- **A run below the works floor reports no withdrawal at all**, and the row for the run says so:
  `withdrawal_skipped_reason` on the log is why, and the run is `partial`. A museum row with no
  `withdrawn` entries is evidence that nothing left only on a run that cleared the floor. Until
  ADR-0044 nothing unlinked a work at all — sync run 42 fetched 291 artworks where the run before
  it fetched 1906 and reported `success` — so every row before it carries the empty list by
  decision rather than by observation.
- **`NULL` is not "nothing moved".** Every row written before the column existed carries `NULL`,
  and nothing can be backfilled: `experience_locations.created_at` was overwritten wholesale on
  2026-08-04 by the delete-and-reinsert this code has since removed (6548 of 6680 rows).

A single-point venue reports a moved point as a withdrawal plus an arrival, because identity is the
point together with the source's reference ([ADR-0022](../decisions/0022-locations-are-marked-not-deleted.md)).
That is worth recording even where the object's own `lon`/`lat` diff says the same thing: the row
was replaced, and a reader's tick did not follow it. Nor is it a churn risk, though the reason has
changed: the one point withdrawn in the catalogue's whole history turned out to be a coordinate
rewritten 1.2 cm more precisely (#543), which is what ADR-0027's tolerance now absorbs — so the
writer raises no card for a rewrite inside ten metres, and its fast path still matches 1235 of 1272
UNESCO rows per run.

That is not the same as "every card from here on is a real departure", and two shapes still record a
withdrawal for a point that never moved. One is the greedy pairing's loser (ADR-0027 decision 5a-i,
#549), which needs a source to list two points of one reference between ten and twenty metres apart —
nothing in the catalogue does. The other is the pair migration 026 declines to touch. Where a visit or a manual region assignment keeps such a pair standing, the card
tells the curator truthfully that nothing moved, and the only honest button — "false alarm" — clears
`missing_since` and leaves the object with two visible rows a centimetre apart under one reference.
The next run pairs the one sitting on the source's coordinate and withdraws the other, so the same
card comes back. It is not data loss: the visit is what kept the pair standing. It is a question the
queue cannot settle, because settling it means deciding which row a traveller's record belongs to,
and that is the surface #544 is about.

**A gated source may not overwrite what a reader can already see.** Contents arriving from a gated
source are written invisible rather than withheld ([ADR-0025](../decisions/0025-per-source-curation-gate.md)),
but an experience row that is already published has no second row to hide an unreviewed value behind
— so for that row alone the run keeps the stored content instead. The condition is
`requires_curation` and a reader being able to see the place — some membership of it passed
(`placeVisibleSql`, the membership's state since #822) — decided under the lock the upsert takes
first, in the statement after it, because it depends on the stored state the write is about to overwrite, and it rides on every
content column but `tags` (#570) beside that column's own `curated_fields` guard. A place still
unread is *not* held: nobody can see it, so the run refreshes it in place and the curator reviews
the newest state rather than whatever landed first.

**And a field of a part readers can already see is held the same way**
([ADR-0037](../decisions/0037-a-part-field-readers-see-is-held-like-the-objects.md)). A run rewrote a
visible work's attribution or a visible place's name on the spot — 73 such changes on the dev database,
22 of them attributions, *The Wine Glass* moved from Johannes Vermeer to a namesake with nobody asked —
while the same run's change to the museum's own name waited on a card. The location writer's keeping
arm and the treasures upsert now carry the object's guard one level down: a visible point keeps its
`name`, a visible work keeps `name`, `artists`, `year`, `image_url` and, with the picture, its credit.
Each statement reads the gate as it already read it for the row it inserts, evaluates the guard on the
row it locked, and returns the guard's own answer (`was_held`) so the record cannot disagree with the
write; `pointChanges` and `workChanges` take that answer as their fourth argument and file each
unclaimed change as `held`. The claim wins where both are true. Visibility is the **row's own**
state — `treasures.curation_state`, never the link's, since a work verified through another venue is
on show there. Outside the hold, on purpose: a coordinate rewritten within ten metres (the same point,
more precisely — ADR-0027, and nothing a reader can see), a work's `sitelinks_count`, `is_iconic` and
`treasure_type`, the identity and provenance columns, and the `returned` arm, whose row is hidden
until it returns. A held name fails the writer's fast path on every run until answered, the cost
ADR-0029 decision 5 already accepts for a claimed point.

The pointer follows. `pending_change_sync_log_id` is set through one statement all three writers
share (`heldProposalPointer.ts`), and the order they run in is what makes the column honest: the
object upsert runs first and **clears** it where the object's own fields propose nothing, the content
writers set it again where they held — so it names the newest run that held anything about the object,
at either level, and is clear when nothing is. The location writer points inside its own transaction;
the treasures writer once per museum, after the works. A run with no log id records the hold and
withholds the pointer, as the object's has always done.

A held picture's credit travels with it. The run fetched a credit for the picture it could not write,
and publishing rather than the next run is what puts that picture on show — so `treasureWriter`
records a `metadata.imageCredit` entry beside a held `image_url` where the credit differs from the
stored one, under the picture's own flags, and publishing writes both. The object's diff reports the
same key under the same name, so the card's vocabulary needs nothing new to say "picture credit".

**A held field is reported as a refused write, not as one the run made.** `computeChangeSet` files
every difference in exactly one of three buckets, and the bucket is what the run reports:
`changedFields` means *written*, `curatedConflicts` means a curator's claim refused it, `heldFields`
means the gate refused it. The hold itself is decided in SQL — it reads the stored `curation_state`
the same statement is about to overwrite — and the rule **is answered once and the answer handed
on**: since #822 the hold is a question about the place's memberships (some membership passed),
which an `ON CONFLICT DO UPDATE` cannot read under the row lock — a subselect there reads the
statement's snapshot — so the upsert locks the place first, in a statement of its own, answers
`was_held` in the next statement beside the `before` snapshot, and binds the answer into the write as a parameter every guard reads
(`(SELECT held FROM hold)`); the preview asks the same expression in its own `SELECT`. `heldSql`
in `experienceUpsert.ts` is the rule's only home, and the diff takes the answer as a boolean
rather than re-deriving anything. A row whose only differences were held is
therefore `unchanged` (nothing about it changed) and its changeset row is `change_type = 'held'`.

The answer has to be decided **under the lock**, and this is not a detail of style. A statement's
subselects and CTEs read the statement's own snapshot, taken before any row lock is acquired, while
`ON CONFLICT DO UPDATE` acts on the row as re-read under the lock — and the two differ whenever a
curator's publish commits in between. While the state was the row's own column, the guards could
read it under the lock inside the statement and hand it back through `RETURNING`; the report derived
from a `before` CTE instead was measured disagreeing with them — with a publish landing in that
window, the CTE said `pending` while the guards said `verified` for the same run, so the report
called the write applied while the statement had held it (#519 again, for one run, self-healing on
the next). Now that the state is the membership's (#822) the guards themselves could only reach it
through a subselect, which is the snapshot side of that same window: a run would then overwrite a
place the curator had just put in front of readers, leaving unreviewed content live with no pointer,
no card and nothing anywhere to say so — the gate's central promise broken permanently rather than a
report wrong once. Worse still in a second way: the decay does not fire under a gated source, so the
membership would go on saying `verified` — asserting a curator's pass over content nobody had seen.
And the divergence is one-directional, because nothing returns a membership to `pending`, so every
reachable instance of it is that case rather than the harmless mirror. So the upsert locks the place
first (`OBJECT_LOCK`, the mode every curator write takes on the same row) **in a statement of its
own**, reads the `before` snapshot and the hold in the next, and binds the answer into the write: one
value, read by every guard, the membership's pointer arm and the diff alike. Two statements and not
one, because a locking read is no better than a subselect for a row of another table: in READ
COMMITTED the statement's snapshot is taken before it waits for the lock, and once the lock is
granted only the locked row is re-read — measured on 2026-09-05, a `SELECT … FOR NO KEY UPDATE OF e`
that waited for a publish answered `false` to "has a membership of the place been passed?" after
that publish had committed, and the next statement on the same connection answered `true`. The
curator's writes read the membership the same way — the lock in one statement, the membership in
the next (`publishUnderLock`, `refuseUnderLock`, `setExperienceAdmission`) — and the treasure
writer's pointer and decay, which ran on the pool, run in one transaction that takes the museum
first. Folding the lock into the UPDATE's own sub-select is not a substitute: it waits, but it chooses
its rows under the pre-wait snapshot — measured, a decay written that way updated 0 rows for a
membership the publish had just passed, and lock-then-update updated 1. `db/locks.ts` states the rule
once. What the membership CTE never assigns
on conflict — `curation_state`, `published_at`, the verdict, the badge — a test pins on the
SET-list's text rather than on parsed assignments, since an assignment can be written mid-line.

Before all of this, a held field landed in `changedFields` — the bucket that means written — so the
run reported an update over a row where nothing had moved, and the change list drew `old → new` with
no chip, telling the curator that the held value was the one now live. `conflict` could not absorb
the case: that word means a person
claimed the field, so the stored value won on purpose and nothing is waiting, while a held row is
waiting on a verdict nobody has given (#519). A row carrying both is `held`, because the held half
is the part still unanswered. Counted as `unchanged`, exactly as a `conflict` row is, and counted
again in the run's own `total_held` (#523; the counters section below), so the summary and the
changeset rows agree on how many rows a run held; the run report's default
view keeps them regardless of significance, since what it drops is a minor `updated` row that moved
nothing else — a denylist naming one case rather than a list of the cases worth showing. A row whose
*contents* moved stays even when its only field edit was minor, because `significance` weighs fields
alone and that row is the only record anywhere that a component arrived. So does an `updated` row
where the source ran into a curator's claim (#516): the refused field is weighed like any other, so a
claimed `shortDescription` or `metadata.website` beside an applied `nameLocal.en` computes `minor`, and the
view reads the stored `curatedConflict` flag — the containment test the queue and both verdict
endpoints already use — to keep the one row in a run where a machine and a person disagreed. A row
whose *only* difference was refused is `conflict` and was never at risk; it is the row that also
carries an ordinary edit that the first three terms filed under routine.

The same reasoning holds against `returned`: a row can come back from missing while a hold from
this very run is still sitting on it, and the hold is again the half nobody has answered.
`resolveChangeType` checks `heldFields` before `returnedFromMissing` for exactly that reason —
checked in the other order, as it briefly was, a combined row read as `returned` and never turned
up under the admin report's `?type=held` filter, the one place a curator would go looking for it.

The proposal itself is already recorded, per object, in the run's changeset. What the row adds is
`pending_change_sync_log_id`, the pointer saying whose proposal is being held, so the curator's screen
can find it. It is written only by a run that actually proposed something — the upsert's own guards
fire whether or not a value differs, so the statement cannot tell a change from a pass that touched
nothing. *Proposed* counts both kinds of refusal: a value the hold kept out and a value
`curated_fields` kept out are both decisions waiting on a curator, so a row whose only difference is
in a claimed field is still holding a proposal and still points at the run that made it. The pointer
is cleared again when a later run proposes nothing at all — nothing written and nothing refused —
because a source that has come back to what is stored is no longer proposing anything. *Proposed*
therefore reads all three buckets: keying it on written fields alone would clear the pointer on the
very run whose content the gate had just held, which is the case the pointer exists for. A row that
is no longer held loses the pointer too: a run free to write the content leaves nothing waiting. The
only other thing that clears it is a curator answering, through `POST /:id/publish` (§ Publishing),
which is what makes the queue's `held` card answerable at all.

**A `verified` row decays when a trusted source changes it.** `curation_state`
([ADR-0025](../decisions/0025-per-source-curation-gate.md)) can also hold `verified`: a curator's
pass on the object as it stood when they looked. `upsertExperienceRecord` returns a `verified` row
to `auto` the moment a run from a source nobody gated writes a real change
to it — the pass covered the object that was there, and a changed object has not been passed. A
provenance-only pass, one that reaches the row and changes nothing, leaves `verified` standing.
So does a change from a **gated** source: there the same statement's hold refused to write the new
values, so what a reader sees is still exactly what the curator passed, and retiring the pass would
punish the row for a proposal nobody has answered yet. Two things say so, and both matter: the
change set files those values as held rather than changed, so the decay statement is not even sent,
and the statement carries the gate check itself for the case where something did get written.

The rule is resolved in TypeScript, against the change set `computeChangeSet` already produces,
rather than folded into the upsert's own `SET` list, because the statement's `CASE` guards fire
whether or not a value actually differs from what is stored — the SQL has no way to tell a content
change from a no-op pass, only the computed change set does, and collapsing the decay into the
`SET` list would retire a curator's pass on every run, changed or not. The `UPDATE` is scoped to
`WHERE curation_state = 'verified'`, so it can only ever move a row one way: a `pending` row is
not published and has nothing to decay, and an `auto` row is already there. The only rows that
carry `verified` today are ones `createManualExperience` wrote by hand — each one's
`curator-<id>-<ts>` external id is never in a source listing (see below), so no sync run's
upsert ever reaches it, and this statement's `WHERE` matches nothing a sync run has ever
touched. `POST /:id/publish` (§ Publishing) is what promotes a `pending` or `auto` row to
`verified`, and a row it published from a *trusted* source is exactly what this decay can then
retire again.

**New content retires its container's pass too.** A pass covers the experience as it stood — its
points, and the works a museum was holding — so a point or a work the run has just added is content
that pass never covered. `retirePassAfterNewContent` (`services/sync/curationDecay.ts`) is the one
statement both writers use for it: `writeExperienceLocations` calls it in the same transaction as the
insert that caused it, and the museum sync calls it once per museum rather than once per painting,
because the fact is the same whether one work arrived or twelve. It moves a row only from `verified`,
and only for a source nobody gated — a gated source writes its new content `pending`, so nothing a
reader sees has changed. A point the source stopped offering and now offers again is not new: the
curator saw it, and its row, its id and its region assignments are the same ones.

**`total_updated` changed meaning.** It used to count every row that passed through
`ON CONFLICT DO UPDATE`, identical or not. Since migration 009 it counts rows that actually
changed, and `total_unchanged` absorbs the rest. Logs 1–4 are therefore not comparable with
later ones.

**A held row is counted twice: inside `total_unchanged`, and again in `total_held`** (#523). A row
a gated source proposed a change to and the gate held is one of the rows `total_unchanged` absorbs —
nothing was written to it — and the run's totals were silent about how many such rows it left:
UNESCO run 68 (2026-08-22) held all 1272 sites and reported `created 0 · updated 0 · unchanged
1272`, a run that touched nothing, while every one of the 1272 was a proposal waiting in the
curator's queue — which the admin reading the run list may not be the person watching. `total_held`
is a subset of `unchanged` rather than a fifth bucket beside it, for the reason `total_updated`
above gives: a stored counter must not acquire a second meaning. `total_curated_conflicts` is the
precedent for counting a refusal on top of the outcome buckets rather than instead of one, and no
more than that: it counts claimed **fields**, on `updated` rows as well as `unchanged` ones — 100
unchanged rows carrying two claimed fields each is 200 conflicts beside 100 unchanged — where
`total_held` counts **rows**, only inside `unchanged`. The two tiles sit side by side on the run
card, so the unit is on screen: Held 1,272 is 1,272 sites, Conflicts 3 is three fields. That
counter stays claims-only — nobody has claimed a held field — so the two never share a field, and
a row carrying both a claim and a hold is counted in both. The
increment and the changeset row's `held` word come from one predicate, `wasHeld` in
`itemOutcome.ts`: the row came through `unchanged` with something in `heldFields`. Structural
rather than empirical — `computeChangeSet` files every unclaimed diff of a held row under
`heldFields`, so its `changedFields` is empty and its `changeType` is `unchanged`; and an insert
under a gate is written `pending` rather than refused, so a `created` row is never held, and the
queue's `arrival` card already carries it. Nor is new *content* under a gate: a point or a work
arriving on a visible object is written `pending` too (`locationWriter.ts`, `museum/treasureWriter.ts`),
files as a `contents` row, and is not in this count — so the number is of held **changes**, and a
run that only hung twelve unread paintings in the Louvre reports Held 0. A held *field of a part*
is a held change and is in it
([ADR-0037](../decisions/0037-a-part-field-readers-see-is-held-like-the-objects.md)): `wasHeld` reads
the recorded contents beside `heldFields` (`contentsHeld` in `types.ts`), so a museum every field of
which came through, with one work's attribution held, counts as held and files as `held` rather
than `contents` — the held half is the unanswered one, and the report's `?type=held` filter is
where a curator would look. The count of all three
waiting kinds — arrivals, held changes, unread contents — is per source, not per run:
`waitingCountsBySource` (`waitingCounts.ts`), which the gate panel shows. The counter is the
number of rows the run held, written from memory when the log closes; wherever the changeset
landed whole, that is also the number of `held` rows on record, which is how migration 038 filled
it for the runs that predate the column. A run from before the column whose changeset was lost, or
landed only in part — the insert goes in batches of 500 with no transaction around them — the
migration leaves at 0 and names with the held rows that did land, because a count from a partial
record would read as exact everywhere afterwards; a run after it carries the number it wrote
itself, whatever became of its record. Both admin reads answer `changeset_lost` beside
`has_changeset`, derived from the `CHANGESET_LOST_MARKER` the orchestrator leaves in
`error_details`, so the run card's note and the run list's not-comparable asterisk read one
predicate rather than inferring the record's fate from `has_changeset` and the counters — which
read a lost record as an old run, and a partial landing as a whole one. The admin's run list
carries it as a **Held** column beside Updated, the run's card as a tile beside Unchanged, and the
live status while a run is going (`held` on `GET /api/admin/sync/sources/:sourceId/status`).
Not touched by it: the default "Significant only" view of the per-object report, whose own rule is
above.

**Two lifecycle axes** on `experiences`. `existence` is curator-only. So is `former` — a
source outage must never change what users see — but `present` can also be restored by the
source itself, which is the one thing the machine may write here and is spelled out below:

- `source_membership` — `present` / `former`: whether the source still lists the object
- `existence` — `extant` / `lost`: whether the object physically survives

They are independent because reality is: the Bamiyan Buddhas were destroyed but remain
inscribed; Dresden Elbe Valley is intact but was delisted in 2009.

`former` is a claim about the source's collection, so the source can contradict it: when a
run produces a row that is `former`, the upsert puts `source_membership` back to `present`
and the changeset records `returned`. That is the same evidence that justified `former` in
the first place, read the other way, and it only ever moves toward more visibility — a source
outage still cannot hide anything, which is what ADR-0020 reserves `former` to a curator for.
`existence` is untouched by that correction: being listed says nothing about whether the
thing still stands. One consequence to read carefully: `state_decided_by`, `state_decided_at` and `state_note`
record the last decision a curator made, not necessarily the state now stored. After the
source takes back a `former`, those fields still name whoever recorded it. They are not
cleared, because they cover both axes at once and an `existence` verdict may still stand —
`experience_curation_log` is where the sequence is, and the changeset row marks the
correction. This narrows ADR-0020 in two places, and
[ADR-0021](../decisions/0021-source-may-restore-membership.md) records it. Decision 1 defines
`returned` as "an object previously flagged `missing_since` is listed again", and a curator's
verdict is exactly what takes a row out of that description, so the trigger is now broader
than the sentence stating it. Decision 2 said of the two axes that "both are set by curators
only. The machine records `missing_since` and nothing more", which the upsert no longer
honours. The reason that sentence existed still holds and is what makes the correction safe:
it was there so a source outage could not hide anything, and a write that only ever restores
visibility cannot. Without it a curator's correct `former` would become permanent the moment
the source recovered, with nothing anywhere to say so — the row leaves `missing_since`, so
neither detection nor the queue nor a `returned` row would ever raise it again. Rows a curator created by
hand (`is_manual`) are outside all of this — their `curator-<id>-<ts>` key was never in a
source listing, so they are excluded from detection and from its coverage denominator.
Absence is judged against the external ids the run actually saw, not against
`last_seen_sync_log_id` — a dry run stamps
nothing, and a row that arrived but failed to process is not missing either. The machine only
ever sets `missing_since`, and only when all three guards pass — the source is `authoritative` (declared
per service in `SyncServiceConfig`, `ranked` for the Wikidata sources — Art Museums, Public Art &
Monuments, Places of worship and Archaeology), the run
finished clean and uncancelled, and it saw at least 90 % of the previously present rows.
When detection is skipped the reason is stored in `experience_sync_logs.detection_skipped_reason`.

A museum's *works* have a floor of their own, since the source is `ranked` and never reaches
this one: the works coverage floor (ADR-0044, § Art Museums below). Its refusal lands in
`experience_sync_logs.withdrawal_skipped_reason`, and unlike detection's it downgrades the run to
`partial` — a run that saw too little to say what left is not a success, whatever its items did.
The orchestrator carries that verdict from `fetchItems` (`withdrawalSkippedReason` on the result)
to every `processItem` through `SyncRunContext.withdrawalSkippedReason`, so the writer marks
nothing behind it; a source that leaves the field out is unchanged, since points are paired per
object and need no floor.

**Dry runs** (`POST /sync/sources/:id/start` with `{"dryRun": true}`) walk the same path and
write the log and changeset with `is_dry_run = true`, but touch no experiences, locations,
treasures or images. Dry-run logs are excluded from every "latest run" query, so a preview
cannot disturb provenance.

**Filtered is not failed.** The museum query matches artworks on `wdt:P195`, so Wikidata
answers with collections as entities — the Royal Collection, Collection Crozat — alongside
museums. They carry no coordinates because a collection is not a place, and the coordinate
check drops them. That is the filter working, so it is counted in `total_filtered` and
recorded as `change_type = 'filtered'`, not as an error: before this, eight such entities made
every museum run `partial` with failures nobody could fix, and on an authoritative source they
would have blocked missing detection outright.

**Serial nominations carry their coordinates in their parts.** UNESCO leaves `coordinates`
null on many serial sites and fills `components_list` instead; `resolveMainPoint()` falls back
to the component nearest the components' centroid. Not the first component (it sat 301 km from
Getbol's former point, far enough to change its region) and not the centroid itself (for parts
scattered like the Roças of São Tomé it can fall in open water). The dry run of 3 August found
28 records of this shape, 25 of them new inscriptions that would never have entered the
catalogue.

**Fixture source** — setting `SYNC_SOURCE_FIXTURE` to a directory makes UNESCO sync read
`unesco.json` from it instead of the live API. Development only — the switch is refused
outright when `NODE_ENV=production`, which is the guard that matters; the directory itself is
operator-set and used as given, while the file name it reads is a module constant checked to
be a bare name so the read cannot leave that directory. In the Docker stack the variable is passed
through `docker-compose.yml`, and the path is the **container's** — put the fixture under the
already-mounted data directory (`./data/sync-fixtures` on the host,
`SYNC_SOURCE_FIXTURE=/app/data/sync-fixtures` in `.env`), since nothing else is mounted
writable. It exists because the real sources make a poor
inner loop and cannot be asked for "the same list, minus one object" — the case the delisting
path needs.

### UNESCO (`unescoSyncService.ts`, `unescoApi.ts`)

- Fetches the full World Heritage list in **one** request to `data.unesco.org` — 1273 records in ~0.7 s, measured
- Asks Wikidata one question per run about every World Heritage property (`unescoWikidata.ts`): its English Wikipedia article (`schema:about` + `schema:isPartOf`, stored as `metadata.wikipediaUrl`) and its Commons picture (P18, stored as `image_url`), both hanging off the item that carries the site's id (P757). Read through `p:P757/ps:P757`, never `wdt:P757` — the truthy path exposes only the best-ranked statement, and Cologne Cathedral ranks `292bis` above the `292` the catalogue is keyed by while the Sydney Opera House carries `166rev` alone, which is why 366 of 1272 rows had no article link before ADR-0043. Fails open (sync proceeds without either if Wikidata is unavailable)
- Multi-location support: serial nominations create multiple `experience_locations`
- **The portal's own photographs are not read** (`main_image_url`, `main_image_author`, `main_image_copyright`), and the reasons are the World Heritage Centre's terms, quoted in [ADR-0043](../decisions/0043-a-picture-we-show-is-one-we-may-show.md): they may not be copied or in-lined, and the photographs are third parties' property. 1260 of the 1272 rows carried one until 2026-09-01 ([#557](https://github.com/uncovering-world/track-your-regions/issues/557)). See § Pictures below for where a picture comes from instead. Nothing is downloaded: the `/data/images` machinery exists and holds none of them

**Their rules, read from their own headers** (2026-08-21). `data.unesco.org` runs Opendatasoft's Explore API v2.1, which answers every request with `x-ratelimit-limit: 10000` (calls a day, anonymous), `x-ratelimit-remaining`, and `x-ratelimit-reset` at midnight UTC. `/records` is capped at 100 rows and at `offset + limit <= 10000`; `/exports` has no such cap and is what the platform documents for taking a dataset whole. So the import uses `/exports/json` — one call instead of thirteen paginated ones, and no `while (fetched < total)` loop that a page returning nothing could spin forever. `select=` names the fields the importer reads (`EXPORT_FIELDS` in `unescoApi.ts`; three more until ADR-0043 stopped asking for the portal's picture and its two credit fields), which took the answer from 24 MB to 3.7 MB: the descriptions in six languages and the video captions are most of that dataset by weight and none of them are used. The run logs what is left of the day's allowance once, and honours 429 + `Retry-After` through the shared retry.

**Three fields the importer asked for wrongly, and a dry run that found them.** Naming the fields in `select` turned the first into a 400 that said `Unknown field: criteria` — that field does not exist in `whc001` and never did, so `buildUnescoTags` produced no criterion tag for any site: measured on the live database, **0 of 1272**. The real name is `criteria_txt` (`(i)(ii)(iii)(iv)` for the Bamiyan Valley), present on 1256 of 1273 records. The other two were found by previewing the fix: `danger` and `transboundary` are compared against the number `1`, and the portal sends the **strings** `"True"` / `"False"` — from either endpoint. So `metadata.inDanger` was false for all 1272 sites, 58 of which are listed in danger, and not one of the 51 transboundary sites carried its tag. The `in_danger` tag survived only because `danger_list` is a string and was tested beside the flag. `isSet` now reads a yes in any of the shapes a portal might send it, rather than the one shape seen today.

**What the first run after this proposes**, measured by dry run 66: `tags` on 1255 sites, `metadata.criteria` on 1255 (the criteria string), `metadata.inDanger` on 58, `shortDescription` on 7 (3 of them curator-claimed, so they arrive as conflicts rather than proposals), `name` and `nameLocal` on one — Getbol drops "(Phase II)" — and `metadata.dateInscribed` on one, Garamba National Park, where the source now says 1980 and the catalogue holds 2026. **Whether that batch is held or written depends on the deployment, not on the source.** `requires_curation` is false in the seed (`db/init/01-schema.sql`) for World Heritage, Art Museums and Public Art & Monuments, the sources that predate Places of worship, which arrives gated, and gating one of the others is an admin's click — the dry run above was measured on a database where UNESCO had been gated. Where it has been, all of it waits for a curator: a one-off batch that is four missing years landing at once, not a source that suddenly started changing its mind. Where it has not, the same batch simply lands. The `metadata.inDanger` row of that table is spent on a database that has had migration 035: those 58 rows already carry the flag, so a run finds nothing to propose about it — see below for why that half was repaired rather than queued. A card a run has *already* filed keeps its `false → true` line, since a changeset records what a run did (ADR-0026) and publishing it writes the value the migration wrote; the rest of that card — the criteria string — is what still needs a curator; the criterion tags filed beside it are no longer a question and no longer a row on the card (#570), though publishing such a card still writes them. The counts above are the entry shape of the run that was measured, and one of them has since changed: a run records each **language** that differs on its own (#728), so Getbol's single `nameLocal` entry is one entry per moved language now — two of its six on that dry run, six on the runs that followed, which all drop "(Phase II)" from every language. The site count does not move; what a curator answers does.

**A site in danger, and since when.** The World Heritage list carries 58 sites inscribed on the [List of World Heritage in Danger](https://whc.unesco.org/en/danger/), and the catalogue stores that fact **twice**: as the `in_danger` tag and as `metadata.inDanger`, which is the field every badge keys on. The two came from different halves of the source — the tag from either of `danger` and `danger_list`, the flag from `danger` alone — so the reading bug above left the tag right on 58 rows and the flag false on all 1272, and the badge the expanded list card, Discover's card and Discover's detail panel draw appeared for nobody ([#600](https://github.com/uncovering-world/track-your-regions/issues/600)). Both writers ask one predicate now (`isInDanger`), so a portal that empties either field cannot end the answer in silence, and a delisted site is still not badged: the field's vocabulary is Y/N and the parser reads the answer rather than the field's presence — Belize Barrier Reef Reserve System, off the list since 2018, answers `danger: "False"` with `danger_list: null` (measured 2026-08-27, when the two fields agreed exactly on 58 of 1273 records).

Fixing the reading repairs nothing already stored, and under a gate it cannot: `inDanger` is not a key a run owns outright (`SYNC_OWNED_METADATA_KEYS`), so the hold refuses to overwrite a row a reader can see and the 58 flips would reach a curator as 58 major changes to answer for — this catalogue's own misreading, dressed as the source changing its mind. `db/migrations/035-in-danger-flag.sql` puts the rows right instead, keyed on the tag rather than on UNESCO's field so it speaks about two columns of one catalogue; **Catalogue Checks** watches the pair from there on ("A site whose danger tag and whose In Danger badge disagree"), in both directions, since a badge on a site nothing lists tells a traveller a place is in peril on no evidence at all.

The date is most of what the fact means on the ground, so the list reads send it: `dangerList` is stored as the source wrote it (`"Y 2013"`) and `experienceDanger.ts` reads the year out of it on the way out as `danger_since`, beside `in_danger` as a boolean. The string itself does not leave the server — a client parsing `"Y 2013"` would be a third copy of one rule — and `parseDangerListing` is the same function the importer used to write the flag. The badge says "In Danger since 2013" wherever the year is known and "In Danger" where it is not (`inDangerLabel`), on the expanded list row, Discover's card tooltip and Discover's detail panel.

### Pictures (`unescoWikidata.ts`, `unescoImageRepair.ts`, `urlSafety.ts`)

**Every picture a run writes is a Wikimedia Commons file, and that is a licence rule before it is a technical one** ([ADR-0043](../decisions/0043-a-picture-we-show-is-one-we-may-show.md)); the one other picture the catalogue may show is a file we host ourselves, as an `/images/…` path a curator names. Until 2026-09-01 four in five were the World Heritage Centre's own — 1260 of 1591 pointed at `whc.unesco.org/document/<id>` — and their terms say those photographs "may not be copied or retransmitted by any means without explicit authorisation" and that a site may "only link to, not replicate" them. Every route #557 had weighed for resizing them (a proxy, a stored variant, the free third-party resizer that was already on the reader's path) made a copy. So the portal is linked to instead, by `metadata.website`, which every row carries and which its terms invite, and the picture comes from Commons.

**Where a World Heritage property's picture comes from.** Wikidata states one (P18) for the item carrying the property's id (P757), and the match is by that id and nothing looser: the site's own number first, then a later numbering of the same property (`166rev`, `292bis`), then the lowest-numbered of its components (`1142-01bis`) — UNESCO's own ordering of a serial property's parts, not a query planner's. Measured 2026-09-01: 1131, 1206 and 1220 of the 1260, 96.8 %. Deterministic at every step (`MIN` over an item's several pictures, a sort within a tier), because on a gated source a picture that changed between runs is a proposal somebody has to answer. A component's picture may stand in for the property; a component's *article* may not — a reader following it from the card would land on the wrong page — so the article is taken from the property's own item only. The 40 left have a Wikidata item (38), a Commons category (16), a part with a picture (17): pools a person can choose from, not statements a run can act on. `Category:Wudang Mountains` opens with a portrait of a person, and a licence-filtered aggregator answers "Deer Stone Monuments" with a cemetery in New Orleans. They show no picture and keep their link.

**Which hosts a picture may come from is decided in one place for both sides.** `PICTURE_HOSTS` and `PICTURE_EXTENSIONS` (`@tyr/shared/pictures`, ADR-0065) are the two Commons hosts and the file types a picture may be, imported by `urlSafety.ts` on the storing side and `imageUrl.ts` on the drawing side — until #789 each side held a copy and `urlSafety.test.ts` read the frontend's out of its source. `isDisplayablePictureUrl` also asks that a Commons file *name a picture* — Commons hosts PDFs, videos and scanned books under the same `Special:FilePath` shape, and a stored one is the empty frame this rule exists to stop — and that it be the file rather than the `/wiki/File:` page about it, which ends the same way and answers HTML; on `upload.wikimedia.org` (or a subdomain of it) only `/wikipedia/commons/` is Commons'. **Every writer of `image_url` holds the line at the writer, and there are two lines.** A run is held to `isCommonsPictureUrl` — a picture file on a Commons host, and nothing else, since a source's picture is a Commons file by construction and no run writes a path of ours: the sync upsert (`withShowablePicture`, `experienceUpsert.ts`, binding every experience collector, since each writes through `upsertExperienceRecord`), the works writer (`treasureWriter.ts`) and both repairs (`pictureRepair.ts`). A person is held to `isDisplayablePictureUrl`, which adds the one local shape the drawing side maps, an `/images/…` path for a file we host: a curator's edit (`safeImageUrlSchema`, and the controller's own second reading) and publishing a held proposal (`publishHeldFields.ts`, which refuses the card rather than dropping the value — a card filed before the rule can still be proposing the portal's photograph). A refused picture takes its credit with it, so no photographer is named beside an empty frame — for a picture the run owns; a picture a curator claimed stays, and so does the credit under it (`creditToWrite` resends it, and the upsert re-applies it whatever the run sent).

**Repairing what is stored is the admin's action, not a run's proposal.** UNESCO is gated, so a run offering a Commons picture for a visible row files a held proposal, and 1260 rows carrying a picture the product may not show are not 1260 questions for a curator. *Fix pictures* on the source's card in the sync panel (`POST /api/admin/sync/sources/:id/fix-images`, `fixUnescoImages`) writes now: a Commons picture with its credit where Wikidata states one, nothing where it does not (the portal's photograph and its credit taken off), and never a picture a curator owns. One outcome is for the whole run rather than a row: when Wikidata does not answer, the repair stops before touching anything and says so — *Wikidata did not answer, so nothing was changed — try again later* — because an unanswered query is not the same as a property with no picture, and read alike it would have emptied every selected row. The same button fills in museums' missing pictures (`fixMuseumImages`); the two share `pictureRepair.ts`, and the panel offers the button exactly where the route acts, read from `repairsPictures` on the source.

**No third-party resizer stands between a reader and a picture.** Commons sizes its own files through `Special:FilePath/<name>?width=N`, and a picture stored in the `upload.wikimedia.org` form is asked for through the same door (`toThumbnailUrl`). What used to sit there was `wsrv.nl`, undocumented, with no agreement behind it, on the path of four reader-facing pictures in five.

### Picture credits (`imageCredit.ts`)

The catalogue displays photographs it does not host — Wikimedia Commons files, on the objects and on the works inside them (#582) — and until 2026-08-22 it named nobody. A share of them are CC BY or CC BY-SA. What both ask of a catalogue that merely *shows* a picture is the same one thing — that the author is named wherever the work appears; CC BY-SA's ShareAlike term binds adaptations, which displaying a photograph is not. The rest are free only because somebody said so. This was not a styling gap. (The World Heritage portal's own `main_image_author` and `main_image_copyright` were read for its photographs until ADR-0043 took those photographs off the catalogue; a photographer's name belongs under their photograph, so they are not read any more.)

**Commons** answers `extmetadata` for up to 50 files per request — their documented ceiling, and what keeps a run to a handful of questions rather than one per picture: `Artist`, `LicenseShortName`, `LicenseUrl`. Asked of the live API on 2026-08-22, every file in the sample answered — Stonehenge is Stefan Kühn under CC BY-SA 3.0, the Little Mermaid is Benoît Prieur under CC0. The UNESCO run asks only about the files that are new to a row (`creditsForNewPictures`): `creditToWrite` reuses a stored credit while the row still shows the same file, so a run after the first is a handful of batches rather than twenty-five.

`Artist` arrives as wiki HTML and is reduced to text **server-side**, before storage: it is somebody else's markup, and storing it raw would leave it waiting for the one component that renders something unescaped. The input is capped before any pattern scans it. A credit that cannot be fetched costs a line under a picture, never an import — a failed batch is logged and skipped, and the previous credit stays. Stored as `metadata.imageCredit`, read out as `image_credit` beside `image_url` on both the list and region reads, and rendered by `ImageCreditLine` under the picture on every surface that shows one — and, equally a rule, under none that does not: see § Credits on the works, where the converse and the two rendering rules live. The visitor surfaces — the Discover detail panel, the expanded list card, the map's hover preview and Discover's hover overlay — are enumerated below, and the curator screens that also draw it are in that section. **The credits appear only after a run writes them** — nothing backfills the rows already in the database, and under a gated source a run proposes rather than writes, so they appear when a curator passes the metadata change.

**A credit belongs to a picture, and to whoever owns it.** A run reuses a stored credit only while the row still shows the same file — a source whose `wdt:P18` changes while the Commons batch for the new file fails would otherwise write the new photograph and the previous photographer's name in one statement. And a run writes no credit at all for a picture a curator claimed, because the upsert keeps their `image_url` and would set the source's photographer beside it. Both rules live in `creditToWrite`, and **every collector goes through it** — Art Museums, Public Art & Monuments, Places of worship, Archaeology, and UNESCO, which matters most there: it carries more of the catalogue's photographs than any other source, and since ADR-0043 its credit is a Commons fetch like the others' (it used to come from the portal's record, and an unconditional write would have printed the portal's photographer under a picture a curator had chosen). A site Wikidata states no picture for stores no credit at all.

**The admin "fix missing images" action credits what it puts there.** It writes the picture and its credit in one `UPDATE`, omits the key where Commons could not answer — a stored `null` is what the next run reports as a change on `metadata.imageCredit`, for the removal of a nothing — and **skips a row whose `image_url` a curator claims**, so clearing a wrong photograph is not undone by the next click. Rows kept that way are counted and named separately from "no image found", which would blame the source for a person's decision.

**A curator who replaces the picture replaces the credit with it.** `PATCH /experiences/:id/edit` writes `metadata.imageCredit` in the same statement as `image_url` and claims `metadata.imageCredit` alongside it. Both halves are load-bearing: without the write, the card would go on naming the photographer of the picture that was just removed — a false claim about a real person, worse than naming nobody; without the claim, the next run would write *its* photographer's name against the curator's photograph, because the sync's metadata clause overwrites an unclaimed key and preserves a claimed one. If the new URL is a Commons file, the credit is resolved for it (one attempt, five seconds, failure is null) — outside the transaction, because a lock held across a request to somebody else's server is a lock held for as long as they feel like taking. **`metadata.imageCredit` alone is claimed only where the edit put a value in it**: claiming a `null` would be permanent, so one slow Commons response would leave a real photograph uncredited for good — and nothing overwrites the gap meanwhile, because a run writes no credit for a picture it does not own. `metadata.website` and `metadata.wikipediaUrl` are the opposite and claimed either way: **clearing** one is a decision, and leaving it unclaimed would have the next run write the source's value straight back over the removal. **Everywhere the picture is, the credit is**: the Discover detail panel, the expanded list card, the map's hover preview and Discover's hover overlay — the credit rides in the hover store's `HoverPreview` for the first of those, since it has no `Experience` in scope. One gap is deliberate and named rather than left to be discovered: the 56×56 thumbnail on a Discover card, which is too small to caption legibly and opens onto a panel that names the photographer. The edit's audit row records the old credit beside the old picture (`buildEditAuditDetails`), and the object's History prints it as the card would — `Carl Montgomery · CC BY 2.0` → `(empty)` for Bamiyan's picture emptied — through `creditSentence`, the one sentence `ImageCreditLine` renders; until #801 the row read `[object Object]`, everything about the removal but the name.

**A hand-made object is credited when it is made, not by a run that never comes.** `POST /experiences` resolves the credit for whatever `image_url` a curator saved and stores it with the row — before the transaction opens, like the edit path, and answering null on anything that is not a Commons file or does not come back in five seconds. Without it these rows would be the one permanently uncredited shape in the catalogue: they are written `verified` and published in the same statement, so a reader sees the picture immediately, and no collector ever reads them back — a manual row belongs to no source.

#### Credits on the works, and on the curator's screens (#582)

**Every work's photograph is credited too.** Nearly every treasure shows a Commons file, and the museum run asks about them in the same pass as the venues: one `fetchCommonsCredits` call over both sets, and one map so a work and the museum holding it cannot credit the same file differently. The map is the reason, not the request count — sharing a batch cannot reduce the number of titles, only the number of half-empty batches, so batching the two sets together saves at most one request. The credit is stored as `treasures.metadata.imageCredit` through `creditToWrite` like everything else — `treasures.curated_fields` holds `image_url` in its claimable set, so a claimed picture is never described by whoever took a different one — and `treasureMetadata` writes `null` rather than `{}` where there is nothing to say, since the upsert replaces `metadata` whole and some works carry no picture at all.

Two ceilings bound a batch now, not one. The count (50, their documented limit) was enough while the files were named after buildings; an artwork's file is named after the painting, the painter, the museum and the inventory number, so fifty of those titles can build a query string several kilobytes long. `batchTitles` closes a batch on whichever ceiling comes first, because a request over the URL limit fails as a 414 — which this module turns into a batch of silently missing credits rather than an error anybody sees.

**On a dense list the credit draws only where it carries something.** Most of these files are public-domain reproductions of paintings, and for one of those Commons names the *painter* as the file's author — so the credit under *The Night Watch* would read "Rembrandt · Public domain" beside a line that already says "Rembrandt · 1642 · painting". A row that repeats itself teaches a reader to stop reading the line, which is the last thing an attribution should do. `creditAddsBeyond` (in `ImageCreditLine.tsx`) is the rule, opted into by passing `redundantWith`: the line appears where the licence asks to be honoured — the CC BY and CC BY-SA minority, such as the Mesha Stele at the Louvre, photographed by Mbzt under CC BY-SA 4.0 — or where the photographer is somebody the row does not already name. An unrecognised licence counts as one that asks, because over-crediting costs a line where under-crediting breaks a term. The large views pass no `redundantWith` and always show it: the 500 px hover preview over the map (`ArtworkPreviewOverlay`, its own component with its own pale strip, since the overlay behind it is dark), and the full-size dialog on a curator's card. Discover's 100 px contents tile has no room for a caption inside it, so the credit sits under the tile by the same rule, and its tooltip names the photographer whenever the tile draws a picture — regardless of `redundantWith`, and silent when it draws none (`creditLabel`).

**A credit never outlives its picture.** The converse of "wherever the work appears" is a rule of the feature rather than a nicety: a line naming a photographer beside a frame whose picture answered 403 is a claim about a person made where the thing that would justify it is not. Every component that renders `ImageCreditLine` gates it on the image having arrived — an `onError` that takes the picture and the credit together, rather than the older `style.display = 'none'`, which hid the element and left the line standing. On the surfaces that drew the portal's UNESCO pictures the refusal used to be the *ordinary* outcome, not the edge one (#557); every picture is a Commons file now, and the rule stays for the day one does not load.

The sharp edge is what the failure is held as. **Where a component outlives one picture, it must remember which URL failed, not that one did** — `ArtworkPreviewOverlay` survives many hovers, and `ObjectContext` and `ObjectPreview` are drawn one card at a time by `ReviewBench` with no `key` anywhere on the chain, so a new object reconciles into the same instance. Held as a boolean, one 403 blanks every object after it and takes a credit off a picture that is there, which is a false statement rather than a missing one. A plain flag is correct wherever the parent keys the child, so that a different picture is a different instance — the rows and tiles of a list, `ArtworkRow`, `ContentTile`, `SearchResultBody` and `WorkRow` among them. The distinction is the lifetime, not the surface: ask whether this instance can be handed a second picture.

**The curator screens name the photographer too.** `objectContextSelectSql` carries `metadata->'imageCredit'` on every queue kind — nine of them now, and stated as a rule rather than a tally so a list added is covered rather than counted — `countedWorksSelectSql` carries each work's, and the search read behind `AddExperienceDialog` carries it for its 40 px result rows. Those screens are the catalogue being worked on rather than published, which changes nothing about the licence — and answers a question only they raise, since a curator deciding whether to replace a photograph needs to know whose it is. The waiting-to-publish preview draws what `GET /experiences/:id` was already sending it in `metadata`. The two curator dialogs draw their picture through `PictureWithCredit`: `CurationDialog` shows the stored picture under the Image URL box with its credit, and `AddExperienceDialog` the address being typed with none — the object does not exist yet, so no credit does (#801).

### Shared retry (`sourceRetry.ts`)

Every source is somebody else's server, and all of them fail the same way. `withRetries` holds the loop — bounded by a `WaitBudget` the whole run shares rather than by a count, waking early when the run is cancelled, reporting each wait through `SourceWait` so a panel can say what is happening — and each client keeps only what its own errors *mean*, as a `classify` function. `sparqlQuery` and `fetchUnescoRecords` are both that loop with a different classifier; `abortOn` gives each attempt a deadline **and** a cancel hook on one signal.

### Art Museums (`museumSyncService.ts`, `museum/*.ts`)

Works-first: the sync decides what belongs in the catalogue by which artworks the world knows,
then admits the museums holding them — not by which Wikidata entity happens to own a famous
painting. See [ADR-0023](../decisions/0023-works-first-museum-selection.md).

- Collects artworks via SPARQL: the three broad classes (painting, sculpture, statue), each asked
  in fame bands, plus every narrower artwork class found by a bounded `wdt:P279*` closure below
  those three roots, asked in batches of 25. A hop that would multiply the class set (e.g. under
  `sculpture` or `print`) is refused rather than followed. Nothing requires a work to name an
  owner or a location: the ownership anchor the broad roots used to carry was what made their
  query unaffordable, and it cost the catalogue unowned works such as *Sunflowers* and the
  *Burghers of Calais*. A work with no venue statement is simply homeless when placement runs
- Resolves where a work actually hangs from its current `P195`/`P276` statements, dropping any
  statement carrying a `pq:P582` end-time qualifier: a venue the two properties agree on wins;
  failing that, a `preferred`-ranked statement that resolves to a venue wins; failing that,
  ownership, then location
- **A work nobody can see is placed nowhere** (#868): it admits no museum, is linked as no
  museum's treasure, and its existing link is marked like any other departure (ADR-0044). Two
  readings, both in the shared collector (`worksCollector.ts`) so Places of worship gets them
  too. *Whereabouts unknown* (`whereaboutsUnknown`, `placement.ts`): a location (`P276`) whose
  value is Wikidata's *unknown value*, standing at best rank — preferred, or normal with no
  preferred location beside it — or a collection (`P195`) whose value is unknown at preferred
  rank. `fetchVenueStatements` keeps such a statement with `venue: null` rather than dropping the
  row, which is how the older venue used to stand: *The Concert* has an unknown location at
  preferred rank since the day of the Gardner theft, *The Storm on the Sea of Galilee* an unknown
  collection at preferred rank beside the Gardner at normal, *Salvator Mundi* and *The Tower of
  Blue Horses* an unknown location at normal rank beside normal named ones. An unknown collection
  at normal rank alone is an anonymous owner and changes nothing (*Nude, Green Leaves and Bust*
  hangs at Tate Modern on loan), and an ended unknown value never arrives (*The Parsonage Garden
  at Nuenen*, recovered 2023). *Lost*: a work carrying a class of the `P279*` tree under `lost
  artwork` (`LOST_WORK_ROOT`, Q4140840 — `destroyed artwork`, `lost sculpture`, `lost painting`
  on 2026-09-12), read whole by `fetchClassTree` and asked for its works through the same
  narrow-class question the pool uses, then intersected with the pool — because the closure under
  `painting` reaches `lost painting` but not `lost artwork`, and *Portrait of a Courtesan*
  arrives typed `painting`. A theft (`P793`) is deliberately not read: 414 of 425 theft events
  carry no end time and most of those works were recovered. One exception by name,
  `REMAINS_ON_SHOW`: the *Colossus of Constantine* is a `destroyed artwork` whose fragments are
  the Capitoline courtyard, and a marked link has no curator's verdict to bring it back until
  #749. A museum that only such works would have admitted is refused with their names — "its
  famous works cannot be seen — The Storm on the Sea of Galilee (whereabouts unknown), The
  Concert (whereabouts unknown)" is what the Gardner's membership reads — rather than the
  sweep's generic reason; a museum admitted anyway lost a work, not its place, and is not
  reported. The run's log names each unseen work with its reason and the venue its statements
  still remember, up to the same cap the placement diff uses
- An entity counts as a venue only if it passes a test: a museum-like class under `wdt:P279*` of
  `museum` (Q33506), coordinates of its own (`P625`), not dissolved (`P576`), and not on a
  kill-list of curatorial departments, art/private collections, museum networks and never-built
  structures. A class that describes a place rather than an institution (a church building or
  cathedral, an archaeological park or Roman ruins, a villa — `SITE_CLASSES` in `venueTest.ts`)
  is vetoed the same way, unless the entity also carries an art class: the Uffizi is typed
  `palace, art museum`, and the palace must not disqualify it. An entity that fails either check
  is resolved by walking `wdt:P361` (part of) to the nearest ancestor that passes — how the
  Louvre's four curatorial departments become the Louvre, and a dead collector's collection
  re-homes to where the works actually hang
- Folds duplicate pins for one physical institution (a gallery inside its own palace, one building
  recorded under two QIDs) into the venue that holds the ticket (`venueFolds.ts`, three rules in
  order). A `P361` container that received a work of its own, within 250 m, is the ticket. A
  **door** — what a venue is located in (`P276`) or part of (`P361`) that would pass the venue
  test on its own, is not an `EDITORIAL_OUT` entity, lies within the same 250 m and is the
  better-known name by sitelinks — is the ticket even when no work names it (#781): the
  Galleria Palatina folds into Palazzo Pitti, the Egyptian Museum of Berlin into the Neues
  Museum, the Musée des Beaux-Arts de la ville de Paris into the Petit Palais, the Palace Museum
  into the Forbidden City, the Sackler Center into the Brooklyn Museum. Fame is what separates a
  collection inside a building from a museum that merely occupies one — the Galleria Borghese
  stays under its own name though it stands in a villa Wikidata types a museum — and distance
  is what keeps a branch two streets from its institution a visit of its own; an umbrella
  organisation is neither (the Nationalgalerie's coordinate lies 200 m from the Alte
  Nationalgalerie and is less known), and the MuseumsQuartier, which is both, is the editorial
  exclusion. Two rows at one spot with no edge between them are one record twice, and the row
  carrying the collection survives — and a row whose twin already went through a door or into
  its container follows it there, provided that door is the better-known name for it too, so a
  duplicate record of a collection does not stay behind as a second pin. The venue graph
  follows a museum-class entity's `P276` one
  hop, like a parent, so the door has facts — dropping a location the entity has left (a
  statement carrying `pq:P582`), the rule a work's `P276` is read under; resolution itself still
  walks `P361` only, and `EDITORIAL_OUT` is what keeps an excluded quarter from being a door
- Once folding settles, each surviving venue must also be an *art* museum (`artTest.ts`) — the
  kind holds art museums by product decision (2026-08-05); archaeology, egyptology,
  natural-history and military museums are not art museums, and #581 imports archaeology and
  history museums as kinds of their own, starting from the rows the art test expelled. Thirteen
  Wikidata classes (art museum, national gallery, kunsthalle, pinacotheca, glyptotheque, sculpture
  museum and others — `ART_CLASSES`) admit a venue outright, whatever else it is typed or holds.
  Without one, the venue's own held works decide by painting-to-sculpture share — a work counts as
  sculptural by the shape of its class label (`isSculptural`: statue, bust, relief, cast, figurine,
  torso, stele, monument) — which is what keeps the Hermitage (typed bare `museum`, mostly
  paintings) while dropping a museum whose famous holding is a figurine or a sculpture, and drops a
  museum with no famous holding at all. Four entities no class rule reaches (the British Museum,
  East Side Gallery, MuseumsQuartier, the National Library of Australia — each typed `art museum`
  on Wikidata) are excluded by name (`EDITORIAL_OUT`), with the reason for each in code. A
  rejection at this stage is recorded as a `FilteredEntity` exactly like a venue-test rejection, so
  the run's own log says why
- One threshold decides both which works are Iconic and which museums are admitted: 22
  Wikipedia-language sitelinks (`ICONIC_SITELINKS`). A museum is in the catalogue only because it
  holds a work that clears the threshold, and a work held by more than 2 venues (`MAX_HOLDERS`)
  admits none of them — Hokusai's *Great Wave* survives in on the order of a hundred impressions,
  and holding one is not what makes a top art museum
- **What an admitted museum holds is read from the museum's side too** (#890,
  `museum/venueSide.ts`, the one stage shared by the three kinds that hold works — Places of worship
  and Archaeology describe their own use of it in their sections). The pool is class-first: classes
  are asked, then where what was collected is kept, so an object at an admitted venue that carries
  no class the pool asks for never reaches the kind's rule, however famous. Once admission is
  settled, the run asks the other question of every venue it admits **and of every venue folded
  into one** — the Ishtar Gate's collection statement names the Vorderasiatisches Museum, which
  folds into the Pergamon, and a read of the survivor alone would miss the one object the read
  exists for: *what does Wikidata say this venue holds, by a current `P195` or `P276` statement*
  (carrying no end time, not deprecated — the rule a work's own statements are read under), at the
  pool's floor of 10 sitelinks and never a venue whole. Fifty venues to a question
  (`fetchVenueHoldings`, `venueSideQueries.ts`), and the question is **venue-first under
  Blazegraph's `optimizer "None"`**, the way the banded pool is asked (ADR-0030 decision 8): written
  work-first, or left to the planner, the same question timed out for *one* venue (65 s, 504) because
  the join started at every `P195` statement on Wikidata; venue-first, fifty of the archaeology
  kind's museums answer in 12 s (measured 2026-09-15). What the pool already holds is skipped — the
  pool's decision stands, kept or refused. Then what each new object *is*, by id
  (`fetchWorksByIds`: the pool's own columns and every `P31` with its label, parsed by the pool's own
  rule, fifty to a question), the kind's `workFacts` where it has one, and the same `keep` the pool
  ran — with the venue as a known fact. This kind keeps everything its pool collects, so its keep is
  the pool's own vocabulary (`askedClasses` on the collection: the closure, the pinned and the extra
  classes): an object typed first by a class the closure never reached and carrying a closure class
  beside it is kept and typed by that class; one carrying none is refused. What is kept has its venue
  statements read, the venue graph extended for the venues they name (`extendVenueGraph` — an
  admitted museum that entered by its class and holds no pool work is in no graph yet), is placed by
  `placeArtwork` and the lost tree exactly as a pool work is, and is merged into the collection, so
  the writer, the works floor (ADR-0044) and the gate never learn which road an object came in on.
  The tier is not asked again: a museum is admitted for a work the pool knows, and a venue-side
  object is listed on the card of a museum already admitted. Its type is the kind's own class where
  it carries one, else the lowest-numbered class the pool asked for, else the lowest-numbered of its
  own — deterministic where an answer's row order is not, since a type that changed with the
  planner's mood would report an update on every run to a word nobody chose; a curator's correction
  stands (#731). **What is refused is reported, not lost**: each refusal goes onto the run's changeset
  as a `filtered` row carrying the object's classes and its holder — `not a work of art by its
  classes: film (Q11424) — held by Museum of Modern Art` — through `FetchResult.refusedContents`,
  which the orchestrator records and **never marks**: `filtered` entries are matched against the
  source's own rows by external id (`markRefused`), and an object is not a row of the source — a
  relic that is also a chapel of the worship kind would otherwise have its place refused for a
  verdict taken on the object. **And so is what the read kept and the kind then wrote nowhere**
  (`keptElsewhere`): a kept object is not a written one — its statements can resolve to a venue the
  kind refuses or to nothing, and nobody can see a lost one — and each such object is named with
  the reason the placement gave (`nobody can see it: lost painting`, `its own statements place it
  at no admitted museum`). Never a row the run itself admits, the rule every kind's `filtered`
  already keeps: an object that is also a museum the run writes is not reported against it. A refusal is *named* only at or above the kind's contents line
  (`reportFloor`: `ICONIC_RELEASE` here, the finds' stay line for Archaeology, the source's stay
  line for Places of worship) and counted below it — the report exists for a person to read which
  classes the pool never asked for, and every film in MoMA's collection named would bury the Karun
  Treasure. That class list is #891's; this read is what shows it the classes. Measured on the
  development catalogue's 124 admitted art museums on 2026-09-15 (raw answers kept under
  `data/cache/890-venue-side/`): they hold **1,853 objects at 10 sitelinks or more (1,064 at 15)**,
  of which 676 (477) are linked at no venue that holds them and 643 (458) are no treasure of any
  kind — nearly all of them MoMA's films and video games (*Minecraft* at 156 sitelinks, *Snow White*
  at 121, *Toy Story* at 116, *Pulp Fiction* at 107), with the Très Riches Heures (`illuminated
  manuscript`), the Blue Qur'an and the design chairs among the handful of real objects. `work of
  art` on Wikidata is no rule to keep those by: its `P279*` tree holds 186,720 classes, `film`
  among them and `hoard` and `chair` not (measured the same day). Each run says what the read did
  in its log — venues, objects held, already in the pool, kept, refused and named — and the two
  questions are cached as `statements` and `pool` answers of the source that asked (ADR-0047)
- Prints a diff (moved / gained / lost / dropped) of this run's placements against what
  `experience_treasures` currently holds, before writing anything — during design this caught
  second-order regressions (a corroboration fix that silently routed a work to the wrong museum,
  and the next fix that silently dropped a work's true venue) that no test did
- Writes an admitted museum as a place with no `type` (an art museum is a kind, not a type — the literal `art` went with #814) whose Art Museums membership carries `is_iconic = true` and the work that qualified it (`admitted_for`, #822), and
  each work it holds as a treasure whose own `is_iconic` joins at the same 22-sitelink threshold
  and releases only below 18 (`ICONIC_RELEASE`), so the badge does not flicker as Wikipedia's
  coverage grows. The membership's flag goes with its admission, and its writers are the run's
  in `admission.ts` and a curator's beside their verdict: the run badges the museums it admits
  (`markIconic`) and takes the badge back where the sweep ran (`unmarkIconic`), the run's two refusal
  writes (`CLEAR_ICONIC` in `markRefused` and `markNotAdmitted`) clear it, and a curator's
  confirmation of a refusal (`setExperienceAdmission`, `lifecycleController.ts`) or refusal of an
  arrival (`refuseArrivalUnderLock`, `curatorRefusalController.ts`) clears it through
  that same fragment, a flag a curator pinned excepted in all of them. The badge is written after the run's admission step, not per museum, and only
  because the museum source declares `badgesAdmitted` — belonging is the badge here, as it is for
  public art and for places of worship, which badge everything they admit too; the exception is
  Archaeology, which badges a museum only for holding a find above its finds' line (§ Archaeology)
  — so that `admission` is a settled answer when it is read: a refusal a curator confirmed gets nothing
  though the collector — which consults `admission` nowhere — can select such a museum again,
  and a run cancelled before that step badges nothing rather than a row it never re-admitted.
  `refused-row-wearing-iconic` in Catalogue Checks names a refused row still wearing it (#760).
  `override` leaves the flag where the refusal put it — an admitted museum without the badge is
  a legitimate state (ADR-0045 decision 5)
- Records what the pass itself counted — `artworkCount` and `totalArtworkSitelinks` in the venue's
  metadata — as the run's own bookkeeping rather than as content: written straight through the
  gate, reported as no change and asked about on no card (§ Change provenance above)
- Departures are marked, not deleted (ADR-0022), and since ADR-0044 that includes a work's link:
  before a single museum is written the run measures the **works coverage floor** — of the works
  the catalogue offers at the museums it admits, the share it places at an admitted museum, which
  must reach 90 % (`worksCoverage.ts`) — and only a run that clears it marks the links of works it
  no longer places here (`linkWithdrawal.ts`, once per museum, after every work is written). A
  run below the floor marks nothing, is `partial`, and says why in
  `experience_sync_logs.withdrawal_skipped_reason` — the treasures analogue of
  `detection_skipped_reason`, shown on the run card as "Withdrawals skipped". A marked link is
  restored on any run that places the work here again, floor or no floor — the two arms run in
  one transaction. A visible link is held while this run places the same work at another admitted
  museum and no readable link of it stands anywhere yet, so a work that moved under the gate does
  not vanish from every reader until the new link is published; decided from the run's proposal
  (`placedThisRun` in the museum service) and the table together, since the new museum may be
  written after the old one. Every reader-facing read of a museum's works carries `offeredLinkSql`
  (`missing_since IS NULL`)
- Images use remote Wikimedia `Special:FilePath` URLs (not downloaded locally); Wikipedia article
  URL fetched via the same `schema:about` + `schema:isPartOf` SPARQL pattern UNESCO uses

### Public Art & Monuments (`landmarkSyncService.ts`, `publicArt/*.ts`)

**What the kind is for.** A thing a traveller stands in front of, outdoors: a sculpture, a
statue, a monument, a memorial, a fountain, an obelisk, a triumphal arch — Christ the Redeemer,
the Little Mermaid, the Trevi Fountain, the Motherland Calls. Not a building Wikidata happens to
call a monument, and not a work that hangs inside one: a cathedral is a place of worship, a
museum's sculpture is that museum's work, and a Pietà is St Peter's before it is Rome's (#753 is
where a work a traveller goes to a church to see will live). This source fills the kind's **world
tier** — what the world knows, by the same fame line as the museums' — and nothing else; the
regional tier, the monuments a region holds below the world's line, comes from regional sources
by the rules of [filling-a-kind.md](filling-a-kind.md) (ADR-0048; #799), and carries no badge.

**The pipeline is the museum import's, one level over** (#754). Five stages, each a cached
question (ADR-0030), wired in `publicArt/pipeline.ts`:

1. **Classes** — `boundedClosure` (the museums' walk, now shared in `classClosure.ts`) under
   sculpture (Q860861) and statue (Q179700), under fountain (Q483453), under war memorial (Q575759)
   and cenotaph (Q321053); plus the commemorative structures pinned by name in `classes.ts`
   (`MONUMENT_CLASSES`: triumphal arch, obelisk, victory, rostral and spiral columns, stele, rock
   relief, runestone, cross, …), the memorial classes pinned by name (`MEMORIAL_CLASSES`: memorial
   Q5003624, Holocaust memorial, cautionary memorial, the tomb of the unknown soldier and their kin —
   with the two commemorative closures, the trees' `commemorative` set, #803) and the heritage-sense
   designations (`HERITAGE_SENSE_CLASSES`: monument Q4989906, national monument, the US National
   Memorial). Two more
   trees are read for the rule below: `P279*` under museum (Q33506, 374 classes) and under structure
   of worship (Q1370598, 1265), the latter over a pinned floor of the worship buildings the first
   import's rows carried (`WORSHIP_CLASSES`: church building, Catholic cathedral, minor basilica,
   mosque, Shinto shrine, Buddhist temple, monastery, …) and less the designations that are not
   buildings (`WORSHIP_DESIGNATIONS`: pilgrimage site, which is what pilgrims make of Christ the
   Redeemer). The trees under `monument` (1000 classes in three hops) and
   `memorial` (694) are **not** followed, and the measurement is in the code: of their classes with
   an instance at 15 sitelinks or more, the largest are tomb (95), mausoleum (93), historic site
   (95), tell (66) and hypogeum (57) — burial and archaeology, not public art. `sculpture` refuses
   its second hop (142 841 classes) exactly as it does for the museums, and keeps its first (237).
2. **Pool** — the four broad roots (sculpture, statue, monument, memorial) sitelinks-first in fame
   bands (100+, 50–99, 30–49, 22–29, 18–21, 15–17 — the museums' shape, § Art Museums above),
   every other admitting class in batches of 25 taken whole, all at 15 sitelinks or more with a
   `P625`: the floor sits below the stay line so that an admitted row that slipped to 17 is still
   fetched and refused by name rather than swept — and the admitted rows no class question named
   at all (fallen further, retyped by Wikidata, or with the coordinate removed) are asked for by
   id afterwards, with no floor, no class and the coordinate optional, so that every admitted row
   Wikidata still answers for gets the rule's own reason: `no coordinates of its own (P625)` for
   the last of those. One entity however many questions offer it.
   Measured 2026-09-04: `monument`'s bands above 18 answer 137 entities in 43 s, `sculpture`'s 92
   in 56 s; the whole admitting set holds 600 entities at 15 sitelinks, 447 at 18 and 300 at 22.
   The pool no longer carries the five `OPTIONAL`s that made a monument with seven makers arrive
   seven times and spend a cap that counted rows (#720).
3. **Facts** — per 50 candidates, one `UNION` question: every `P31`; `P276`, `P361` and `P195`,
   each read statement by statement as what still holds (`standing` in `queries.ts`: best-ranked,
   what `wdt:` would answer, and carrying no `pq:P582` end time — the end-time rule the museum
   import reads a work's location under, and per statement rather than per value so that a whole
   that has both an ended and a standing statement of the same rank keeps the standing one; a
   preferred statement is Wikidata's mark for the current one and is read as `wdt:` reads it, so
   an ended statement ranked preferred over a standing normal one would leave the work placeless
   — an editing error upstream, and none among the pool's 13 preferred statements on 2026-09-05);
   and `P170` with the blank-node
   filter (six rows of the old sculpture query named a `.well-known/genid/…` creator). `P195` the
   rule reads only when nothing says where a work stands: whose collection a work is in is
   ownership, not a place — HAM Helsinki Art Museum owns the city's outdoor sculpture, and the
   first dry run, which read `P195` as a container, refused the Sibelius Monument as a work
   inside it (#804). Then what the containers are (label,
   `P31`) and what they are in turn inside or part of, walked up to **three hops**
   (`CONTAINER_HOPS`, the museum import's `VENUE_HOPS`): the Venus de Milo is located in Room 345,
   which names the Louvre Museum; the Dendera zodiac in Room 325, in the Sully Wing, part of the
   Louvre *Palace* — which Wikidata types a palace, not a museum, so a room or a wing
   (`INDOOR_CLASSES`) is indoors whatever the building is called. Each container is handed to the
   rule with how it was reached (`ContainerFact.relation`: the candidate's own `located in` or
   `part of`, or `above` — walked up to from the container `via` names), because a museum the
   candidate itself is *part of* is not where it stands (#803): Wikidata types a museum an
   institution, the Pakistan Monument is part of the Pakistan Monument Museum, which stands in the
   monument's base and is part of the monument in turn, and the monument stands in Shakarparian
   park by its `P276`. The rule reads such a museum as an owner — the collection rule below, with
   `part of Pakistan Monument Museum: a work of a museum` as its reason when nothing else places
   the work — and what the walk reached *only* through it as the museum's, not the work's: a
   place is what a chain of places reaches, and a container is listed once with every route that
   reached it, so which of two `part of` statements the source listed first decides nothing, and
   a work part of a museum *and* located in its courtyard stands in the museum; a room that is
   part of a museum is inside it as before, so the Louvre reached through Room 325 still names
   the museum. Measured on the pool on 2026-09-13: no sculpture above the line reaches a museum by
   `part of` alone — the works inside museums say `located in`. Then what the owners are, the
   same question, one hop and no walk: an owner is not a place, so it has no chain and no
   building above it. The old `bindingsToLandmarks`
   grouping is this stage's parse: makers deduped by folded label, a label that *is* a QID
   dropped.
4. **Verdict** — `publicArtVerdict` in `publicArtTest.ts`, pure, tested on the rows the first
   import got wrong. In the order a person would give the reason: **what it is** — a class of the
   worship tree (floor included, designations excluded), or of `KILL_CLASSES` (camps, stadiums,
   archaeological sites and caves, tombs and mausolea, finds — a Venus figurine is a museum
   object wherever Wikidata "locates" it, and the Venus of Willendorf is located in Austria —
   organisations, settlements and areas, events and works, amusement parks, walks and halls of
   fame, sculpture gardens, lost or destroyed things, landscape) is refused whatever else it
   carries; **where it stands** — a container in the museum or worship tree, walked up as above,
   refuses it as `inside St. Peter's Basilica: a work of a place of worship, not public art`
   (`inside Louvre Museum` for the Venus de Milo), a room or a wing as `inside Room 325 (Louvre
   Palace): a work indoors, not public art`, and a container that is a site (`SITE_CLASSES`: an
   archaeological site, a camp — the classes that own their parts) as `part of Babylon:
   archaeological site, not public art` (the Ishtar Gate). A district, a forest or a landscape as
   container says nothing — the third dry run refused the Charging Bull as part of the Financial
   District and the Hermannsdenkmal as part of the Teutoburg Forest before the list was narrowed
   to sites. **Whose it is, only when nothing says where it stands** (#804): a work nothing
   places — no location, no part-of that is not a museum institution (#803, stage 3), or none
   that still holds — is asked whose it is, the museum it is part of first and then whose
   collection it is in, and a museum's or a place of worship's makes it theirs: `in the collection of
   Sverdlovsk Regional Natural History Museum: a work of a museum, not public art` (the Shigir
   Idol), `in the collection of St Mark's Basilica: a work of a place of worship, not public art`
   (the Horses of Saint Mark, whose nine locations every one carry an end time). Any other owner
   says nothing — Akademgorodok, a campus, owns the Monument to the laboratory mouse — and an
   owner is never walked up or read as a room. A work something places keeps its place whoever
   owns it: the Sibelius Monument stands in its park. Measured on the 171 rows the tier admitted,
   2026-09-05: 72 carry no container, three of those an owner, and the fallback changes exactly
   the two verdicts it was written for. A coordinate match against museums was measured on the
   same 72 rows and not built: none shares a coordinate with a museum or a church, while eleven
   have one within 50 m — the Lion of Belfort stands 11 m from the History Museum of Belfort,
   the Fontana della Barcaccia 34 m from the Keats-Shelley House — so a radius would refuse real
   monuments and an exact match reaches nothing; and the Nestorian Stele's coordinate, which
   #804 took for the Stele Forest's, is its find spot forty kilometres away; then a class of
   `VETO_CLASSES` (cemeteries, buildings and structures) or of the museum tree refuses it
   **unless an artwork class answers** — the sculptural and fountain closures and the pinned
   structures, never the heritage-sense designations — and **the museum's veto alone is lifted by
   a commemorative class as well** (the `commemorative` set: the war-memorial and cenotaph
   closures and `MEMORIAL_CLASSES`, #803): a memorial Wikidata also types a museum is a memorial
   complex with a museum in it, and a traveller stands in front of Tsitsernakaberd's flame
   (`museum, memorial, Armenian Genocide memorial`), the 9/11 pools (`museum, memorial`) and the
   Victoria Memorial in Kolkata (`museum, memorial`) whether or not there is a museum below;
   measured on dry run 109 of 2026-09-13 against dry run 99, those three are what the lift admits
   above the line — and the Anne Frank House (`historic house museum, war memorial`), a house
   museum, which is the known false admission it costs; the Anzac Memorial and the Gedenkstätte
   Berliner Mauer pass the rule now and sit below the line. `monument` is not commemorative: it is what Spain's heritage
   register calls a listed museum. So the Hermannsdenkmal (`sculpture, monument,
   tower, colossal statue`), Monas in Jakarta (`obelisk, memorial, museum`) and Christ the Redeemer
   (`colossal statue, pilgrimage site, monument`) stay, and the Aljafería (`palace, castle,
   parliament building, monument`), Arlington (`cemetery, war memorial`), Montjuïc Castle
   (`memorial, military museum, castle` — a building typed a memorial is the building), the Reina
   Sofía (`art museum, monument`) and the Bilbao Fine Arts Museum (`art museum, monument`) go.
   Open places and landforms (a square, a park, a hill) are not vetoes:
   the Mansu Hill Grand Monument is typed `monument, square` and is a monument on a square. A
   coordinate on another globe is refused too (Fallen Astronaut's `P625` is on the Moon). What
   passes is typed `sculpture` when it carries a sculptural class, else `monument` — the
   vocabulary readers had.
   Known false refusals, left to a curator's override: the Bocca della Verità (a church portico),
   Stonehenge and the Madara Rider (archaeological sites — the Rider is part of the Madara
   preserve, and World Heritage holds both), the Neue Wache, the Soviet War Memorial in the
   Tiergarten (`cemetery, military museum, monument`: no commemorative class, and a cemetery's veto
   is not the museum's); and known false admissions, left to a curator's rejection: a work Wikidata
   neither places nor gives an owner (the Infant Jesus of Prague; the Nestorian Stele, pinned at
   its find spot rather than in the Stele Forest that holds it), Villa d'Este (typed fountain), the
   Anne Frank House (typed a war memorial beside its house museum). The Pakistan Monument,
   Tsitsernakaberd and the 9/11 Memorial were on the first list until #803.
5. **The line, then the write** — a candidate that passes enters at **22 sitelinks and stays until
   it falls below 18** (`ENTER_SITELINKS`/`STAY_SITELINKS` in the pipeline; the museums' own line,
   ADR-0023), read against what the kind already admits (`admittedExternalIds`). An admitted
   row that fell below 18 is refused by name — `17 sitelinks: below the world tier's line (22 to
   enter, 18 to stay)` — and a candidate below the line that was never in is simply out, and
   nothing is said about it: a refusal names a rule, and none ran on it. The admitted are written
   most famous first, names disambiguated by the description's location hint, credits asked of
   Commons for them alone; every class the rule read goes onto the row as
   `metadata.wikidataClasses`, and whether an artwork class answered as `metadata.wikidataArtwork`
   — both sync-owned keys (§ Change provenance), and the second is what the catalogue check reads.

**The cap decision.** The 200 the source used to cut at is gone: the world tier is a **threshold on
the world's own signal, global, not a count and not per region** — ADR-0045 decision 2's "the
ranking's own rule", and the same rule the museum source applies. The count is a property of the
data (171 on the dry run of 2026-09-04, against 205 under the cut). A per-region floor
is the regional tier's question, and belongs to the rules of [filling-a-kind.md](filling-a-kind.md) (ADR-0048).

**Refusals and the badge.** Every candidate the rule refuses comes back as the run's `filtered`
(§ Change provenance), which marks the rows the kind holds under those ids `refused` with the
rule's reason, and the review page's *kept out* card asks whether the rule was right (ADR-0024).
The reasons are written for that card — `inside St. Peter's Basilica: a work of a place of
worship, not public art`, `not an artwork, and typed: palace; castle`, `not public art:
mausoleum` — and reach it through `refusalReason.ts`'s pass-through, untranslated, with one
exception: `no coordinates of its own (P625)` is the museum rule's form as well, and the card
translates it, summary and help panel, in words that fit either source. Deliberately not the
museum rule's `kill-list:` prefix: the card's help panel explains that one as curatorial
departments and museum networks, which is nobody's reason for turning down a mausoleum.
The source declares `recomputesMembership`, so the sweep still runs under its guards (errors,
cancellation, the 50 % floor) — but since every admitted row is asked for by id when the pool
does not name it, the sweep's generic reason is left for a row Wikidata no longer answers for at
all; the run before the rule refused nothing,
so the first live run is the one that turns the buildings, sites and institutions of the first
import into refused rows a curator can read (100 of the 205 on dry run 89 of 2026-09-04, every
one of them by name — the Madara Rider and the Mystery Play of Elche among the three asked for
by id — with 171 admitted, 66 of them new to the catalogue: the Statue of Liberty, the Arc de
Triomphe, Nelson's Column, the Memorial to the Murdered Jews of Europe, the Brandenburg Gate
among them).

**Each source, its own cache.** The key is the source and the query text together (`hashOf` in
`wikidataCache.ts`; [ADR-0047](../decisions/0047-a-cached-answer-belongs-to-the-source-that-asked.md),
which narrows ADR-0030 decision 1 to what its decision 4 — the cache belongs to a source —
already said). It was the query text alone until the public-art run's first dry run read the
museums' cached children of `sculpture`, a week old, and missed the Madara Rider, retyped to a
class Wikidata had created that week — and *Clear* on one source would have left behind the
shared rows the other had last written. A row is one source's now: what the panel shows for a
source is what its runs read, and clearing it clears exactly that. Migration 043 empties the
table of the rows keyed the old way and corrects the column's comment; a database that skips it
carries them as dead weight until each kind's lifetime passes.

**Belonging is the badge.** The source declares `badgesAdmitted`, so every membership the world
tier admits carries `is_iconic`, written after the admission step (ADR-0045 decision 5, #760) — a
flag this source never wrote before; the regional tier, when it comes, carries none.

**What is kept** — four cache kinds (`CACHED_KINDS_BY_SOURCE[3]`): `classes` for the closures
and the two trees, `pool` for every band and batch and for the admitted rows asked for by id,
`edges` for the facts pass, `entities` for the containers. The panel offers *Sync without cache*
and the cache section on that declaration.

`public-art-row-typed-a-building` in Catalogue Checks (`docs/tech/data-assertions.md`) asks the
stored rows the rule's question, for the rows the rule never reached.

**SPARQL reliability**: All Wikidata queries use direct `wdt:P31` (instance-of) rather than `wdt:P31/wdt:P279*` (subclass traversal) to avoid timeouts on the Wikidata endpoint. Requests ask for a **55s** server-side timeout (Blazegraph `timeout`) plus a 70s client-side AbortController safety net. The service's own deadline is 60s and asking above it moves nothing — the query dies there either way, but as a *gateway* error (504, then 502 from their nginx) that says nothing about what went wrong, which is how museum run 61 failed. Under the ceiling the query engine answers instead, and five seconds of their cluster go back to the queue. Retries are bounded by **time rather than by count**: exponential backoff capped at three minutes, `Retry-After` honoured where the service sends one, and a wait budget of fifteen minutes **shared across a phase** rather than granted to each query — the collection's queries share one, and the Commons credit pass that follows gets its own, because by then the first is spent — a collection sends a few hundred, and a quarter of an hour of patience each is arithmetically hours of a run nobody is watching. The count exists as a backstop and is set high enough that the budget is what stops the loop; the old shape (four retries, 30s ceiling) gave up after about a minute, which is "the service was busy", not "the service is down". A cancelled run is noticed **inside** a wait and inside a request, not only between queries: the backoff sleeps in one-second slices and returns early, and an in-flight request is aborted — without that, Cancel sat unhonoured for as long as the current backoff, which from the panel is a button that does nothing. 1s delay between requests, one query at a time — their limit is five parallel per IP. Every collector — museums, landmarks, and the Wikipedia-link query the UNESCO run sends — passes the same three things: the wait reporter, the cancel check, and a shared `WaitBudget` — including the admin-only image-fixing pass, which used to send bare queries and so minted a fresh budget per batch. A query sent without them is a query nobody can stop and a wait nobody can see. The label service is asked for `LABEL_LANGS` everywhere (`en,mul,en-gb,…`): asked for `"en"` alone it answers with the bare QID for anything unlabelled in English, which is how the National Gallery of Art once arrived as the string `Q214867`.

**What a run keeps (ADR-0030)**: the Wikidata collectors — Art Museums, Public Art & Monuments, Places of worship and Archaeology — cache what Wikidata answers, in `wikidata_query_cache`, keyed by the hash of the source and the query text — the query is the question, so a changed filter misses by construction rather than by remembering to invalidate, and one source's rows are never another's (§ Public Art's cache paragraph). Two reasons: their front end caches nothing we send, because we POST, so a class closure that has not moved in months is recomputed by their cluster on every run; and a collection that fails in its third phase used to start the next attempt at the first — run 61 threw away 1166 artwork classes it had already paid for. Every row carries its own expiry, written at fetch time, with defaults set to the rate the facts change at: class trees 7 days, work pools 1 day, venue statements and entity edges 12 hours, entity details 6 hours. Per source, and only for the kinds that source's collector describes — the public-art collector describes four (`classes`, `pool`, `edges`, `entities`; § Public Art above), the places-of-worship collector five (those four and `statements`, since it collects works as well; § Places of worship below), the art-museums collector the same five, the archaeology collector those five and a sixth of its own, `osm` — what OpenStreetMap maps at each site candidate, asked of the QLever mirror or, where `OSM_READER` names it, of the public Overpass API, and kept for a day either way (§ Archaeology below; what English Wikipedia files an article under is asked of a wiki rather than of Wikidata and is kept nowhere), the UNESCO run reads that source's own API and caches nothing. Only the source that keeps something is offered the bypass: `caches` on the sources listing is `CACHED_KINDS_BY_SOURCE[id].length > 0`, and the panel hides "Sync without cache" where it is false, rather than offering to ignore a cache that does not exist. A run started with `refreshCache` ignores the cache **in both directions** — `withCache` short-circuits before the read *and* the write, so what is kept survives with its original `fetched_at`/`expires_at` and the next ordinary run uses it again. Replacing an answer is what Clear is for; the admin panel shows each kind's age, expiry, size and lifetime, can change that lifetime (which re-dates what is already cached, from each answer's own fetch time) and can clear any of it. A cache failure never fails a run: a read that throws falls through to the source, a write that throws is logged and the answer still returned. **The write and a lifetime change serialise** on a transaction-scoped advisory lock keyed by `(source_id, kind)`, and the write reads the policy inside its own `INSERT`: without both, a row could commit carrying an expiry the panel no longer shows — a policy nothing obeys, which is decision 7 read backwards. The locked section is two database statements; the source's answer is already in hand when `writeCached` is called, so nothing waits on a network request while holding it.

**The broad pool is asked in fame bands, sitelinks first**: `ORDER BY DESC(?sl) LIMIT 3000` over every painting carrying an owner is the query that killed run 61, and measurement on 2026-08-21 showed why it could not be rescued by trimming — without the sort it still timed out, and stripped to two columns it came back 502. The cost is reading a sitelink count for each of half a million instances. So the question is asked the other way round: `?w wikibase:sitelinks ?sl` with Blazegraph's `hint:Query hint:optimizer "None"` and `hint:Prior hint:rangeSafe true` makes the sitelink filter an index range scan, and the class becomes a probe on what that scan found. The top band went from a gateway error to 7s. Because the scan is proportional to the width of the range (10–19 took 61s, 10–11 took 33s), the bands cut the bottom finer than the top: 100+, 50–99, 30–49, 20–29, 15–19, 12–14, 10–11. They tile the range with no gap and no overlap and cache separately, so a run that dies in the fourth band keeps the first three, and `run.step()` between bands is where a cancelled run stops. A band that fails still fails the run: the pool decides which museums the source admits (ADR-0024), and a quietly short pool would withdraw real museums while reporting success. **Narrow classes are not banded** — a class with a few thousand instances is cheap to scan directly, banding them would turn thirty affordable questions into two hundred, and they were never the query that failed.

### Places of worship (`worshipSyncService.ts`, `worship/*.ts`)

**What the kind is for.** A building a traveller walks into: a cathedral, a mosque, a temple, a
shrine — the Hagia Sophia, Angkor Wat, Notre-Dame de Paris, the Sagrada Família — and what stands
inside it and is worth looking at on its own. Michelangelo's *Pietà* is St Peter's, the *Last
Supper* is Santa Maria delle Grazie's, the Shroud of Turin is Turin Cathedral's, and the Iron Crown
is Monza's. Those works had nowhere to
live until this kind: Public Art & Monuments refuses both the church (`a place of worship, not
public art`) and the work inside it (`a work of a place of worship, not public art`), and the
museum rule vetoes a church as a venue. The rule is
[ADR-0052](../decisions/0052-a-place-of-worship-is-admitted-for-itself-or-for-what-it-holds.md) and
the source's record is
[`wikidata-places-of-worship`](../sources/global/wikidata-places-of-worship.md); this source fills
the kind's **world tier** and nothing else, the regional tier being
[filling-a-kind.md](filling-a-kind.md)'s (ADR-0048) and carrying no badge.

**One source, two doors, one line.** A place is in the catalogue because the world knows the
building, or because the building holds a work the world knows. One number cuts both: the source's
`enterSitelinks` is what door one measures the *building* against and what door two measures the
*work* against, so a place holding an admitted work is admitted whatever its own sitelinks — the
Church of Santo Tomé has 10 and holds *The Burial of the Count of Orgaz*. Both doors are the world
tier of ADR-0048, so a place either one admits is Iconic. Which door a row came through
is the run's own bookkeeping and is not stored: `admitted_for` on the membership names the most
famous of the works that admitted it, which is the one thing about the doors the catalogue keeps.
St Peter's, at 129 sitelinks, would enter on its own fame and still names the *Pietà*; a church
holding nothing of ours names nothing.

**Door one — the place** (`worship/places.ts`). The public-art shape over the worship tree. The
tree is `P279*` under `structure of worship`, floored with the `WORSHIP_CLASSES` the public-art
import already pins and with every root the type rule walks — so that what the rule can name, the
rule admits — less the `WORSHIP_DESIGNATIONS` that are not buildings at all (`pilgrimage site`,
which is why Christ the Redeemer never reaches this rule) and less the part classes. The pool is
the nine `BROAD_WORSHIP_ROOTS` asked in fame bands and every other class of the tree in batches of
25, all at a floor of 15 sitelinks — below the stay line, so an admitted row that slipped is
fetched and refused by name rather than swept — and the admitted rows no class question named at
all are asked for by id afterwards (`fetchEntitiesByIds`), so every one of them gets a reason of
its own. The part classes are asked for too, though the rule refuses every one: a bell tower
Wikidata types nothing else should be seen refused by name — the Leaning Tower, the Giralda, St
Mark's Campanile — rather than silently absent. Then one facts pass per 50 candidates for every
`P31` the rows carry, and the verdict, `worshipVerdict` in `worshipTest.ts`, pure and given every
fact it reads (a row's own classes and nothing else — a tower is a tower whether a cathedral stands
beside it or not):

- **What it is**, before whether it is ours: a class of `WORSHIP_KILL_CLASSES` refuses the row
  whatever else it carries, because the Temple Mount is a hill though it is also a mosque. One
  entry is conditional: `destroyed building or structure` is lifted by a standing-ruin class
  (`RUIN_CLASSES` — `religious building ruin`, `monastery ruins`), because Fountains Abbey and St
  Augustine's Abbey are World Heritage Sites with a ticket office, while the Second Temple and the
  Basilica Aemilia carry no ruin class and stay refused.
- **A tower is not a place of worship.** A row whose only worship class is a `bell tower`,
  `campanile`, `church tower`, `minaret` or `steeple` is refused (`WORSHIP_PART_CLASSES`), and
  offered to nobody: a traveller does not enter Pisa Cathedral to see the Leaning Tower, and does
  not call the Minaret of Jam a place of worship. What a traveller climbs or stands under is a
  visit of its own kind, proposed and unbuilt
  ([`PROPOSED-EXPERIENCE-CATEGORIES.md`](../vision/PROPOSED-EXPERIENCE-CATEGORIES.md) § Towers &
  Landmarks), so the reason names the missing kind rather than a church. Whether the tower stands
  over a cathedral or alone in a river valley makes no difference to that answer, so the rule does
  not ask — the Leaning Tower, the Giralda, St Mark's and Giotto's campaniles, the Kalyan Minaret,
  the Minaret of Jam, the Qutb Minar and Big Ben all read alike. A row carrying a proper worship
  class beside its tower is the place: the Ivan the Great Bell Tower is a church you walk into, and
  the Hagia Sophia is typed `minaret` among nine other classes.
- **Somewhere to stand**: a coordinate, and on Earth.

The line is asked after the verdict, not inside it: `lineVerdict` in `places.ts` reads the source
row's two numbers rather than a constant, admits what clears the enter line, refuses by name — with
its count — an admitted row that has fallen below the stay line, and says nothing at all about a
candidate that was never in.

**Door two — a work it holds** (`worship/pipeline.ts`). The museum import's works collector
(`museum/worksCollector.ts`), run with this kind's own rule: a `VenueRule` whose classes are the
worship tree and whose site veto is off — the veto exists to stop a church being called a museum,
and here the church is the point — plus the treasure classes of `WORSHIP_TREASURE_CLASSES` walked
as trees, since the Shroud of Turin is an instance of `relic associated with Jesus` and a question
about `relic` itself answers with one row. Placement, folds, `MAX_HOLDERS` and the edition rule are
ADR-0023's, unchanged. Three rules are this door's:

- **A museum wins.** A work whose statements the *museum* rule places anywhere is the museum's,
  asked of the raw statements rather than of this run's placements: the *Creation of Adam* stays
  the Vatican Museums', and the Sistine Chapel enters on its own fame with no works of ours.
- **A work that is itself a place is never a treasure** (`isItselfAPlace`). 13 classes lie in both
  the treasure trees and the worship tree, and without this the Cavern of the Patriarchs would be
  a place at one door and somebody's treasure at the other. The row's own `P31` set comes from the
  places pool, which carries every class of every entity it named; the works pool carries only the
  class a work was collected under, and the Cavern arrives there as a tomb.
- **A work nobody can see opens nothing.** The Statue of Zeus at Olympia is typed `lost
  sculpture` and `destroyed artwork`; its temple stands on its own fame or not at all. The reading
  is the shared collector's, the same one the museums use (§ Art Museums, #868): the lost tree
  under `lost artwork` and a location whose value is unknown both place a work nowhere before
  this door ever sees it.

A venue a work names must then pass door one's own rule minus the line (`graphVerdict`, asked by
`admitVenues`), which is what keeps the Temple Mount out of both doors, and chapels fold into the
church they are inside by the museum import's fold rules — Cornaro into Santa Maria della Vittoria,
Contarelli into San Luigi dei Francesi, the Chapel of the Emerald Buddha into Wat Phra Kaew.

Those folds are narrowed once by this kind (`foldsOntoAdmitted`): **a fold may only land on a place
this kind could admit.** The museum's fold rule picks its survivor by distance and container and
knows nothing about worship, and the kind's verdict used to be asked of the survivor only
afterwards — so a chapel could be folded into a row the kind refuses and taken out of the catalogue
with its works. The Cappella Paolina folded into the Apostolic Palace 177 m away, which the kill
list refuses as a `palace of the Popes`. A fold whose survivor — followed to the end of its chain —
is neither admitted by door one nor admitted by the rule is dropped, and the folding row stands as
its own place. The test is the rule's and not the line's: a survivor the rule admits is admitted by
door two for any iconic work it receives, so a fold onto a row only the *line* leaves out still
stands (the Temple of Amun at Karnak into the Precinct of Amun-Re, 18 sitelinks; the Santuari vell
de Meritxell into Our Lady of Meritxell).

The two sets are then unioned:
`door` on the collected item reads `place`, `work` or `both`, a place admitted for its own fame
lists the treasures it holds too, and a row this run admits is never also reported as a refusal,
whichever door refused it.

**What an admitted place holds is read from the place's side too** (#890). Once both doors have
answered, the run asks of every admitted place — and of every chapel folded into one — what Wikidata
places inside it by a current `P195` or `P276` statement at the pool's floor: the museum import's
shared stage (`museum/venueSide.ts`; § Art Museums describes it once), judged by this kind's treasure
vocabulary — the art closure, the pinned classes and the treasure trees of `WORSHIP_TREASURE_CLASSES` — so a relic filed first
under a class no root reaches and carrying `relic` beside it is kept, typed `relic`, and hangs where
the pool would have hung it. The three rules of door two are then asked of the merged collection
exactly as they were of the pool (`ourWorks` in `worship/works.ts`, door two's own rules over a
placed work, runs twice, and its log line says which pass it is): a
museum wins, a place is never a treasure, and nobody can see a lost one. For the place rule the
second pass reads every class the by-id answer carried beside the places pool's: below that
pool's floor of 15, a chapel tomb at 12 sitelinks standing in St Peter's is a chapel only there,
and it is written as nobody's treasure. The doors themselves are not
asked again — a place is admitted for its fame or for a work the pool knows. Measured on the 1,078
admitted places of the development catalogue on 2026-09-15: **226 objects at 10 sitelinks or more
(125 at 15)**, of which 161 (83) are linked at no place that holds them and 149 (77) are no treasure
at all — and nearly all of those are not things a traveller looks at but things that happened there:
the conclaves in the Sistine Chapel (nine at the pool's floor, the 2025 one at 48 sitelinks), the
coronations and royal weddings at Westminster Abbey, the 2019 fire at Notre-Dame, the Grand Mosque
Seizure, the Battle of the Alamo. The objects among them are the known misses the source record
already names — the Black Stone (`stone, heirloom`), the kiswah (`parament`), the Hereford Mappa
Mundi, the Codex Calixtinus, the Coronation Chair (`ceremonial chair`) — and the Horses of Saint Mark
(`group of sculptures`, at St Mark's). Each is refused with its classes on the run's changeset as a
`filtered` row, named at or above the source's stay line (`contentsLine`, 18) and counted below it,
and marked as a refusal of nothing: a treasure's id is not a place's, whatever it shares with one.
What the read kept by class and this door's own rules then wrote nowhere is named beside them,
with the rule that turned it away — `the museum that holds it wins`, `a place of worship itself,
not a treasure`, `nobody can see it: …`, or `its own statements place it at no admitted place` —
and never a row this run admits, the rule `filtered` keeps for the places: a chapel inside a
basilica whose `P276` names it carries a worship class the vocabulary refuses, and is a row the
run writes, not an object it turned down. The class list that would keep the objects is #891's.

**Types.** Eight words a reader filters by, read from the class trees in the precedence of
`TYPE_ROOTS` — `cathedral`, `monastery`, `mosque`, `synagogue`, `chapel`, `church`, `shrine`,
`temple` — the first tree a row's classes reach winning. The Hagia Sophia is a **mosque** because
`mosque` precedes `church`, and St Peter's is a **church**: Wikidata gives it `parish church`
beside its three basilica titles and no cathedral class, which is also the traveller's answer,
since Rome's cathedral is the Lateran. The two generic roots are matched **only as the row's own
class** (`direct`), never walked: measured 2026-09-08, `temple` is itself a subclass of `shrine`,
and church building, cathedral, chapel and basilica are under both, so walking them would type
every parish church a temple. What is walked is the particular word — Shinto shrine, imamzadeh,
dargah and the Confucian ancestral shrine under `shrine`; the Buddhist, Hindu, Jain, Taoist and
Confucian temples, the gurdwara, the pagoda, the stupa, the temple complex and the ancient Greek,
Roman and Egyptian temples under `temple`. `TYPE_OVERRIDES` holds one entity class read before the
precedence loop: a Thai `wat` is a `temple`, because Wikidata files it under `vihāra` under
`monastery` and nobody in Bangkok is queueing for a monastery — while Sera Monastery, a Tibetan
monastery that is not a wat, keeps the class graph's answer. Rome's Pantheon comes out a `church`,
which is what stands there now. A place no word of `TYPE_ROOTS` fits is admitted **untyped**, which
is a real answer rather than a gap — Po-i-Kalyan and the Alamo Mission are two of log 102's eighteen
(fourteen on the run of record, log 104, below). The
value goes in `experiences.type` and is repeated as the second tag beside `worship`.

**The line is on the source row, and an admin moves it.** `api_config.enterSitelinks` and
`api_config.staySitelinks` on `experience_sources` (22 and 18 for this source, seeded by
migration 050), read at the start of every run by `readSourceLine` (`sourceLine.ts`) and written by
`PUT /api/admin/sync/sources/:sourceId/line` from the source card's `SourceLineControls`.
A run whose row states no line **fails** rather than falling back to a constant: a run that quietly
used 22 would admit a different catalogue than the panel says it does, which is the admission axis
read backwards (ADR-0024). The two ends share one bound — whole numbers 1 to 1000, the stay line no
higher than the enter line — enforced in the schema and again in `parseSourceLine`, because the
panel is not the only caller a stray row could reach. Art Museums and Public Art & Monuments keep
their constants, so a source whose `api_config` states no line answers **409** (`This source keeps
its line in code`) rather than gaining one no run was told to read, and the panel renders no fields
for it.

**Refusals**, in the words the *kept out* card shows (ADR-0024), each pass-through and untranslated:

- `not a place to visit: destroyed building or structure`, and the same form naming any other kill
  class the row carries, several joined by `;` and a space — hill, mountain, neighborhood, ancient city,
  polis, tell, Jewish cemetery, Latin Rite Catholic cemetery, Holy Trinity column, palace of the
  Popes, civil basilica, auberge.
- `a tower, not a place of worship: bell tower`, and the same form naming whichever of the
  `WORSHIP_PART_CLASSES` (bell tower, campanile, church tower, minaret, steeple) the row carries. Nothing is appended: the row is offered to no place, because a
  tower is a visit of a kind the catalogue has yet to carry. The reason can misdescribe the row:
  Monar Jonban (18 sitelinks) carries `mausoleum` beside `minaret` — a Sufi tomb a traveller
  visits as a shrine — and the Emin Minaret (16) is Turpan's mosque complex, but both sit below
  the enter line today, so this changes only the words the reason gives, not the catalogue.
- `no place-of-worship class`, `no coordinates of its own (P625)` — which the card translates,
  since the museum rule writes it too — and `not on Earth: its coordinate (P625) is on another
  globe`.
- `17 sitelinks: below the world tier's line (22 to enter, 18 to stay)`, for an admitted row that
  slipped; a candidate below the line that was never in is simply out, and nothing is said about
  it, because a refusal names a rule and none ran on it.
- `folded into Santa Maria della Vittoria — housed in it, and it is the better-known name, 9 m
  away`, reported only for a venue that had received a work of ours.

The source declares `sourceCompleteness: 'ranked'`, `recomputesMembership: true` and
`badgesAdmitted: true`: absence from a run says a row fell below the line or stopped passing the
rule and nothing about whether the building still stands, every run recomputes the whole membership
from the whole pool, and belonging is the badge — written once admission is settled rather than per
place (#760). A place is written as one experience with one point, its type in the column and
repeated as a tag; its treasures go through the museums' own writer (`upsertVenueTreasures`), so
ADR-0044 governs them unchanged — the run measures the works coverage floor before a single place
is written and only a run that clears it marks the links of works it no longer places here.

**What a run keeps** — five cache kinds (`CACHED_KINDS_BY_SOURCE[4]`): `classes` for the worship
tree, the `WORSHIP_TREASURE_CLASSES` trees and the type trees, `pool` for the bands and batches of both pools,
`statements` for where each work hangs, `edges` for the venue graph and `entities` for its details.
Per source, as ADR-0047 requires, so this run fetches the works pool the art-museums source already
fetched: log 100 took 27 m 55 s cold against 7 m 43 s on the warm cache. The panel's *Sync without
cache*, its per-kind ages and lifetimes and its *Clear* all follow that declaration, and *Fix
pictures* is offered too (`fixWorshipImages`, the shared Wikidata picture repair).

**Twins with World Heritage.** 192 of the 1116 places at the line also carry a World Heritage id
(P757), so Cologne Cathedral is two rows, two pins and two cards until #755 merges them, exactly as
the Statue of Liberty is today, and a region's count of places counts it twice. ADR-0046 already
says how two rows become one place; making them one is that issue's work.

**Known misses**, each named so the next reader does not go looking:

- **The Western Wall and the Kaaba** carry no class under the worship tree at all, and no list
  change reaches them: the only class that would, `sacred place`, holds 30 rows at the line of
  which 25 are landscape — the Ganges, Fuji, Kailash, the Holy Land as a *term*. A traveller in
  Mecca is covered by Al-Masjid Al-Haram, which is admitted; one at the Western Wall is covered by
  nothing, since the Temple Mount above it is refused as a hill. Both wait for a curator, as the
  Black Stone does — a real object with no Wikidata class to carry it.
- **Six visitable rows refused as destroyed buildings**, because Wikidata types them so and types
  them no ruin: Champmol, Port-Royal-des-Champs, the Temple of Antoninus and Faustina, the
  Bibi-Heybat Mosque (destroyed in 1936 and rebuilt in 1999), the Abbey of St Victor and the
  Ospedale della Pietà.
- **Every tower is refused and handed to nobody**, whether it stands over a church or alone: the
  Leaning Tower of Pisa, the Giralda, St Mark's and Giotto's campaniles, the Kalyan Minaret, the
  Minaret of Jam, the Qutb Minar, the Hassan Tower, the Burana Tower, the Torrazzo of Cremona,
  Oldehove in Leeuwarden. Unlike Jam and the Qutb Minar, each a World Heritage Site of its own, the
  Hassan Tower **is** Rabat's mosque site — its `P361` target, the Hassan Mosque, holds one
  sitelink and never reaches the pool — so this is the one loss a traveller would call a mosque
  site rather than only a tower. They wait for the kind that is theirs
  ([`PROPOSED-EXPERIENCE-CATEGORIES.md`](../vision/PROPOSED-EXPERIENCE-CATEGORIES.md) § Towers &
  Landmarks); Public Art & Monuments refuses the same rows as classes of the worship tree, so they
  are named in two rules and listed in none.
- **Manuscripts and church bells are not treasures**: a codex is in an archive and a bell is in the
  tower, and the test is being on public view rather than being valuable. The class test is coarser
  than the rule it serves, so the Hereford Mappa Mundi is refused with the archives.
- **A serial World Heritage listing enters as one place**, which visiting one of its locations is
  not: the Sacred Sites and Pilgrimage Routes in the Kii Mountain Range, the Jesuit Missions of
  Chiquitos, the Shrines and Temples of Nikkō, the Jesuit Block and Estancias of Córdoba and the
  Jesuit missions among the Guaraní. Four of those five are also untyped, which is a usable signal
  for a later check; the fix belongs with the twins (#755, #768).
- **A palace or a castle the worship tree reaches is admitted**, and no class rule can separate it
  from a real place of worship. Measured on log 102's collection: `palace` (Q16560) is carried by
  the Potala Palace, the Yonghe Temple, Lambeth Palace, Pena Palace and the Palace of Mafra, and
  `castle` (Q23413) by Takht-e Soleyman, Ananuri and Loarre Castle. Killing either class would take
  the Potala, the Yonghe, Takht-e Soleyman and Ananuri with it, and Loarre carries the same two
  classes Ananuri does. So Pena Palace, Lambeth Palace and Loarre Castle are a curator's hand.
- **A type is Wikidata's claim read faithfully**, which three rows make plain: Westminster Abbey
  comes out a `cathedral` (Wikidata gives it `Anglican or Episcopal cathedral`, though it is a Royal
  Peculiar and London's cathedral is St Paul's), St Basil's Cathedral comes out a `church` (its only
  class is `Eastern Orthodox church building`), and the Shrine of Bahá'u'lláh comes out a `church`
  (`sanctuary` sits under `church building`). `TYPE_OVERRIDES` is for a vocabulary that got a word
  wrong, not for one row, so all three are a curator's hand.

**What the runs measured** (five dry runs on the development stack, 2026-09-08 and 2026-09-09,
`is_dry_run`, the catalogue untouched). Log 100 ran 27 m 55 s cold and admitted 1089 of 5347 fetched
entities, refusing 63, the first measurement; log 101, on the warm cache, 1080 and 76 after the
class lists were tuned on log 100's own rows; log 102, 7 m 43 s, 1086 and 65, the run the
class-list decisions were read off; log 103, 7 m 45 s, 1083 and 69, after the last kills and the wat
override; log 104, 8 m 28 s, 1078 and 77, the run of record, with towers out and the fold rule.

**Log 104 is the run of record** — the first carrying the tower decision, the `arula (altar)` kill
and the fold rule: 8 m 28 s, **1078 places** — 1053 by their own fame alone, 4 through a work alone,
21 by both — out of 5321 distinct entities the two pools named and a works pool of 2800, with **68
works written as 69 treasure links at 46 places** (59 art, 7 relics and reliquaries, 2 tombs, 1
astronomical clock, and no towers) and **77 refusals**. Its types: cathedral 286, church 228, mosque
175, monastery 160, temple 152, chapel 27, shrine 23, synagogue 13, and 14 places none of the eight
words fits.

Against log 103 it admits five fewer and refuses eight more, and every one of those is nameable: the
Minaret of Jam, the Qutb Minar, the Hassan Tower and the Burana Tower leave the kind (an earlier
draft admitted a minaret with no mosque left), the Ara Pacis leaves it on the altar kill, four more
minarets that used to fall out below the fame line unremarked are now refused by name (Kalta Minor,
the Eger and Emin minarets, Monar Jonban), and the Cappella Paolina's fold into the Apostolic Palace
is no longer reported as a loss because it no longer happens — the only fold that changed between
the two runs. The works pool lost 47 rows with the tower classes (2847 → 2800), which the fold rule
reads as a venue's works count; the Basilica of Our Lady of Guadalupe and the Old Katholikon of the
Trinity Lavra were already the ones that received a work and folded away in log 103, and stay so in
104. All four works #753 names arrive at the venue it names and
each is its venue's `admitted_for`. The first live run is the maintainer's, and it arrives gated
(`requires_curation = true`, ADR-0025): a community-edited source's first rows wait for a person.

### Archaeology (`archaeologySyncService.ts`, `archaeology/*.ts`)

**What the kind is for.** The two things a traveller into archaeology browses together: the
excavation they stand in — Pompeii, Saqqara, Mycenae — and the museum that shows what came out of
it — the British Museum, the Egyptian Museum, Naples, the Museo Nacional de Antropología. They had
no list until this kind. The art test (ADR-0024) rightly expelled the institutions whose famous
holdings are archaeological rather than art — the British Museum by name, in `EDITORIAL_OUT` — so a
traveller browsing museums found no archaeology museum in Egypt, Mexico, Turkey or Greece and, in
London, art museums without the British Museum (measured for ADR-0058, 2026-09-13). The rule is
[ADR-0058](../decisions/0058-archaeology-is-one-kind-of-sites-and-museums.md) and the source's
record is [`wikidata-archaeology`](../sources/global/wikidata-archaeology.md); this source fills the
kind's **world tier** and nothing else, the regional tier — the state antiquities services that
enumerate the museums of Greece, Turkey, Egypt, Mexico, Italy and France nearly whole — being
[filling-a-kind.md](filling-a-kind.md)'s (ADR-0048) and carrying no badge, as it is for every other
kind.

**One kind, two types, both doors built.** `Archaeology` is kind 5 and its types are `site` and
`museum` (ADR-0058 decision 1): a person planning Egypt wants Saqqara and the Egyptian Museum on
one list, so the distinction is a chip inside the kind rather than two kinds. **Both are written
by one run**, and that is not an implementation detail: the orchestrator reads absence from a
run's item list as a withdrawal, so two runs would have each door retire the other's rows on
every pass. `collectArchaeology` returns museums and sites in one array, and `processItem`
dispatches on `item.type`.

**The site door** (`archaeology/sites.ts`, `archaeology/siteTest.ts`) is ADR-0058 decision 4,
narrowed by #581's second slice. The pool is Wikidata's `archaeological site` tree — 590 classes,
1,960 items with a coordinate at the pool's floor of 15 sitelinks, measured 2026-09-14 — asked
with the root in fame bands and the rest of the tree in batches, the worship pool's shape. The
classes alone cannot decide anything: the tree holds Athens (through `free city`), Cairo and
Damascus, while Troy carries `city-state, polis, Bronze Age settlement, settlement site` and no
class that says dig. **So OpenStreetMap is the judge**, and the verdict runs in five steps — what
the item is not (a shipwreck, a lost city, a lake or a reservoir or a desert or a mountain range
with no ruin on it), the map's ruin, the map's town or census boundary (where a site class with
no population statement, or a World Heritage listing of the place itself, still lifts it), the
branch it came in on (where a weak tag on an item nobody is counted at lifts it too — Carthage),
then the line. Refused on the map's town, the card names only what the rule read: "a living place —
OSM maps a town here and Wikidata counts its people" where the item states a population, "a
living place — OSM maps a town here and Wikidata gives it no class of a site" where it states
none. The line is asked last and decides whether a refusal is *named*: 830 rows sit between
15 and 21 sitelinks, and a village refused down there would bury Athens and Rhodes under the long
tail.

**Pompeii is the row both doors see.** English Wikipedia files it under `Archaeological museums
in Italy`, so the museum door's category walk names it and refuses it for carrying no museum
class; its own classes are `archaeological site, ancient city`, so the site door admits it. One
entity is one row with one type, so the museum verdict is taken first and the site door yields —
a guard rather than a policy, since the park veto already sends every open-air excavation the
museum tree reaches to this door — and a row the run writes is never also reported as a refusal.

**The OpenStreetMap reader** (`osm/readOsmObjects.ts`, `osm/types.ts`) is kind-agnostic: it reads
every object carrying `wikidata=<item>` with the tags that say what stands there, and which tags
mean *ruin* is the kind's to say (`archaeology/classes.ts`). It asks in batches of 100, pauses
between them, and files every answer under one cache kind — and it does so through **one of two
doors** (`OsmDoor`: a name, the question for one batch in the endpoint's own language, and the
send), because the first is a third-party mirror that has moved host once and ADR-0059 asks the
connector for a fallback (#893). **Which door a run opens is the operator's choice, by name**:
`OSM_READER` unset or blank is the QLever osm-planet mirror (`osm/qleverOsm.ts`), `overpass` is
the public Overpass API (`osm/overpassOsm.ts`), and any other value is refused — at boot in
production and as a warning in development, the treatment `validateEnv` gives every insecure
value, and in any case where the door is built, before a question is sent — a typo read as the
default would be a run that failed on the mirror an hour later, in the middle of the outage the
operator was working around (`osm/readerChoice.ts`). A choice rather than a fallback the run takes
on its own, since a run that switched doors mid-outage would write a day's extents from two
sources under one provenance, and ADR-0059 decision 2 is a promise about naming where a fact came
from. The run log names the door it opened. Both doors carry the project's bot `User-Agent`
(ADR-0043's rule), retry on the run's shared wait budget — this run waits on Wikidata, Wikipedia and the
OpenStreetMap door, and a budget per door would let it wait three times over (#886) — and keep the same promise: **the
geometry crosses the wire only for a ruin object or a protected area**, a city's administrative
outline is never fetched, and each door spells that rule in its own query (`BIND(IF(…))` in the
SPARQL, `out geom` on the `drawn` set alone in the Overpass QL), where a test reads it.

**The mirror door** POSTs one SPARQL query per batch and times out at 120 s; osm2rdf has built the
polygons already, so the WKT arrives finished. **The Overpass door** is held to the stricter
manners the instance publishes and the register record quotes
([`openstreetmap-overpass`](../sources/global/openstreetmap-overpass.md) § The fallback reader):
one request at a time and never two, a five-second pause measured from the end of the last
exchange, a `[timeout:120]` on a batch and a `[timeout:600]` on each of the enumeration's eight
questions, and a `[maxsize:]` of 64 MiB declared in every query — both halves
of the instance's admission rule, where the undeclared default would claim 512 MiB for a question
that ran under a declared 8 MiB — the thirty seconds the wiki asks for after a
429 that names no `Retry-After` (a 504 and a 5xx double from five seconds as the mirror's do), and
a 200 whose body carries a `remark` naming a runtime error — how Overpass reports a query it could
not finish — read as "ask again", never as an empty map. Its question is an exact
`nwr["wikidata"="Q…"]` per item, an index read where one regular expression over the key would
be matched against every object on the planet carrying it. What Overpass answers is OSM as stored
rather than finished polygons — a way's vertices, a relation's members each carrying their own —
so `osm/overpassGeometry.ts` joins a `multipolygon`'s or a `boundary`'s outer and inner ways into
rings, hangs each hole on the outer ring containing it, drops a ring that does not close rather
than closing it by hand, and never joins a `site` relation into an outline nobody mapped; the
rows it then answers are the mirror's shape, so `foldOsmRows`, the writer's `ST_GeomFromText` and
the extent rule cannot tell the doors apart. Checked on 2026-09-14 against the polygons the mirror
had stored on the development database: the 63 extents a probe of 100 admitted sites covered
agree to within a tenth of a percent, the Nazca zone and the Acropolis to the fourth decimal.

Answers from either door are cached per source under the kind `osm` for a day (ADR-0030,
ADR-0047) — keyed by the query text, so the two doors never read each other's rows — and `Sync
without cache` bypasses it as it does for Wikidata. A batch that cannot be read **ends the run**
whichever door it went through: read as silence it would say "no OSM object carries this item"
for every site in it, which refuses precisely the sites the rule exists to admit. **And so does
an endpoint that answers about almost nothing**, which no transport error reports: a rebuilt
dataset, a renamed `osmkey:` IRI or the host moving again answers HTTP 200 with no bindings, and
every candidate reads as unmapped. So the site door counts the share that came back with an
object and fails the run by name below a floor of half (`OSM_ANSWER_FLOOR`; the measurement is
885 of 1,126, or 79%) **before a single verdict is taken**. The share is read over the
candidates the read can answer about: a row the enumeration reached through an article alone
carries no `wikidata` tag on any dig, so the read may legitimately have nothing to say about it
and it is counted on neither side (`byArticleOnly`, #895) — the exclusion narrows what the floor
is measured over, never what it catches — and the run drops the
`osm` cache on the way out, since otherwise the same emptiness would be read out of our own table
until it expired. Both register records were written before their code, as ADR-0059 decision 4
requires: [`openstreetmap-qlever`](../sources/global/openstreetmap-qlever.md) and
[`openstreetmap-overpass`](../sources/global/openstreetmap-overpass.md).

**Before the map is asked, Wikidata is read twice, and one refusal runs ahead of the five steps.**
The pool is the class questions (the root's bands, then the narrow classes), topped up **by id**
with the rows this source already holds as sites that no class question named — retyped on
Wikidata, or fallen below the pool's floor — so each gets a reason of its own rather than the
sweep's silence; the museums the source holds are the museum door's to ask after, never this one's
(`admittedExternalIds` takes the type). Then the facts (`P31`, the World Heritage listing, a
population statement) in batches of fifty. **A row with no class under the `archaeological site`
tree when its facts are read, that no OpenStreetMap object tagged as a dig carries, is refused by
name** — "no class under archaeological sites on Wikidata, and no OpenStreetMap object tagged as a
dig carries it" (`refuseRetyped`) — before the per-item read is sent: the by-id rows Wikidata
retyped, the row the map once named and no longer does, and the rarer row a class question named
whose facts come back empty because the pool is cached for a day and the facts for twelve hours,
and the item was merged, deleted or had its one site statement deprecated in between. A row with
no class that the map still names is not refused here: it is judged by the map's word, whichever
question named it first (#895, below). A row the line had already put out is not named
(`sourceLine.ts`'s rule). **And a facts batch in which every row the pool vouched for — by a
class question or by the map, every row but the by-id ones — comes back with no class, no
listing and no population — and there are at least two of them — ends the run** — the third
run-ending condition beside the two above — because a class-named row carries a `P31` under the
tree by construction and a map-named row, which carries none, still answers a listing or a
population where it has one; the entrance's rows arrive in batches of their own, and a batch
reading as "no facts" would put every city in it on the site branch or walk a comune in on the
map's note. Both halves matter: *every* is what tells a batch that failed quietly from a handful
of items merged, deleted or deprecated on Wikidata since the pool was read (two silent rows among
fifty are refused by name and the run goes on), and the floor of two (`SILENT_BATCH_FLOOR`) is what
keeps a tail batch holding a single row from turning one merged item into a run that fails until
the day-old pool cache expires — silence on a single row is evidence of nothing.

**The pool has a second entrance: what the map itself calls a dig** (#895, ADR-0060;
`archaeology/siteEntrance.ts`). The class tree never sees Ajanta (`grotto`, `temple`), Nemrut
(`mountain`) or Jerash (`city`), so beside it the run reads OpenStreetMap's own list: every
object tagged `historic=archaeological_site`, `archaeological_site=*`, `historic=ruins` or
`ruins=*` — a `no` value left out, the mapper saying the opposite — that carries a `wikidata`
tag — 63,630 rows, 41,163 objects naming 38,753 items on 2026-09-15 —
in **one question** to the mirror, or eight to Overpass — one exact-match selector at a time —
each under a budget of its own on either door (nine minutes for the mirror's question, inside
its own deadline; a declared 600 s per Overpass selector), since a planet-wide tag read does
not fit a batch's two minutes on a slow afternoon and a value regex is a scan of every
`historic` object (dry runs 134 and 135) —
(`readOsmDigs`, tags only, never a geometry; an answer with no dig at all ends the run and drops the cached OSM answers, as the per-item floor does), plus the 2,027 such objects carrying a
`wikipedia` tag and no item (1,532 articles), resolved to their items through the wiki each
tag names (`wikipediaArticles.ts`: Nemrut's tumulus is `tr:Nemrut Dağı`; a tag naming a section,
`es:Antuco#Historia` on a fort's node, is left out — a section is a part of what the article
is about, and the town's item is not what the mapper linked). Wikidata is then asked only
**how many articles** each item the tree did not already name has, five hundred to a question
(`fetchSitelinksByIds`), and for the full row only of those at the pool's floor
(`POOL_MIN_SITELINKS`, 15, below the place line so that an admitted row that slipped under it
still arrives to be refused by name: 601 of 39,587 on dry run 136) — the measurement counted
774 at the place line, 210 of them in no class under the tree — so the tens of thousands below
the floor cost one number each. **One rule judges both entrances.** A candidate the tree named is judged as
before; a candidate only the map named has no site class, so `siteVerdict` reads the map's word
as its step-2 signal and Wikidata's classes as what can contradict it (`osmNamedVerdict`): a
`destroyed building or structure` (the Hanging Gardens) is nothing to stand in; a class under
`archaeological artefact` (the Venus of Willendorf, mapped at its find spot) is a find, not a
place; a class on the flat list `OSM_ONLY_NOT_A_PLACE` — a business (Azovstal), a power
station, a country house, a camp, a massacre or a council with a coordinate, a national library, a
concert hall, a disambiguation page, each read off what dry run 136 would have created — is
not a place to stand in; a `ruins` tag alone cannot carry a fortification, a palace, a château,
a structure of worship or a museum past the door (Devín, Bodiam, the Tower of David, the
Château de Blois — a monument in ruins is another kind's row), where
`historic=archaeological_site` on the same item can (Tintagel, the Thracian Tomb of Kazanlak);
and **a population statement is the living-place rule here** — a comune of
Italy stands on no settlement branch and states its people all the same, and eighteen of them
arrive on a ruin the mapper linked to the town's article (Potenza, Alcalá de Henares) —
outweighed only by the place being World Heritage itself (Delos) or by **English Wikipedia's
second vote**: the candidate's own article's categories, read as the museum door reads a
museum's and never as a walk, with `Archaeological sites in …` on it lifting the veto (Jerash,
Lagash, Kilwa Kisiwani, Qalhat, Písac; Ashdod is the measured false positive). What survives
enters with the question on its card, under the museum row's key: "no class of a site on
Wikidata; OpenStreetMap maps an archaeological site here (historic=archaeological_site on
way/115567314)" — `metadata.admissionNote`, read by the review card already. A row only the map
named that the map no longer names, or that has no coordinate — a mapper's tag naming a
person, a class, an event — is `out`, never refused; an admitted row that neither the classes
nor the map name any more, or that lost its coordinate, is refused by name, in words true of
both shapes. Three more
class trees are walked for the vetoes (fortification, palace, structure of worship), cheap and
cached. Measured on the 210: 125 enter — Ajanta, Delos, Sigiriya, Jerash, Lagash, Kilwa
Kisiwani, Gobustan, Chaco Culture, the Ziggurat of Ur, Elephanta, Alta, Zvartnots, Qalhat,
Dmanisi, Eleusis, Nemrut among them — 53 are monuments in ruins, 24 living places, 8 destroyed.
What the source record names as still unreached — Sanchi, the Thai historical parks — is a
curator's row or the regional tier's (#881).

**The extent.** Where OSM drew a polygon around the ruin — 516 of the 651 items with a ruin
signal have one — the run stores it in `experiences.boundary`, the first run ever to write that
column, with `area_km2` measured from the same geometry in the same statement so the two can
never disagree (#763). **A designated outline first, then the most ground**, among the item's
ruin objects and the protected areas drawn around them: an object carrying `heritage=*` is one a
heritage body drew a line around, and among those — or among all the candidates where none is
designated — the polygon covering the most ground is drawn (`largestByArea`, a shoelace area over
the WKT, good for ranking and stored nowhere). The Nazca Lines are why on both counts: the ruin
object traces one group of geoglyphs at 0.0015 km², the World Heritage zone (`heritage=1`)
774 km², and the outer archaeological reserve — four corners nobody designated — 5,638 km² (all
three by the writer's own expression on the dev database, 2026-09-14); the zone is what a reader is
asking to see. Replayed on the mirror's answers for the 836 items with an extent (the same day),
ground and text length disagree on twenty, and ground is right where they do (Sarmizegetusa Regia,
Preah Khan, Tintern Abbey) except at Nazca, which the designation settles.
`ST_MakeValid` alone is not enough (a polygon with a dangling spike comes
back as a `GeometryCollection`, which will not go into a `MultiPolygon` column), so the
expression is
`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText($n, 4326)), 3))`, with an empty
result stored as no extent rather than a shape with no area. **The extent is not held by the gate**, and that is deliberate: an outline is what somebody
surveyed rather than a claim about the place, so it follows the source the way a find's discovery
place does, and `metadata.osm` — which the run owns and re-derives every pass — stays true of the
polygon the row holds. Held, a published site would keep the first run's outline for ever while
its provenance moved on. **Not held, and not silent**: the change set compares the outline by a
hash of the geometry the writer stores (`BoundarySnapshot` in `changeSet.ts`; the incoming WKT is
hashed through the statement's own `EXTENT_OF` expression, so a polygon PostGIS merely rewrote is
no change), and a re-traced polygon is a `boundary` change record — minor, carrying the area
before and after, filed as written even on a held row because it was — that a dry run previews and
the sync report shows as "Extent 5.7 ha → 6.1 ha". A curator's claim on `boundary` still refuses
the run, as it does for every column, and is reported as a curated conflict; no screen writes one
today, and the screen that does will have to decide what becomes of `metadata.osm` beside a shape
the run may not touch.
A polygon over 5,000 vertices is stored whole and **simplified on read** —
`ST_SimplifyPreserveTopology(…, 0.0002)`, about 20 m at the equator — in the single-experience
read that already returns `boundary_geojson`. What OSM said is on the row as `metadata.osm`
(`verdict`, `object`, `tag`, `extentFrom`, `readAt`), a key the run owns: that key, `boundary`
and `area_km2` are the whole of the OSM-derived part of a site row, kept separable and offered
under ODbL (ADR-0059 decisions 2 and 3).

**What a reader sees.** Map mode draws the outline of whichever site is hovered, else whichever
is selected — a 2 px line and a 15% fill in the kind's colour, under the markers so nothing
clickable is hidden — from the detail read the open card already issues. The card and Discover's
panel both carry `ExtentLine`: `Extent 5.7 ha · © OpenStreetMap contributors`, rendered together
or not at all, because the credit is a licence term and a credit beside nothing credits nobody.
Hectares below a square kilometre, square kilometres above, one decimal below ten in either unit;
a site is something you walk across, and Troy's excavations measure 5.7 ha (Machu Picchu's 11.5),
both read off OpenStreetMap's polygons on 2026-09-14 with the expression the writer stores them
by.

**A site's card lists the finds dug up there, and where they are shown** (#894). A find is a
museum's treasure carrying `metadata.foundAt` — the discovery place the museum door stores
(decision 3) — and the site rows those names point at are places of this kind (`type = 'site'`),
so `GET /api/experiences/:id/finds` (`experienceFindsController.ts`) joins the two by **exact**
Wikidata id: `foundAt.qid = experiences.external_id` on a site row. Measured on the development
catalogue on 2026-09-15: 65 of the 175 finds with a spot land on 48 sites — Mycenae lists the Mask
of Agamemnon and the Warrior Vase, both at the National Archaeological Museum of Athens; the
Acropolis of Athens lists the Parthenon Frieze at the British Museum *and* the Acropolis Museum.
What the exact match does not reach is a find filed under a place *inside* a site — the tomb of
Tutankhamun rather than the Valley of the Kings, the House of the Faun rather than Pompeii, the
Royal Cemetery at Ur — because following that relation is a source read of the spot's own item,
and this read is built from rows the two doors already write; a spot that is a city (Rome), a
region (Nubia) or a place of worship (the Ramesseum, a source-4 row by the same id) stays words.
Every row of the answer is one a reader may open: the museum admitted, passed and still standing
(`experienceOfferedToReaderSql`, `hideLostSql`), the link still placed and passed
(`offeredLinkSql`, `publishedContentSql`), the work passed — never widened for a curator, since a
link is a claim a reader acts on — and a find no such museum holds is not listed. A museum in two
kinds is two rows until #755, so the venues are one per `external_id`, the row of the site's own
kind preferred. Each venue carries `regions[]` — the search read's list, `readerRegionsJsonSql`
(`readerRegions.ts`): published world views, a region a reader's point put the object in, no
rejected pair, smallest first — which is what makes "shown at the Louvre" a link (ADR-0042's rule,
`openableRegion`) rather than a name. The reverse line is on the find's own row: `/:id/treasures`
sends `found_at_site` beside `found_at`, the site row by the same rule with the same `regions[]`,
so "found at Mycenae" on the Athens museum's works list is a way to Mycenae, and "found at Fort
Julien" on the British Museum's stays words. On screen the list is `SiteFinds` (shared by Map
mode's card, where `SiteFindsList` adds the map's picture overlay, and Discover's panel) and the
link is `PlaceLink`; the card asks for the finds only of a row `hasExtent()` says is a site,
before any read, and `useExperienceCardReady` waits on the answer so the list is in the card the
frame it opens. The site's own row is gated the same way, and a site nobody may see, a row that
is not a site and an id that names nothing all answer the same empty list.

**The badge differs by door** (ADR-0045 decision 5, the world tier). A site is badged for
belonging — being one of the world's archaeological sites is the whole claim — and a museum only
for holding a find the world knows: `badgesAdmitted` is
`(item) => item.type === 'site' || item.findsAboveLine > 0`. The British Museum wears it for the
Rosetta Stone; Pompeii for being Pompeii; the Bardo, in the catalogue on its own 35 articles,
stands in the kind in full standing without one.

**The kind is still gated and still unseen.** The source is seeded `requires_curation = true`
(migration 056) and its rows arrive `pending` for a curator. **A count below is the survey of
2026-09-13 unless it names a run**; the source's record tables the runs. The first live run is
the maintainer's, and ADR-0058 decision 7 is why it waited for this slice: "Archaeology" without
Pompeii is a list that claims the world and holds half of it.

**A museum is admitted for what it is, never for one find** (ADR-0058 decision 2). This is the one
rule the kind exists to hold, and it is a product judgement before it is a query: the holders of a
famous find include the Uffizi (the Venus de' Medici), the Prado (a stale location of the Lady of
Elche) and Museum Ulm (the Lion man) — art and city museums with one ancient object — and a person
who collects archaeology museums and is sent to the Uffizi has been misled. So the door asks what
the museum is *about*, and a find only ever moves a museum that already passed that door across the
fame line.

**Who is judged at all** (`archaeology/pipeline.ts`, `archaeology/museums.ts`). Three roads reach the
verdict (`judgeAll`'s union: the class pool, the category members, the holders of a famous find)
and nothing else does, so the long tail of everything that owns an ancient statue produces no
named refusals. **Whose facts are read** (`candidatesOf`) is a wider set, on purpose: those three,
every venue any find is placed at, and both ends of every fold. Wider because "holder" is not a fact
about a museum — the holder cap is a predicate over the *length of a find's whole venue list*, so a
find over the cap under one fold set is under it in another, and the fold decision below judges
exactly such in-between sets; a venue only a partial set makes a holder would otherwise reach the
verdict with no row. The whole placement map costs nothing to walk, since a venue reaches a
placement through the venue graph, which already holds its row and classes. The three roads:

- **The class pool** (`collectMuseumPool`). The museum closure asked 25 classes to a query, each
  batch taken whole — no fame bands, because the whole tree answers with 87 museums at the pool's
  floor of 15 sitelinks (14 at 40 or more, 30 between 22 and 39, 43 between 15 and 21), where
  `monument` alone has tens of thousands. The floor sits below the stay line, so an admitted row
  that slipped to 17 is fetched and refused by name; and the admitted rows no class question named
  at all — retyped on Wikidata, or gone from the tree — are asked for by id afterwards in batches of
  50, so each gets a reason of its own rather than the sweep's silence. Only the rows this source
  holds as **museums**: the sites it holds are the site door's to ask after (`admittedExternalIds`
  takes the type), since a door judging the other door's rows would admit or refuse them by a rule
  they never entered through — Athens refused here for want of a museum class ahead of the site
  door's own reason, or a museum the museum door stopped admitting written as a site by the site
  door on its fame alone.
- **The holders of a find above the finds' line** (`findJudged`), selected by the museum tier's own
  `selectTier1` on the placements as the fold decision leaves them, and restricted to venues the
  graph gives coordinates of their own. Hysteretic like
  every other line here: a museum the source already admits is also judged at the finds' *stay*
  line, so Delphi does not fall out the first time the Charioteer slips from 18 articles to 17. No
  `multipleMedium` cap is offered — the cap exists for the editions a print or a cast comes in, and
  nothing that was dug up exists in an edition.
- **The museums English Wikipedia files under `Archaeological museums in|of …`**
  (`wikipediaCategoryMembers.ts`, `readMembers`). The category is the second signal of the nature,
  and it is a **door** and not only a test: a museum Wikidata types bare `museum` is in no class
  pool and, holding no find the world has heard of, is named by nothing at all — which is half the
  canon. The walk starts at `Category:Archaeological museums by country` and follows only the
  subcategories whose own title matches that same rule, so the siblings of another kind
  (`Byzantine museums in Greece`) are left where they are; it reads each category once behind a
  visited set, stops four steps from the root, and asks two questions per category — the articles
  with the Wikidata item each is about (`generator=categorymembers` with
  `prop=pageprops&ppprop=wikibase_item`) and the subcategories (`list=categorymembers`) — on the
  categories client's own transport, POST and page size `max`, every continuation followed. It has
  **no fame floor of its own**: a country category holds that country's museums whatever the world
  has heard of them, and where a member stands is the line's question and no door's. The rows are
  asked for by id in batches of 50, and only for the members neither the pool nor the venue graph
  already carries. **A category that cannot be read fails the run**, as a batch of titles does and
  for a stronger reason: a lost category is a whole country's museums missing from the candidate
  set on a run whose log said success. Two kinds of member are dropped rather than judged: one the
  by-id question does not answer for (a `wikibase_item` left behind by a merged item), and one whose
  row comes back with no English article — the walk found the museum *through* an English article, so a
  row without one is the two reads disagreeing, and judging it would read the categories of an
  article it does not have, find none, and refuse the museum by name for a fact nobody stated. Dry
  run 113, the first with this door open, admitted 31 museums that run 112 had not reached at all —
  the Bardo, the National Museum of Iraq, the Museo del Oro and the Pergamon Museum among them.
Two more rows are read without being roads: **every fold's survivor**, because the fold filter
below asks what each survivor is before any of this is settled and a door no work ever names — the
Vatican Museums, Palazzo Pitti — reaches the set by no other road; and **every fold's source**,
because a fold the decision below drops hands that museum its finds back and it is judged on its
own.

Of the candidates, the classes come off the venue graph where it knows the entity and are asked of
Wikidata for the rest in batches of 50 (`readClasses`), and the English Wikipedia categories are
asked in one call (`readCategories`), the door batching 50 titles inside itself.

**A category is a shelf, so what walks in through it is asked whether Wikidata calls it a museum at
all** (`isMuseumOnWikidata`, the museum import's own class closure rather than a second list — a
narrower answer would refuse the Bardo, typed nothing but `museum`). The editors file the dig
beside the building: of the 776 articles carrying a Wikidata item that the 60 country categories
held at depth 1 on 2026-09-13, 75 are at or above the place line and **27 of those carry no museum
class at all** — Pompeii (`archaeological site, ancient city`, 122 sitelinks), Chichén Itzá,
Teotihuacan, Masada, Çatalhöyük, Sforza Castle, Bodrum Castle. Nothing else in the rule refuses
them: the park veto reads Wikidata's park tree, which holds none of them, and the category answers
the nature question before the class is ever asked, so each would be admitted as a `museum` pin on
an ancient city. **An archaeological park on the same shelf is the other way round**, and the
pipeline test covers it since #887: Wikidata files `archaeological park` under `archaeological
museum` and so under `museum`, so Hadrian's Villa (`archaeological site, archaeological park`, 52
sitelinks) *passes* this gate carrying a museum class, and the park veto is the only thing between
it and a museum pin on an open-air site a traveller walks for an afternoon. The gate is asked of **every** member rather than only of those nothing else
knows — a row another road really did vouch for passes by construction, while being in the venue
graph vouches for nothing, since the graph holds every entity a find points at, the dig it was dug
out of included. What it refuses it refuses to the site door, not out of the catalogue
(`no museum class on Wikidata: a site, a castle or a city in Wikipedia's category — the site door's`),
and that refusal is named **at or above the place line, or wherever the source already admits the
row**: the gate asks `lineStanding` and nothing of its own, so an admitted row that has slipped
below the stay line reads as `fell` rather than `out` and leaves the catalogue with its number and
a reason, exactly as the verdict below refuses every other. Those are a worklist the site door will
want, while a country's whole archaeology named row by row is the long tail every `out` in this
kind exists to keep out of a curator's list. Dry run 113 named 40 of them.

**What the museum is about** (`museumNature` in `archaeology/museumTest.ts`), in the order a person
would give the reason:

- **A veto is answered ahead of any nature**, because it names the thing better than "no
  archaeological signal" would and refuses whatever else the row carries — but the two vetoes are
  not asked alike. The **archaeological park** veto is asked of every row, and reads the whole park
  tree rather than the one class: Wikidata files `archaeological park` under `archaeological
  museum`, and a row typed only `Fudoki no oka` — Japan's word for an archaeological park with a
  museum on it — would otherwise walk in. An open-air excavation with a ticket office is somewhere
  you walk around whatever Wikipedia shelves it under: it is a site, and the site door admits it on
  its own terms (decision 4). The **natural history** veto is asked only where **neither signal of
  the nature answered**, because either one is enough and a museum of both natures is a museum of
  both: the Naturhistorisches Museum Wien is typed `natural history museum` and its article carries
  `Natural history museums in Austria` and `Geology museums in Austria` and nothing archaeological,
  so it is refused and the Venus of Willendorf waits for a kind of its own; the Yorkshire Museum is
  typed natural history *and* archaeological, is filed under `Archaeological museums in England`
  and `Museums of ancient Rome in the United Kingdom`, and its draw is Roman York, so the veto is
  never reached. Dry run 112 refused the Piacenza Civic Museum, typed both, on the unnarrowed
  veto; run 113 admits it.
- **The English Wikipedia category**, `Archaeological museums in|of …` (`NATURE_CATEGORY`), before
  the class, so that the reason a curator reads is the editorial judgement where there is one. It is
  the honest signal of what a museum is about and the one the class tree does not carry: it sits on
  the British Museum, the Pergamon Museum, the Neues Museum, the National Museum of Iraq, the Bardo
  and the Museo del Oro — every museum the class misses — and is absent from the Uffizi, the Prado,
  the Deutsches Historisches Museum and the Carnavalet.
- **A Wikidata class** under `archaeological museum` or `egyptological museum` (`MUSEUM_ROOTS`,
  walked as trees and floored with the roots themselves). The reason names the root's label rather
  than the subclass a row arrived by: what a curator checks is that Wikidata files the museum under
  `archaeological museum` at all.
- **A department category last** (`DEPARTMENT_CATEGORIES` — `Museums of ancient …`, `Museums of the
  ancient Near East`, `Egyptological collections`, `Pre-Columbian art museums`, `Mesoamerican art
  museums`), and only when nothing above it matched: the Larco Museum carries `Pre-Columbian art
  museums` *and* `Archaeological museums in Peru`, and a department word beside a nature takes
  nothing away.

**The verdict** (`museumVerdict`). A veto or no signal at all refuses the row by name. A nature — and
a department counts as one — then meets the fame line, which is `sourceLine.ts`'s for every kind
(hysteresis, and the sentence a fallen row is refused with) with one thing added here: **a find above
the finds' own line counts as in before the standing is asked at all**, which is how the
Archaeological Museum of Delphi enters at 15 sitelinks for the Charioteer, Olympia at 17 for the
Hermes and Heraklion at 21 for the Phaistos disc. The verdict is taken on the count that forgives a
slip — the finds' *stay* line for a museum the source already admits, the enter line for every
other — while the collected item carries a second count of the same finds taken at the enter line
alone, which is the badge's and not the door's (below); where the count is zero the refusal says so,
and where the nature is missing
the refusal says how many famous finds were not enough. A museum whose categories name only an
antiquities department — the Hermitage, the Vatican Museums, the Kunsthistorisches Museum, the
Pushkin Museum, the National Museum of Scotland — is **admitted with the run's question on it** rather than kept out:
`an antiquities department (category: …); is the exposition substantially archaeology?` goes into
`metadata.admissionNote`, and the source's gate (ADR-0025) is what holds the arrival — there is no
fourth curation state. The Hermitage's antiquities are among the world's best and it is still
visited as an art museum; only a person can say which this is.

**`admitted_for` names the find that got the museum in**, and only where the museum's own fame did
not: a row at or above the place line's *enter* count is there on its own account and names
nothing, while Delphi's membership names the Charioteer and Heraklion's the Phaistos disc. Asked of
the **enter line** and not of the row's standing (`lineStanding`), because the place line is
hysteretic: an admitted museum at 21 *stands* in, and it could not have entered on 21 — what
carried it in is what it holds, on its first run and on every run after. Read off the standing, the
run named Heraklion's disc once and cleared it on the next run, since the upsert writes
`admitted_for` from what the run brings, every run (#896). Deterministic rather than remembered, so
the same facts name the same find whatever the run's history, and a name that was cleared comes
back by a run. A museum in the band whose find has since fallen below the finds' stay line names
nothing and stays on its own count, which is then truly what keeps it. It is the run's own
bookkeeping, never a question for a curator.
The coordinates are not asked by the verdict — the venue graph already refused a holder without
them, and a rule asked twice can answer differently in two places — so `placementOf` refuses a pool
row that has none, in the words every other kind uses.

**The folds are the museum import's, narrowed twice** (the shape `worship/pipeline.ts` found with
the Cappella Paolina). First by the survivor's **nature** (`foldsOntoAdmitted`): a museum may fold
only onto a survivor this kind admits — by category, by class, or as a department held for a
curator — so an archaeological collection is never taken out of the catalogue by a fold onto a row
the rule refuses. Then, once the verdict is in, by **whether the run writes the survivor at all**
(`keepFoldsOntoJudged`): a fold stands only onto a museum this run admits or holds, and otherwise
the finds stay with the museum that held them. It is two steps rather than one stricter test because
this kind's admission *depends on* the placements a fold produces — a find above the finds' line
carries a museum below the place line — so the admitted set does not exist until the rule has run,
where worship can test its admitted places before its folds. The nature test alone let through a
survivor that is archaeological and still never written: below the place line, in no class pool, no
category naming it, and after the fold holding only finds below the finds' line. Its new finds were
then stored for nobody, the museum they came from arrived with an empty case, and neither was named
in any refusal. Only a **container** fold can reach it — a door fold takes the better-known name by
construction (`doorOf`), while `applyContainerFolds` follows `P361` within 250 m with no fame test at
all. A run that drops a fold judges again off the mended placements, and **keeps asking until a round
drops nothing** — dropping a fold does not merely give finds back, it un-folds one survivor into the
several museums that claimed those finds, and the holder cap is counted on the length of that list
(`selectTier1`). What makes that reachable is that **the finds' line is hysteretic too, so "below the
line" is two lines and not one**: a find is measured at the finds' *stay* line for a museum the
source already admits and at the *enter* line for one it does not, while the cap is applied to every
pool find before any line is read. A find **in the band** between the two therefore carries a museum
already in the catalogue and leaves an unadmitted survivor uncarried — the unadmitted one goes
unwritten and its folds drop, the un-folding pushes that same find over the cap, and the admitted one
falls with it, taking a third museum's fold with *it*. Without the band the two would stand or fall
together and one pass would do. It terminates because a round never puts a fold back, so the kept set strictly
shrinks; and nothing in a round re-reads Wikidata, the rows, classes, categories and finds all having
been read before the first. The test follows the chain to its
end. The Pio-Clementino museum (10 sitelinks, no English article) is 86 m
from the Vatican Museums and one ticket with them; the Vatican's article carries `Museums of ancient
Greece`, so the fold stands and the Laocoön is shown under the name a traveller looks for.

**A museum that folded is not also a row of its own**: it leaves the items whatever its own fame
would have said and is reported once, by where it went (`foldedAway`). That is what a fold means —
the survivor is *the* name for both, one ticket and one visit — and the art import says it by
construction, a folded venue never being in `tier.museums`. This kind used to say it only by
accident: a folded museum was usually below the place line and came out `out`, while one above it
stood as a second pin holding nothing, its case next door. Every kept fold is reported that way, not
only the ones a find above the line carried: the old narrowing was about counting a *loss*, and this
line is an address rather than a loss. **A survivor held for a curator keeps the folded
museum's works only as long as the curator admits it** (#887), and that is the curator's decision
rather than a defect: the fold is a claim about the world — these two names are one visit — and a
curator who says the Hermitage is not an archaeology museum has said the collection folded into it
does not belong to this kind either. The fold itself stands on the run's own verdict — neither fold
filter reads what a curator decided — and what takes the finds off a reader's screen is the
contents rule: a refused membership hides the museum and its works go with it (`hideRefusedSql`,
ADR-0024), and an admission put back brings them back.

**What a find is** (`archaeology/finds.ts`, ADR-0058 decision 3). A find is something that was **dug
up**, never something that is old: the Aztec sun stone is a `sculpture` of 1510 with no discovery
place on its item, Sutton Hoo is AD 625, the Oseberg ship AD 820, the Benin Bronzes
sixteenth-century, and a date cut would read the Mediterranean as archaeology and the Americas,
Africa and the North as not. So there are four ways in, read in that order — the
`archaeological artefact` tree (Wikidata saying it itself, and about half the measured pool); one of
the nine find classes asked whole beside it (`FIND_CLASSES`: inscription, stele, figurine, Venus
figurine, death mask, sarcophagus, hoard, papyrus — Wikidata's narrow "manuscript written on
papyrus", never the generic `manuscript`, which is what brings in the libraries — and viking ship;
seven of the nine sit outside the tree, which is why they are asked for at all); a discovery place
(`P189`) on the item, whatever its date; and last, an
object of this kind's ancient-art pool made before AD 500 — `sculpture` and `statue` asked in fame
bands, as they are for the art museums, and `mosaic`, `group of sculptures`, `fresco` and `vase`
taken whole. That last way in is for the ancient sculpture that carries no discovery place of its
own and makes Naples and the Vatican worth an archaeology traveller's day — the Doryphoros, the
Laocoön, the Alexander Mosaic — and for the two classes no other root reaches, the Bull-leaping
fresco at Heraklion and the François Vase in Florence. Against all four stands one veto, `NOT_A_FIND`: fossil, skeleton,
individual animal, mineral, diamond, meteorite, coprolite, gemstone — six of them walked as trees and
two matched flat, for the reasons the venue-side read paragraph below gives (#890) — and before any
road is asked, an item with no class at all is no find. **The pool is class-driven**:
it is the shared works collector's (`museum/worksCollector.ts`) under this kind's roots and extra
classes, with the rule above as its `keep`, so a diamond or a tyrannosaur reaches the rule through a
class that collected it and is then refused by name — the discovery place is a reason to keep a
work the pool already holds, not a door into the pool. The read of what each admitted museum holds
(#890, below) is the second way into the same rule, and the one that meets an `iron meteorite`. The site veto of the venue rule stays
**on**, where the places of worship switch it off: a park is not a venue for this kind.

**What an admitted museum holds is read from the museum's side too** (#890). The finds pool is
class-first, and two of the four roads into a find are not classes: a discovery place, and a date
before AD 500 on an object of the ancient-art roots. So the Pergamon Altar (`altar`, dug up at
Pergamon) and the Ishtar Gate (`city gate`, `arch`, 575 BC) could keep a pool row and could never get
one, and on dry run 120 the Pergamon Museum arrived with the Market Gate of Miletus, the Kilamuwa
Stela and the Victory stele of Esarhaddon and neither of the two things it is visited for. Once the
verdict has settled (`judgeToAFixedPoint` in `archaeology/museumHoldings.ts` — the museum door's second half, split out of the pipeline with the rounds below — the fold decision and the verdict asked of each other until
neither moves), the run asks of every museum it admits — **and of every museum folded into one**,
which is where the Ishtar Gate is: its collection statement names the Vorderasiatisches Museum, 60 m
from the Pergamon and `P361` it, and a read of the survivor alone would never find it — what Wikidata
places there by a current `P195` or `P276` statement at the pool's floor (`museum/venueSide.ts`, the
shared stage § Art Museums describes), reads what each new object is (its classes, and through this
kind's own `workFacts` its discovery place), and hands it to `findReason`: the Altar is kept as *found
at Pergamon*, the Gate as *made before AD 500*, each typed by its own class — `altar`; `arch`, the
lowest-numbered of the Gate's two, deterministically, since a type that changed with the answer's row
order would report an update to nobody's word on every run, and a curator's correction stands (#731).
What is kept is placed as a pool find is and merged, and **the verdict is asked once more** over the
merged placements, because what a museum holds is what it is badged and, below the place line,
admitted for: the Pergamon wears the badge for the Gate and the Altar where the pool alone left it
none. An object read here can name a museum no pool find named; it gets a row from the extended graph,
its classes off it and its categories from Wikipedia (one more call, for the few there are), and
reaches the verdict like any holder — **and the read is asked again of whatever the new verdict
admits that no round has read**, until a round admits nothing new: a museum an object carried over
the line has its own case read in the same run, and the rounds are one read for the report, each
object named once. It terminates because the set of museums read only grows. What is refused is
reported on the changeset with its classes, and so is what the rule kept and the run still writes
nowhere — a find whose statements resolve to no admitted museum, or one nobody can see — with that
reason; a row the run writes is never among them. Named at or above the finds'
stay line and counted below it — the Louvre's paintings refused as not finds would otherwise bury the
Library of Ashurbanipal (`library`, no discovery place, 51 sitelinks), which is the real miss the read
shows and the class list (#891) is for; the run's summary line says how many the read kept and
refused, and names what it kept. Measured on the 83 admitted museums of the development catalogue on
2026-09-15: **468 objects at 10 sitelinks or more (252 at 15)**, 274 (134) linked at no museum that
holds them, 115 (49) no treasure at all — the Pergamon Altar, the Library of Ashurbanipal, the Benin
Bronzes (`group of sculptures`, undated and with no find spot, so refused by the rule as ADR-0058's
consequences foresaw), the Oxyrhynchus Papyri (`manuscript collection` with a find spot, kept), the
Bardo attack (`mass murder`, located in the Bardo), and the paintings and frescoes of the Louvre, the
Vatican and the Hermitage, which are the art run's treasures and no finds. **Dry run 126 and live
run 127** (2026-09-15) read 91 venues — the 84 admitted museums and the 7 folded into them — and
kept 26 finds the class pool could not reach (the source record names them); 20 museums gained 27
links, the Pergamon its two, and wears the badge for them. Two of the 26 were wrong and the run
named them: the Bendegó meteorite, typed `iron meteorite`, a subclass the flat `NOT_A_FIND` list
never named, and "Gupta art", an item with no class at all kept by the date road. So **six of the
eight natural-history roots are walked as trees** (`NOT_A_FIND_WALKED`, six more class questions
in `fetchArchaeologyTrees`, each floored with its root) and **an item with no class is no find**
before any road is asked — the pool never met either shape, because the pool is collected by
class. Not all eight: live run 128 walked them all and withdrew the Gebelein predynastic mummies
from the British Museum and Clonycavan Man from the National Museum of Ireland, because Wikidata
files `mummy` under both `skeleton` and `individual animal`; those two stay matched flat, which is
what the veto was measured on (Sue and Lucy carry them directly). Run 128 showed one more thing
the read makes possible: the Museu Nacional's only link was the meteorite, and once the run
refused it the museum offered nothing — which `reconcileLinks` used to read as nothing to compare
rather than everything to withdraw, so the meteorite stayed a pending find. An empty offer now
marks the museum's links like any other, floor permitting (ADR-0044 decision 4 as written): a
museum the run wrote and offered nothing at is an answer, not a short run. Run 129 is the live run
under both rules.

**Where a find was dug up is stored on it.** `foundAt` — the discovery place's QID and the label a
reader would see, read as a statement that still holds (best-ranked, no end time) and single-valued,
a find whose item names two find spots being a question for a curator rather than for a batch of
fifty. The works writer puts it in the treasure's `metadata` beside the picture credit
(`metadataPatch` in `museum/treasureWriter.ts`), and it is the one metadata key **not** written
whole, because a treasure is global by `external_id` (ADR-0025) and two kinds write the same ancient
sculpture in the Louvre: the run says which of three things happened, and the upsert obeys
(`metadataWithFindSpot`, and `INSERTED_METADATA` on a first write). No key — the art and the worship
runs, which never read `P189` — keeps what the
row holds; the key with `null`, which is what this kind's collector answers where Wikidata records no
discovery place, removes it, and that is the only way a find spot is ever removed; an object replaces
it. Written whole instead, the Art Museums run would erase the find spot of every object it shares
with this one, and the next archaeology run would put it back, on every pass.
`GET /api/experiences/:id/treasures` serves it
as `found_at` and `ArtworksList` draws it as a line of its own under the makers: the Rosetta Stone
is a British Museum object and a Fort Julien one — the redoubt at Rashid on the Nile delta where
soldiers found it in 1799, and the label Wikidata's discovery place carries, so the label the card
shows — and a row naming only the museum tells a traveller the smaller half. Two consequences the review recorded, both real and both small:

- **A work whose picture a curator has claimed keeps its credit, and still follows the source on its
  find spot.** The upsert's guard is on the column rather than on the credit key — it exists so that
  a source's photographer is never printed under a photograph a curator chose — so it decides *which
  object* is kept, the stored one; the find spot's own three states are then applied over whichever
  object that is (`metadataWithFindSpot`, one rule parametrised on its base). The claim is about a
  photograph and the find spot is about the object, and a P189 correction reaches a claimed work as
  it reaches any other. What the claim still freezes whole is everything else in there, which today
  is the credit alone (#887).
- **A changed `foundAt` is reported like a changed credit** (#887). `workChanges` compares a work's
  name, makers, year and picture; `creditChange` adds the credit when the picture moved, and
  `findSpotChange` adds `metadata.foundAt` when this run's answer differs from the row's — a spot
  arriving, moving, or going away, that last being the only way one is ever removed. Silent for a
  kind that never asked, since the art and worship runs send no key and the upsert keeps what the row
  holds; an entry there would report a change nobody made. Minor significance, never a curated
  conflict (nothing claims where a thing was found) and never held (the find spot is written through
  both arms of the metadata guard, so unlike the credit it waits on no claim and no gate). The
  curator's words for it are "find spot" in the feed and "found at" on the card.

**English Wikipedia's categories** (`wikipediaCategories.ts`) are the one door to the second signal,
and hold no archaeology of their own — which categories mean what is `archaeology/classes.ts`, so a
second kind asks this door rather than writing a second client with its own mistakes. Titles in,
non-hidden categories out (`clshow=!hidden`), 50 a request, **POST rather than GET** because fifty
titles in a query string is kilobytes and the Action API answers a long URL with a 414. A batch is
asked as many times as its continuations require, each answer appended rather than replacing what
the last one filed, and a batch still continuing after ten asks is a source repeating itself and
throws. Normalisation and redirect hops are walked in that order and a title may map to several
asked names, so `British_Museum` and `British Museum` both come back answered. Every title asked for
is in the map, empty where the article carries no category or the API has no such page. **A batch
that cannot be read fails the run**: nothing is caught, the orchestrator marks the run failed and
not a row is written, because a swallowed batch is up to fifty museums read as category-less — which
for half the canon is fifty museums this kind refuses, the British Museum among them — on a run
whose log said success. The Action API's own refusals inside a 200 are read the same way — an
`error` object, with `maxlag` and `internal_api_error_*` waited out like a 503. **A body with no
`query` at all is judged by the caller and not by the transport**, because that silence means two
different things: for a batch of titles it is the same fifty museums read as category-less and it
throws, while a category holding no articles of its own is answered in exactly that shape and is
read as empty — the root `Archaeological museums by country`, which held 60 country categories and
no article of its own on 2026-09-13, is one. The second caller is this module's sibling
`wikipediaCategoryMembers.ts`, the walk described under *Who is judged at all*, which borrows this
file's endpoint, retry rule and refusal wording rather than growing a second client with its own
mistakes.
**A wait says so, on the run's own patience** (#886). `CategoryOptions` takes the `onWait` and the
`WaitBudget` the Wikidata door takes, and both Wikipedia readers pass every wait through them: the
panel reads "Waiting on Wikipedia…" with the time left, in the words `waitMessage` gives a Wikidata
wait, rather than the last phase line for however long a 429's `Retry-After` lasts. **One budget per
run, not per door** — the archaeology run mints a single `WaitBudget(SPARQL_WAIT_BUDGET_MS)` and
hands it to its Wikidata door and both Wikipedia readers, so a run cannot spend the full number on
one wiki and the full number again on the other; a run that exhausts it fails with the reason named.
A reader called without a budget mints a fresh one, which is what keeps a test and a one-off caller
working.

**What the panel counts as *fetched*** is the distinct entities the run named: every museum the
class pools answered with, every category member the by-id question answered for (one then dropped
for want of an English article included, since it was fetched all the same), and the finds pool
**after this kind's keep rule** — a diamond or a tyrannosaur the class pool returned is refused as
not a find before any museum is judged and is not counted. That last set is a pool after a cut on
purpose: it is what `worship/pipeline.ts` counts, and a kind counting its contents differently would
make one number mean two things across two source cards (#887).

**Two lines on the source row, not one** (ADR-0058 decision 5). A find carries fewer Wikipedia
articles than the museum showing it, and the second line is what decides three things: which of a
museum's works are kept as finds at all, which of them wear the must-see badge, and which museum a
find can carry over the *place* line — the Archaeological Museum of Delphi enters at 15 sitelinks
for the Charioteer, Olympia at 17 for the Hermes and Heraklion at 21 for the Phaistos disc, and the
museums' own line would have lost all three. (The survey counted 56 museums holding a find at 22
sitelinks and 78 at 18, but on its widest reading of what a find is — the built pool is collected
by class and is narrower, so those two numbers size the question rather than the answer.) So
`api_config` carries `enterSitelinks` / `staySitelinks` for places (22 and 18) and
`findEnterSitelinks` / `findStaySitelinks` for finds (18 and 15), seeded by migration 056. One line
for both doors would either lose those three museums or, set at the finds' number, widen the places
into their own long tail. The
second pair is optional and is read only when the row mentions it, and then **in full**: half a pair
is an error rather than a pair completed from the places' line, because a find silently judged by
the museums' line is the flood the second line exists to prevent. A source that states no second
pair reads exactly as it did before. The admin panel's source card offers a second row of fields for
it, bounded and validated by the same function as the first pair (`SourceLineControls`), shown
wherever the row states *either* finds column — a row carrying half a pair is one whose run refuses
to start, and this card is the only place an admin can repair it, so the empty partner is shown with
the save held until it is filled rather than both fields hidden behind a source that looks
one-doored. A save sends both pairs whenever the source has both — the route
merges the keys a body carries, so naming one pair would leave the other at a number the admin could
read on the card but had not sent. `GET /api/admin/sync/sources` carries the two new columns
(`find_enter_sitelinks`, `find_stay_sitelinks`, NULL for a one-door source), which is the only way
the panel can tell a two-door source from a one-door one.

**What the run writes.** One experience with one point per museum, `type` `museum` in the column and
repeated as the second tag beside `archaeology` (#814), and its finds as treasures through the
museums' own writer, so ADR-0044 governs them unchanged: the works-coverage floor is measured before
a single museum is written, over the same placements the diff was measured against, and only a run
that cleared it marks the links of finds it no longer places here. A find this run places at another
admitted museum keeps a visible link at the one it left until the new museum is read
(`placedElsewhereFor`), since the museum it moved to may be written after the one it left. The
metadata is the museum's facts plus **three keys the run owns** —
`wikipediaCategories` (what English Wikipedia files the article under), `archaeologyNature`
(`archaeological` or `department`) and `admissionNote` (the question on a held row's card) — added
to `SYNC_OWNED_METADATA_KEYS`, so they pass the gate and a claim without ever raising a card:
editors re-file articles constantly, and each re-filing would otherwise ask a curator to approve a
category list nobody displays, while all three are re-derived from live sources every pass and a
stored copy decides nothing. The signal the nature was read off (`natureWhy`) is **not** stored at
all: on a held row the sentence a curator reads carries it, and on an admitted one it is the run's
own bookkeeping. Credits for the museums' photographs and their finds' are fetched in one Commons
pass after the collection (`fetchCommonsCredits`), which is what stops the Rosetta Stone and the
British Museum crediting the same file differently.

The source declares `sourceCompleteness: 'ranked'`, `recomputesMembership: true` and — unlike every
other source that badges — `badgesAdmitted` as a **predicate** rather than `true`: absence from a
run says a row fell below one of the two lines or stopped passing the rule and nothing about
whether the museum still opens its doors, every run recomputes the whole membership from the whole
pool, and **belonging is not the badge here**. A museum is in this kind for what it is about and
never for one find (ADR-0058 decision 2), so the must-see badge marks the museum that holds a
famous find and nothing else (ADR-0045 decision 5): `badgesAdmitted: (item) => item.findsAboveLine > 0`.
The British Museum is badged for the Rosetta Stone; the Bardo, in the kind in full standing
on its own 35 articles and holding nothing above the finds' line, wears none. It is written once
admission is settled rather than per museum (#760), and the orchestrator hands `markIconic` only
the admitted ids whose item passes (`badgeAdmitted`). **And takes it back**: a museum that stays
admitted and stops passing the predicate — its last famous find slipped below the finds' line — has
the badge cleared by `unmarkIconic` off the same list, since the writers that clear the flag with a
membership never reach a row that keeps its membership. **A museum held for a curator wears the badge
from the first run after they publish it** (#887), because the badge reads `admission = 'admitted'` and a held row
is not admitted until somebody says so — an art museum arriving with "is the exposition substantially
archaeology?" written on it is badged by the next run once the answer is yes. That is the choice and
not an oversight: the card a curator answers on lists the finds the badge would be *for*, with their
names and their sitelink counts, so the thing being granted is on screen before the decision is
taken, and a badge written ahead of the answer would be a must-see on a row no reader can see.
A curator's pin on the badge survives it,
and so does every badge on a run whose **admission sweep did not run**: the clear speaks about the
admitted rows the run did not name, which is the sweep's own set, and a run the sweep's guard
refused — an empty answer, errors, a membership collapsed to under half — has the badges left
standing with the admissions they belong to. The *add* is ungated, because it only ever speaks about
rows the run did admit.

**The badge counts at the finds' *enter* line, hysteresis or none**, where the verdict that keeps
the museum counts at the stay line: two questions, two numbers, and `findsAboveLine` on the
collected item is the badge's. Counted hysteretically, an admitted museum would be badged for a
find at 16 articles that the treasure writer leaves unbadged — a museum marked must-see for a work
shown without the mark, which ADR-0023 decision 2 forbids. The band the other way is accepted as
under-badging: a find that slips from 18 to 16 keeps its own flag while the museum stops counting
it, so a museum can stand unbadged beside a badged find; that way round misses a badge rather than
claiming one the catalogue cannot show. The find's own `is_iconic` is read at the same two numbers
because the run hands them to the writer (`iconicLine` on `museum/treasureWriter.ts`, where the art
museums' 22/18 are the default), and both readers of the second pair ask one function for it —
`contentsLine` in `sourceLine.ts`, which answers the source's find line where it states one and its
only line where it does not, so a one-line source cannot have its places judged at its own number
and the objects inside them badged at the art museums'. **Places of worship reads it too** (#883):
that source states one pair, so `contentsLine` hands the writer the churches' own line and a relic
is badged at the number the church was judged by. It used to be left on the writer's default and
agreed with it only because 22/18 is what the row happens to hold — an admin moving the source to
30/25 would have moved the churches and left the Shroud of Turin at 22. **A work both kinds place is badged at
whichever line reached it, and that is accepted**: `treasures.is_iconic` is one flag per work,
globally, because a work is passed once (ADR-0025), so a find at 19 articles in the Louvre is badged
by the archaeology run at 18 and then kept by the art run, whose release arm holds anything at or
above 18 — and the Louvre's *art* card shows a must-see the art rule alone (22 to enter) would not
have granted. The flag is the object's and not the room's: an object the archaeology rule calls a
must-see find is one wherever it hangs. Scoping the flag per kind is a schema change and
belongs to #603.

**Refusals**, in the words the *kept out* card shows:

- `a natural history museum, not an archaeology museum` and `an archaeological park: a site, not a
  museum`, the two vetoes.
- `no museum class on Wikidata: a site, a castle or a city in Wikipedia's category — the site
  door's`, for what the editorial shelf named and Wikidata does not call a museum — said at or
  above the place line, and of a row the source already admits whatever its count (`lineStanding`
  answers `fell`, not `out`), and 40 times on dry run 113: Pompeii, Chichén Itzá, Teotihuacan,
  Masada.
- `not an archaeology museum by category or class (no find above the line)`, or `(2 famous finds
  held)` where the museum holds some and they were not the question.
- `21 sitelinks: below the world tier's line (22 to enter, 18 to stay)`, for an admitted row that
  slipped; a candidate below the line that was never in is simply out and nothing is said about it,
  because a refusal names a rule and none ran on it.
- `no coordinates of its own (P625)` and `not on Earth: its coordinate (P625) is on another globe`,
  the words every other kind refuses a placeless row with.
- `folded into the Vatican Museums — housed in it, and it is the better-known name, 86 m away` (or
  `— inside its P361 container, …` for a container fold), for **every** museum a kept fold took out
  of the run, whatever it held. Not a loss but an address: it says where this name went. It is also
  why such a museum is not a row of its own — see the fold paragraph above — and it comes before the
  rules' own lines, so a museum that folded is named once and by where it went rather than by a rule
  that ran on it before the fold was settled.

**What a run keeps** — six cache kinds (`CACHED_KINDS_BY_SOURCE[5]`, ADR-0047): `classes` for this
kind's eleven class trees (the museum roots, the parks, the natural-history veto, the artefacts,
the natural-history trees that say what is no find, walked from six roots (#890), the site
door's three —
`archaeological site`, `human settlement`, `shipwreck` — and the map entrance's three a `ruins`
tag alone cannot carry a candidate past — a fortification, a palace, a structure of worship,
#895) and for the
venue and work classes the shared stages ask after, `pool` for the museum pool, the site pool and
the bands and batches of the finds pool, `statements` for where each find is kept, `edges` for the
venue graph and for each site candidate's classes, listings and populations, `entities` for their
details, and `osm` for what OpenStreetMap maps at each site candidate — a kind of its own, a day
long, so an admin can drop the OSM half without dropping Wikidata's and see its size beside it in
the panel — all of it asked before the first museum is written. What a wiki answers goes through no
cache at all. *Sync without cache*, the per-kind ages and lifetimes, *Clear* and *Fix pictures*
(`fixArchaeologyImages`, the shared Wikidata picture repair) are all offered on the source's card.

**On the screens.** The kind has a colour of its own, amber-brown (`kindColors.ts`), deliberately far
from the art museums' blue, because an archaeology museum and an art museum are the two rows a
traveller is likeliest to confuse; its two types share it, since a dig and the museum showing what
came out of it are one kind. The type vocabulary (`experienceTypes.ts`) offers a curator *Site* and
*Museum* and nothing else, and the review card explains either in the same words.
`TreasuresInsideChip` is silent for this kind as it is for art museums: a museum's row lists its
holdings already, so a second "N treasures inside" chip would say it twice. A held museum's question
is drawn on the review card itself as **The run asks: …**, not only behind *Look at the object*,
because a batch answer (#852) can dispose of a row without the object ever being opened.

**A museum in two kinds is two rows until #755** (ADR-0058 decision 6). The Louvre is an art museum
and an archaeology museum and is admitted here on the same terms as anywhere: two rows, two pins,
two memberships on two places, and a visit marked on one not seen on the other, until the merge of
ADR-0046 makes them one place with two memberships. The Capitoline Museums and the Israel Museum are
the same shape. Nothing is refused for being in another kind — the honesty owed to a traveller is
that each list holds what its name says, which the nature rule secures.

**What this door does not reach**, each named so the next reader does not go looking:

- **A museum under the place line with no find above the finds' line.** The Larco Museum carries
  both signals — typed archaeological, with `Archaeological museums in Peru` on its article — and
  misses all the same: 18 sitelinks, below the place line, with nothing of its own at the finds'
  line to carry it over. The Yorkshire Museum goes out the same way at 15, on the line rather than
  on the natural-history veto it used to fall to. Both are the regional tier's and a curator's —
  Peru's national registry is already a record in [the register](../sources/README.md).
- **A museum neither signal names.** The Viking Ship Museum in Oslo, which holds the Oseberg ship,
  and the Drents Museum, which holds the Yde Girl, are refused by name — `not an archaeology museum
  by category or class` — because Wikidata types neither archaeological and English Wikipedia files
  neither under `Archaeological museums in …`; each holds finds, and a find admits no museum here.
  The National Museum of Korea, typed `national museum` at 38 sitelinks and filed under `History
  museums in South Korea` and `Art museums and galleries in Seoul` (checked 2026-09-13), is not even
  a candidate: no road reaches it, so not a word is said about it. A museum with no English article
  at all is judged by its Wikidata class alone, for want of anywhere to read the second signal.
  What the two signals *do* reach
  the category door widened considerably — the Tokyo National Museum, which the survey had filed
  among the misses for holding a Hokusai print, entered on run 113 through `Archaeological museums
  in Japan`. That is the price and the reward of an editorial signal, and it is why a run's refusals
  are to be read by name rather than counted.
- **A famous find in a museum this kind does not admit stays out with it.** The Venus of Willendorf
  is the Naturhistorisches Museum Wien's, which the veto refuses; the Venus of Lespugue is the Musée
  de l'Homme's and Lucy the National Museum of Ethiopia's; the Shigir Idol is the Sverdlovsk regional
  museum's. Each waits for a kind of its own — natural history, local history. Museum Ulm is the one
  the survey filed there and the rule admits: its article carries `Archaeological museums in Germany`
  beside `History museums in Germany`, so the Lion man's museum passes this door on the category
  after all, which is the editorial signal being taken at its word in both directions.
- **Everything about a site.** Pompeii, Troy, Carthage and Mohenjo-daro are not in this kind yet;
  273 of the 1,130 sites the survey counted at the line are World Heritage rows the catalogue
  already holds under that kind. Wikidata's site tree also holds living cities — Athens is an
  `ancient city`, Cologne a `Roman city` — which is the leak the site door's class rule and
  OpenStreetMap answer, in the next slice.

### Shared patterns

- Every outbound call says who is calling through `userAgent()` (`backend/src/config/userAgent.ts`), which is the one place the header is built. The shape is the one Wikimedia's User-Agent policy states — `<client>/<version> (<contact information>)` — the version comes from `backend/package.json`, and a run asks for the `bot` marker the policy wants for automated agents, which a curator's own lookup does not carry — the marker names the traffic, not who set it going. The contact is a website and a mailbox that answer; `USER_AGENT_CONTACT` lets a deployment that is not this one publish its own. It matters more than politeness: the policy answers a caller without a working contact by blocking it "without notice", and the OSM Foundation's Nominatim policy refuses a stock agent outright, so the header is a dependency of filling the catalogue. It used to be written at each call site, which drifted into six spellings naming a repository, an account and a domain that do not exist (#864); `userAgentOneSource.test.ts` fails the gate if a second home appears
- The source rows carry no header of their own: `experience_sources.api_config` held a `userAgent` key nothing read, and migration 053 removed it
- The Archaeology run's door to OpenStreetMap is the operator's choice by name — `OSM_READER` unset for the QLever mirror, `overpass` for the public Overpass API, anything else refused at boot in production, warned about in development, and in any case before a question is sent (`osm/readerChoice.ts`, § Archaeology) — and the run log names the one it opened
- SPARQL retries with exponential backoff bounded by a fifteen-minute wait budget shared across a phase (`WaitBudget`) — a collection's queries share one, and the credit pass after it gets its own, 429 + `Retry-After` header handling, 55s server-side + 70s client-side timeouts, an optional `isCancelled` hook that wakes the backoff and aborts the request in flight, and an optional `onWait` reporter so a run can say on screen that it is waiting for the source rather than looking hung (all in `sparqlQuery()`)
- 1.5s delay between image downloads
- `curated_fields` JSONB on `experiences` protects curator edits during sync upserts — each field is checked individually in the `ON CONFLICT` clause (implemented in `upsertExperienceRecord()`)
- Sync log lifecycle: `createSyncLog()` → processing → `updateSyncLog()` (also updates `experience_sources.last_sync_*`)
- Startup cleanup in `index.ts` marks orphaned `running` sync logs as `failed`

## Assignment Model

### Region assignment

- `experience_regions` and `experience_location_regions` reference `regions(id)` only — there is no direct experience-to-division relation. Experiences reach the administrative base layer through a mirror world view imported from it (`source_type = 'base_layer'`, one region per division), never directly; assignment always targets a region, whether it belongs to a hand-built world view or to the base layer mirror. See [ADR-0018](../decisions/0018-base-layer-mirror-world-view.md)
- Spatial assignment writes `auto` rows to `experience_regions`
- Manual curator assignment writes/overwrites `manual`
- Re-assignment and sync flows only clear/recompute `auto`, preserving manual curation.
  This holds at the location level only because a sync now *keeps* the row of a point that
  has not moved (`locationWriter.ts`). It did not before: the write deleted every location
  of every object it touched, and `experience_location_regions.location_id` is
  `ON DELETE CASCADE`, so the cascade took `manual` rows along with `auto` ones — it does
  not read `assignment_type`. A location the source stops offering still loses its
  assignments, which is correct: the place is no longer there

**Two ways in, for two different questions.** A sync places what moved, by itself, at the end
of the run — `placeMovedExperiences` in `placement.ts` calls
`assignRegionsForExperiences(ids, worldViewId)` for every world view that has geometry, over
the experiences whose locations were inserted, moved or dropped. Because `locationWriter`
keeps the row of a point that stayed put, an ordinary run reaches this with an empty set and
does nothing at all. Through it the run stays open on purpose: `progress.status` becomes `'assigning'` rather than
a terminal value, so `isSyncStillRunning` keeps a poller polling for the whole of it — a few
seconds on a source's first run since placement reads leaves through their pieces (ADR-0054;
the measurement table below has the figure for the 1078 places of the worship source, whose
placement took 25 minutes on that run), so the phase reports no progress inside itself and
does not chunk the statement. What it does say is how much it is placing — `Assigning regions for 1078 moved
objects...`, from `enterAssigningPhase` — and nothing else. The item loop leaves the run
with no current object: `processItemsLoop` clears `progress.currentItem` in a `finally`,
on both of its exits, because the loop is the only thing that has one, the panel shows the
name whenever it is non-empty, and a cancelled run still enters the placement phase for what
it moved with the finished item's name set. Its primary line is replaced on the ordinary
exit too — `Processed 1078/1078, tidying up...` — since `Processing N/N: <name>` would
otherwise stand above the bar through missing detection, the admission sweep, the changeset
and the log close, until the completion line is written. Before #850 the last object's name
stood in both places through all of that and the placement, as if the run were still
handling it. `cancelSync` refuses it — placement is past the point `progress.cancel` is read, so
accepting would report a cancellation that never happens. The refusal actually starts a phase
earlier: `isCancellable` accepts only while there is an item loop left to interrupt, so the
post-loop window — missing detection, changeset recording, log closure — is refused too. The
status endpoint reports that answer as `cancellable`, and the admin panel disables its button
on it rather than re-deriving the rule.

It runs after the sync log is closed and never throws, for the same
reason recording the changeset does not: a follow-up step going wrong must not leave a
finished run reported as still running.

It does not stay silent either, and it says so in two places. The run's own reported status
becomes `partial` rather than `complete`, so a poller reading `runningSyncs` in the thirty
seconds before that entry is swept agrees with the row rather than reporting success over
it. And the row itself: a failure reopens the closed log through
`annotateClosedSyncLog`, appending `PLACEMENT_FAILED_MARKER` and downgrading a successful run
to `partial`, so an operator learns that `experience_regions` is stale for what the run moved
and that a full re-assignment is the remedy — nothing else in the product prompts for one. A
run that already reached `failed` or `cancelled` keeps that status, since both are facts of
their own and survive nowhere else in the row. The write is narrow, `status` and
`error_details` only: `updateSyncLog` rewrites every stat column, and this caller has correct
values for none of them — `total_fetched` is the source's item count rather than the processed
one, `detection_skipped_reason` is `detectMissing`'s answer, and `withdrawal_skipped_reason` is
the collector's floor's inside `fetchItems` (ADR-0044), neither of which anything here
recomputes.

The full rebuild (`assignExperiencesToRegions`, `POST /api/admin/experiences/assign-regions`)
stays an admin action, for the case that genuinely needs it: **a region changed** — its geometry,
or its place in the tree, neither of which re-places anything on its own (#494) — so every location
has to be re-tested against it. That one clears the world view's `auto` rows
first, which is why it is not what a sync uses — the clear and the rebuild are separate
statements, so while it runs the world view has no assignments and a browsing user sees empty
regions — for about seven seconds on the development catalogue.

**Where a point is placed: the leaves first, every ancestor from the tree, and the other regions
only for what no leaf holds**
([ADR-0054](../decisions/0054-placement-reads-leaves-through-their-pieces.md)). Both ways in run
one statement, `directPlacementSql`, and differ only in which points they name. It tests a point
against the world view's leaf regions through `region_geom_pieces` — each leaf's geometry cut into
pieces of at most 256 vertices and indexed one by one ([geometry-columns.md](geometry-columns.md)
§ `region_geom_pieces` table) — and asks the whole leaf only about a point on the line between two
of its pieces, where `ST_Contains` on either piece says no. Every ancestor of a leaf that holds the
point gets its row from the walk that follows, as before. The other regions — the non-leaves, and a
leaf with no pieces, which is tested whole rather than skipped — are asked only about the points no
leaf holds, and among what those whole geometries hold a leaf still comes first: a non-leaf gets a
row only for a point no leaf holds, however the leaf was asked. So a leaf whose pieces are missing —
a database that has not run migration 054, a cut that failed — costs time and never changes a row.

That last pass is not a formality. A parent's geometry is built from a GADM division a level up,
and GADM's coastlines do not nest to the metre between levels, so a parent is not exactly the sum
of its children: eight offered points on the development catalogue lie in a country and in no leaf
of it, each 20–240 m outside its nearest leaf — Juno Beach, Delos, the Megaliths of Carnac, Tuol
Sleng, the Hiroshima Peace Memorial from two sources, and two points of the Dorset and East Devon
Coast. A rule that tested the leaves alone would take them out of their
countries. The points nothing holds (#469, #471) stay unheld either way.

What the rule does change is the other direction. A non-leaf whose outline covers a point that a
leaf outside it holds used to get a row for the point, and no longer does. On the development
catalogue that was nine points. Eight are in the Vatican — St Peter's, the Sistine Chapel, the
Vatican Museums and five more — and were listed under Italy as well as Vatican City, because Italy's
union removed the Vatican's 0.44 km² as a small hole; they are listed under Vatican City and Europe
now. The ninth is the Qhapaq Ñan's Segment Rumichaca on the bridge between Colombia and Ecuador:
inside the Ecuadorian leaf Carchi and 35 m from the Colombian leaf Nariño, it was in both countries
and is in Ecuador only. Which country a component of a serial site belongs to is a question about
the source's data rather than about geometry (#264).

Measured on 2026-09-10 on all 7844 offered points against the rows the whole geometries place — a
comparison that shares no code with the pieces, and that agreed row for row with main's own statement
on a sample of 100 worship objects — those nine rows are the only difference. Under both, 176 points
are in no region and eight are in a country but in no leaf of it. The issue that asked for this
counted 179 and nine from the rows then stored, and the gap is the rows' age rather than the rule.
Four of the 179 — Ban Chiang, the Thap Lan forest, the Louvre Abu Dhabi and the rock art at Sivil —
lie in leaves that gained their geometry after the points were last placed, and the next
re-placement puts them there. The Chora of Chersonese, 19 m off both the Sevastopol' leaf and
Ukraine, was held only by Europe's outline, which is cleared for recompute (#667), so it is in no
region under either rule.

The statement's shape rests on three facts about the planner, measured on the development catalogue
on 2026-09-10, and a change to it should measure them again:

- **A leaf is looked up by key for each piece that holds a point** (`LATERAL … OFFSET 0`). Joined
  plainly, the planner hash-joined every leaf of the world view first on a large placement — a
  second and a half before the first point was tested.
- **The points no leaf holds are a materialized set of their own.** Written as an anti-join, it
  lands above the containment test, and every point is tested against the continents before the
  held ones are dropped.
- **The other regions are found through their GiST index, as candidates grouped per region, and
  tested region by region.** A test against a whole region reads its geometry and builds a prepared
  index over it, which PostGIS keeps for consecutive calls on the same region. Measured on the pass as
  first written, which scanned every region of the world view against the 184 points no leaf holds,
  on its own and at a load average near 6: 8 s tested region by region, 3 min 41 s tested point by
  point — neither is a part of the timings in the table below. Grouping the candidates also means a
  region no unheld point comes near is never read, which is what a database without pieces relies
  on: re-placing the whole world view there takes 31 s, where that first shape took 8 min 45 s.

Measured on the development database on 2026-09-10. The machine was shared and loaded — a load
average near 6 for the "before" column and near 2 for the "after" one — so read the ratios rather
than the digits:

| What is placed | Before | After |
|---|---|---|
| A run's 1078 Places of worship objects: clear, direct step, ancestors, denormalise | 25 min (sync log 105) | 3.4 s, 2.9 s of it the direct step |
| The whole world view's 7844 points, as the admin's rebuild does it | about 4.8 h at 2.2 s a point (extrapolated) | 7.3 s, 4.9 s of it the direct step |
| One object inside a leaf (Paris, Banks of the Seine; St Peter's Basilica), direct step | 1.2–1.3 s | under 1 ms |
| One object with points no leaf holds (Beaches of the D-Day Landings), direct step | 7.8 s | 1.6 s |
| The whole world view on a database without pieces (054 not run), direct step | — | 31 s |

The previous statement's 2.2 s a point was measured on 100 of the worship objects (3 min 42 s),
where its rows matched the whole-geometry comparison above one for one.

### Rejection filtering

- Public/user responses exclude rejected items
- Curators with scope see rejected items with `is_rejected`/`rejection_reason`
- `includeChildren=true` in region queries applies descendant-aware rejection checks

### Lifecycle filtering

The two axes ([ADR-0020](../decisions/0020-experience-lifecycle-and-run-changeset.md), narrowed
by [ADR-0021](../decisions/0021-source-may-restore-membership.md)) are read by every user-facing
query, and the rule is deliberately asymmetric because the reasons are:

| State | Lists, map, search, counts | Visit history | Card |
|---|---|---|---|
| ordinary | shown | shown | nothing |
| flagged `missing_since` only | shown | shown | **nothing** |
| `former` | shown | shown | `Former` chip |
| `lost` | hidden | **shown** | `Lost` chip |
| the membership's `admission = 'refused'` | hidden | **shown** | not reachable |
| the membership's `curation_state = 'pending'` | hidden | **hidden** | not reachable, except `GET /:id`, `/:id/locations` and `/:id/treasures` for a curator/admin whose scope reaches the experience |

`former` is a claim about the source's catalogue, not about the world: the place still stands
and you can still go, so nothing about who sees it changes. `lost` is a claim about the world,
and offering somewhere demolished as somewhere to go is the one thing this data can get
actively wrong — so it leaves every read that offers a *set* to go through: the lists, the map,
search and the counts. It does **not** leave a visit: someone who saw Palmyra before 2015 saw
it, and that record cannot depend on the thing still standing. A traveller's visit record keeps all
three of those exemptions — `existence`, `admission` and `missing_since` — which is what lets the
counts elsewhere shrink without erasing anything. The fourth is kept out at the write instead:
`markVisited` refuses a row this reader was never offered (`experienceOfferedToReaderSql`), so an
unread row never gets a visit to hide.

**A by-id read is the documented exception, and it is `lost` only.** `getExperience` and its
siblings hide a row the kind refused but leave a `lost` one reachable, so an object judged
lost still answers at its own address rather than 404ing there. That gap predates the admission
axis and closing it is a separate decision about a different question — recorded here because
the code says so only in comments, at `getExperience` and `getExperienceLocations`, and this file is where a reader looks first. (The `Lost` chip
is a list-surface control, rendered by `ExperienceListItem` and Discover's `ExperienceCard`, so
the by-id answer carries the row without carrying the mark.)

A third axis, `admission` ([ADR-0024](../decisions/0024-a-category-may-refuse-what-the-source-still-lists.md)),
answers a different question again: not whether the source still lists the object, and not
whether it still exists, but whether *this kind* accepts it. The works-first museum
importer refuses an archaeological collection, a natural history museum, a church or a painted
wall — and Wikidata goes on listing every one of them, so neither of the other two axes can
say it without asserting something false. `hideRefusedSql()` is a separate fragment from
`hideLostSql()` for the same reason they are separate columns, and because the two are toggled
independently: `includeLost` is a reader asking to see what is gone, and it must leave
admission alone. The verdict is the membership's since #822 (§ Kinds and sources), so the
fragment asks whether *some* membership of the place is admitted (`placeAdmittedSql`,
`db/membership.ts`) — the same answer as the row's column while a place has one membership,
which every place does today.

`curation_state` ([ADR-0025](../decisions/0025-per-source-curation-gate.md)) is the fourth column
that can take a row off a reader's screen, carried by the place's membership
(`experience_kind_memberships`, since #822 — a kind fed by a gated source holds the gated members
per member, ADR-0045 decision 7), `experience_locations`, `experience_treasures` and `treasures`
rather than by the experience alone, because a gated source's points and works are exactly what a
run can add unchecked between one curator visit and the next. It answers a question none of the
other three do: has anyone looked at this row yet — not whether the source still lists it, not
whether it still exists, not whether this kind accepts it. A sync run writes it — `pending` for a
membership from a gated source, `auto` everywhere else. `createManualExperience` writes `verified`
instead, on both the membership and its one location: there is no source here to gate, and the
curator who typed the row in and placed the point already read it — `auto` would say "published
unread" about something a person wrote.
`existence`, `admission`, `missing_since` and `curation_state` answer different questions and
compose rather than collapse: merging any two into one column is forbidden, because it would make
it impossible to ask about either again.

Every reader-facing read now honours it. `hidePendingSql()` gates a place — some membership of it
passed (`placeVisibleSql`), and `experienceOfferedToReaderSql()` asks both questions of *one*
membership, which is what every writer of a reader's claim composes — and
`publishedContentSql()` gates a content row — a location, a treasure link, a treasure — because
ADR-0025's split is load-bearing: a published museum may hold newly-written, unread paintings, and
a predicate that only checked the experience would publish them the moment a run wrote them. Both
live beside `hideLostSql`, `hideRefusedSql` and `offeredLocationSql` in `db/readerPredicates.ts`, unconditional everywhere a list,
count, search or map feed applies them — there is no `?includeUnread=true`, unlike `?includeLost`,
because a reader has no legitimate reason to ask for what nobody has checked. The by-region
**count**'s two `FILTER` expressions both need it, or a row that is both `lost` and `pending` gets
counted as something the "show what is gone" toggle would reveal when revealing it would still
leave it gated — measured live: without the fix, `lostHidden` read 1 for such a row; with it, 0.

**The relaxation is narrower than the gate.** `GET /:id`, `/:id/locations` and `/:id/treasures` —
and only those three — widen the predicate for a curator or admin whose scope reaches the
experience, resolved by `maySeeUnreadExperience()` (`experienceScope.ts`). Every other read that
carries the gate — search, the by-region list and its counts, the per-kind counts,
region-counts, the map feed, and the per-user visited-status denominator — applies it
unconditionally, to everyone: a curator comparing "what the catalogue offers" against a reader's
view has to see the same numbers, or the two could never agree on what the catalogue offers.
`/:id/locations` and `/:id/treasures` widen their *content* predicates on the same boolean as their
container, not just the container's: a curator who was let through the gate on a queue item that
is itself a location or a treasure, rather than the whole experience, still needs to see that one
row once past it. `maySeeUnreadExperience()` costs nothing for a caller who cannot benefit from
it — an anonymous or non-curator request returns `false` before touching the database; only an
authenticated curator's request resolves scope, via `resolveExperienceScope()`, the same function
`editExperience` and the lifecycle decisions already use for "does this caller's authority reach
this experience".

That split has a visible consequence, not a bug: `experienceRegionQuery.ts`'s `location_count` —
the number a region card shows beside each experience — carries the gate unconditionally, with no
relaxation, because it is the same kind of number as the by-region list it sits inside. A curator
whose scope reaches a gated experience can therefore see a card say "2 locations" and then open
`/:id/locations` for that same experience and see 3 — the relaxed read and the unconditional count
are answering different questions ("what may this caller see at this address" versus "what does
the catalogue offer"), and making them agree would mean removing the relaxation, not extending it
to the count.

A region-scoped curator (not a global or source one) can meet a narrower gap than that, for a
reason worth naming so nobody debugs it twice: `resolveExperienceScope()` — and so
`maySeeUnreadExperience()` — decides a region-scoped curator's reach via `MIN(er.region_id)` over
`experience_regions`, so a `pending` experience with no `experience_regions` row *yet* answers
"no scope reaches this" to every region-scoped curator, admins and global/source curators
excepted. Placement runs at the end of a sync (issue #480's fix), so the window between a row
landing `pending` and its placement finishing is the same window every other region-scoped read
already treats as "not yet in any region" — including the curation queue's own scope filter,
which this matches rather than diverges from.

**Region membership is asked of the points a reader can see, not of the roll-up.**
`experience_regions` is placement's denormalisation of where an object's *points* are, and
placement writes it from every **offered** point — `pending` ones included, because decision 5
holds contents by writing them invisible and an unplaced one would leave the region curator's
queue empty. A read that answers "what is in this region" from that table alone therefore offers
an object on the strength of a row no reader is shown: the region's list gains it, the
`location_count` beside it reads through `publishedContentSql` and says none of its points are on
offer here, the marker batch draws nothing, and opening it lists places in other regions (#521).
`readerRegionMembershipSql()` (`db/readerPredicates.ts`) is the further question — does this
region hold a point of this object that is offered *and* published — and every reader-facing
region read carries it: the by-region list and its count in both branches, the marker batch in
both branches, `region-counts`, and the `regions[]` of both
reads that answer where an object is — `GET /:id` and, since #592, `GET /search`, whose array is
what a search row opens. A **manual** assignment is exempt, since a curator adding an object to a region is not
deriving membership from a point and that claim carries no `experience_location_regions` row to
find — it is how an object whose only point falls just outside the boundary (#469) or lies
offshore (#470) reaches a region's list at all. That exemption is permanent and reaches a row
placement wrote: `assignExperienceToRegion` upserts `assignment_type = 'manual'`, so a curator
putting a rejected-but-auto-placed object back into a region flips the row for good, and
placement's clear touches `auto` rows only. It is the reading rather than an oversight — the case
the exemption exists for has no backing point by construction — and it does not produce the
pinless row the predicate exists to prevent, since the marker batch answers with the object's
places wherever they are (`representablePlaces` falls back to the out-of-region ones). A claim
that should no longer stand is removed with `removeExperienceFromRegion`, which deletes a row of
either type. The curator's side reads the roll-up whole and is
unchanged (`experienceScope.ts`, `reviewQueueContext.ts`, `publishWaitingController.ts`), which is
what puts the unread point in front of the curator being asked about it. `regions[]` is the single
read that relaxes, on the same boolean as the row it sits in, for the reason `/:id/locations`
does: a curator reading a queue item has to be shown where publishing will put it. Measured on the
dev catalogue, where the predicate changes no row today — every membership is backed by a
published point — the cost is the region list unchanged within noise, its count 12 → 27 ms, the
tree counts 5.6 → 10.4 ms at the world's roots, `?regionId` 15 → 33 ms and the marker batch
129 → 143 ms.

The `admission` row in the table above reads "Visit history: shown" beside "Card: not reachable", and those two
cells are not a contradiction — reading them as one is what let another by-id read stay open for a
whole slice. The line they fall either side of: **the catalogue's reads refuse a kept-out row; a
record of what a person did is theirs and stays.** A read that describes an experience — its detail,
where it is, a reader's denominator of points visited there — is the catalogue talking, so it
refuses a kept-out row. A read of what *this person* did (`getVisitedIds`) is not, so it does not
filter, and neither does the write path: if a traveller stood in the British Museum,
that is true whether or not this kind calls it an art museum.

**The shape of the refusal follows what the answer is**, which is why the rule is not "it 404s":
404 where the answer is the row, and an empty list where the answer is other objects that merely
live in it. So the reads whose answer *is* the row 404 together — `getExperience` and
`getExperienceLocations` under `/api/experiences/:id`, and `getExperienceVisitedStatus` under
`/api/users/me/experiences/:id`, which reached `experience_locations` without joining `experiences`
at all until #503 closed it — while `/:id/treasures` answers 200 with an empty list, because its
subject is the works and the same predicate withholds them (see its row in § API Endpoints). Both
are the same refusal.

Unlike the other two, the machine writes this one. A refusal is not an ambiguous observation:
the run matched the object in the source's own answer and applied a deterministic rule to it,
and a candidate that fails the same rule is never created at all — so a row that predates the
rule has to end up where a new one would. Five writes (`services/sync/admission.ts`), every one
on the membership the run's own source brought (`m.source_id`, joined to its place by the external
id the run names — a run refuses, restores and badges what it brought and nothing another source
did) — the three that move `admission` all skipping a membership whose `curated_fields` holds
`admission` and all skipping `is_manual` places, while the last two, about the badge rather than
about admission, honour the flag's own pin instead, so a membership a curator overrode is badged:

- `markRefused` — unconditional, for the entities the fetch named and a rule turned down. The
  rule's own words go into `admission_reason` on the membership, because a changeset entry is
  keyed by the external id the run named and that is not always the row's.
- `restoreAdmission` — a row this run admits comes back. Without it the axis is a one-way door.
- `markNotAdmitted` — the sweep, only for a source whose `SyncServiceConfig` declares
  `recomputesMembership`. It reaches the case matching by external id cannot: `Roman Forum and
  the Palatine` (Q55685908) was placed by one run and refused by the next under a *different*
  Wikidata item for the same ground. Guarded by the run finishing clean and uncancelled and by
  the admitted set holding at least half the previous one — looser than missing detection's
  90 %, because that floor guards a listing and this one guards a rule, and a rule is meant to
  move the set.
- `markIconic` — the must-see badge on the memberships the run admits, only for a source whose
  `SyncServiceConfig` declares `badgesAdmitted`, and in one of two shapes. `true` where belonging
  *is* the badge — the works-first museums of ADR-0023, and the rule-cut world tiers that
  followed, Public Art & Monuments and Places of worship. A **predicate over the run's own items** where it is not: the Archaeology source admits
  a museum for what it is about and badges only the one holding a find at or above the finds' enter
  line, so `badgeAdmitted` builds an external-id → item map and hands `markIconic` the admitted ids
  whose item passes and no others — an admitted id with no item among them is left unbadged, since
  the question cannot be asked of it and badging it would answer `true` by default. Either way a
  listing or a rule that is not fame badges nothing, however its membership is computed (ADR-0045
  decision 5). Written after the admission step, once every row of the run has
  the admission it will keep, so a confirmed refusal gets nothing and a cancelled run badges
  nothing (#760).
- `unmarkIconic` — the same badge taken back, and **only where `badgesAdmitted` is a predicate**:
  where belonging is the badge every admitted row is in the list handed to `markIconic`, so nothing
  is left over and no statement is sent. Where the two sets come apart, an archaeology museum whose
  last famous find fell below the finds' line stays in the kind for what it is and stops wearing a
  must-see badge for a find it is no longer credited with — nothing else would ever reach it, since
  every writer of `CLEAR_ICONIC` — the run's `markRefused` and `markNotAdmitted`, a curator's
  `refuseArrivalUnderLock` and a confirmed refusal's verdict in `lifecycleController.ts` — fires
  when a row *leaves* the kind. It clears against the
  very list `markIconic` was given, so the two statements cannot disagree about who is badged, and
  honours the badge's own pin: a curator who called this must-see goes on saying so, while a pin on
  `admission` is a different answer and does not pin the badge. **Sent only on a run whose sweep
  above actually ran** — the set it speaks about is the sweep's, and "no skip reason" is not "the
  sweep ran" (a source that publishes a list skips nothing and sweeps nothing), so the step hands
  the badge both facts (`SweepOutcome`). Ungated, one broken SPARQL day would take the badge off
  every row the run failed to reach while the sweep was busy protecting their admission. The flip is
  recorded in no changeset, in either direction; that is #603's.

Restore and the sweep are order-independent — restore only sees refused rows the run admits,
the sweep only admitted rows it does not — but both must run after `markRefused`, so a venue a
run both names as filtered and admits ends that run admitted rather than hidden until the next
one.

An object a run merely flagged looks completely ordinary. That is the point of leaving both
verdicts to a curator: a source outage must not change what anyone sees.

`hideLostSql()` and `lifecycleSelectSql()` live in `db/readerPredicates.ts`, and the
request's ask for lost rows (`includeLost()`) in `controllers/experience/includeLost.ts`,
rather than inline, because the predicate goes
into a dozen queries built by string concatenation and the one that forgets it is the one that
lies. The rule holds by construction since #791: a literal `curation_state <> 'pending'` or
`existence <> 'lost'` in a statement anywhere but `db/readerPredicates.ts` and
`db/membership.ts` fails the backend lint (`READER_PREDICATE_RULES` in
`backend/eslint.config.mjs`), the sync writers included. Two traps it has already caught: `searchExperiences` needs brackets round its two name
alternatives (unbracketed, `OR` binds looser than the lifecycle `AND` and every lost object
matching by trigram comes straight back), and the by-region **count** has to carry the same
rule as the list or the page says one number and shows another. `listKinds` carries both
predicates in its per-kind `experience_count` for the same reason — without them it
reported 128 experiences in *Art Museums* where the catalogue offers 101 — the 27 rows that
kind's own rule turned down (#503). Both, though the `hideLostSql()` half changes nothing
today: measured 2026-08-09, all three kinds hold zero `lost` rows, so the whole 128→101 gap
is refusals. It is still the half to have, because the vision promises that what no longer exists
leaves "the lists, the map and the counts" (`docs/vision/vision.md`, *Places that changed*), and
without the predicate that promise would only be accidentally true. The rule that makes this
checkable holds everywhere a count appears: **no count advertises more than its list shows by
default, and a count that labels a kind rather than a page does not move when a caller widens
the list.**

`?includeLost=true` puts them back — named in the **query schemas** as well as read in the
controllers, because `validate()` replaces `req.query` with the parsed object and Zod strips
what it does not name. A parameter the controller reads but the schema omits never arrives,
while every test calling the controller directly keeps passing; `types/experienceQuerySchemas.test.ts`
guards that. The location batch carries the same flag, or a revealed row would arrive with no
markers and a zero location count. The by-region response carries `lostHidden` — computed by
the count query that was already running — so the list can offer "3 in this region no longer exist —
show them" only where there is something behind it, instead of a permanent control for a state
almost no region has.

**Taking a verdict back.** The review queue lists only flagged rows, so it lets go of an object
the moment it is answered, and a `lost` verdict then hides it from lists, map, search and
counts. `CurationDialog` is therefore the one surface a curator can still reach it from, and it
carries the control, sending `POST /:id/state` with the row as the dialog is showing it. The
two halves are not reached the same way: **"It does still exist"** needs the reveal first,
since a `lost` row is not otherwise on screen, while **"It is still listed"** sits on a
`former` row wherever it already is — which is both card surfaces, Discover included, because
`former` is never hidden. Without that, a mis-clicked verdict
had no remedy short of SQL, which is why `missing_since` travels in `lifecycleSelectSql()`:
the correction has to send the flag as seen rather than infer it from the verdict.

`LifecycleChip` (`components/shared/LifecycleChip.tsx`) is on both card surfaces — Map mode's
`ExperienceListItem` and Discover's `ExperienceCard` — since both read the same by-region
response and a labelled row in one is an unexplained one in the other. The reveal affordance
is Map mode only for now: Discover's list is filtered the same way, but has no place to put
the control that would not compete with its kind filters.

## API Endpoints

### Public browse

Every read below except `/search`, `/kinds`, `/:id/finds` and `/points` carries `optionalAuth`, because its answer is shaped by who asks — a curator's rejected rows, a curator's or admin's whole `regions[]`, a gated museum's unread treasures, a reader's own `is_new` — and `optionalAuth` says so in the headers: `Cache-Control: private, no-cache` and `Vary: Authorization`, so a shared cache cannot store one caller's answer and serve it to the next, while the browser keeps its ETag round-trip (#597; the reasoning is in `docs/security/SECURITY.md` § Headers). `backend/src/routes/callerShapedReads.test.ts` holds that each of these routes carries the middleware.

Every read `frontend/src/api/experiences.ts` and `frontend/src/api/worldPoints.ts` call answers through a schema in `backend/src/api/responses/experiences.ts` and `responses/worldPoints.ts` (ADR-0066). The rows are typed and mapped key by key, so a column a query gains reaches a reader only once its schema names it, and a timestamp leaves as an ISO string: `experienceAnswerRows.ts` maps the object, a region's list, search, the works and the finds, `locationOf` (`experienceLocationController.ts`) the two location reads, `toColumns` (`worldPointsController.ts`) the map's points, and `experienceQueryController.ts` maps the kinds and the region counts inline, off typed queries. The object's `metadata` is an open record in its schema until #574 settles its model. The map's point tiers (`overview`, `markers`) are one list, `worldPointsVocabulary.ts`, which the request's schema, the handler and the answer's schema all read.

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/experiences/:id` | Full detail — without `tags`, which nothing renders and which a gated run now writes unreviewed, a bypass that holds only while no reader-facing read returns them (#570; `experienceQueryController.test.ts` pins the select). 404s for a refused row — the class rule, not this row's exception: every read that describes an experience refuses one the kind kept out, and every by-id read whose answer *is* the row answers 404 (see § Lifecycle filtering, which also says what shape the refusal takes where the answer is not the row). Also 404s a `pending` row, except for a curator/admin whose scope reaches the experience (`maySeeUnreadExperience()`) |
| GET | `/api/experiences/by-region/:regionId` | Supports `includeChildren`, `includeLost`, `limit` (default 100, max 5000), `offset`; optional auth affects rejection visibility. Rows come back `ORDER BY e.name`, so a `limit` under the region's size truncates alphabetically rather than paging — both callers pass `WHOLE_REGION_LIMIT` and take the region whole. `total` is a `COUNT(DISTINCT e.id) FILTER (…)` over the same predicate the list uses — which includes the lifecycle rule, so it follows `includeLost` — and not the page size, so `offset + experiences.length < total` says rows remain beyond the returned window — truncation for a caller that started at `offset` 0 and asked for the whole region, plain `hasMore` for one that is paging; the server cannot distinguish those, since the difference is intent. Distinct because the rejection join can multiply rows per experience. `lostHidden` reports how many the region holds that no longer exist and are **not** being shown — zero once `includeLost` is on, since nothing is hidden then, and it excludes `pending` rows too, or a row gated for both reasons would be counted as something the toggle would reveal. `pending` rows are excluded from both the list and the count unconditionally, for every caller including a curator: this is a *set*, not one of the by-id reads the pending gate relaxes (`getExperience`, `getExperienceLocations`, `getExperienceTreasures`) |
| GET | `/api/experiences/by-region/:regionId/locations` | Batch: all locations for all experiences in region, grouped by `experience_id`. Each row carries `curated_fields`, the claims a curator holds on the place, so a place's row on the map's card can say *pin corrected* (#583). The rows are typed and mapped key by key into `RegionExperienceLocationsResponse` (`backend/src/api/responses/experiences.ts`, ADR-0066), so a column the SELECT gains reaches the response only once the schema names it. Supports `includeChildren` and `includeLost`, the latter because this batch has to follow the list: a row the list shows but this omits arrives with no markers and a confident `0/N in region`. Eliminates N+1 per-experience location fetches. Excludes a `pending` container or a `pending` location, unconditionally |
| GET | `/api/experiences/search` | `q`, `limit`. Also excludes `pending` rows unconditionally. Each result carries `kind_id`, `kind_name` and `regions[]` — **where it can be opened**: the regions that name the object to a reader (`readerRegionMembershipSql`, the same predicate `/:id`'s `regions[]` uses), in **published, active** world views only, minus any pair a curator rejected (a rejection leaves the membership row standing, so without that predicate a search row would link to a list that drops the card), ordered smallest first by `geom_area_km2` (nulls last) so a caller opening one frames the object rather than its continent. Empty where nothing published places it — 28 of the 1577 visible objects on 2026-09-01. Published-only rather than caller-shaped, because this route deliberately carries no session; the region context is computed *after* the LIMIT, in a select over a `matches` CTE, so the placement lookup runs for the page rather than for every name that matched ([ADR-0042](../decisions/0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md)) |
| GET | `/api/experiences/kinds` | The active kinds (their source rows) ordered by priority. `experience_count` is a kind's count of ADR-0046 decision 8 — the memberships the kind offers, admitted and passed, of places not `lost`, each once (`kindCountSql`, #822) — unconditionally: it labels the kind, not a page, and no caller passes `includeLost` here |
| GET | `/api/experiences/region-counts` | `worldViewId` required, optional `parentRegionId`. Per kind per region, of memberships — a kind's count, ADR-0046 decision 8 (`countedMembershipsSql`), returned under `kind_counts`, keyed by `kind_id`. One per place within a kind, because a place holds at most one membership per kind (`UNIQUE (experience_id, kind_id)`): a place in two kinds counts once under each and never twice under one; a region's total of *places* is the region list's own number (`countedPlacesSql`), not this endpoint's. Excludes `pending` and refused memberships and `lost` places unconditionally |
| GET | `/api/experiences/:id/locations` | Multi-location list; optional `regionId` adds `in_region`, and the answer names the region it was asked about as `regionId`. The answer is `ExperienceLocationsResponse` (ADR-0066). 404s for a refused row, like `/:id`. Also 404s a `pending` container, and excludes a `pending` location from the list — both relaxed together for a curator/admin whose scope reaches the experience, so a queue item that is itself one pending location inside an otherwise-published experience is still visible once past the gate. Each row carries `curated_fields` — the fields a curator has claimed on the place (migration 027) — so the object screen's Location field can say a correction stands rather than showing a moved pin as the source's; `curation_state`, so the same field can say an unread place is one readers are not sent to until it is published (#583); and `refused_at`, so it can tell a place a curator *turned down* from an unread one (#859) — the state cannot, a refused point staying `pending`, and without the mark the field offered publishing as the way to show a place the publish refuses |
| GET | `/api/experiences/:id/treasures` | Treasures list (artworks/artifacts). Carries `hideRefusedSql()` on the container, so a refused museum's works come back empty: the contents follow the container, and answering with them would put back on screen exactly what hiding the museum took off it. Three more predicates gate `curation_state` — on the experience, the `experience_treasures` link and the treasure itself — because any of the three can be `pending` independently; all three relax together for a curator/admin whose scope reaches the experience. Each row carries `found_at` (a find's discovery place, ADR-0058) and, since #894, `found_at_site`: the Archaeology site row by that Wikidata id, with its reader-named `regions[]`, where a reader may open one — `null` where the spot is not a site the catalogue holds |
| GET | `/api/experiences/points` | The catalogue's reader-visible **places**, for the map's world layer (#910, [ADR-0061](../decisions/0061-the-catalogues-world-map-is-a-read-of-the-api-not-a-tile-source.md)). Filters: `kindId` (absent is every kind at once), `bbox` (absent is the whole world), `detail` — `overview` sends coordinates alone, `markers` adds the place's and object's ids and names, the kind and the type — and `folded`, which answers one point per object at its reader position (ADR-0028 decision 2) instead of one per place, counting the places it stands for in `locationCount`. Stateless like `/search`: no `optionalAuth` and no curator widening, so there is nothing caller-shaped to keep out of a cache. Answers **places, not objects**, which is why it exists at all: a read of objects answers a serial site as one row where it has hundreds of places. Columnar, one array per field, because a `FeatureCollection` repeats its keys once per place: 37 kB brotli for the overview of every kind (measured 2026-09-16), 18 kB folded, against 267 kB for the same values as GeoJSON. `kindId` is bounded to int4 and a `bbox` that is not four numbers is a 400, not a dropped filter — an unparseable box must not widen a viewport to the whole catalogue, and a repeated `?bbox=` parameter is refused rather than composed out of its halves. Capped at 20 000 rows, more than twice the places the catalogue holds (8 842 on 2026-09-22), because `bbox` is optional on both tiers and the limiter bounds how often a stranger asks rather than what each ask costs; a read that hits the cap answers `truncated: true`, since a density picture built from a subset is wrong rather than incomplete |
| GET | `/api/experiences/:id/finds` | The finds dug up at a site and the museums that show them (#894, § Archaeology). Stateless like `/search` — no `optionalAuth`, no curator widening: every row is a museum a reader may be sent to, through a link the source still places and a curator has passed, each with the same reader-named `regions[]` the search sends (`readerRegionsJsonSql`). A site nobody may see, a row that is not a site and an unknown id all answer `{ finds: [], total: 0 }` |

### User visits (`requireAuth`)

Every response `requireAuth` lets through here carries `Cache-Control: private, no-store` and `Vary: Authorization`, set by the middleware itself: the bodies are one traveller's own history, and `no-store` is what keeps them out of the browser's disk cache after sign-out (#710; the reasoning is in `docs/security/SECURITY.md` § Headers). A request that never reaches it answers with Express's defaults instead — the router's rate limit at 429, and the 400 from `validate`, which is wired ahead of `requireAuth` on every route in the table below — and neither carries anything of the caller's to keep. `backend/src/routes/callerShapedReads.test.ts` holds that every route on the user router carries the middleware.

Every call the web makes here lives in `frontend/src/api/visited.ts`, and its answer is a schema in `backend/src/api/responses/visited.ts` (ADR-0066), built key by key, a visit's `visited_at` leaving as an ISO string or null.

| Method | Endpoint |
|--------|----------|
| GET | `/api/users/me/visited-experiences/ids` |
| POST | `/api/users/me/visited-experiences/:experienceId` |
| DELETE | `/api/users/me/visited-experiences/:experienceId` |
| GET | `/api/users/me/visited-locations/ids` |
| POST | `/api/users/me/visited-locations/:locationId` |
| DELETE | `/api/users/me/visited-locations/:locationId` |
| GET | `/api/users/me/experiences/:id/visited-status` |
| POST | `/api/users/me/experiences/:experienceId/mark-all-locations` |
| DELETE | `/api/users/me/experiences/:experienceId/mark-all-locations` |
| GET | `/api/users/me/viewed-treasures/ids` |
| POST | `/api/users/me/viewed-treasures/:treasureId` |
| DELETE | `/api/users/me/viewed-treasures/:treasureId` |

One of these filters `admission` and the rest do not, and the split is the line in § Lifecycle
filtering rather than an oversight. `visited-status` describes an experience to a reader — its
points and how many of them they have reached — so it 404s for a refused row, like every by-id read
whose answer is the row. It is `requireAuth` only, no curator role and no scope, so before #503 any
authenticated account could read a refused row's points there. Everything else in this table is the
person's own record — what they visited, marking and unmarking it — and stays unfiltered whatever a
kind later decides about the building.

### Curator (`requireAuth + requireCurator`)

Every endpoint `frontend/src/api/curation.ts` calls answers through a schema in `backend/src/api/responses/curation.ts` (ADR-0066), and the web types each answer from it. Each one that can re-place the object after its commit reports the outcome in `PublishResult`'s words: `placementFailed` with the named `placementFailedWorldViews`, or neither, built once by `placementReport` (`controllers/experience/placementReport.ts`). The curation log's entries are typed and mapped key by key: `action` is the curation-log vocabulary, and `curator_name` is null for a curator with no display name.

| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/experiences` | Create manual experience. Required `kindId` (no default); the row is filed under that kind's own source, first by display order (#819). Optional `websiteUrl` and `wikipediaUrl` stored in `metadata.website` / `metadata.wikipediaUrl`, and the saved `imageUrl` has its `metadata.imageCredit` resolved and stored with it — resolved before the transaction opens, so a slow Commons never holds a lock |
| POST | `/api/experiences/:id/reject` | `{ regionId, reason? }` |
| POST | `/api/experiences/:id/unreject` | `{ regionId }` |
| POST | `/api/experiences/:id/assign` | `{ regionId }` |
| DELETE | `/api/experiences/:id/assign/:regionId` | Manual assignment removal |
| DELETE | `/api/experiences/:id/remove-from-region/:regionId` | Full removal (any assignment type). Keeps rejection as guard against spatial recompute |
| PATCH | `/api/experiences/:id/edit` | Editable fields (`name`, descriptions, `type`, `imageUrl`, `tags`, `websiteUrl`, `wikipediaUrl`). The last two are stored in `metadata.website` / `metadata.wikipediaUrl` via JSONB merge, and an `imageUrl` change writes `metadata.imageCredit` in the same statement — three per-key metadata claims in all. An empty string **clears** a field: the column is stored as `NULL` (`clearedToNull` — what every other writer stores for "nothing", and the catalogue holds no `''` in these columns), a metadata link as `null`, and the clearing is claimed like any other edit so the next run does not write the source's value back (#696) |
| GET | `/api/experiences/:id/curation-log` | Latest curation actions, filtered to the caller's curator scope (see Curation Guarantees) |
| GET | `/api/experiences/review/queue` | What a run could not decide: `missing` objects awaiting a verdict, `refused` rows a kind's rule turned down, `conflicts` where the source and a curator disagree, `arrivals` a gated source wrote that nobody has passed, `held` where an already-visible row is holding a newer proposal, `contents` where a visible row holds unread points or works of its own, and `withdrawn` where a point the source stopped offering is waiting on a verdict — plus three lists that are answered rather than waiting and appear on no other surface: `keptOut`, the confirmed refusals; `answeredWithdrawals`, the points a curator has decided about and which no reader can see as a result; and `refusedParts` (#859), the unread points and work links a curator turned down, each entry carrying `refused_points` / `refused_points_total` and `refused_works` / `refused_works_total`, capped and totalled the way the answered points are, with `refusedAt`, `refusedBy` and `note` — both read from the *act* rather than the row, so both are scoped by the log's own predicate — `missingSince` where the source has stopped offering the part since it was turned down, and, for a point, `visited`. The entry also carries `takeable` — the writer's own precondition (`contentsAnswerableSql`, evaluated by the database in both places rather than spelled twice), so a card never offers a take-back the endpoint would refuse — beside `object_admission` and `object_curation_state`, which choose *which* question to name first: an object nobody has passed is its arrival's, one a rule kept out is the refusal card's, one the source has dropped is `missing`'s. The seven are one list: `order` is the page as the keys phase chose it — one entry per question, `{ kind, id, askedAt, runId, subs }` — and the arrays beside it are a lookup by id rather than an order of their own. `total` is the whole queue under the filter and `facets` carries the counts each chip would leave (`kind`, `source`, `region` with an `Unplaced` bucket and a `worldView` beside each root, `run` with the batches this curator set aside flagged, and `setAside`). Every kind carries what the object *is* — `image_url`, `latitude`/`longitude`, `website_url` and `wikipedia_url` from `metadata`, `image_credit`, `region_names`, and how much it holds (`offered_locations`, `counted_works_total`) — through one shared fragment, so no card can show less about an object than its neighbour. `conflicts` additionally carry `run_completed_at` and, per proposed field, `claim` (who claimed it and when, read from the newest `edited` log entry under the *column* name) and `decidedBefore` (every earlier answer on that field, newest first — both `accepted_source` and `declined_source`, each entry carrying its `action`, since a refusal rendered as an acceptance is its own opposite). A `conflicts` entry lists the claimed fields that are still *open*: one whose current proposal matches a stored refusal is dropped, and an object with none left leaves the array. `refused` and `keptOut` additionally carry `counted_works` — the venue's famous works from `experience_treasures`, named, most widely known first, capped at twelve. The *array* is those two kinds only, because UNESCO sites hold no works and every other query would carry a join for an empty list; the total beside it is universal, which is what lets the capped array say how many it is not showing, and what a refusal naming one work rather than counting has to reconcile against. A `withdrawn` entry carries `withdrawn_points`, each with its `id` (the verdict is per point), `name`, `externalRef`, `missingSince`, coordinates, `curatedFields` — the fields a curator has claimed on the row, so the card can say a correction stands (#583) — `visited` — which is what makes the verdict matter rather than tidy-up — and `replacedMetres`: how far away the source now offers that same part, or `null` where it offers it nowhere. That last one is the field the card's whole sentence turns on, and the reason it is a distance rather than a flag is measured: the catalogue's first withdrawal has a replacement **1.2 cm** away, a coordinate rewritten at finer precision, which a flag would have called a move. An `answeredWithdrawals` entry carries `answered_points` instead — capped at `CONTENTS_ROWS_SHOWN` with `answered_points_total` beside it, newest answer first, because this is the one per-object list that only *grows*: a point enters when it is answered and leaves only if the verdict is taken back, so an object worked through over months would otherwise arrive as one card of hundreds of rows. Each entry carries the same `id`, `name`, `externalRef`, `missingSince` (nullable here, a run having possibly cleared the flag since), coordinates, `curatedFields` and `visited`, plus what makes it answered — both lifecycle axes, which are what the take-back's `expected` is built from and which decide how many ways back the card offers; `decidedAt` and `note` off the row; and `decidedBy`, read from the curation log under the log's own scope rather than off `state_decided_by`, so a verdict from a region this reader does not cover arrives unnamed rather than naming somebody the log endpoint would have dropped. No `replacedMetres`: that field tells a rewritten coordinate from a component that really moved, which is the question this list is not re-asking. A `contents` entry carries the rows themselves rather than only their counts: `pending_points`, each with `id`, `name`, `externalRef`, coordinates and `curatedFields`, and `pending_works`, each with `id`, `name`, `artists`, `artistsCurated`, `year`, `imageUrl`, `imageCredit`, `treasureType`, `iconic`, `externalId` (the work's Wikidata item, which the row opens the item and its article from), `curatedFields` — the same thing the points carry, in the work's own key, so the row can say a correction stands (#731) — and `venueCount`, how many museums hang the work, which the dialog the row opens states before Save, most widely known first — both capped at `CONTENTS_ROWS_SHOWN` (25, the page size), with the two counts beside them as the totals, so a card that is showing twelve of ninety-three can say so instead of implying twelve is all there is. Params `q` (a name, at most 100 characters), `source` (`1,3`), `kind` (`arrival,refused` — the five kinds and the three waiting sub-kinds; a word the vocabulary does not know is dropped rather than refused, because the filter set is an address), `region` (an id, or `none` for the unplaced), `run`, `aside=show`, `sort` (`date` \| `question`), `cursor`, `limit` (default 25, 100 at most), and `keptOutOffset` / `answeredWithdrawalsOffset` / `refusedPartsOffset`. `paging` carries `{ cursor, nextCursor, keptOut, answeredWithdrawals, refusedParts }`: one keyset cursor for the seven kinds, and the three offsets for the three lists that are not open questions ([ADR-0051](../decisions/0051-the-review-queue-is-one-list-of-dated-questions.md)). The answer is `ReviewQueue` (`backend/src/api/responses/reviewQueue.ts`, ADR-0066), and every card is built by `queueItemOf` (`reviewQueueItem.ts`), which writes the keys the schema names and nothing else a query selects. A proposal's fields are the stored changeset's, copied key by key, so a key a writer once leaked into the record — `protectedByClaim`, stored until 2026-08-31 — is not served. Scoped like the curation log — `CURATOR_SCOPED_REGIONS_CTE` in every branch of the keys union as well as in every statement that draws a card |
| PUT | `/api/experiences/review/set-aside/:syncLogId` | No body. Puts a run's whole batch of open questions aside, for this curator alone ([ADR-0051](../decisions/0051-the-review-queue-is-one-list-of-dated-questions.md) decision 4) — one row in `curator_queue_set_aside`, whose `user_id` is taken from the token and never from the request, answering `{ syncLogId, setAside: true }` (`RunSetAside`, ADR-0066). `ON CONFLICT DO NOTHING`, so a second press answers what the first one did: the response states the state the caller asked for rather than whether a row moved. A run that does not exist and a **dry** run — which writes no changeset and so raises no question to put aside — are both 404, indistinguishably, rather than a second error shape for a run that was never a batch. Carries `authenticatedLimiter` |
| DELETE | `/api/experiences/review/set-aside/:syncLogId` | No body. Brings the batch back — `{ syncLogId, setAside: false }` whether or not a row was there, because the caller is asking for a state and not for a deletion: a 404 for a batch already brought back would make the chip a one-shot. Carries `authenticatedLimiter` |
| POST | `/api/experiences/:id/state` | `{ membership?: 'present' \| 'former', existence?: 'extant' \| 'lost', note?, expected: { membership, existence, flagged } }` — a verdict on one or both axes; at least one required. `expected` is **not** optional: it is the row as the caller saw it, compared under the write lock, and without it the server cannot tell a stale view from a deliberate correction |
| POST | `/api/experiences/locations/:locationId/state` | The same body, about one point inside the object (ADR-0026). Answers whether a point the source stopped offering is delisted, gone, or was never gone. Three things differ from the object-level verdict. Scope: a point carries none of its own, so the id is resolved to its containing experience server-side and `resolveExperienceScope` is asked about that. `missing_since`: only the false alarm (`present` + `extant`) clears it, because on a location that column is *one of the two terms* a reader-facing read carries (ADR-0026 decision 7), and each verdict is held by a different one — `former` by the flag, which is why clearing it would put back a pin for a place the source no longer lists; `lost` by its own axis, whatever the flag says, which is what makes that verdict outlive a run and also makes it the one answer here that can hide a point readers could see. Leaving the flag standing is what takes an answered row out of the queue without any read learning a filter for the queue's sake. A source that lists the point again takes the delisting back, in one direction only and wherever that point is — every arm of the writer that matches an offered row writes `source_membership = 'present'`, the one that gives a withdrawn point its place back and the one that keeps a point never withdrawn, and the fast path counts a delisted-but-listed row as unmatched so one of them is reached at all (ADR-0026 decision 6). Never the reverse, as the experience upsert has it (ADR-0021); `existence` is untouched, because a listing says nothing about whether the thing still stands. Without that the point would come back visible while recorded as delisted, and its next departure would raise no card at all, since the queue reads the axes as "nobody has answered". The one answer with no transition to name is the false alarm, and it is the *only* one: re-sending a verdict a row already carries answers 409 rather than writing a dismissal into the trail beside a flag nothing dismissed. And the audit row hangs off the *experience*, with the point named in `details.locationId`, so a serial site's seven components cannot record seven indistinguishable verdicts. The response says `offeredToReaders`, rather than leaving a client to infer visibility from two axes — and, where the answer changed what a reader sees and re-placing the point failed, `placementFailed`/`placementFailedWorldViews`, named as the sibling endpoints name them: a verdict is a placement event in either direction, because a withdrawn point holds no `auto` region rows and a `lost` one must hold none, so a curator has to be told when the regions are out of date. Needs migration 024 applied, or the audit insert violates the `action` CHECK and the whole call 500s |
| PATCH | `/api/experiences/locations/:locationId/edit` | `{ name?, latitude?, longitude? }` — a curator's *correction* to one point, as against the verdict above about its standing. The coordinate arrives as a pair or not at all: half a move is not a place, and on a single-point object it is where the object itself would go. Each value written also writes a claim on that column (`experience_locations.curated_fields`, migration 027), which is what makes the correction survive the next run — every arm of `locationWriter` otherwise writes the source's name and coordinate over whatever is stored. The claim set is re-read under the write lock and *added to*; the one path that takes a key back off a point's claims is `accept-source` on the object's `location`, which releases the coordinate on the point and the object together, since the two are one fact and releasing half of it puts the object's coordinate on the source's pin and its only visible point on the curator's (ADR-0029 § Consequences); and `external_ref` and `ordinal` are never claimable, because the pairing reads both to decide whether a point moved or was replaced. **The object's anchor follows the point where the object holds exactly one point a reader is positioned over — offered, published, and this one**, claimed there too: ADR-0028 positions a reader at the place nearest the object's own coordinate, so with one place the reader already follows the edit while the object's published coordinate stays behind — the disagreement #550 is about, 106 objects and 191 km at its worst. Both the count and the edited row's own membership are inside the statement's own `WHERE` rather than a read before it: a second point arriving in between cannot leave the anchor moved for a reason that stopped being true, and counting the visible points without asking whether *this* is one of them would move the object onto a coordinate no reader is ever sent to — by correcting a withdrawn, `lost` or unread sibling. A gated arrival's only point is `pending`, so correcting it moves nothing until publication, which is the same rule read consistently rather than an omission. Scope is resolved through the containing experience, as the verdict above does. A move re-places the experience into regions after the commit — answering `placementFailed`/`placementFailedWorldViews` where that failed, as the sibling `/state` route does and for the same reason: the remedy is admin-only, so a curator has to be told which world view is out of date rather than that something is. A rename places nothing, since region rows are computed from coordinates. Records `location_edited` naming both sides of what changed and whether the anchor moved — needs migration 028, or the audit insert violates the `action` CHECK and the whole call 500s. **Its screen is one dialog, offered wherever a curator is looking at a place** (#583): `PointPreviewDialog` (`components/shared/`) opens on `PointCorrection` wherever a caller offers a correction — the map already on the place, the source's own position left as a faded pin, the pin draggable, Save asleep until something changed — and the form sends only what changed and reads the outcome off the reply — `anchorMoved` is never promised, since a pending or withdrawn place moves nothing whatever the count. It opens from every row that shows a place: the review page's unread points, held location parts, withdrawn and answered points; `CurationPlaces` on the object screen, which is the only row a single-place object's place has anywhere (1178 of 1671 objects, every museum and monument among them); and a place's row on an open card in Map mode and in Discover. A corrected row says so through `claimLabel` (`utils/placeClaims.ts`) off the `curated_fields` every one of those reads now carries. The take-back is not on this screen: `accept-source` needs a live conflict proposal and is offered where one exists, the conflict card |
| PATCH | `/api/experiences/:id/works/:treasureId/edit` | `{ name?, artists?, year?, imageUrl? }` — `''` for `imageUrl` takes the picture off and its credit with it — a curator's correction to one work, the same act the point's route above is for and the answer the gate has no button for: its two are "take the source's" and "keep what is here", and neither says *this instead*. The museum is in the path because a work hangs in more than one and carries no scope of its own; the link is what proves it hangs in this one, and its absence is a 404 rather than a 403 — the caller may well curate this museum, it simply holds no such work. Scope is resolved through that museum, the object is locked before the work (`OBJECT_LOCK`), and each value written also writes a claim on its column (`treasures.curated_fields`), which is what makes the correction survive the next run. The claim set is re-read under the write lock and added to. An **empty** `artists` is a value a curator can mean — *Salvator Mundi* reading "Leonardeschi" is worse than reading nothing — so it is not folded into absence, and the statement carries a boolean per column saying which of the two the request was. Sending `artists` *unchanged* is also a request, and the common one: the stored order is a query planner's (ADR-0040), so claiming the column is usually a curator vouching for an order that was already right, which is what `work-makers-unconfirmed` counts. `year`'s floor is −200000, a bound the stored rows set rather than a guess about art history — −4000 refused nine works the museum run had already written, the oldest the Lion man of the Hohlenstein Stadel at 38000 BC in Museum Ulm, and a curator cannot be refused a value the screen is showing them (#731). `imageUrl` **is** writable, and only because the credit is written with it (ADR-0049, narrowing ADR-0040 decision 6): `creditForOneImage` resolves the photographer from Commons *before* the transaction opens — a lock held across somebody else's server is held for as long as they take — and `image_url` and `metadata.imageCredit` move in one statement, so no row holds one photograph under another photographer's name (ADR-0043). `''` takes the picture off and drops the credit with it. One claim, not two: `treasureWriter` keeps the row's own `metadata` whenever `image_url` is claimed, so a credit key would be one nothing reads. The reach is ADR-0025 decision 2's rather than this endpoint's — a work is passed once, globally, so the row a correction changes is the row every museum holding the work carries, and the screen says so before Save from the `venue_count` its rows carry. That count is of museums the work *hangs* in and deliberately not of museums a reader can reach today: a refused or still-gated museum holds the work all the same and carries the corrected row the moment it is shown, so `venueCountSql` applies the withdrawn-link term alone and its docblock says why. Records `work_edited` naming only the fields the edit touched, under their column names — needs migration 040, or the audit insert violates the `action` CHECK and the whole call 500s. **Its screen is one dialog, offered wherever a curator is looking at a work** (#731): `WorkPreviewDialog` (`components/shared/`) opens on `WorkCorrection` — the makers as rows to drag or step through with arrows (`MakerList`), the year as digits plus AD/BC (`YearField`), the picture with the credit that belongs to the file that is stored, and Save asleep until something changed. It opens from the works waiting to publish on the review page, from a held work part (`PartPreviewDialog`), and from a work's row on an open card in Map mode (`ArtworksList`) and in Discover (`ContentTile`). A corrected row says so through `claimLabel` (`utils/workClaims.ts`) off the `curated_fields` those reads now carry |
| POST | `/api/experiences/:id/admission` | `{ decision: 'confirm' \| 'override', note? }` — answer a refusal. `confirm` keeps the row refused and hidden — and drops its Iconic flag through the same fragment the run's refusal writes use, since the pin written here is what keeps every later run off the row (#760) — while `override` admits it again and leaves the flag where the refusal put it. Both pin `admission` in `curated_fields`, which is what takes the card out of the queue and what stops a later run reversing either answer; no `expected` block is needed, because a second curator collides with that answer — the pin, or a batch's `admission_answered_at` (ADR-0067) — and gets 409. `override` on a row that was `pending` also publishes it, in the same transaction (ADR-0025 § 4.5) — `curation_state = 'verified'`, `published_at = COALESCE(published_at, NOW())` — because that verdict is the only thing that ever un-hides an arrival nobody had read; `override` on an `auto` row and `confirm` on any row never publish. The response's `published` field says which happened. See § Publishing for the mechanism and why it does not place |
| POST | `/api/experiences/:id/accept-source` | `{ fields: string[], expectedSyncLogId }` — apply the values that run proposed for those fields and release the curator's claim on them. `expectedSyncLogId` is required: a newer proposal is refused rather than substituted. Also deletes any standing refusal of those fields, since a refusal belongs to the claim being released. Accepting `imageUrl` releases `metadata.imageCredit` with it, drops the stored key, and **says so where there was one** — `releasedCredit` in the response, in the `accepted_source` audit row, and as a clause in the curator's confirmation line. The deletion is unconditional and the report is not: an edit that could not resolve a credit stores the key as `null`, and announcing that as a removal would name something nobody could see. Reported on the same footing as the released pin and for the same reason: the value deleted is the curator's own and the card they answered never mentioned a photographer. It does so for the reason the coordinate below gives: the two were written in one transaction and mean one thing, and releasing half would leave the source's photograph credited to the curator's photographer — permanently, since the per-key re-apply would put that name back on every later run. Accepting `location` releases the claim on **the point the anchor was taken from** as well, and answers `releasedPoints` naming it: the object's coordinate and that point's are the same fact (ADR-0028), the only path that claims `location` on an experience is `/locations/:locationId/edit`, which claims both together, and releasing one of them alone would have the next run write the source's coordinate to the object while the pin a curator corrected stays where they put it — #550, made by the two endpoints written to close it. That point is matched by its coordinate rather than by re-deriving the anchor rule, and the difference is not academic: an object that gains a second published point and has *it* corrected carries a claim the anchor never came from, and a release written as "every claiming point" would undo that correction in answer to a card about the anchor. Each released point is also **put back on the coordinate that run offered for it**, and those are answered as `movedPoints`: the pairing bounds a point's identity by the reference *and* ten metres, and the claim was the only thing letting a corrected row pair at any distance, so releasing alone would have the run retire the row and insert the source's point beside it — a `withdrawn` card for a component nobody delisted, with the visit record left on a pin no reader is shown. The coordinate is the source's own for that row, read from the same run's contents record; where that run offered none, nothing is written. A moved pin re-places the experience after the commit and answers `placementFailed`/`placementFailedWorldViews` where that failed — which is also why the route is rate-limited (`authenticatedLimiter`), like every other curator route whose work outlives its transaction. The object's own coordinate is not written here and follows at the next run, since `location` is not an acceptable field |
| POST | `/api/experiences/:id/decline-source` | `{ fields: string[], expectedSyncLogId }` — the opposite answer to the same card: record that the curator stands by the stored value, so the queue stops asking. Writes nothing to the experience — the stored value has already won every run since the disagreement began. The refused **value** is read from the locked proposal, never from the request, because the queue suppresses by comparing it against what the source proposes now. Every field is refusable, including the ones `accept-source` cannot write. Needs migration 022 applied, or the audit insert violates the `action` CHECK and the whole call 500s |
| POST | `/api/experiences/:id/decline-held` | `{ fields?: string[], parts?: [{ kind, ref, name, fields }], expectedSyncLogId }` — the other answer to a held row (#722, [ADR-0038](../decisions/0038-a-held-proposal-is-answered-per-field.md)): the curator says "not this" to what a gated run proposed, without claiming the field. At least one row, named as the queue named it — the object's own field by name, a part by the kind and the reference and name the record carries, since the record names a part and never identifies it (ADR-0026 decision 4). `expectedSyncLogId` is required — unconditionally here, where publishing requires it only once a held selection is named (#722), because every call to this endpoint answers a held card and a held card always names the run whose proposal it shows. It is compared under the write lock against `pending_change_sync_log_id` and refused rather than substituted. Writes nothing to the experience or its parts — the stored value has already won every run since the gate first held this one — and nothing to `curated_fields`, which is the whole difference from the lever it replaces (edit the field, which claims it, then publish, which skips it). What it writes is the answer, into `experience_held_decisions`, storing **the value**: the queue suppresses the row only while the proposal is jsonb-equal to it, so a source that changes its mind is heard. The pointer is cleared only when nothing on the card is left open. Answers 409 on a stale run, on a proposal the pointer no longer names, and on a row nothing is waiting on. Needs migration 039 applied, or the audit insert violates the `action` CHECK and the whole call 500s |
| POST | `/api/experiences/:id/publish` | `{ contentsOnly?: true, fieldsOnly?: true, locationIds?: number[], treasureIds?: number[], heldFields?: string[], heldParts?: [{ kind, ref, name, fields }], expectedSyncLogId? }` — say that a reader may see this (ADR-0025). An empty body publishes the object: any held content fields, `curation_state = 'verified'`, `published_at` if the row was `pending`, the pointer cleared, and every unread point and work it holds. `contentsOnly: true` or naming either array is a contents publish, leaving the experience's own state alone — `contentsOnly` for every pending content row, naming an array for exactly those rows. `fieldsOnly: true` is the mirror and closes the first half of #524: it applies what the run proposed for the object's own fields and leaves every unread point and work where it is, so a curator doubting one proposed sentence no longer holds back twelve checked paintings by answering it. It is exclusive with all three contents shapes, since a body naming both halves is asking for the object publish it could have asked for by naming nothing. The trail records which of the three this was — `scope`, one of `object`, `contents` or `fields` — because the numbers cannot say: an object publish over a row holding no unread contents writes the same zeros as a fields-only one. All five are explicit rather than inferred, and the `.refine`s make the alternatives among them exclusive — `fieldsOnly` beside a held selection is deliberately *not* refused, since the selection is already the fields half and restating it has one reading rather than two: leaving everything absent used to be read as "the object", full stop, and a card with no ids to send had no other way to ask for its contents alone. `expectedSyncLogId` is the run the caller's card named, compared under the write lock against `pending_change_sync_log_id`, and only when the call will actually write a held field or the caller named a run at all — a pointer whose one held field is already claimed writes nothing and answers success rather than 409 forever. It may not accompany a contents publish, named or bare, and it is **required** whenever `heldFields` or `heldParts` is named: a per-row answer names the run it answers, so a selection sent without one is a 400 rather than a selection applied against whatever the object happens to hold now. `heldFields`/`heldParts` narrow the fields publish the way the id arrays narrow the contents one (#722): those rows are written, the rest stay open, and what stays open is what keeps the pointer — so publishing one of six leaves the card standing with the other five rather than clearing them unanswered. Naming either makes the call a fields publish, so it is exclusive with the contents shapes and refused on a `pending` row; a selection reaching no open row answers 409. A field the curator claims in `curated_fields` is skipped rather than refused; a row its kind refused answers 409, because admission is asked first (ADR-0025 decision 4) and `override` on the refusal is what publishes it; a point the source has withdrawn is never published, matching the `contents` card. Needs migration 019 applied, or the audit insert violates the `action` CHECK and the whole call 500s. See § Publishing for what it writes and why it does not place |
| POST | `/api/experiences/sources/:sourceId/publish-waiting` | no body — release everything this source is holding: every unread object as an object publish, every visible object holding unread contents as a contents publish. One transaction and one `published` log row per object. Held field proposals are deliberately left for their own cards. Answers `published[]` (each object with `locationsPublished`, `treasureLinksPublished`/`treasuresPublished` — both axes, since a work passed in one venue and unread in another moves the link and not the row — `withdrawalsReleased`, and with `placementFailed`/`placementFailedWorldViews` where re-placing failed), `refused[]`, `outOfScope` and `heldLeftForReview` — `null` where the count itself failed after the publications had committed — all scoped to the caller. Rate-limited (`authenticatedLimiter`) |
| POST | `/api/experiences/:id/refuse-arrival` | `{ note? }` — a curator's no to an arrival (#852, [ADR-0053](../decisions/0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md)), written the way a rule's refusal is: `admission = 'refused'`, `admission_reason = 'kept out by a curator'`, the admission pin and the badge cleared, on the membership, under the place's lock; `curation_state` stays `pending`, since nobody passed it. The row leaves the queue for the kept-out list and *Put it back* (`/:id/admission` `override`) publishes it as it always has. Open arrivals only — a rule-refused, passed or withdrawn row is 409 with the reason. Log action `arrival_refused`. Exempt from rate limiting on the verified check: nothing after `client.release()` |
| POST | `/api/experiences/:id/refuse-contents` | `{ locationIds?, treasureIds?, note? }` — a curator's no to the unread points and works under a visible object, the named ones or all of them: `refused_at = NOW()` on exactly the rows the contents card shows (the same two fragments the card, the count and the publish read), on the *link* for a work rather than the work, so it stays askable at every other venue. A refused part keeps `curation_state = 'pending'` — every reader hides it by the word it already reads — and stops being asked about; a later whole-object publish does not release it. A refused point releases the withdrawal it may have been holding — a moved point's old row, kept on the map until the arrival was answered — through the two statements the publish uses, so the old point asks its own `withdrawn` question rather than standing for ever; answered as `withdrawalsReleased`, and any refusal that reached a point re-places the object after the commit as the publish re-places it — placement's insert carries `refused_at IS NULL`, so a refused point counts toward no region any more (`placementFailed` / `placementFailedWorldViews` where that failed). A `pending` object is 409 and sent to its arrival's card; nothing reached is 409 rather than an empty 200. Log action `contents_refused`, with the counts and the named ids. Carries `authenticatedLimiter` for that placement branch |
| POST | `/api/experiences/:id/unrefuse-contents` | `{ locationIds?, treasureIds?, note? }` — the way back from the row above (#859, closing [ADR-0053](../decisions/0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md)'s own recorded trade-off, *a refused part has no screen yet*): `refused_at = NULL` on the marked points and work links under the object — the named ones or all of them — under the place's lock, with the refusal's preconditions and its 409s — spelled once as `contentsAnswerableSql` and evaluated by the database, so the list that draws the button asks the same question this does — and nothing else written. The question comes back and no reader moves: the part was hidden before the refusal and is hidden still, and publishing it is what shows it. A link keeps `curation_state = 'pending'`, since that word says nobody passed the work *here* and `auto` would silently pass what a curator turned down; a withdrawal the refusal released is **not** re-acquired, the old pin being a withdrawn point with a card and two answers of its own now (ADR-0026) — the take-back restores the question, never the pairing. A restored point counts toward its regions again, so the object is re-placed after the commit (`placementFailed` / `placementFailedWorldViews` where that failed), which is why the route carries `authenticatedLimiter`. Nothing turned down left to reach is 409 rather than an empty 200. Log action `contents_unrefused`, naming the ids the statements returned — always, where the refusal names them only when its caller did |
| POST | `/api/experiences/review/answer` | `{ rows: [{ kind, id, runId }] (1–100), answer: 'accept' \| 'reject' \| 'lost' }` — one answer to a page of review rows (#852). `kind` is the queue's own word (`conflict`, `waiting`, `withdrawn`, `refused`, `missing`), `runId` the run the curator saw the question asked by, which the held and conflict writers compare with the pointer under the lock. Each row goes to the `*UnderLock` writer its single-row card calls — `reviewAnswerDispatch.ts` is the table of what each answer does per kind, and a `waiting` row's sub-kinds are read from the membership rather than trusted from the client; `lost` is refused on any row but `missing` and `withdrawn` (every open point of the row, each through the point writer). On a `refused` row *accept* keeps the row out (`confirm`) and *reject* puts it back (`override`), and neither pins `admission` (ADR-0067): a batch confirmation closes the question with `admission_answered_at`, a batch put-back is admitted until the next run applies the rule again, and only the refusal card's own answer claims `admission`. Scope per object; one transaction and one audit row per object; a row that refuses, throws or is out of scope is one line in the report and the rest are answered. Answers `ReviewAnswerResult` (ADR-0066): `{ answer, answered: [{ kind, id, name, answer, did }], refused: [{ kind, id, name, error }], outOfScope, placementFailed: [{ id, name, worldViews }] }`, where `did` counts what the answer did (`published`, `locations`, `treasureLinks`, `treasures`, `withdrawalsReleased`, `fields` — the parts' rows counted with the object's — `points`, `pointsRefused`). Carries `authenticatedLimiter`: up to a hundred publishes, and a verdict on a withdrawn row re-places the object once per point |
| POST | `/api/experiences/new-badges/seen` | `{ experienceIds: number[] }` — records that these chips were shown to the caller. Rate-limited (`authenticatedLimiter`), unlike the curator routes beside it: this is an ordinary authenticated action and the only one here a client sends on its own initiative. Only the first impression per experience is kept; a stale id is ignored rather than failing the call, and the response names what was actually recorded |

### Geocoding (public + admin)

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/geocode/search` | Nominatim proxy. Params: `q`, `limit` (default 5). Rate-limited 1 req/sec. Answers `PlaceSearch` (ADR-0066): `{ results }`, each with its point as numbers and the `wikidataId` from Nominatim's extratags, `null` where OpenStreetMap links no item |
| POST | `/api/geocode/ai` | AI geocoding (curator/admin). Body: `{ description }`. Answers `AIGeocodeResult`: `{ lat, lng, name, confidence }`, read out of the model's JSON key by key. A point off the globe is a 500, a missing name is the curator's own description, and a confidence outside `high`, `medium` and `low` is `low` |
| GET | `/api/geocode/suggest-image` | Wikidata image suggestion (curator/admin). Params: `name`, `lat`, `lng`, `wikidataId` (at least one required). Layered lookup: direct QID → SPARQL spatial → name search. Answers `ImageSuggestion`: `{ imageUrl, source, entityLabel, wikidataId, wikipediaUrl?, description? }`, or 404 when no layer finds a picture. `wikipediaUrl` is extracted from Wikidata entity sitelinks (enwiki) |

### Admin (`/api/admin`, admin-only)

| Method | Endpoint |
|--------|----------|
| GET | `/api/admin/sync/sources` |
| PUT | `/api/admin/sync/sources/reorder` |
| POST | `/api/admin/sync/sources/:sourceId/start` |
| GET | `/api/admin/sync/sources/:sourceId/status` |
| POST | `/api/admin/sync/sources/:sourceId/cancel` |
| PUT | `/api/admin/sync/sources/:sourceId/curation-gate` |
| PUT | `/api/admin/sync/sources/:sourceId/line` — `{ enterSitelinks, staySitelinks, findEnterSitelinks?, findStaySitelinks? }`, the world tier's fame line on the source row (ADR-0052). Whole numbers 1 to 1000, stay no higher than enter; the next run reads it. A source whose finds are thinner than its places states the second pair too (ADR-0058 decision 5) — both find keys or neither, bounded the same way; only the keys the body carries are written, so a body without them leaves a stored finds line alone. A source whose `api_config` states no line is refused 409 rather than gaining one no run was told to read |
| GET | `/api/admin/sync/sources/:sourceId/cache` — what this source keeps: per kind, its entries, age, next expiry, size and lifetime (ADR-0030) |
| DELETE | `/api/admin/sync/sources/:sourceId/cache` — clears one kind (`?kind=`) or all of them; the next run asks the source again |
| PUT | `/api/admin/sync/sources/:sourceId/cache/:kind/ttl` — `{ hours }`, bounded a minute to a month. Re-stamps what is already kept from each answer's own `fetched_at`, and answers how many were re-dated. A kind the source does not declare is refused 400 rather than written as a policy nothing reads |
| POST | `/api/admin/sync/sources/:sourceId/fix-images` |
| GET | `/api/admin/sync/logs` |
| GET | `/api/admin/sync/logs/:logId` |
| GET | `/api/admin/sync/logs/:logId/changes` |
| POST | `/api/admin/experiences/assign-regions` — answers `AssignmentStarted` |
| GET | `/api/admin/experiences/assign-regions/status` — answers `AssignmentStatus`: `running` alone while no run is known since the server started |
| POST | `/api/admin/experiences/assign-regions/cancel` — answers `AssignmentCancelled` |
| GET | `/api/admin/experiences/counts-by-region` — answers `PlacementCounts`, the regions holding at least one experience, most first |
| GET | `/api/admin/curators` — answers `Curators` (`authentication.md` § Administrators in the curator directory) |
| POST | `/api/admin/curators` — answers `CuratorAssignmentCreated` |
| DELETE | `/api/admin/curators/:assignmentId` — answers `CuratorAssignmentRevoked` |
| GET | `/api/admin/curators/:userId/activity` — answers `CuratorActivity`, each entry mapped key by key |
| GET | `/api/admin/users/search` — answers `UserSearchResults`, up to twenty accounts |

Every row above answers through a schema in `backend/src/api/responses/admin.ts` (ADR-0066), and so do Catalogue Checks' (`docs/tech/data-assertions.md` § Where it sits). The sync screens' answers are mapped key by key in `controllers/admin/syncAnswerRows.ts`:

- **A source** (`ExperienceSource`) carries its gate, its fame lines, `waiting` (null where the counts failed) and whether it `caches` and `repairsPictures`.
- **A run's status** (`SyncStatus`) is the in-memory run's figures, or `running: false` with `lastSyncAt` and `lastSyncStatus` from the source row when no run is known since the server started.
- **A run's log** (`SyncLog`) reads its counters through `COALESCE(…, 0)` in `SYNC_LOG_COLUMNS_SQL`, the one column list both log reads select. The columns are nullable, but every writer sets them and they default to 0. The detail read (`SyncLogDetail`) adds `error_details`, each entry read as its `externalId` and `error`.
- **What a run did** (`SyncChange`) carries its bigint `id` as a string. The stored `changed_fields` and `contents` are read out one key at a time: a field through `changedFieldOf` (`controllers/experience/reviewQueueItem.ts`), the review queue's reader, and a contents item as its `name` and `ref`.
- **A backlog released** (`PublishWaitingResult`, row `publish-waiting` above) holds each published object's `placementFailed` pair to the rule `PublishResult` is held to, `placementTogether` (`backend/src/api/placementTogether.ts`).

### Field limits

What a curator edits or creates is bounded by the column it is stored in, not
by a number chosen at the API — the rule and its reasoning are in
`world-views.md` § "Field limits":

| Field | Limit | Column |
|-------|-------|--------|
| Experience name | 500 | `experiences.name`, and `experience_locations.name` for the location created with it |
| Type | 100 | `experiences.type` — the type within the kind, from the kind's own vocabulary |
| Image URL | 1000 | `experiences.image_url` |
| Country code | 10 | one element of `experiences.country_codes` |
| Country name | 255 | one element of `experiences.country_names` |

Short description, description, tags, and the website and Wikipedia URLs are
not on this list: the first three are `TEXT`/`JSONB` columns and the last two
live inside the `metadata` JSONB, so none of them has a width to align with.
Every entry above reads its width from `COLUMN_WIDTHS` in
`backend/src/db/schema.generated.ts`, generated from the schema (ADR-0064).

A name — a place's, a point's, a work's title and each of its makers — is
tidied before it is bounded (`storedName`, the schemas' spelling of
`tidyLabel`): edges trimmed, a run of whitespace inside collapsed to one space,
so a title of nothing but spaces is refused as empty rather than stored, the
width is measured on what the row will hold, and what `validate()` puts back on
the request is that form. The correction dialogs compare what was typed with
what is stored by the same rule before deciding whether to send a name, so a
title pasted with two spaces over a stored one with one claims nothing
(`backend/src/types/storedName.test.ts`).

### What a URL field may hold

`imageUrl`, `websiteUrl` and `wikipediaUrl` are held to a shape as well as a
width, and the shape is decided by the URL parser rather than by a pattern over
the string: a link must be an absolute `http(s)` URL, and a picture must be a
Wikimedia Commons picture file or an `/images/…` path on our own origin, for a
file we host ourselves (ADR-0043 — `isDisplayablePictureUrl`; a run is held to
the narrower `isCommonsPictureUrl`, since no run writes a path of ours). The rule
is declared once, in `backend/src/types/urlSafety.ts`, and
read from there by both the request schema and the curation controller, wording
of the refusal included. The value is trimmed, judged, and then **stored in the
form the parser read** rather than the form it arrived in — `HTTPS://…` becomes
`https://…`, an interior tab is dropped — because the check that draws the
picture tests `startsWith('https://')` and would otherwise refuse a value this
one accepted, saving a picture that never appears. A path on our own origin is
stored untouched. The width is measured last, on the stored form: percent-encoding
can only make a url longer, and the column is what has to hold it.

It is an allowlist because the denylist it replaced leaked twice. A URL parser
drops leading whitespace, and ASCII tab, LF and CR from anywhere in the value,
before it decides what the scheme is — so `" javascript:…"` and
`"java<tab>script:…"` are both `javascript:` URLs that a pattern over the raw
string does not see. The two copies of that pattern, one in the schema and one
in the controller, disagreed about which of them trimmed, which is how a scheme
behind a single space reached `experiences.image_url` (#693).

The rule binds what a **curator** sends. A sync writes these columns directly,
through no request schema, and the rows already in the database predate the
rule — which is why the picture is checked again where it is drawn
(`frontend/src/utils/imageUrl.ts`, #692), and why that check is not a duplicate
of this one.

The other stored picture, a region's imported map, is held to the link form of
the same rule on both sides — an absolute `http(s)` URL and nothing else, since
no map is a path on our own origin — see
[world-view-import.md](world-view-import.md) § "JSON Tree Validation" (#694).
A region's source page is held to it on the way **out** as well, offered only
through `safeHref` (`frontend/src/utils/safeHref.ts`) — the same function a
picture credit's licence link already asked (#703). `websiteUrl` and
`wikipediaUrl` are not yet: the surfaces that link them — the expanded list card, Discover's
detail panel and the review page's `ObjectContext` — take the stored
value as it is, which is what #708 is for.

## The "New" chip

`is_new` is decided server-side and means **the reader could first see it recently** — not
"recently created", and no longer "arrived in the latest run". All three mark a first
appearance, of different things. `created_at` is when the row entered *this database*, which
for a bulk-loaded source is one instant for thousands of objects that entered the source
years apart; the client-side `isNewExperience(created_at)` this replaced measured that while
the chip claimed to mean arrival.

**Why the anchor moved from the run to publication (#529).** Under a gated source, arriving and
becoming visible are different moments, and the gap is a curator's working week. An arrival is
invisible until someone passes it, so a chip keyed to the run that found it failed in the
ordinary case rather than an exotic one: a museum arrives Monday, Art Museums runs again
Wednesday, the curator answers Thursday — and by then the arrival's own run is not the latest,
so the chip never appeared for anyone. With no intervening run it was no better: the window was
counted from the run's completion, so it was being spent while nobody could see the row.
`published_at` is when a reader could first see it, which is the only moment "new" can honestly
mean once a gate exists. It is the membership's since #822 — a place becomes visible *in a kind* —
and the window is the membership's source's, so both are read through the membership.

```text
is_new = some membership's published_at IS NOT NULL
         AND ( that published_at inside its source's new_badge_days
               OR this reader first saw the chip < 7 days ago )
```

The two clauses are a **maximum, not a choice**. The source's window is the floor everyone gets
— sources have different cadences, so it is per source — and a reader who arrives near its end
keeps the chip a week from their own first sighting rather than losing it the next day. Anonymous
readers get the first clause alone; there is nobody to have shown it to, and `v.user_id = NULL`
is never true, so the personal clause drops out without needing a second query.

**Two clauses were removed with the old anchor, and both removals are deliberate.** The
`EXISTS … change_type = 'created'` proof of a sighting existed only because migration 009
backfilled `first_seen_sync_log_id` to the newest run of each source, so the column alone
credited every row to a run that never inserted them; `published_at` is never
backfilled — migration 018 left every row but one NULL on purpose — so a publication needs no
proof. And the latest-completed-run bound existed to stop chips accumulating, which the window
already does; under piecemeal approval "the newest batch" has stopped being a unit, because a
curator answers eighteen arrivals across a week and no run divides them.

**Two consequences, stated here rather than discovered later.** Chips no longer clear when a
source next runs — each lasts its own full window, so a weekly source shows roughly four
windows' worth at once instead of one batch. And everything published before the gate existed
wears no chip at all, because `published_at` is NULL for it: the column starts meaning something
from the first publication forward. Nothing re-inserts a whole source any more — force sync is
gone — so no single act can chip a whole source, which is the property the removed bound was
protecting. No retention job is needed for `user_new_badge_views` either: the personal clause is
bounded by its own seven days.

Both clauses are correlated subqueries, so they run once per output row — 5000 of them on a
whole-region read. Each is now a primary-key lookup rather than a sorted scan: the window clause
reads `experience_sources` by `id` for `new_badge_days`, and the personal clause hits
`user_new_badge_views` by `(user_id, experience_id)`. The `published_at` comparison itself is on
the row already being returned.

`idx_experience_sync_logs_latest` (`source_id, completed_at DESC, id DESC`) was built for the
predicate this replaced, and `isNewSql` no longer reads `experience_sync_logs` at all — `grep -rn
"completed_at DESC" backend/src` returns nothing. Whether the index earns its keep for other
queries is a separate question; what matters here is that the chip is no longer the reason it
exists, so nothing about the chip should be read from it.

The `completed_at`-versus-id warning that used to live here went with the clause it was about: a
run that starts earlier can finish later, so ordering runs by id could name a months-old run as
the latest and switch every chip in a source off at once. Nothing in the predicate orders runs
any more, which is why that trap is gone rather than fixed.

**Impressions** arrive by `POST /api/experiences/new-badges/seen` rather than as a side effect
of the read that produced the chips: a GET that writes is a GET that lies about being
repeatable, and a timestamp set by a prefetch, a crawler or a warmed cache is not an
impression. `ON CONFLICT DO NOTHING`, so only the first counts — restarting the week on every
later view would let the chip follow a returning reader around indefinitely. The insert selects
through `experiences` rather than binding the ids directly, because the foreign key would
otherwise reject the whole statement for one stale id, and a client a moment out of date is the
normal case.

The client reports from an effect after the list commits — the closest thing to "on screen"
without observing each row — and never on fetch, which would stamp rows the reader never
reached. Both card surfaces render the chip and both report, or a reader's week would start
whenever they happened to use one of them.

`experience_sources.new_badge_days` (default 30) arrived with ADR-0020's schema and has a
consumer as of this slice.

## Review Queue

`GET /api/experiences/review/queue` is the other half of change provenance: the run
records what it could not decide, and this is where a curator decides it. Seven kinds of
question, kept apart because they are answered differently — and three lists that are not
questions at all, carried here because nowhere else can carry them.

**What a decision rests on travels with the question.** Every kind carries the object
itself — its image, its point, the source page and Wikipedia from `metadata`, and the names
of the regions it crosses, and how much it holds — through one select fragment shared by every one of the queries, for the
reason `lifecycleSelectSql` is shared: a field required in the type and selected by some of
the queries is the shape that typechecks and silently reads `undefined`. A conflict carries
more, because it is the kind that asks a curator to choose between two texts: when the run
that proposed finished, who claimed the field and when, and every earlier acceptance on that
same field. None of it is new storage. The claim's author is the newest `edited` entry in
`experience_curation_log`, and it is keyed by the **column** name — `short_description`, not
`shortDescription` — so the lookup goes through `CURATED_KEY_BY_FIELD`, the same map the
claim itself does; reading it by the changeset's own name finds nothing and every edit reads
as anonymous. Three of the seven —
`missing`, `refused`, `conflicts` — predate the per-source curation gate
([ADR-0025](../decisions/0025-per-source-curation-gate.md)); `arrivals`, `held` and `contents`
are that gate's own open questions, covered together below the four older kinds. `withdrawn`
belongs to neither group: it is a question about a point *inside* an object
([ADR-0026](../decisions/0026-a-run-records-what-a-container-holds.md)), answered per point
rather than per object, and the only kind whose verdict goes to a different endpoint.

**The id opens the page that names it, and a work opens at its article (#806).** The
source id beside an object's name (`SourceId.tsx`) is a link where a page names the id —
a Wikidata QID opens the item, a World Heritage number opens the Centre's own page for it,
which is the row's `metadata.website` on every UNESCO row and is offered only when that
page's path carries the id as a segment (`sourceIdHref`, through `safeHref`) — with the
copy as an icon beside it; an id nothing names, a curator-created row's say, stays the copy
button it was. The Wikipedia link on an object's card is the **stored** article and nothing
else: all five experience syncs store the English sitelink, so a museum with a QID and no
stored article is one whose object has *no* English article (Wikidata, 2026-09-05: 0 of the
7 such museums on the development catalogue; 5 have an article in another language), and a
link resolved from the QID there would dead-end on every row it applied to. A **work** is
the opposite case — the works writer never asks for an article, and 50 of 50 sampled works
have an English one — so every surface that shows a work to a curator (`WorkCard`, the
contents card's rows, for which `pending_works[].externalId` is now selected) links its
name to the item and offers *Wikipedia* beside it as
`Special:GoToLinkedPage/enwiki/<QID>`, which Wikidata resolves at the click: a 302 to the
article when the sitelink exists, and Wikidata's own "no page found for that combination"
form — a page that says so, not a 404 — when it does not. Both are built only from an id
that *is* a QID, which every work's is (`treasures.external_id` is the Wikidata item the
works writer upserts by); a row whose id were not one would read as plain text, and so
would a row an older server sends without the field. English until the product has a
language rule; `utils/wikidataLinks.ts` is the one place either address is built, and the
admin import tree's AI enrichment builds its item link through it too — the QID there is
the model's own answer, held by the schema to a string and nothing more.

**One list of dated questions, chosen before it is drawn**
([ADR-0051](../decisions/0051-the-review-queue-is-one-list-of-dated-questions.md)). The seven
kinds were seven statements, each with its own `LIMIT`/`OFFSET` and its own `ORDER BY`; they are
one list now, read in two phases. `reviewQueueKeys.ts` is the first: a `UNION ALL` of every
kind's open predicate selecting nothing but a question's key — its kind, the object it is about,
the run that asked it, the source, and, for the three gated kinds, which of them the object holds
— ordered and paged across all seven at once, with the counts each chip would leave spliced
into the same statement from `reviewQueueFacets.ts`. The predicates are not restated there. Each is one
function in `reviewQueuePredicates.ts` (`missingOpenSql`, `refusedOpenSql`, `arrivalOpenSql`,
`heldOpenSql`, `contentsOpenSql`, `withdrawnPointOpenSql`/`withdrawnContainerOpenSql`,
`conflictChangeOpenSql`), composed both by the union and by the statement that draws that kind's
card, so what makes a question open is spelled once and read twice — the cost ADR-0051 names for
keeping both, paid down to one module rather than left in two files.

**Every question is dated by the run that asked it** (ADR-0051 decision 1), through what each
kind already carries — a pointer to that run, or the stamp the run left. Four have the pointer:
`held` is the `completed_at` of the run its membership's `pending_change_sync_log_id` names,
`arrival` that of the run which first saw the row (`first_seen_sync_log_id`), `conflict` that of
the **newest** changeset row's own `sync_log_id` (the `DISTINCT ON (e.id) … ORDER BY ch.id DESC`
picks it), and `refused` that of the same arrival run — whoever took the refusal — falling back to
the membership's `updated_at` only where the row names no arrival run, or names one that never
completed. The other three read a stamp:
`withdrawn` takes
`MAX(el.missing_since)` over the points a run stopped offering, `missing` the object's own
`missing_since`, and `contents` the newest pending part it holds — `GREATEST` of the pending
points' and the pending works' `created_at`, so a card holding only works is dated by the works.

`contents` is the one kind with **no** run pointer at all: nothing on an unread point or work
names the run that brought it, so the question is dated by when that row was written rather than
by when its run finished. ADR-0051 decision 1 phrases it as the newest pending part's first-seen
run; the part's own `created_at` is what the code reads, which is that run writing the part
rather than that run completing. `refused` is the other approximation, and a different shape of
one: the refusal is written on the membership, which carries no run pointer, so the date is the
object's **arrival** rather than the refusal. `COALESCE(l.completed_at, m.updated_at)` reaches
`updated_at` only where the row names no arrival run at all, or names one that never completed — a
run still in flight, or one that failed. Neither is true of any of the 118 open refusals on the
development catalogue of 2026-09-07. So a refusal a *later* run took sits at its arrival's place,
older in a newest-first list than the act that put it there: 96 of the 118 are dated more than a
day before the membership was last touched, the Warsaw Uprising Monument, the Veiled Christ and
the Giants of Mont'e Prama among them — all three arriving on 26 July and last touched on
31 August. What the trade buys is a date that does not move: an unrelated upsert cannot walk a
refusal up the list. A run pointer on the refusal is what would fix it, and that is a change to
what a refusal records.

**The filters are predicates over that same union.** A search on the object's name — `ILIKE` on
`experiences.name`, which carries a trigram index, with the pattern's own wildcards escaped, so a
curator typing `100%` is looking for a name with a per-cent sign in it rather than for every name;
the source; the question — the five kinds plus the three sub-kinds `waiting` groups, since
"waiting to be published" is three different pieces of work; the region, meaning that region and
everything under it (the subtree is walked), or `none` for
the objects in no region at all — 28 of them on the development catalogue, which a control that
could not name them would hide from every curator who touched the chip; the run; and the
curator's own set-aside. `sort=date` is newest first, `sort=question` class-first — a
disagreement, then what is waiting, then what has left, then the two verdicts a rule already took
— newest first inside each class. Both are complete orders over the union, which is what makes a
page assemblable at all.

**The page is taken by keyset, at the precision the timestamp is stored in.** The cursor is
opaque (base64url JSON) and carries `(asked_at, rank, id)` as the database wrote them — deliberately
not the millisecond `toISOString` would round to. 1 255 held keys share run 98's `completed_at` to
the microsecond, so a rounded cursor asks for rows strictly older than an instant *inside* that
group and silently drops its tail. `limit + 1` rows are asked for, so "is there another page" is
still answered by the rows rather than by a second count. A cursor that does not parse, or that
names a date Postgres would refuse, opens the first page instead of erroring — the leniency
`docs/tech/addresses.md` asks of every parameter that arrives from an address bar.

**The counts are counted, under the filter** (ADR-0051 decision 3). `total` is the union under
every filter; each facet is a second aggregate over the same union under every filter *but its
own*, so a chip states what picking it would leave rather than what is already on screen. Kind,
source, region and run, plus how much is set aside. The region facet counts through the root row
placement already writes — `assignAncestors` propagates a point's region to every ancestor and
step 4 of `regionAssignmentService.ts` denormalises the chain into `experience_regions` — rather
than by walking the tree, which is a measured choice: walking cost 330 ms. The dependency on that propagation is confined to
the count; the region *filter* walks its own subtree, so what a curator filters by does not rest
on it. The facet offers the roots of every public world view plus whatever region this curator is
assigned, each carrying the world view it is a root of, because a name does not identify one —
the development catalogue has two roots called Europe.

**The page's ids are then hydrated by the statements that already draw the cards.** Each swapped
its `LIMIT`/`OFFSET` for `AND e.id = ANY($n::int[])` and runs for the ids of its own kind, or not
at all; each keeps the `ORDER BY` it had, and what that orders is now its own array rather than
anything a curator sees. `order` — the page's keys as the first phase chose them — is the list the
client draws, and an array is then a lookup by id. `keptOut`, `answeredWithdrawals` and `refusedParts` stay
outside all of it: those rows are answered rather than open, carry no `asked_at` and are not in
the union, so they keep their own statement and their own offset. **Two of the filters still reach
them**, as predicates of their own on the object's row: the source chip and the search, because a
curator narrowing the queue to one source, or looking for one object by name, means the whole
page. The region, the run and the set-aside do not — a run is what a question was asked *by* and
these are answers, and neither list is counted in the facets a chip states.

Measured on the development catalogue (2026-09-07, admin scope): 1 621 open questions — 1 451
held, 118 refused, 52 arrivals, 11 contents, no conflict, and nothing withdrawn or missing. The
sub-kind counts sum past the total on purpose: a waiting row is one question per object, and 11
objects hold two of the three gated kinds at once. The keys statement executes in 123 ms at an
estimated cost of 79 688, and the endpoint answers a page of 25 with its facets in 296 ms cold and
148 ms warm, against about 590 ms for the nine statements it replaced.

**A curator sets a whole run's batch aside** (ADR-0051 decision 4).
`curator_queue_set_aside(user_id, sync_log_id, created_at)`, keyed on the pair, written by
`PUT /api/experiences/review/set-aside/:syncLogId` and removed by the `DELETE` on the same path.
The unit is the run because the run is the batch: run 98 of 5 September put 1 255 questions about
one field, `metadata.criteria`, into the queue at once, and "not now" is one decision about the
run rather than 1 255 of them. The keys phase drops a set-aside run's rows unless `aside=show`,
and only for the curator who set it aside — the row is theirs, not the queue's, so nobody else's
list changes and it holds across a reload and across machines. The run facet still lists the
batch, counted *before* the exclusion and flagged `setAside`, and `facets.setAside` says how many
batches are hidden — the batch is the unit and the only number the chip needs: a batch nothing
names has no way back. Nothing expires the row and
nothing has to — the read offers only runs with open questions, so a run whose questions have been
answered, or whose held pointer a later run has moved, hides nothing on its own. A dry run is
refused with 404, the same answer a run that does not exist gets, since it raised no question to
put aside.

**A conflict can be answered both ways, and only one of them used to exist.** Accepting the
source writes its value and releases the claim. Standing by the curator's own value was the
*absence* of an action, so the identical card came back after every run — measured before it
was built: of seven conflict rows on the dev database across three objects, every one repeated
a proposal the source had made before, Aksum's three times in two days.
`POST /:id/decline-source` records the answer in `experience_conflict_decisions`, and the
`conflicts` query drops a proposed field with a matching row.

Three properties carry the weight. **Suppression is by value**
(`d.declined = COALESCE(f->'new', 'null'::jsonb)`): a field-level rule would be simpler and
would hide the one case a curator must see, a source that has changed its mind. The `COALESCE`
is not incidental — a source that stops publishing a claimed `metadata.*` key proposes no value
at all, which `JSON.stringify` drops from the changeset row, while the refusal of it is stored
as a jsonb null; the bare comparison answers SQL NULL and never true, so that card would come
back after a refusal that answered 200 and said the question was settled. Both sides have to
agree on the missing case. **The value comes from the locked proposal, never the request** — the
comparison is what silences the card, so a refusal of something nobody proposed would silence
nothing while looking like an answer. And **accepting deletes the refusals for those fields**,
inside the acceptance's own transaction: a refusal says "not while I hold this field", so one
left behind after the claim is released would silence the field the day someone claims it again.

The two answers are not symmetric about what a reader sees, and the asymmetry is the point.
Accepting writes the source's value — immediately for the five fields in `ACCEPTABLE_FIELDS`,
at the next sync for the rest — so a visitor sees the change as the click lands. Refusing
writes nothing at all: the refused value had already lost every run, which is what makes it a
decision about the *asking* rather than about the object.

**Refused rows** — the one kind of item here a run has *already* acted on, and the exception
to the page's standing promise that nothing on it has changed what visitors see. None of the
three answers below is true of one: the British Museum is open, so not `lost`; it was never a
legitimate member of *Art Museums*, so not `former`; and the refusal was right, so not a
false alarm. Its two answers are its own — the rule was right, or the rule was wrong — and the
card carries the rule's objection, because "refused" alone leaves a curator guessing while the
reason lets them confirm a rule or spot a bad one. A confirmed row is not deleted: the refused
set is the list the archaeology kind will be built from. Refused rows are excluded from
the missing group, or the same row would appear twice under two contradictory framings.

**A refusal is shown in two sizes.** `admission_reason` is written by and for the rule —
`painting-share: 2 painting(s) vs 9 sculptural work(s)`, `site, not a venue: church building;
Catholic cathedral — named by The Elevation of the Cross (24 sitelinks)`. It names internal
tests, states no threshold, and never says where its numbers came from. `refusalReason.ts`
splits it in two: a sentence for the card, and the reasoning — the threshold, what the counts
are of, and the stored text verbatim — behind a question mark (`HelpHint`). Every shape the
live catalogue holds is covered, and an unrecognised one falls through to the stored text
rather than to a confident summary of a rule the file has not read. Two details are load-
bearing. Twelve of the twenty-two refusals here weigh exactly one work, so the one-work case
gets its own wording rather than "of the 1 famous works". And the phrase that carries a number
— or names a single work — is hoverable: `counted_works` puts the works themselves under it
with their pictures (`WorksPreview`), which is the difference between a claim and something a
curator can check. The counts come from the rule's own run and the works from the catalogue
now, so the preview says how many it is not showing rather than stopping at the cap: it
reconciles against the sentence's own number where there is one, and against
`counted_works_total` where the sentence names a work instead of counting.

**Kept out** — the refusals a curator confirmed, returned as `keptOut` and collapsed at the
foot of the page. They are answered, so they are not work; they are here because this is the
only surface they appear on at all. Every other verdict is taken back where the object is —
`former` never hides it, `lost` has a reader toggle that reveals it — but `hideRefusedSql`
rides on no toggle, so a confirmed refusal answers 404 by id and shows up in no list. Without
this list, one mis-click would put an object out of the product for good. `override` is
therefore allowed on a confirmed row while `confirm` is not: the way back must not be
closeable by an earlier click, and it is the safe direction, since it reveals rather than
hides and two curators clicking it reach the same state. `confirm` keeps "already answered"
(the curated-fields pin, or a batch's `admission_answered_at`, `admissionAnsweredSql`) as its
concurrency check, so a stale card cannot silently re-hide a row someone just put back. A batch
answer (ADR-0067) is turned away from any answered row in either direction, under the same lock,
so it can never put back over a card's answer and keep that card's pin. If the kept-out row was a `pending` arrival nobody had read before it was confirmed,
putting it back publishes it in the same step (see "Overriding a refusal is the other half"
under § Publishing) — confirming never changes `curation_state`, so it is still there to answer.

**Answered withdrawals** — the same thing one level down, returned as `answeredWithdrawals`
and collapsed beside the kept-out block. A verdict on a point is what removes it from the
`withdrawn` card: that query asks about a flagged point whose two axes are still clean, so
answering either axis takes the row out of it — by design, or a card would come back with
its own answer written on it. Nothing then showed it, because a point is not reachable at
its own address and every reader-facing read carries `offeredLocationSql`. The endpoint has
always accepted the correction (`POST /locations/:locationId/state` logs
`location_state_restored`); what was missing was the list to offer it from.

Two predicates, and neither alone is the criterion: **a verdict stands** — `former` or
`lost` — and **no reader can see the point**. The first is what there is to take back, and
it is also what makes this list and the `withdrawn` card disjoint *by construction* rather
than by a guard either one carries. It is asked of the axes rather than of
`state_decided_at` for two reasons. The axes are themselves the record of a person: no arm
of `locationWriter` writes `former` or `lost` — both column comments in the schema say "set
by a curator only", and ADR-0026 decision 6 has the restore move toward `present` and never
away — so a row carrying a verdict and no timestamp would be a bug, and hiding it from the
only screen that can undo it is the wrong way to answer one. And a date is the wrong key
outright: a point answered "false alarm" can be withdrawn *again*, so a row carrying an old
decision date is genuinely waiting, and keyed on the date the same point would raise two
cards at once — one of them with nothing on it to take back. The second predicate keeps this a way
back rather than a second copy of the map, and it earns its place on one state —
`{former, extant, flag NULL}`, which is visible, membership being in no reader-facing read.
No run produces it: every arm of `locationWriter` that clears the flag restores membership
in the same statement, the `returned` arm writing `missing_since = NULL` and
`source_membership = 'present'` together for the reason its own note gives. What reaches it
is a person — `POST /locations/:locationId/state` accepts `former` on a row whose flag is
already clear and leaves it clear, since only an answer with both axes clean clears
anything — which no card in the product sends, and which is therefore the documented
endpoint's other clients.

Unlike every kind that asks something, it carries **no object-level lifecycle guard**.
`hidePendingSql`, `hideRefusedSql` and `e.missing_since IS NULL` are on the questions so
that one row never raises two cards whose answers contradict each other; this asks nothing,
and each of those guards hides the *object* from readers, which makes the point inside it
more unreachable rather than less. Scope stays, being about who may look.

Each standing verdict is taken back **on its own** — they are independent claims, one about
the source's list and one about the world — and the point returns to readers only where
both axes come clear, which is `offeredLocationSql` read forward rather than a rule the
screen invents. The card says which of the two will happen before the click
(`wouldReveal`), because the answer differs: undoing a `lost` while a `former` still stands
leaves the point hidden, while undoing one whose flag a run has already cleared puts it
straight back on the map — and that second case is a placement event, so the reply may
carry `placementFailed` like any other. What it does *not* do is restore the waiting state:
nothing can, since the flag is cleared by any answer leaving both axes clean, and if the
source still does not list the point the next run marks it again and it returns as a
question. Who answered is read from `experience_curation_log` under the same scope
predicate the conflict card uses — not from `state_decided_by`, which carries no region and
would name a curator whose act the log endpoint would drop for this reader.

**Missing objects** — rows the machine flagged `missing_since` and nobody has judged yet
(`source_membership = 'present'`, and not refused, and — since ADR-0025 — not `pending` either:
`hidePendingSql()` excludes a row no reader has ever seen, because there is no verdict to give
about whether it disappeared from in front of anyone. That row is not silently dropped: it
raises no `missing` card and no `arrivals` card either, the latter guarded by
`missing_since IS NULL` — the two predicates are what makes it raise the right number of cards,
zero, rather than a wrong one under either heading). Three answers, and only two of them change anything:
*former* (the source delisted it, it is still there), *lost* (it no longer exists), or a
false alarm. All three clear `missing_since`, including the false alarm — leaving it set
would put the object back in the queue after every run, which is how a queue stops being
read. Clearing the flag is necessary but not sufficient for *lost*: the source will go on
not listing the object, so detection would stamp it again on the next clean run and the only
exit would be answering a different question. Detection therefore skips `existence = 'lost'`
rows — a judged object is not asked about again — and drops them from the coverage ratio on
both sides, since a row that can never be seen would otherwise drag the source toward the
90 % floor that switches detection off. That the two axes stay independent is the point: a
*lost* verdict says nothing about whether the source still lists it, and coupling them would
undo what ADR-0020 separated. The two axes are set independently, so a call may carry either or both, and each one
decided writes its own `experience_curation_log` row: `marked_former`, `marked_lost`,
`state_restored` for an axis moving back, and `missing_dismissed` for the verdict that
moves nothing — calling *that* a restoration would record one that restored nothing.
**Every call must say what the curator was looking at.** `expected` carries the two axes and
the flag as the card rendered them, and the handler compares all three with the locked row
before deciding anything; a mismatch is 409. Nothing else can tell a card drawn before the
question was answered from a deliberate correction, and the difference matters most where it
is least visible: "false alarm" over a recorded `former` is a real transition, so no check on
the verdict alone catches it — it would undo an answer its author never saw and leave the row
in exactly the shape `flagMissingExperiences` re-stamps, reopening the entry they had closed.

The flag belongs in that comparison rather than beside it. A run that finds the object again
clears `missing_since` and touches neither axis (`experienceUpsert.ts`), so a queue card still
matches on both while the question it asks has been withdrawn — and answering `former` there
records as delisted an object the source currently lists, which drops it out of detection's
predicate (`source_membership = 'present'`, asked alike by `countActiveExperiences`,
`countSeenAmongActive` and `flagMissingExperiences`) and leaves the correction path as the only way back.

Comparing state rather than refusing every decided row is what keeps a verdict correctable.
Refusing them wholesale would make `former` and `lost` terminal: `missing_since = NOW()` has
one writer, and its predicate wants `present` and `existence <> 'lost'`, so detection
re-flags neither. One mis-click would remove an object from the product with no remedy short
of SQL — and `state_restored` would be an action nothing could emit, with the schema, the
migration and this document all claiming otherwise.

A call that moves nothing, on the state the curator saw, is the false alarm — the one verdict
with no transition to name, which is what makes `missing_dismissed` unambiguous. If the flag
is already cleared it is instead a second answer to a closed question, and 409s: taking it
would write a duplicate row and move `state_decided_by` to whoever clicked last.

The page refetches on a refusal as well as on success, so a card someone else answered goes
away instead of repeating the refusal on every click. Reaching a *decided* row needs a view
the queue does not provide — it lists open questions only — so the entry point for correcting
a verdict lives in `CurationDialog` instead; see § Lifecycle filtering above for which half is
reached how.
Migration 011 widened the action CHECK to admit `marked_former`, `marked_lost`, `state_restored`
and `missing_dismissed`. A decision is one transaction over
a `pool.connect()` client — `pool.query('BEGIN')` does not pin a connection, so the UPDATE
and its log rows could otherwise land on different ones — and it re-reads both axes under
the object lock first. Every verdict writes both columns, the axis the curator did not decide
defaulting to what is already stored, so reading that from outside the transaction would let
one curator's verdict silently revert another's. Two curators on one item is the ordinary
case: every region-scoped curator covering any of its regions sees it, as do its source's
curator and every admin.

**The object lock is `OBJECT_LOCK` — `FOR NO KEY UPDATE`, not `FOR UPDATE`** — and a
transaction that locks a row of an existing object's contents takes it on the object first.
Both halves matter, and both were learned from the same failure. The rule is about
transactions and about which rows they hold, and what it leaves outside is named rather than
counted — the count went stale here once already — each for its own reason: `upsertVenueTreasures` runs each of its per-work statements on the
pool with no `BEGIN`, so it holds nothing across them and can wait for a lock without ever being
half of a cycle, and the one transaction inside it — `reconcileLinks`, which restores and marks
the venue's links (ADR-0044) — is under the rule for exactly that reason and takes the object
first; `createManualExperience` creates the object in the same transaction, so the INSERT's
own row lock is the "object first" the rule asks for, and its point insert spends the token that
insert hands back (`insertCuratedExperience`); the region and rejection writers
touch rows no lock-holder waits for, reaching `experiences` only through the audit row's key
share, which the mode below is chosen never to conflict with; and **placement**
(`assignRegionsForExperiences`) does key-share the point rows through
`experience_location_regions`, so a transaction that changes a point's key column — the
writer's ordinal parking — can wait for it, but it never waits in turn, since its own reach
into `experiences` is another key share. `db/locks.ts` says the same in the same order, and is
where a writer that joins the set will look.

**The lock is taken through `lockExperience`, and a write under it takes its token**
(ADR-0069). `db/experienceWriter.ts` runs the `OBJECT_LOCK` statement on the caller's
connection and returns the row with a `LockedExperience`. That type is produced only in that
module — by the two lock functions and the manual create's insert — and every curator write to
`experiences` requires it:

- `updateExperienceColumns` (the edit, accept-source, a published proposal);
- `recordDecisionOnExperience`;
- `setLifecycleVerdict`;
- `anchorToItsPoint`.

So a write issued before the lock, or on a path that never took it, does not compile.
`lockSourcedExperience` is the run's form, found by source and external id.

The table's writers are a closed list the backend lint names (`EXPERIENCE_WRITE_RULES`):
that module; the run's upsert, missing detection and picture repair; and the seed. An
`INSERT INTO` or `UPDATE` of `experiences` anywhere else is refused.

**A point is written under its object's token too.** Every curator write to
`experience_locations` requires the object's `LockedExperience`, and each names the object
beside the point, so one object's token cannot be spent on another's point. They are in
`controllers/experience/experienceLocationWriter.ts`, beside the handlers whose unread gate
they compose:

- `publishUnreadPoints`, `markUnreadPointsRefused`, `restoreRefusedPoints`;
- `releaseDeferredWithdrawals`, one release for both answers to a moved point's arrival —
  published or refused;
- `setPointVerdict`, `correctPoint`, `releaseAnchorPointClaim`, `movePointTo`,
  `renamePoint`, `insertCuratedPoint`.

The manual create's `insertCuratedExperience` hands back the token, since its insert's own row
lock is the object lock. So *the object first, then its points* (`db/locks.ts`) is a type error
to break. The table's writers are a closed list the backend lint names
(`EXPERIENCE_LOCATION_WRITE_RULES`): that module; the run's `locationWriter.ts`, which takes the
same lock; and the seed.

The **order**, because the audit row's foreign key reaches `experiences` even in a handler that
never names it, so a writer that took the point first and logged afterwards was holding one row
and waiting for the other. That binds `writeExperienceLocations` too, which is why the sync's
location writer opens its transaction with the same lock rather than being the one path excused
from the rule: it reaches the object twice — the insert's FK, and `retirePassAfterNewContent`,
a real `UPDATE experiences` immediately before the COMMIT — so a run holding a parked point and
asking for the object, against a curator holding the object and waiting for that point, is a
cycle Postgres resolves by failing one of them.

The **mode**, because an INSERT into `experience_locations` needs `FOR KEY SHARE` on the parent
while its own transaction holds the object. `FOR NO KEY UPDATE` self-conflicts, so two writers
on one object still serialise and an UPDATE or a DELETE of the row is still blocked, and it does
not conflict with that key share. No writer here changes a key column of `experiences`, so
nothing gives up anything it had. The constant lives in `db/locks.ts` — its own module, because
`db/index.ts` builds the pool and every test of a curator write mocks that wholesale, which
would have made the constant `undefined` inside those tests while the suite stayed green.

**Conflicts** — fields where `curated_fields` refused the source's value and the two now
disagree. The queue reads them out of `changed_fields` (`curatedConflict: true`) on the
latest **non-dry** run, because a preview proposes values that were never applied and never
will be. Accepting the source writes the proposed value **and removes the field from
`curated_fields`**: leaving the claim in place would make the next run refuse the very value
the curator just accepted, and the conflict would reappear. The request names the run it was drawn
from (`expectedSyncLogId`), and a newer proposal is 409 rather than silently substituted:
the handler re-resolves the newest proposal at click time, so without it a run landing
between render and click would replace the curator's edit with a value they never saw — the
same exposure `expected` closes on the verdict path. The response names `fromSyncLogId` back,
along with `applied` and `released`, and the page states both: the refetch takes the card
away, so nothing else could say which half landed or where it came from.

That released claim is one of two things that take the item out of the queue. The changeset
row is a record of what a run did and is never rewritten, so the query asks a second question
of every proposed field — is the curator still claiming it? — and drops the row when nothing
is left.

The other is the source withdrawing the proposal. A run that finds the source agreeing again
writes **no changeset row at all** (`worthRecording` in `itemOutcome.ts`), so a missing
newer conflict is not evidence that the old one stands. What such a run does leave is
`last_seen_sync_log_id`, and a value newer than the conflict's run means a later run saw the
object and had nothing to propose — **once that run has finished**. `last_seen` is stamped
per item inside the loop while the changeset is written in one batch after it, so mid-run the
newer value exists and the rows it would be read against do not; without the completion check
every conflict in a source would vanish for the length of the run, and a curator clicking a
card fetched beforehand would be told there is no proposal on record. The batch lands before
the log is closed, which is what makes a completed log the point to read from — but not on
its own. Two paths close a log that recorded nothing: a failed changeset insert is caught
deliberately so a run cannot stick at `running`, and a crashed process is closed by the
startup sweep. Both are excluded, or the inference would silence a standing disagreement for
a whole sync cycle instead of the length of one run.

Status cannot make that distinction — a run that throws after the item loop records its
changes and *then* marks itself `failed`, so keying on `failed` would suppress the inference
for a run whose changeset is entirely on record. What separates them is the marker each path
leaves in `error_details`, and both the marker and the predicate that reads it live in
`syncLogMarkers.ts`, written by the startup sweep and the orchestrator and read by the queue
and `accept-source` — one definition rather than four copies of a string. Both the queue and `accept-source` carry that check, or
the endpoint would refuse a *newer* proposal while writing a *retracted* one — a value
nothing currently proposes, and an item whose only exit would be giving up a claim the
curator has no reason to give up.
It follows that keeping the edit needs no call and leaves the item in place: refusing *is*
the current state, and the run will go on proposing until someone accepts.

Answering that question needs a translation, because the two vocabularies differ:
`changed_fields` says `shortDescription` where `curated_fields` holds `short_description`,
and both `metadata.inDanger` and `metadata.dateInscribed` are claimed as plain `metadata`.
`CURATED_KEY_BY_FIELD` in `changeSet.ts` — the map the upsert itself honours — is passed in
as a parameter rather than restated. A `curated_fields` entry is **not** reliably a column
name: `editExperience` claims `metadata.website`, `metadata.wikipediaUrl` and
`metadata.imageCredit` per key, none of which a column matches, so the query falls back to the field's own name for keys the map does not
carry.

Between the map and that fallback sits a third arm, `CLAIM_KEY_BY_FAMILY`, for the per-part
entries of a column claimed **whole**. `nameLocal.ko` is the case: the languages are the source's,
so no map could name them, and the only claim they can fall under is `name_local` — the upsert's
guard is `curated_fields ? 'name_local'` and keeps or replaces the map entire. Without it a run
would report the source's local name as applied while the upsert kept the curator's, and
publishing would write over the claimed column. `metadata` is deliberately **not** a family, since
its claims are per key. All three arms are `claimKeyFor` in TypeScript and the same expression in
SQL, off the same two objects, so the two runtimes cannot come to protect and ask about different
things (`claimKeySql` in `reviewQueuePredicates.ts`, read by `reviewQueueConflicts.ts` and
`reviewQueueKeys.ts`). The shape the queue serves has one home, the backend schema
`ReviewQueue` whose type the web imports (ADR-0066).

(Those two metadata keys used to be a pre-existing hole in metadata protection too —
the upsert guarded metadata only with `curated_fields ? 'metadata'`, which neither
satisfies. That guard now also honours a per-key claim on each of them directly (#488),
re-applying just that key over the source's value. `CURATED_KEY_BY_FIELD` still does
not carry either key, though, so that fallback is still what represents them here.)

`computeChangeSet` diffs **every** metadata key on its own now, under `metadata.<key>`
(ADR-0039), so a curator's claim on one reports as its own conflict rather than disappearing
inside a catch-all diff. Before #488 there was no diff a per-key claim could match against — the
claimed key and whatever else changed were one `metadata` diff, which `CURATED_KEY_BY_FIELD`
protects only as a whole-column claim — so a run that correctly kept the curator's value (the
per-key guard above) still filed `changed_fields: metadata, curatedConflict: false`: a write
that never happened, reported as one that did, with no conflict for a queue card to raise. (The gate
has the same shape one layer out, and #519 is that story: a write the hold refused, filed as one the
run made. Both are fixed the same way — the field says which refusal kept it out.)

**Whether a claim reaches a key is decided where the stored row can be seen**, not by the name:
`RawDiff.protectedByClaim` carries the answer out of `metadataChanges`, because two facts about
the row settle it and no lookup can. A claim on the whole `metadata` column protects every key
under it, which no per-key name matches — without this the source's values would report as applied
over a curator's claim. And a claim whose key the row no longer carries protects nothing: the
upsert only re-applies a claimed key while `experiences.metadata ? claimed.k`, so the source's
value lands and filing it as a conflict would offer a curator "accept" on a value already written.

**The flag answers protection, not addressability, and the whole-column arm is where that costs
something** (#729). Such a claim used to raise one conflict named `metadata`, which
`CURATED_KEY_BY_FIELD` resolves; it now raises one per key, and all three readers look a
conflict's claim up by name — the queue through the same map, `accept-source` and `decline-source`
through `claimKeyFor` — which sends `metadata.website` to itself, and `['metadata']` does not
contain it, so those conflicts reach no card and no answer. **Publishing is a fourth reader and
loses more than the asking**: its skip list is the same lookup, so the per-key entries are not
skipped and are written key by key over the column the claim covers, while `experienceUpsert.ts` still
keeps that column whole on `curated_fields ? 'metadata'`. Reachable only for a claim made *after*
the run, since one standing at diff time holds every key. Unreachable today, since nothing writes a
bare `metadata` claim, and the same class as the per-key gap the paragraph below records.

A claim on a key the map *does* carry — `metadata.inDanger` or `metadata.dateInscribed` — is
not this fallback's case, and would still be reported as applied, not as a conflict:
`CURATED_KEY_BY_FIELD` already has an entry for it, so the `?? diff.field` fallback never
fires, and the diff is checked against a whole-column claim instead of its own name. The
upsert's SQL guard does not draw that distinction — it re-applies any claimed `metadata.%` key
still present in the stored row the same way, major or not — so a per-key claim on one of
these two, provided the row still carries that key, would be honoured in storage and still
misreported here, #488's exact shape, unfixed for those two keys. No writer
produces such a claim today: `editExperience` (`curationController.ts`) adds
`metadata.website`, `metadata.wikipediaUrl` and `metadata.imageCredit` per key — never
`inDanger` or `dateInscribed`, the two the map carries — so this is a doc-truth gap rather
than a live one, tracked as #727 with its sibling above. The credit joined that list with the picture credits and takes the same
fallback, being no more a major key than the other two. The rule holds for the keys the map does not carry: there,
the claim key the queue reads and the claim key the upsert honours are the same string, and
`computeChangeSet` — producing the very `changed_fields` and `curatedConflicts` the queue
reads — uses that same string too.

Accepting is always a claim release; whether the value is *also* written on the spot is what
`ACCEPTABLE_FIELDS` (`acceptableFields.ts`) decides — `name`, `shortDescription`,
`description`, `type`, `imageUrl`. Their **claim keys** are `name`, `short_description`,
`description`, `type`, `image_url`, and each of those is a real column, which is what
lets `CURATED_KEY_BY_FIELD` answer both questions for them: the field name itself is
camelCase and matches no column, so the map is doing work in every case, not only for the
exceptions. (`type` is the varchar type within the kind — `cultural`, `monument` — not the
`source_id` foreign key, which no source proposes and this endpoint never touches.) `location` and the country arrays need
more than an assignment, and `metadata` is claimed per key, so writing it wholesale would
discard the keys the curator did not touch. Those fields come back marked
`acceptable: false`, and accepting them releases the claim without writing: the **next run**
then applies the source's value through the ordinary upsert, and the response reports them
under `released` rather than `applied`.

That is the only way such an item leaves the queue, and it is why the endpoint does the
release rather than pointing the curator at the edit dialog. `applyProposedFields` is the
only code anywhere that removes a key from `curated_fields` — `editExperience` unions into
it (`curationController.ts`) and never subtracts — so a curator told to "settle it by
editing" would find the card exactly where it was, forever. Nor could they: the edit dialog
does not offer location at all.

The accept path reads `curated_fields` **inside** the transaction that rewrites it, under the
object lock. The whole column is rewritten, not one element of it, so a value read before
the lock would discard whatever a concurrent edit or a second curator claimed in between.
`editExperience` now reads it the same way, for the mirror image of the same reason: it
unions into the column, and a claim released by an accept between its old unlocked read and
its write would have been put straight back — resurrecting a claim over the value the
curator had just accepted.
The lock is also what makes "is this field still claimed?" a decision rather than a guess: a
field released while the request was in flight is no longer an open conflict, and writing it
would overwrite an answer someone already gave. That case is a 409, as is a field the source
never proposed — never a 200 reporting that nothing happened.

All three write paths — the two here and `editExperience` — read what they modify under the
lock that writes it, and all three roll back through `rollbackQuietly` (`db/index.ts`),
which swallows a failing ROLLBACK: a rollback on an already-broken
connection rejects in its own right, and an unguarded `await` in a `catch` would throw that
instead of the error the caller needs to see. It returns that failure rather than dropping
it, and each caller hands it to `client.release()` — `pg-pool` keeps a released client
unless the argument is truthy or its connection has already gone unqueryable, so a client
whose ROLLBACK failed while the socket still works would otherwise rejoin the idle pool
carrying an open transaction. The other curation handlers still roll back
unguarded — pre-existing, and not touched here.

`editExperience` re-reads under its lock everything the transaction depends on, not only
`curated_fields`: the `old` values in the audit row come from the locked snapshot too, since
values read before the lock can name a version that was already gone when the edit landed.

### Turning a source's gate on, and letting it go (ADR-0025)

`requires_curation` was read by four services from the day the gate landed and written by
nobody: the schema sets it, migration 018 seeded it `false` on all three sources, and gating one
meant hand-written SQL against production. Three things closed that.

**The switch.** `PUT /api/admin/sync/sources/:sourceId/curation-gate`, admin-only like
everything on that router, and beside the other source writes because the gate is a property
of the source rather than of any object. Two promises are properties of its single statement
rather than of anything it checks: it touches `experience_sources` and nothing else, so
**turning it on is not retroactive** — rows the source already published stay `auto` and stay
visible, and one source can hold `auto` rows from before the switch beside `pending` ones from
after it. And it names no content column, so **turning it off publishes nothing** — the statement moves
no row. What a backlog does next depends on its kind. Unread objects and unread contents stay put,
because only the insert arm ever writes `pending` and only a person moves a row out of it. A change
a run is holding does the opposite: the hold is `requires_curation` and a reader being able to see
the place — some membership passed (`experienceUpsert.ts`) — so it stops existing with the gate,
and the next ungated run writes the proposed values and clears the pointer with nobody involved. The flip is logged with
the actor's id; there is no per-source audit table, and the switch that decides whether a
whole source reaches readers unreviewed should not leave no trace at all.

**What a source is holding.** `getSources` answers `requires_curation` and a `waiting` object
per source, counted in the three kinds the review queue asks about — arrivals, held changes,
unread contents. Three numbers rather than one, because "18 waiting" is equally true of eighteen
unread museums and of eighteen paintings inside one published museum, and those are different
days' work. The queue is named as the authority for each predicate, since the panel's number and
the cards a curator opens next must not disagree. `waitingCounts.ts` records the one place the
two cannot share a spelling — the queue reaches held fields through `CROSS JOIN LATERAL` because
it has to show them, a count asks `EXISTS` — and the case that separates those readings: a
pointer whose changeset holds only a field a *curator* claimed must count zero, because it
raises no `held` card either.

The counts are an addition to that endpoint and the source list is what it is for, so they are
counted in their own `try` and answered as `null` when the aggregate fails. `SyncPanel`,
`AssignmentPanel` and `CuratorPanel` share that query and read only its data: a throw used to leave an admin with a heading, no sources, no
Start Sync and no reason. The panel says "How much this source is holding could not be counted",
offers no release — the confirmation names what it will publish, and it could name nothing — and
states the switch's two backlog answers as kinds rather than counts. Count-free but not silent:
how much is unknown, what becomes of it is not, and the held-change half is the only consequence
on that control a flip back cannot undo, since a run that applies a held change clears the pointer
and re-gating restores nothing. Silence would leave an admin deciding without knowing the class of
thing exists, which is a step past the report-after-the-click the copy is written against — and
the unknown is not independent of the risk, because the aggregate that fails is the one that gets
slow on a grown, gated catalogue. Zeros would have been the wrong
fallback for the reason `heldLeftForReview` is nullable too: they are an answer about the source
that nothing checked.

**Letting it go.** `POST /api/experiences/sources/:sourceId/publish-waiting`, curator or
admin, one transaction per object through the same `publishUnderLock` a single card uses, and one
`published` audit row per object — never one for the batch, since a log row saying "42 objects"
answers "when did this museum become visible" for none of them. Scope is resolved per object and
what the caller does not cover comes back as `outOfScope`, because a batch that quietly published
fewer than it found would read as a cleared source.

**Nothing a single publish reports is dropped because there are forty of them.** Each entry
carries its point count, both work counts, `withdrawalsReleased` and the placement failure, each
for the reason the card carries it: a count of objects is not what a visitor gains, releasing a visible object's
unread points releases the withdrawals deferred behind them so an old pin stops being shown at
that moment and nowhere else records when, and a publication whose re-placement failed is a
success with stale regions. Read off a batch of forty, each of them is otherwise recoverable only
by opening forty histories, which is the work this endpoint exists to avoid. The same reasoning wraps every statement from the first object onwards — the loop's body and the
closing held-count query — while the selection that runs before any of it deliberately stays
unwrapped, because nothing has committed yet and "I could not read the source" is then the honest
answer. Past that point the report describes publications that already exist, and the world-view
names in it reach a person here and nowhere else, so a throw from the closing query would answer
500 and discard them.
That count is therefore `null` rather than absent or `0` when it fails, and the panel says it
could not be counted — `0` would be a claim about the source that nothing checked.

**It does not publish a held change, and that is the decision worth carrying forward.** The three
kinds are not equal in what releasing them does: an arrival and unread contents are things a
reader cannot see yet, so publishing reveals them, while a held change rewrites a row a reader is
looking at with a value nobody read. The card for that one shows `old → new`; a batch has nowhere
to show it. So held changes stay for the queue, the response names how many were left, and the
panel's remaining count is explainable instead of looking like a failure. It also keeps the
staleness check honest rather than routed around: `publishUnderLock` refuses a call that would
write held fields without naming the run it saw, and passing each row's own pointer back would
satisfy that check falsely, when its whole purpose is that a person looked.

The panel's copy carries the rest. The switch reads "Hold new and changed content for review"
with the consequence underneath in both directions — including that what was published before
the switch stays visible, which is the clause an admin needs before they will touch it — and the
confirmation for "Publish all waiting" offers `arrivals + contents` and says outright that a
change to an object readers can already see will not be published there.

### The gate's own three kinds (ADR-0025)

The four kinds above predate the per-source curation gate. These three are the open questions
it leaves — a row a gated source wrote that nobody has passed, and the two ways an
already-visible row can still be holding something unread. All three carry `hideRefusedSql()`:
a refused row is already invisible for a reason with its own card above, and asking "may a
reader see this?" about it would ask the second question before the first is settled — a refused
row shaped like each of the three below raises no card in any of them. All three also
carry the same scope filter as the four older kinds, or a region-scoped curator would be offered
work outside what they cover.

**Arrivals** — a membership from a gated source, `curation_state = 'pending'`, that nobody has
looked at (an arrival is a membership arriving, #822: its state and its admission are read off
the membership, the source's observation off the place). The whole object is the proposal, so
there is nothing to show beside it but the object itself; the queue's own version of "created,"
for a source that does not get to publish on its own say. Ordered newest-arrived first by `first_seen_sync_log_id`. A row the source has since
stopped offering withdraws instead of raising a card, guarded by `missing_since IS NULL`
(ADR-0025 § 3.6) — nobody has ever seen it, so there is no verdict to give either about whether
it disappeared. That same row raises no `missing` card either, per the predicate change noted
above, so it is correctly invisible under both headings rather than wrongly visible under one.

**Held** — an already-visible membership (`curation_state <> 'pending'`) whose newest content
proposal was kept out by the upsert's own gate rather than applied — the mechanism
`experienceUpsert.ts` documents under "A gated source may not overwrite what a reader can already
see" (above), and reported by the run as `change_type = 'held'` with each kept-out field flagged
`held`. The membership's `pending_change_sync_log_id` names the run whose proposal is waiting, and
the proposal itself is read straight from that run's changeset row.

Two halves to the card since [ADR-0037](../decisions/0037-a-part-field-readers-see-is-held-like-the-objects.md):
`proposed`, the object's own held fields off `changed_fields`, and `proposed_parts`, the held fields
of its parts off the contents record — a place renamed, a work re-attributed — each part carrying
the record's name and reference, the held fields alone, and the stored row behind the record — its
name as it stands now (`storedName`), which heads the group and seeds the dialog, since the record's is
the name as the run saw it and a part corrected since would otherwise be headed with the name it no
longer has — so the card can open it and say "place 5 of 8" or "by Johannes Vermeer, 1660" without a
second read
(`heldPartsSelectSql` in `reviewQueueContents.ts`) — a place's row carrying its `locationId` and
`curatedFields` as well, since the dialog it opens in corrects it (#583), and a work's row its `treasureId`,
`workCuratedFields` and `venueCount` for the same reason one level over (#731) — its own claim key, because one
`jsonb_build_object` builds both kinds of part and a shared name could not answer for two rows. A row is a card where *either* half holds
something — `heldFieldExistsSql OR heldPartExistsSql`, the pair `heldWaitingSql` counts by, so the
panel's number and the queue's cards agree row for row. Either half may be NULL on a card about the
other; the trailing guard drops a row with nothing on both, and is load-bearing now where it used to
be a floor. The row behind a part is found by one rule the card and publishing share,
`partRecord.ts`: the reference narrows, the name decides among the duplicated references, and
where no row answers to the record's name any more a row whose `name` a curator has claimed is the
one — the record names the part as it stood when the run wrote it, and a held row's stored name
leaves that for one reason only, a correction, which always claims `name`
([ADR-0050](../decisions/0050-a-renamed-component-is-found-by-its-claim.md), #833; before this term
the tie fell to the lowest id, and renaming uKhahlamba Drakensberg Park from its card reopened the
card on Sehlabathebe National Park, the other half of Maloti-Drakensberg Park under `985ter-001`).
The lowest id breaks a tie only among rows the name admits — the rows that share a name as well as
a reference; a tie among rows it does not admit is a row nobody can identify, and the
rule answers with `identified` false: the card gives the part no door, exactly as for a withdrawn
one, and publishing reports it and leaves it open. A claim carries no date, so the term tells a row
carrying a curator's name from one that is not, never "renamed since the run": a sibling corrected
long before the run counts too, and the case lands on `identified` false rather than on the right
row — the safe answer, with the card standing. The one referenceless point is found because the
reference is compared with `IS NOT DISTINCT FROM`. Offered rows only; a part the source has since
withdrawn keeps its group on the card with nothing to open.

The pointer is not proof the gate is what held every field on it. `experienceUpsert.ts`'s
`proposedAnything` sets the pointer for *any* refused proposal — a curator's own `curated_fields`
claim included, and not only the gate-held fields this card is about — so without a filter a field
refused only by a claim would carry two contradictory cards at once: `conflicts`, which
`accept-source` can answer, and a `held` twin answered by publishing, and the twin would
outlive an `accept-source` call showing a value already written. The query therefore requires
`(f->>'held')::boolean` on each field — this card is only ever the fields the *source's gate*
held, never one a claim refused for its own, separately-answerable reason. Read off the field's own
flag, not inferred from the absence of a claim (#519): the elimination was right only while the gate
was the sole other reason a write could be refused, and a third reason would have been silently
reclassified as gate-held here and handed to publishing, which writes all eleven columns.
`e.missing_since IS NULL` guards the row for the same reason `arrivals` carries it: a visible row
can be flagged missing *and* holding a proposal at the same time, and that is `missing`'s
question, not this one.

**A held row is dropped from the card once it has been answered** (#722,
[ADR-0038](../decisions/0038-a-held-proposal-is-answered-per-field.md)). Both halves carry the
predicate `heldDecisions.ts` owns — `heldFieldAnsweredSql` for the object's own field,
`heldPartAnsweredSql` for a part's — and so do `heldWaitingSql`, the panel's count and
`danger-flag-disagrees-with-its-tag`, because four spellings of that rule would be how they came
to disagree. `picture-with-nobody-credited` composes the same module and asks it a **narrower**
question, `heldFieldRefusedSql` / `heldPartRefusedSql`: the one reader for which publishing is not
settling: on a card filed before ADR-0039, publishing the object's source-data row while its
picture is still open withholds the run's credit on purpose and the next click writes it
(`data-assertions.md` says why; since ADR-0039 the credit is its own row and moves with its
picture, so the sequence needs an older card). Sharing
the module is what lets that difference be stated once and deliberately rather than arrived at. The answer is matched **by value**, and
the comparison stays in SQL where jsonb equality lives: a source that comes back with something
different is asking a new question and the row returns, while one repeating itself is not heard
again. Both verdicts are recorded, publishing's as well as the refusal's, which is what makes a
one-row publish possible at all — a card that keeps its pointer would otherwise go on offering a
value it has just applied, since a run's record is never rewritten to say otherwise.

**Two endpoints answer a `held` card**, and between them they are the only writers that clear the
pointer in response to a person — `experienceUpsert.ts` clears it otherwise only when a *later run*
proposes nothing at all, the source having come back to what is stored. `POST /:id/publish` writes
the value; `POST /:id/decline-held` refuses it and writes nothing at all. Both clear the pointer
only when nothing on the card is left open, so answering one row of six leaves the other five
findable. The field
carries no `acceptable` flag, unlike `conflict`'s: that flag answers "can `accept-source` write
this?", and every field reaching this query is, by the filter above, one `accept-source`'s
`curatedConflict: true` lookup would never find anyway. Publishing writes all eleven, which is
why it has to exist as a separate writer — see § Publishing below.

An empty proposal is excluded by the `WHERE` above rather than by the `WHERE q.proposed IS NOT NULL`
that follows the grouping. `CROSS JOIN LATERAL` with a per-field predicate drops those fields before
`GROUP BY` runs, so a changeset whose every field was claimed — or whose `changed_fields` is `[]` to
begin with — forms no group and never reaches `jsonb_agg`. The trailing guard is a floor kept for the
shapes that would need it (a `LEFT JOIN LATERAL`, or the field predicate moved into a `FILTER`, either
of which keeps the group and hands `jsonb_agg` an empty set). In the `conflict` kind the same guard is
load-bearing, because there it wraps a correlated subquery that does return NULL for a row that exists
— the two look alike and work differently, which is why both say so at the call site.

**Contents** — a visible experience (`hidePendingSql()`) holding unread points or works of its
own, each gated independently of the container (ADR-0025 decision 2): a published museum can
hold newly-arrived paintings, and a published UNESCO site can hold a newly-arrived component.
Counted **and** listed: `pending_locations`/`pending_treasures` carry the whole number, and
`pending_points`/`pending_works` carry the first `CONTENTS_ROWS_SHOWN` of them — the points in the
source's own order, the works most famous first. Counting alone was #524's complaint: twelve works
"counted rather than listed" asks a curator to decide about twelve things they cannot see. Listing
alone would be worse at the other end, since the largest serial nomination — the Rock Art of the
Mediterranean Basin on the Iberian Peninsula — holds hundreds of points, so the
cap stays and the card says *"showing 25 of 93 points"* rather than letting a short list stand for a
long one. `hideRefusedSql()` on
the container is what keeps a refused museum's newly-arrived paintings from raising a card here
too — the museum already has its own card in `refused`, and its contents are not a second
question.

This kind and `withdrawn` live in `reviewQueueContents.ts` rather than in the handler: both read
`experience_locations` rather than `experiences`, both carry the only per-row lists the queue
returns, and listing the rows took the controller past the length the development guide sets.
The conflict card's statement is in `reviewQueueConflicts.ts` for the same reason: it is the
largest the queue sends, and the only one that reads the curation log per field.
What every card shows about its object — `objectContextSelectSql`, `countedWorksSelectSql` —
moved to `reviewQueueContext.ts` with the page size, since a definition two files build rows
from is the only arrangement in which the cards cannot drift apart.

A location's own visibility matters here too: `offeredLocationSql()` — both terms — alongside
`el.curation_state = 'pending'`, because a point the source has withdrawn — or one a curator has
declared gone from the world — is not "unread" in any sense a reader would ever notice: every
reader-facing location read carries the same fragment, so publishing either changes nothing on
screen.

Treasures need a second table, not a second column on one, mirroring
`getExperienceTreasures`'s "three predicates, not one": a link's own `curation_state` and its
treasure's are independent axes (a work is checked once, globally; a link "as being HERE" —
ADR-0025), so a treasure shared across venues can have its link already reviewed while the work
itself is still `pending`. The count asks both — `et.curation_state = 'pending' OR
t.curation_state = 'pending'` — or such a treasure would be invisible on this page and never
asked about. `et` and `t` are joined unfiltered (the pending check moves to the `FILTER`/`WHERE`
instead of the JOIN condition), because `t.curation_state` is not visible from inside `et`'s own
`ON` clause.

Each kind is aggregated in its own `CROSS JOIN LATERAL`, and the joins' own arithmetic is what
decides it: `el` and `et` are independent one-to-many on the same experience, so joined side by
side their row count is a product, not a sum. Three pending points and twelve pending works make 36
raw rows for one experience, so a plain `COUNT(...)` reported 36 for a treasure count that is
actually 12 — and 36 again for a location count that is actually 3. `COUNT(DISTINCT ...)` absorbed
that; a *list* cannot, and would have shown each point twelve times. Aggregated apart, the product
has nowhere to form, and each side carries its own `LIMIT`.

An `arrival` can never share a row with `held` or `contents`: `held` requires
`pending_change_sync_log_id IS NOT NULL`, and the pointer is only ever *set* on a membership whose
`curation_state <> 'pending'` (`heldProposalPointer.ts`), while
`contents` requires `hidePendingSql()` directly. Both therefore exclude `curation_state =
'pending'` by construction, the same column `arrivals` requires to equal it — not a coincidence
enforced by extra code, but the same column read two ways. A `pending` experience *can* hold a
`pending` location at the same time (the location's own gate is keyed off the source, not off
the container's current state), and such a row is real; it is classified only as an `arrival`,
never as `contents`, for exactly that reason. `missing` and `held` are not mutually exclusive the
same way, though — both read a row's *own* `missing_since` and `pending_change_sync_log_id`
independently, so `held` carries its own `missing_since IS NULL` guard rather than relying on
`arrivals`'s structural argument.

The queue pages by cursor (`limit` default 25, 100 at most): one *Show more* at the foot of the
list asks for the next page at `paging.nextCursor` and appends it, and the three answered lists
below it keep their own Previous / Show more on their own offsets. The toolbar prints the whole number
under the filter — `1,621 open` — and the list's own accessible name says how much of it is
loaded (`25 of 1,621 questions loaded`, the container's `aria-label` rather than text on the
screen). A day or question heading carries a count only once every page is loaded: a page holds
25 of a backlog the toolbar has just called 1,621 open, so a number beside "Sat 5 Sep" would be a
claim the list has no way to make, and the honest answer until then is no number at all.

The page lives at `/review` (`frontend/src/components/curation/ReviewPage.tsx`, with the list in
`ReviewQueueList.tsx` and the search, order and chips in `curation/feed/`), reachable from the
header for curators. That gate is convenience: every action it offers is checked server-side
against the caller's scope. Its whole working set — the order, the search, the source, kind, region and run filters and
the question open on the right — is the page's address (`docs/tech/addresses.md` § The review
page), so a filtered feed is a link and Back undoes a filter.

**A row is a proposal with two answers, and a selection is answered at once** (#852,
[ADR-0053](../decisions/0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md)).
Every row carries a box (`ReviewQueueList.tsx`; a sibling of the row's button, so the row stays
one control): a click ticks it, a shift-click ticks the loaded rows between it and the last one
clicked, `x` ticks the row the keyboard is on, `Esc` clears; a tri-state box over the list ticks
the loaded rows and, once a whole page is ticked with more matching, offers *Select all N
matching* — `N` is the endpoint's `total`. The ticks are `curation/selection/useRowSelection.ts`
and are transient by design — never a parameter (`addresses.md` says why) — surviving *Show
more*, dropping a row that left the list, and cleared with a notice when `filterKey` changes.
While anything is ticked a page-fixed bar (`SelectionBar.tsx`) names the selection by kind
(`answerWords.ts`: a `waiting` row counts by the sub-kinds it holds) and offers *Accept the
proposed changes* and *Reject the proposed changes*, each expanding to what it does per kind in
the words that kind's card uses — the table in `answerWords.ts` is the one both the bar, the
summary, the confirmation and the cards' own new buttons quote — and *Lost* only for a
selection wholly of `missing` rows or wholly of `withdrawn` rows; the bench shows a summary
(`SelectionSummary.tsx`) instead of one card while more than one row is ticked. The rows on
screen go to `POST /review/answer` in chunks of the page maximum (`answerRows.ts`), progress
between chunks; an all-matching selection is walked through `fetchReviewQueue` under the
filters, limit 100: the first page after every answer, since answered rows leave the list, and
past a page holding nothing untried — refused rows are remembered and skipped — by the queue's
own cursor, until a page with untried rows turns up or the cursor runs out, so a page of
stubborn rows never ends the walk with matching rows behind it. A batch within one page asks
nothing, every answer having a take-back at the foot of the page since #859; past it, or
all matching, `useAnswerSelection.ts` opens a dialog naming what it will do per
kind. Afterwards `answerNoticeFor` (`answerNotice.ts`) says what happened in the gate notice's
shape, through the three clauses `utils/noticeClauses.ts` shares with it; a transport failure
part-way is `AnswerStopped`, carrying what landed, and the line says which rows may already be
answered. The batch invalidation (`invalidateAfterBatchPublication`) follows, the queue's key
included.

**A proposal is a table of facts** (#570). `factRows.ts` turns what the queue carries — `metadata`
with an object on each side, `location`, `shortDescription` — into rows: one per fact that
moved, each with its meaning from `fieldMeaning.tsx`, its kind (*new*, *changed*, *removed*)
and the one sentence its fact has about the change. `FactTable.tsx` lays them out as *fact ·
readers see · the run proposes* (a held card) or *fact · as curated · the source proposes · your
answer* (a conflict card — "as curated" rather than "yours", since the value that stands may be
another curator's, and the trail under it says whose), and `ProposalSummary` counts the rows by kind above the table, so a
curator reads which question the card asks before a single row: on this catalogue 1272 held
cards propose only facts arriving — the criteria, which no reader surface shows yet, and a
picture credit, which readers will see under the picture. The line "nothing readers see
changes" is said from the facts rather than from the kind of change: only where every row
arrives *and* the vocabulary marks each arriving fact `unseen` (`UNSEEN_BY_READERS` in
`fieldMeaning.tsx`, measured against what the expanded row, Discover's card and its detail
panel read), since a picture or a description arriving is a fact appearing that readers see. A picture row draws the picture (#801): `imageUrl` on the object and `image_url` on a work render through `PictureFact.tsx` — the picture at the size the dialogs preview at (`PictureWithCredit`), `ImageCreditLine` under it, and the file's name as the link to the address — where the row used to print two Commons URLs, one per column, on each of the 86 cards run 93 filed about a public-art row's picture. Each side is credited to *its* photographer: `render(value, context, side)` reads the proposed `metadata.imageCredit` row's `old` for the column readers see and its `new` for the proposed one, a credit inside a whole `metadata` row on a card filed before ADR-0039 the same way — and, where no credit row was filed, `context.imageCredit` (the object's stored credit, which both cards put on the context) for the column readers see and *nobody* for the proposed picture. The absence of a row is not evidence that the credit is unchanged: for a claimed picture the run resends the stored credit rather than resolving the source's (`creditToWrite`), and for a work whose picture is in conflict it files no credit at all (`creditChange`), so a conflict card never carries one, and the only credit it knows is the current picture's — borrowed for the proposal, it would name a photographer for a photograph that is not theirs. A `FactRow` carries the `ChangeContext` it was built in for exactly this: `partGroups` builds a part's rows in the part's own context — its fields, its picture's credit — so a work's picture is never credited to the museum's photographer, and `FactTable` takes no context of its own. The shape is the one the tools built for this decision converge on:
Wikidata's Mismatch Finder lays a disagreement with an external database out as *property ·
Wikidata value · external value · review status*, one row per property; OSMCha colours a
changeset added / modified / deleted before a reviewer opens a feature; Wikimedia's visual diffs
show a change as the reader would see it rather than as it is stored.

The measurement behind it: `metadata` is the most frequently changed field in
`experience_sync_changes` — 4314 entries, against 3785 for `tags` and 124 for every named
`metadata.*` key together — and 2927 of those 4314 differ in exactly one key, none in more
than three. Printed whole, the run-68 proposal on the Bamiyan Valley asked about eight named
things on one side against six on the other; as rows it is three facts.

What the table decides, rather than merely draws:

- **Rows, not fields.** The storage grouping — "source data", then the keys under it — is gone.
  A field with named parts becomes one row per part that moved (`changedKeys` in
  `objectDiff.ts`; the keys that agree are not rows), and the rule is the *shape* rather than the
  field's name: `nameLocal` is a language map with the same defect and gets the same rows, each
  named as its language. **The splitting reads older records only.** A run files a fact per
  metadata key (ADR-0039) and a fact per language (#728), each arriving as one row that names
  itself — `meaningOf` sends `nameLocal.<lang>` to the same vocabulary entry `keyMeaningOf`
  produces, so a row reads identically whichever way it arrived. The rows **a split makes** stay
  contiguous and share the field's answer — the answer cell spans them, and a conflict card's
  does so because `accept-source` takes a field and never a key
  inside one. Nothing a run files today splits, so nothing it files spans: a per-key and a
  per-language row each carry their own field and get their own cell.
  A value the vocabulary can say whole stays one row — the rule is a `render` on
  the meaning, not a list of field names — so a coordinate is a place and not two numbers, and
  a picture credit claimed per key is the photographer and the terms rather than `author` and
  `license` rows carrying a definition written for neither. `tags` is never a row
  (`NOT_A_QUESTION`): nothing on the site reads them, newer runs
  do not file them, and publishing a card an older run filed still writes them — harmless for
  the same reason they are not shown.
- **A type is explained in its kind's vocabulary.** The row is *type*, never *category* — that
  word is the chip beside the object's name, the kind — and `meaningOf('type', value)` reads
  the proposed value (or the stored one, where nothing is proposed) to say which closed
  vocabulary it is from (`typeVocabularyOf`, `utils/experienceTypes.ts`): a monument's card
  explains monument or sculpture, a natural site's cultural / natural / mixed. One sentence for
  every kind, opening with UNESCO's, is what *The Motherland Calls* used to get (#814). And the
  fact is one row: public art stored its type twice, as `category` and `metadata.type`, so a run
  proposed the same change twice and a curator answered twice — migration 044 dropped the key
  and the duplicate entries, and the landmark writer no longer writes it.
- **The card's equality is the server's own: `jsonEquals` from `@tyr/shared/equality`**
  (ADR-0065). The server decided the *field* changed; `changedKeys` decides which *keys* to
  show for it, and the two must answer alike or the card contradicts the queue that raised it.
  Key order is not a difference (JSONB does not keep it) and `null` against a missing key is
  not one either — which is what keeps the 17 log entries where `criteria` merely appeared as
  `null` off the screen. Those four properties are stated once, in `equality.test.ts` beside
  the declaration; `changeSet.test.ts` holds the diff to it with one case, and the pre-existing
  "ignores JSONB key order" case does **not** cover this — its reordered keys are compared per
  key, each being an entry of its own since ADR-0039. Until #789 `objectDiff.ts` held a copy
  named `valuesEqual`, pinned to the server's by the same four cases stated in both suites.
  `isEmptyValue` beside it is deliberately wider — an empty list is nothing to a person, so a
  row reads as *new* rather than *changed* — and kept apart, since the server's equality is not
  the card's to loosen.
- **A value is shown as readers see it.** Each meaning may carry a `render`: the In Danger badge
  is the badge, with the year from the object's own listing (every queue kind now selects the
  danger listing through `dangerSelectSql` and maps it with `withDangerFields`, so a card gets
  `danger_since` exactly as the badge does); the criteria are chips with their meaning one hover
  away (`utils/unescoCriteria.ts`); a credit is the photographer and the terms; a Q-number is
  glossed and linked; a year of `-1848` is "1848 BC"; hectares carry m² or km² beside them;
  nothing is a dash. Text a person wrote is compared word by word across the two columns. A
  value the vocabulary cannot say is shown as stored, and the kind stripe says what happened —
  the "shown as stored, not compared word by word" note is gone with the layout that needed it.
- **The definition is on the term.** The fact's name carries a dotted underline and a tooltip on
  hover and on keyboard focus — the idiom `RefusalLine` and `SourceId` already use — rather than
  a question-mark button per row; `HelpHint` (once `RuleHelp`) keeps the button for the places
  that explain a rule rather than a fact, and now says in its accessible name which.
- **The sentence is one line and about this change.** Never the kind, which the row already
  says. A fact whose change is an event in the world — the danger listing, a coordinate, the
  countries, the Wikidata item, the UNESCO region, the inscription year — is marked `event` and
  its sentence arrowed: "Listed since 2003 — readers see no badge today; publishing adds it",
  "Moved 33.4 km north — may fall in a different region; check the pin", "Inscription years do not
  change — check the source page". A changed country *name* reads the country *codes* row to
  tell a spelling correction from a change of country, which is why a sentence sees the whole
  proposal (`ChangeContext`). The year in the danger sentence and on the proposed badge comes
  from the same place: `withDangerFields` dates a listing only on a row whose flag is true, so
  on the one card where the year is most of the fact — a site just listed, flag about to turn
  true — the object carries no year and `listedSince` reads it from the card's own
  `metadata` row or `metadata.dangerList` row, which a new listing always changes with the
  flag. A card carrying no year leaves it out rather than inventing one.
- **Rows are grouped by subject, and the object is only the first.** A run records what moved
  inside an object as well — a place of a serial site renamed, a work's attribution corrected
  (ADR-0026, `contents.locations.changed[]` and `contents.treasures.changed[]`, the same field
  shape one level down; on this database 32 cards carry work-field changes and 2 carry
  place-field changes, e.g. `Château de Montésgur → Château de Montségur`). `FactTable` takes
  `FactGroup[]`: the object's group has no heading, a part's group is headed by the part's name,
  what tells it from its siblings, and `onOpen`. The held card feeds those groups since ADR-0037
  (`heldPartsSelectSql` selects `changed[]` entries with held fields and resolves each to its
  stored row), and a part's group opens through `PartPreviewDialog` — a place on the map, with *Fix this
  point* beside it where the stored row was found (#583), or a work in the dialog it is corrected in,
  its makers reorderable and its title, year and picture editable where the stored row was found
  (#731) — until a part has an address of its own (#575). Where it was not found the part opens
  nothing at all: everything a preview would draw belongs to the row that is gone. The subject also carries the
  part as the *record* names it (`subject.part`), which is what an answer about one of its rows
  is built from (#722); `key` is unique only within a card and `label` is for a person, so
  neither can stand in for it.

**The three gated kinds share one section and group by experience.**
`frontend/src/components/curation/WaitingToPublish.tsx` renders "Waiting to be published" — one
heading, one sentence (nothing here has reached a visitor), and one card per experience whatever
mix of `arrival` / `held` / `contents` named it. `groupGated()` does the joining, because the API
answers `held` and `contents` separately so each query stays simple while a museum whose label is
held *and* which gained twelve paintings is one object and one decision to the person looking at it.
Inside a card the rows follow ADR-0025 § 4.2 — `fields` with both versions, and `points` and `works`
in `curation/GatedContents.tsx`, their own file since each gained a way in: counts over listed rows
(`shared/ContentsList.tsx`), an unread point's name opening `PointPreviewDialog` where it can be
corrected (#583), an unread work's row carrying a *Correct* action into `WorkPreviewDialog` (#731).
That component is mounted **keyed on the object**, which is what stops a dialog opened on one card
from standing on the next: `ReviewBench` mounts `GatedCard` unkeyed on purpose, so the object
preview survives a move down the queue (`ObjectPreview`), and without the key a point or a work
held open would be paired with the next card's id and name. The card resets `openPart` by hand for
the same reason — and `ItemHeader`, `messageFor` and `GatedRow` come from `queueCard.tsx`, which exists so every page
file rendering a card shares the idiom without importing another one (`lint:circular`). There are
three of them today, grouped by what raises the section, and the module's own docblock names them:
a fourth is a section added rather than a count to revise. `GatedRow` is shared for a second reason
besides that one — not across sibling pages but across the two files that draw *one* card, since the
56px gutter its labels stand in has to be a single decision or the rows in that column stop lining
up.

What the card does that is not a free choice:

- **One button for the object, and two answers per held row.** The object-level publish is one act
  at the endpoint: naming no contents applies the held fields, marks the row read *and* releases
  every unread point and work under it, and the label says what the click covers ("Publish the
  change and what arrived with it"). Beside it, since #722, each fact on the held table carries
  its own answer in its own column — **publish this** and **not this**, the conflict card's shape.
  A key inside the source's data is a fact and carries its own pair of buttons (ADR-0039), and so
  is one language of the local names (#728) — a curator who wants Getbol's corrected Korean name
  no longer has to take the English one with it. **Nothing a run files today spans**: the column
  spans only on a card filed before those two, whose keys or languages share one field, kept alive
  because a changeset is never rewritten. It says how
  many it answers there, which is the only thing on screen that says so. `HeldAnswer` builds the selection from the row's subject: the object's group names the
  field, a part's carries the pair the record identifies it by. Neither button is a primary — the
  card's premise is that readers keep what they can see until somebody says otherwise. The
  contents rows still have no per-row control: this queue counts them rather than listing ids on
  each, so a third button there would promise a precision the screen cannot express (#524).
- **`expectedSyncLogId` is sent for a `held` card only.** An arrival's `sync_log_id` is the run that
  first saw it, not a pointer — a `pending` row holds no proposal — so sending it would be compared
  against `NULL` and refused every time.
- **A card with contents but no held half sends `contentsOnly: true`, not an empty body.** An empty
  body is an object publish: the endpoint sets `curation_state = 'verified'` on the experience, which
  is exactly right for an arrival — there is no earlier verified state to misreport — and exactly
  wrong for a card whose only open question is twelve unread paintings under a museum readers already
  see. `contentsOnly` publishes every pending content row and leaves the experience's own state alone,
  with no staleness check, matching what `held` alone already gets right by naming the pointer.
- **The contents counts are cast.** `COUNT(...)` is `bigint`, which `pg` hands over as a string, so both
  counts carry `::int` — wrapping the whole aggregate, since `FILTER` binds to it. Measured before the
  cast: `pending_locations` arrived as `"1"`. That survives arithmetic by coercion and breaks a plural
  rule, which compares against 1 (`'1' === 1` is false), so an uncast count reads "1 points" on the
  card. A test pins the cast, and the card keeps one `Number(...)` as a floor under it.

What the publication did is reported in the page's own notice, because the refetch takes the card
away: which fields landed, how many points and works became visible, `withdrawalsReleased` (the
moment a replaced pin stopped being shown, recorded nowhere else) and `placementFailed`, which turns
the sentence from a success into a success with stale regions. `POST /:id/admission`'s `published`
is reported the same way, so "put it back" says whether the row is now visible rather than leaving
the curator to look for a second button.

**A placement failure names its world views, because its reader cannot act on it.** Re-assignment is
admin-only end to end (`requireAdmin` on the whole admin router; `AdminDashboard` redirects everyone
else), while this page's ordinary reader is a region- or source-scoped curator — so the response
carries `placementFailedWorldViews` beside the flag, one entry per world view that failed, each with
its name for the person reading the notice and its id for the admin they take it to. `id: null` is the
one case with no world view to name: listing them is what failed, so none was attempted. The reason
each gave stays in the server log and out of the response — it is a database error string the curator
can do nothing with, and the admin reading the log has it in full. Before this the "which" existed
only in a `console.error`, which left the curator saying "something about regions failed on the Prado".

**Publishing invalidates the object's own caches, not only the queue.** `invalidateExperiences(qc, {
experienceId })` — the same helper the edit and reject mutations call. A publication changes the
fields, points, works and counts every other surface reads, and the object a curator opens from the
card shares its cache key (`['experience', id]`) with Discover and `CurationDialog`; without this a
publish that succeeded is followed by the pre-publish snapshot for as long as the global 60s
`staleTime` lasts. The admission cards invalidate for the same reason, since an `override` publishes.

Three caches hold what a publication releases and each is keyed differently: the object's points
(`['experience-locations', id]`), its works (`['experience-contents', id]`), and the **region** batch
that draws the pins (`['region-locations', regionId, includeLost, includeChildren]`). The queue is not region-scoped,
so it cannot name the third — and the helper therefore invalidates that key by prefix whenever it is
given an object without a region. The asymmetry that makes the omission visible rather than
theoretical: `['experiences']` prefix-matches the by-region list, so the list refetches on its own,
while the batch beside it is held for five minutes (`useRegionLocations.ts`) — a just-published
museum in the list with no pin, and the `0 locations` count that hook's docblock warns about. A
region-scoped caller still invalidates only its own region, because it knows which one it changed.

**The card names the one way to keep a curator's own wording.** `heldFieldWrites` re-reads
`curated_fields` fresh under the write lock and skips any held field the curator has claimed since the
run, reporting it back as `claimedFieldsSkipped`. So "keep the twelve paintings, refuse the proposed
label" *is* expressible — edit the field first, which claims it, then publish — and the card says so
next to the wording it is showing, because a lever nobody is told about is an accident rather than a
feature.

A curator can also follow a card through to the object it names — the card's "Look at the object"
reads `GET /api/experiences/:id`, which is the by-id relaxation's whole purpose (§ What a curator
can open). An arrival is in no list, no count and on no map, so without it the card names an object
and offers nothing to judge it by. That read carries no `location_count` at all — the column exists
only on the region list's own query (`buildRegionQueries`) — so the preview says nothing about how
many points or works the object holds, rather than printing a count that would read zero regardless
of the truth; issue #524 tracks the read that would list them properly.

### Publishing (ADR-0025 § 4.4)

`POST /api/experiences/:id/publish` (`publishController.ts`) is the answer to all three of the
kinds above. No longer the only writer that moves a row off `pending`, and never was: `/:id/admission` has
done it since this stage's own § 4.5, since overriding a refusal on an unread arrival marks it
read, and `publish-waiting` does it per object for a whole source — but still the only one that clears `pending_change_sync_log_id` in answer
to a person, because the batch leaves held proposals for the card that can show `old → new`. One transaction under
`SELECT … FOR NO KEY UPDATE`, shaped after `applyProposedFields`: everything the decision rests on —
the pointer, the proposal, `curated_fields`, `curation_state`, `admission`, `metadata` — is
re-read inside the lock that writes, and every refusal is awaited before the client is released.
The state, the verdict and the pointer are the membership's (#822), read beside the place under the
place's lock — the lock every writer of the membership takes — and written on the membership the
click answers (`membershipToAnswerSql`, the place's only one until #755), while the content lands
on the place: two statements in the one transaction.

It is two modules. `publishController.ts` is the transaction shell — the lock, the staleness check,
the contents, the released withdrawal, the placement, the audit line. `publishHeldFields.ts` is the
other half: given the `changed_fields` a gated run recorded rather than wrote, which columns does
publishing assign and which does it leave alone. That half depends on nothing in the shell (no
lock, no refusal, no pool), and the shapes that make it awkward are all per-column — two jsonb
columns, one geometry built from a pair, and `metadata`, which no single changeset entry describes.

**It needs migrations 019 and 020 to exist.** Without 019 the audit insert violates the `action`
CHECK, so the endpoint answers a bare 500 and the publication rolls back correctly and completely
— a working refusal, but an opaque one. Without 020 the two statements that release a held
withdrawal name a column that is not there, with the same result; and a gated run fails earlier
still, since `locationWriter` writes the pairing into that column and the whole location write for
that experience rolls back. Whether a given database has been through them is now readable —
`npm run db:migrate:status` lists what is pending, and `npm run db:migrate` applies it
(ADR-0041) — so 019 and 020 are no longer two hand-applications to remember.

**Five shapes, all explicit, none of them inferred from the others' absence.** An empty body
publishes the object: its held fields, `curation_state = 'verified'`, and every unread point and
work it holds. `{ contentsOnly: true }` publishes every pending content row and leaves the
experience's own row alone — a visible museum that gained three checked paintings has not thereby
been read. `{ locationIds }` / `{ treasureIds }` (or both) do the same for exactly those rows.
`{ fieldsOnly: true }` is the mirror of the second (#524): the held fields land and every unread
point and work stays where it is, so declining one proposed sentence stops holding back twelve
checked paintings. `{ heldFields }` / `{ heldParts }` with `expectedSyncLogId` narrow that mirror
again (#722): the rows named are written and the rest of the card stays open, which is what keeps
the pointer. The held fields of the object's *parts* go with the object's own on both shapes
that write them ([ADR-0037](../decisions/0037-a-part-field-readers-see-is-held-like-the-objects.md);
`publishHeldParts.ts`): each part is resolved through `partRecord.ts` and locked after the object,
a place's `name` and a work's `name`, `artists`, `year`, `image_url` and credit are written from the
run's own record, a field the part's curator has since claimed is skipped and reported per part, an
unwritable field refuses the whole call with the pointer standing, and a part the record names that
no offered row answers to is reported as `partsNotFound` and the rest published — 409ing over a place
the source has since withdrawn would leave a card no answer can clear. Each such part carries its
`reason`: `withdrawn`, or `ambiguous` for a place more than one offered row answers to that nothing
tells apart (#833) — the outcome line says which, since one asks the curator for nothing and the other for a look
at the siblings. An ambiguous part's rows stay open and keep the pointer, so the card the outcome line
sends the curator back to is still there; a withdrawn part's do not, which is the clearing the sentence
before this one exists for. The staleness check covers a
proposal held on parts alone, asked of the proposal rather than of the writes. The response carries
`appliedParts`, the audit row `parts` and `partsNotFound`. A contents publish touches none of it. It answers **409 on a row nobody has passed yet** — an arrival has no held
fields to publish on their own, and publishing it this way would put an object in front of readers
with nothing on the map, which is what the writer's deferral machinery exists to prevent. The trail
records which of the three acts it was — `scope`, one of `object`, `contents` or `fields` — because
an object publish over a row holding no unread contents writes the same zeros as a fields-only one.
The schema's five `.refine`s keep the alternatives apart and hold a held selection to its
run — and one pair is deliberately left alone, `fieldsOnly` beside a held selection, which restates
its own half and has a single reading, so a rule against it would be a rule with no defect behind it.
The five: `contentsOnly` beside a named array says "contents only" twice, any contents publish beside
`expectedSyncLogId` answers a question it is not asking, `fieldsOnly` beside any contents shape asks
for the object publish an empty body already means, `heldFields` or `heldParts` beside a contents
publish is two answers in one body since either already publishes the fields half, and either of them
*without* `expectedSyncLogId` is a 400 — a per-row answer names the run it answers, and a selection
carrying no run would be applied against whatever the object holds by then. An empty array is a 400 rather than either reading, since it would mean "publish
nothing and do not publish the object either". A named work publishes two rows, its link
(`experience_treasures`) and the work itself (`treasures`), because a reader's treasure list gates
both and a work is passed once globally while its link is passed as being *here*; both writes are
scoped through this experience's own links, so an id belonging to another venue changes nothing.

**A held card is answered one row at a time** ([ADR-0038](../decisions/0038-a-held-proposal-is-answered-per-field.md),
#722). `heldFields` / `heldParts` narrow the fields publish the way the id arrays narrow the
contents one: those rows of the held proposal are written, the rest stay open, and what stays open
is what keeps `pending_change_sync_log_id` — so publishing one of Getbol's six held fields leaves
the card standing with the other five on it rather than clearing them unanswered. Naming either
makes the call a fields publish, so it is refused on a `pending` row for the same reason
`fieldsOnly` is, and it may not accompany a contents shape. It also requires `expectedSyncLogId`,
which the rest of the endpoint leaves optional: a per-row answer is about the proposal one run made,
so a selection with no run named would be applied against whatever the object holds by the time it
arrives. A selection that reaches no open row answers 409 rather than reporting success. The mirror answer is `POST /:id/decline-held`
(`declineHeldController.ts`), which names the same rows the same way, writes nothing to the object
— the stored value has already won every run since the gate first held this one — and claims
nothing, which is the whole difference from the one lever a curator had before (edit the field,
which claims it, then publish, which skips it). Both record what they answered in
`experience_held_decisions`, keyed on the experience, the part the record names and the field, and
storing **the value**: the queue, `heldWaitingSql`, the admin panel's count and the catalogue
assertions all compose `heldDecisions.ts`'s fragments rather than spelling the comparison again, so
a source that comes back with a *different* value asks again while one that repeats itself does not.
They ask the same question with one deliberate exception, stated where a new reader would look for
it (§ The gate's own three kinds): `picture-with-nobody-credited` asks whether the row was
**refused**, not whether it was answered, because a published credit can still be unwritten. Publishing records its own
verdict too, and that is what makes a one-row publish possible at all — a card that keeps its
pointer would otherwise go on offering a value it has just applied, since a run's record is never
rewritten to say otherwise. Both endpoints clear the pointer only when nothing is left open. A
*publish* that names no selection answers the whole card, so it leaves nothing open and clears the
pointer exactly as every call did before; a refusal always names its rows, `declineHeldBodySchema`
requiring at least one.
**A picture and the credit that belongs to it are one answer**, and that is the one place a
per-row answer is deliberately not per row. It holds at both levels now (ADR-0039): a run
records every metadata key as a fact of its own, so the object's credit is
`metadata.imageCredit` exactly as a part's is, and `heldSelection.ts` has each name the other —
a selection reaching the picture reaches the credit with it, at both endpoints, since a coupling
only publishing honoured would let a refusal separate what a publication cannot. The pairing is
level-aware because the two levels spell the picture differently: the object's changeset field is
`imageUrl`, a part's is its column `image_url`.

Underneath it, `creditPin`/`nextMetadata` still hold the column rule — **the stored credit is the
credit of the stored picture** — for the shapes the pairing does not reach. This call writes the
picture and the run's own credit entry drops the key, so the stored one goes: no credit beats the
last photographer's name under a photograph they did not take. A run that says *nothing* about the
credit is the opposite case and the pin stays out of it — silence is the run asserting the stored
credit, and reading it as an offer of none would delete one the source still stands behind. Or a card **filed before ADR-0039**,
whose credit rides inside a `metadata` catch-all with no name of its own and can therefore still
be refused while the picture lands — the row is then published with nobody credited and
`picture-with-nobody-credited` reports it. Those cards keep standing until a run re-proposes,
because a changeset is what happened and is never rewritten, so `creditProposal` reads the named
entry first and falls back to the catch-all's key. Or
the run offers a *different* picture and this call is not writing it, so the row keeps what it
shows and the stored credit with it. Everywhere else the pin is null and the credit's own entry
decides, which is not a corner but the
ordinary case: **all but one of the cards holding a credit hold no picture change at all**, the run
having found the photographer for the picture the page has been showing all along (§
`picture-with-nobody-credited` in `data-assertions.md`). A rule that fired there would delete the
credit *and* mark the row answered, so no later run would offer it again. A curator who claimed
`metadata.imageCredit` on its own still wins over the pin, that being an answer already given.
Without the rule, a per-row answer could put a new photograph under the previous photographer's
name, or credit a photographer for a picture nobody is shown — reachable on Getbol's own card,
where run 68 proposes a photograph and a credit for it in one changeset.

Two kinds of row survive on a card that keeps its pointer and nothing on it can clear — a field
the curator has claimed since the run, and a part the record names that no offered row answers to
— and the object-level "Publish the change" reports both and clears the pointer, which is the way
out.

**`contentsOnly` exists because "absent means the object" was a defect, not a convenience.**
Before it, a contents publish was inferred from named ids alone — nothing named meant an object
publish, full stop. A card with pending contents but no ids to name (one that counts rather than
lists them) would have to send an empty body to publish just its contents, which published the
object instead. Usually harmless, since publishing an already-visible object's non-existent held
fields is a no-op; not harmless when the row held a real pointer whose one held field a curator had
already claimed (see the staleness paragraph below), where the empty body both silently marked the
object read and, before that fix, 409ed forever trying to. `{ contentsOnly: true }` says the
intent explicitly, so the inference never has to be made again.

**A point the source has withdrawn is never published**, named or not: the location statement
carries `offeredLocationSql()`, the same predicate the `contents` card carries, and the two have to
move together — the card is what asks the question the statement answers. The reason is not that a
withdrawn point is invisible anyway (it is, through `offeredLocationSql()`) but what happens when it
comes back: `locationWriter`'s "offering it again" arm clears `missing_since` and deliberately
leaves `curation_state` alone, so a point published while withdrawn reappears on the map already
marked `verified` — a coordinate no card ever showed a curator, recorded as one a curator passed.

**A refused row cannot be published** — 409, naming the order to work in. ADR-0025 decision 4:
admission is asked before publication, so whether anyone has looked at an object is a question asked
only once its kind's own rule has answered yes (ADR-0024). All three of the gate's queue kinds
carry `hideRefusedSql()` for the same reason, and the consequence of allowing it is not cosmetic:
nothing returns a `verified` row to `pending`, so the row would leave `arrivals` for ever and a
later `override` would put it in front of readers with nobody having reviewed its contents. The way
through is `POST /:id/admission` with `override`, which publishes in the same transaction — see
"Overriding a refusal is the other half" below for what that writes. Contents publishes are refused
on a refused container too, since the `contents` card excludes it as well.

**`expectedSyncLogId` is compared against the membership's `pending_change_sync_log_id`**, not against
the newest changeset as `accept-source` does: the card names the run the pointer names, and a newer
run overwrites the pointer, so equality with the pointer is the whole staleness question. Absent is
a claim too — "this row was holding nothing" — so a proposal that arrived after the card was drawn
is refused with 409 and the current pointer rather than published unread. It may not accompany a
contents publish, named or bare, which touches neither the held fields nor the pointer.

**The check only applies when it has something to be about.** `pending_change_sync_log_id` is set
for *any* refused proposal, including one whose only refused field a curator had already claimed —
and the queue's own `held` card correctly excludes a claimed field from what it shows, so such a
row's card has no held half at all. Before this was narrowed, the comparison ran unconditionally
whenever the call was an object publish: the card sent an empty body (no held field to show meant
no `expectedSyncLogId` to send), the stored pointer was non-null, and the row 409ed forever with no
run id the curator could ever discover to answer with. The check now runs only when the call will
actually write a held field (`applied`/`unwritable` between them say whether there is one left once
a claim has taken its share out — see `staleProposalRefusal`, `publishController.ts`) **or** the
caller named a run at all: a caller who sent nothing was shown nothing to answer and is exempted the
way the fully-claimed row now is, but a caller who did name a run believed something specific was
held, and if the row now disagrees that belief was still stale even though nothing would have been
written from it. ADR-0025 § 4.4 already says a contents publish leaves the experience's own state
untouched, which is why skipping the check for a call that writes nothing costs nothing: the
object's row is not being answered for either way.

**An arrival has no staleness check available at all**, and the parameter must not be read as
covering it. A `pending` membership never holds a pointer — `heldProposalPointer.ts` sets one only where
`curation_state <> 'pending'`, because a row nobody can see is refreshed in place rather than held,
so that a curator reviews the newest state instead of whatever landed first. A run that rewrites an
arrival between the card being drawn and the click is therefore invisible to the curator and to this
comparison alike, and what gets published is the newest state rather than the state on the card.
Nothing in the schema records what the card showed, so there is nothing to compare against;
changing that would be a decision about how arrivals are stored, not about this endpoint.

**All eleven content fields, not `accept-source`'s five.** The column list comes from
`CURATED_KEY_BY_FIELD`, so it cannot drift from what the upsert honours. It has to be the full
eleven because `accept-source`'s answer for the other six is to release the claim and let the next
ordinary run apply the value, and under a gate the next run holds it too — six fields would be
proposed every run and applied never. For the same reason nothing held may be dropped in silence:
a value this writer cannot produce (a coordinate the changeset did not record as a pair of numbers)
refuses the whole call rather than clearing the pointer around it.

**Two columns cannot be assigned from what the changeset carries**, and they are one shape rather
than two: a run records a fact per *part* of them, so no single entry describes the column. Both
are merged onto what is stored by one function, and the merge deletes where an entry's `new` is
absent — a part the source dropped is recorded only by its absence, and a `||` merge would leave it
proposed for ever and applied never.

- **`metadata`**, reported **one key at a time** (ADR-0039) — `metadata.<key>` for every key that
  differs, and nothing at all for the keys the run computes about its own pass. Two rules sit on
  top of the merge here: the credit follows the picture (see "The credit belongs to the picture"
  above), and every `metadata.<key>` a curator claims is re-applied from what is stored, exactly as
  the upsert re-applies it.
- **`name_local`**, reported **one language at a time** (#728) — `nameLocal.<lang>` for every
  language that differs. Neither extra rule applies: a language map holds no fact belonging to
  another column, and no per-language claim can exist, because `curated_fields ? 'name_local'` is
  the upsert's whole guard and no editor writes the column. `claimKeyFor` is what sends every
  language to that one claim, so a claimed map is skipped whole rather than written over.

The point of merging rather than assigning is that it is what makes a per-row answer mean anything
on these two columns. Getbol, Korean Tidal Flats (Phase II) is the case: run 68 proposes six local
names, all six dropping "(Phase II)". Assigned, publishing the corrected Korean name would write
the run's whole map and carry the English one with it — a fact the curator never answered.

A card **filed before** the writer changed carries the older shape instead: a `metadata` catch-all
whose `new` is the source's object minus the keys reported individually, or a `nameLocal` entry
holding the whole map. Publishing reconstructs both from the same branch — keys the entry's `old`
does not mention were not its business and are kept, everything it does speak for is replaced
wholesale, which for a whole-map `nameLocal` entry comes to replacing the column outright. The path
stays because a changeset is what happened and is never rewritten (ADR-0039 decision 4) — those
cards stand until a run re-proposes.

**A claim is skipped, not refused.** Publishing answers "may readers see this"; a
`curated_fields` claim answers "whose text is it". Both can be open at once, so a claimed field is
left alone and named back in `claimedFieldsSkipped` while the rest of the call succeeds. The writer
takes only the fields flagged `held`, which is the same predicate the queue's `held` card uses, so
it writes exactly what that card showed and nothing beside it — and reads the flag rather than
inferring it from the absence of a claim (#519), since an elimination would hand this writer, which
assigns all eleven content columns, any future field refused for some third reason.

**`published_at` is stamped only where the membership was `pending`.** `COALESCE(published_at, NOW())`
alone would not restart an existing New-chip window, but it would invent one for the rows that
predate the gate — 1603 of the catalogue's 1604, measured 2026-08-11 — visible for months with
`published_at` NULL, because migration 018 deliberately did not date them. So an already-visible
row's `published_at` is not touched at all, in either direction.

**Publishing releases a withdrawal that was waiting on it.** A moved point under a gated source
is a withdrawal `locationWriter` held back and an arrival nobody can see (see "Location model"
above). Publishing the arrival is the moment the two swap, and it happens in this transaction
because on either side of a COMMIT the place exists twice or not at all. Two statements: the held
point takes `missing_since = NOW()`, driven off `arrived.withdrawal_deferred_for_location_id`
where the arrival is no longer `pending` — which the statement above is the only thing that can
have made true — and then the pairing is cleared, because a pairing left standing outlives its
purpose and turns harmful (a run that offers the old point again clears its `missing_since`, and
the next run to withdraw it would find the stale pointer and hold it for ever, with no second
arrival for anyone to publish). Both are skipped when the call published no point at all, since a
pairing only ever sits on a `pending` one. The count is returned as `withdrawalsReleased` and
recorded in the audit row: a person asking why a pin moved has that row and nothing else, because
the run that proposed the move is a different row in a different table and says nothing about when
it took effect.

The withdrawal also clears the released row's **own** pairing, in the same `SET` list rather than
leaving it to the clear that follows — that one skips rows still `pending`, which is exactly what a
released intermediate in a chain is. It is the floor under `locationWriter`'s prevention (see
"Location model"), and it is a floor rather than a duplicate: without it a chain arriving by any
route the writer does not cover leaves a duplicate pin for ever, and with it for at most one source
interval.

**Publishing does not place — except that one.** Placement's insert predicate is the same
`offeredLocationSql` pair the reads carry — `el.missing_since IS NULL AND el.existence <> 'lost'`
— and nothing else: no `curation_state`, no `admission`, nothing about the experience. So a
`pending` location was already placed by the run that wrote it and flipping it to `verified` moves
no geometry, no point and no membership. The `existence` term joined it with the verdicts
([ADR-0026](../decisions/0026-a-run-records-what-a-container-holds.md)) and changes nothing about
this paragraph's conclusion, because publishing touches `curation_state` alone: what it does mean is
that a curator's verdict on a point *is* a placement event, in either direction, which is why the
verdict endpoint places when it changes what a reader sees and the queue's own contents join takes
the predicate from the fragment rather than spelling it out. A held content field cannot move it
either: placement reads `experience_locations.location`, never `experiences.location`, and no
trigger connects the two. A released withdrawal is the exception, because the old point stops
being offered and the clear is unfiltered while the insert is not: its
`experience_location_regions` rows have to go, and the experience-level union they fed has to be
recomputed. So `assignRegionsForExperiences` runs for that publish only, after the COMMIT and on
its own connection since it opens a transaction of its own, and reports failure rather than
throwing — the publication is already committed, so an exception there would answer 500 to a
click that landed, and the response says `placementFailed` instead. Every world view is attempted
and every failure named in the log, rather than stopping at the first: each is its own transaction
over its own regions, so one failing says nothing about the next, and abandoning the rest would
leave them stale with nothing recording which. The response names them too —
`placementFailedWorldViews`, one entry per failed world view, beside the flag — so the curator
reading the notice can say *which* object and *which* world views to an admin; the log carries the
same list with the database error each gave, which is the half only an admin can use. "Publish places" reads as the obvious symmetry and is wrong for every
other case: an unconditional placement would delete and reinsert region rows across every world
view with geometry, for 18 museums at a time, for no change at all.

The audit row is `action = 'published'`, whose value had to be added to the
`experience_curation_log.action` CHECK in both schema homes (`db/init/01-schema.sql` and
`db/migrations/019-published-curation-action.sql`) — the insert is inside the publish transaction,
so a rejected action would roll the publication back with it. `details` carries the scope
(`object` / `contents`), the fields applied and skipped, the run id, and the three counts.
Publishing an already-published object is allowed, and is how a curator takes newly-arrived unread
contents under a row that is already visible. It decides nothing a second time — `curation_state` is
already `verified`, `published_at` does not move, the pointer is already null — but it is not a
no-op at the row level: it writes a second audit row, and `experiences.updated_at = NOW()` moves
whether or not anything else does, because the assignment list is fixed rather than diffed.

### A curator's no, and one answer to many rows (#852, ADR-0053)

Publishing was the only answer the gate's arrivals and unread contents had; a review row is a
proposal with two answers, and `curatorRefusalController.ts` gives those two kinds their no.
**An arrival is refused the way a rule refuses it**: `refuseArrivalUnderLock` writes
`admission = 'refused'`, `admission_reason = 'kept out by a curator'`
(`CURATOR_REFUSAL_REASON`), the admission pin and `CLEAR_ICONIC` on the membership, under the
place's lock, and leaves `curation_state = 'pending'` — nobody passed it, and ADR-0025 decision
4 asks that both facts be said. The row leaves the queue for the kept-out list, every later run
honours the pin, and `override` publishes it as it always has. **Unread contents are refused by
a mark, never a state**: `refuseContentsUnderLock` sets `experience_locations.refused_at` and
`experience_treasures.refused_at` on exactly the rows the contents card shows, through the two
fragments the card reads; the part stays `pending` to every reader, and what changes is the
question — and, for a point, what a region counts: placement's insert carries `refused_at IS
NULL` too, so a refused point drops out of `experience_location_regions` when the refusal
re-places the object after its commit (`placeAfterRelease`, the reason the route carries
`authenticatedLimiter`), and a point that was holding a replaced pin releases that
withdrawal on the way, as the publish would have. "Unread and still asked about" is spelled once —
`unreadPointSql` and `unreadLinkSql` in `waitingCounts.ts` — and composed by
`contentsOpenSql`, the keys union, the contents card, `contentsWaitingSql` and the three
`publishContents` statements, so a later whole-object publish cannot release what a curator
turned down. A point is unread while `curation_state = 'pending' AND refused_at IS NULL`; a
link on either of its two axes, `(et.curation_state = 'pending' OR t.curation_state = 'pending')
AND et.refused_at IS NULL`, since the link says the work is *here* and the work says it is a
work, and either unread keeps the question open. The mark sits on the link, not the work: "not
this work here" is the link's axis, which is why a refused link is also set `pending` — a
`verified` link with a refusal mark would read as passed to any reader that forgot the mark.

**The way back is the one UPDATE the mark promised** (#859, closing ADR-0053's own recorded
trade-off). `unrefuseContentsUnderLock` (`unrefuseContentsController.ts`, `POST
/:id/unrefuse-contents`) sets `refused_at = NULL` on the marked rows the list
showed — the named ones or all of them — under the place's lock, with the refusal's own
preconditions and its own 409s, and logs `contents_unrefused` naming exactly the ids the
statements returned. Nothing else is written, and two things are deliberately left alone: a
link stays `pending`, because that word says nobody passed the work *here* and `auto` would
silently pass what a curator turned down; and a withdrawal the refusal released is not
re-acquired, the old pin being a withdrawn point asking its own question now (ADR-0026) — the
take-back restores the question, never the pairing. A restored point counts toward its regions
again, so the object is re-placed after the commit through `placeAfterRelease`, which is why
the route carries `authenticatedLimiter` as its opposite does.

**The list a curator finds them in** is `queryRefusedParts` (`reviewQueueRefusedParts.ts`),
answered as `refusedParts` with `paging.refusedParts` and rendered by `RefusedPartsCard` as
the third block at the foot of the review page — beside *what you have kept out* and *the lost
places you have answered*, for the reason both of those exist: a refused part is on no other
screen at all. Shaped like `queryAnsweredWithdrawals`: one row per object, two laterals
numbering their rows before aggregating so the list caps at `CONTENTS_ROWS_SHOWN` without
cutting the count, newest refusal first. **The objects holding one are named before the
laterals run** — `refused_part_holders`, a `MATERIALIZED` CTE of two index-only probes of the
partial indexes migration 052 adds. Two laterals in a FROM clause are evaluated for every row
that reaches them, and a WHERE term cannot stop that, so without the gate the statement
aggregated nothing 2749 times on every read of the page whether or not anyone opened the list:
measured on the development catalogue with no refused part in it, ~100 ms against the 19 ms of
the one-lateral list beside it, and 0.5 ms with the gate. Restating the laterals as `EXISTS` in
the WHERE was measured making it worse. Who turned a part down is read from the log by
**timestamp equality** — the refusal writes `refused_at = NOW()` and its `contents_refused`
row in one transaction and `now()` is one value per transaction, so `log.created_at =
el.refused_at` names the act where matching the log row's ids would name nobody for the batch
answer, which refuses without naming any. The name is scoped in the select list rather than in
the WHERE, for the reason the answered-withdrawals query spells out.

`POST /review/answer` (`reviewAnswerController.ts`) answers a page of rows with one answer, and
`reviewAnswerDispatch.ts` is the table of what each answer does per kind — accept an arrival is
`publishUnderLock({})`, accept a held row `publishUnderLock({ expectedSyncLogId })`, contents
alone `{ contentsOnly: true }`; reject an arrival is the refusal above, reject a held row
`refuseUnderLock(null, runId)` then the contents refusal where contents are open; a conflict is
`acceptSourceUnderLock` / `declineSourceUnderLock` with `'all'`, every open field resolved
under the lock; a refusal is `answerAdmissionUnderLock` (`override` / `confirm`); `missing` and
`withdrawn` take the verdict the answer names through `answerStateUnderLock` and
`answerLocationStateUnderLock`, with the `expected` block an open row means, `withdrawn` once
per open point. Every arm is the `*UnderLock` function the single-row card calls — the five
that were Express handlers were split at #852's first commit — so the batch decides nothing of
its own and re-asks the writer's question under the writer's lock. Measured on the development
catalogue on 2026-09-09: an accepted arrival's points were placed when written (ADR-0025
decision 5), so publishing the 1 078 worship arrivals triggers no placement; the cost is the
publish transaction per object.

### Overriding a refusal is the other half (ADR-0025 § 4.5)

`POST /:id/admission` (`setExperienceAdmission`, `lifecycleController.ts`) is where a refused row
comes back, and `override` on a **`pending`** row is the only path that publishes without going
through `publishExperience` at all — the two assignments are appended to the membership's `UPDATE`
this endpoint already runs (the verdict, its reason, the pin and the badge are the membership's
since #822; who decided and the note stay on the place, beside the lifecycle verdicts that share
those columns), inside the transaction that already holds the place `FOR NO KEY UPDATE`, rather
than a second call to the publish writer. `confirm` never publishes, on any state: it is the
verdict that leaves an already-invisible row invisible.

The decision is narrower than "override publishes":

- **Only `override`.** `confirm` says the rule was right, so the row stays refused and hidden — the
  opposite of a publication.
- **Only from `pending`.** An `auto` row was already visible before its kind refused it — the
  refusal is what hid it, not the gate — so putting it back changes `admission` alone.
  `curation_state` and `published_at` are untouched, and the response's `published: false` says so.
  Only a row nobody had looked at (`pending`) turns "the rule was wrong" into a first publish.

`curation_state` is set to **`verified`, not `auto`.** The default a run leaves behind means "nobody
has looked"; a curator did — they read the card, the reason and the object's name, and overruled a
kind's rule about this specific row. That claim is real but narrower than `publishExperience`'s:
nobody has passed the description, the image or the treasures underneath, only the admission
question. That is the deliberate cost of not asking the same question twice — the alternative is
leaving a `pending` row unread forever because the one card that could resolve it is answered
"admit", not "publish".

`published_at = COALESCE(published_at, NOW())`, gated by the same `before.curation_state ===
'pending'` check as the assignment itself, for the reason `publicationAssignments` states: nearly every
row the catalogue held before the gate is undated because migration 018 left it so, and stamping an
already-visible row would invent a New-chip window for something visitors could see all along.

**Resolved in TypeScript, not a `CASE` over `$2`.** `nextReason` a few lines above is the same
lesson already paid for once: a parameter used both as a varchar value and as the left side of a
text comparison gives Postgres two types to deduce for one placeholder — "inconsistent types
deduced for parameter $2" — invisible to a mocked-pool test and immediate on the first real click.
`publishes` is a plain boolean computed from the read under the lock, and the `SET` fragment it selects is
a literal string with no parameter in it at all.

**Does not place.** Verified against a live database rather than assumed: a refused row's
`experience_regions` count matches an admitted row's exactly, because placement's insert predicate
(`offeredLocationSql()`: the withdrawal flag and the `lost` verdict) reads neither `admission` nor `curation_state` — a refused location was
placed the moment it was written, and un-refusing the object moves nothing.

The audit row is `admission_overridden` either way; `details.published` is what tells the two cases
apart without a reader having to infer it from which columns moved.

## Curation Guarantees

- `curated_fields` on `experiences` protects edited fields during sync upserts
- Manual experiences (`is_manual = true`) are not replaced by source sync
- Manual region assignments are preserved across assignment recompute jobs
- The curation log is scope-filtered per row, not per experience. `getCurationLog`
  reaches the log only if something in it is attributable to the caller's scope —
  a region the experience is assigned to, or a region its log rows already name —
  and then returns the rows for the regions they cover plus the rows that name no
  region. The two halves of that gate are deliberate: removing an experience from
  a region deletes the assignment and logs the removal, so assignments alone would
  refuse a curator the record of their own last act there. Admins, global curators,
  and curators of the experience's source see everything. The predicate is
  `CURATOR_SCOPED_REGIONS_CTE` (`backend/src/middleware/auth.ts`) — the
  descendant closure of a curator's region assignments, the same set
  `checkCuratorScope` reaches by walking ancestors, expressed so it can qualify
  a result set instead of one region. Gate and filter run off that one closure,
  so the gate never admits a row the filter would drop — it is strictly the
  stronger of the two. Where they part is deliberate: a row naming no region
  satisfies neither half of the gate, so an experience whose log holds only
  those is refused outright rather than handed over. That refusal is the hole
  #442 names; without the gate, any curator could read such a log
- An edit is granted on the experience, not on one of its regions.
  `editExperience` intersects the experience's assignments with
  `CURATOR_SCOPED_REGIONS_CTE`, so a curator scoped to any one of the regions it
  sits in may edit it. The previous shape read one region out of an unordered
  `LIMIT 1` and refused the curator whenever that row named a different region
  of the same experience (#450). The same query answers what the `edited` log
  row names: for a region-scoped curator, the lowest-id region of the experience
  their scope covers — every candidate is a region they genuinely cover, and
  naming one keeps the entry visible to its own author under the per-row filter
  above; for admins, global curators, and curators of the experience's source,
  `NULL`, since no single region is where their authority came from and a row
  naming none stays visible to every curator who can reach the log. Every other
  curation handler is told its region by the request — `regionId` in the body or
  the path — so this is the only place the question arises

## Frontend Integration Notes

- Discover and Map UIs share `CurationDialog` and `AddExperienceDialog`
- `CurationDialog` carries where the object is as a field beside its name (`CurationPlaces`, reading `GET /api/experiences/:id/locations`): *Location* for one place — coordinate, countries, a *pin corrected* chip where a claim stands, and the way into `PointPreviewDialog` with the correction offered — and *Places* for a serial site, the parts folded behind a count and shown on request, capped at 25 with "Show all". For a single-place object this field is the only row its place has anywhere, since every places list on a card is gated on `isMultiLocation` — 1178 of 1671 objects on 2026-09-06, every museum and monument among them (#583)
- `AddExperienceDialog` has Create New as the first (default) tab, Search & Add as the second. Props: `defaultKindId` pre-selects the kind dropdown, `defaultTab` controls which tab opens (0=Create, 1=Search). Dialog closes automatically on successful creation and invalidates experience queries so map markers and lists refresh immediately. The kind selector offers the kinds `GET /api/experiences/kinds` lists — there is no "Curator Picks" — and a kind is required for creation; the row is filed under that kind's own source. When the curator types a name (3+ chars, debounced 800ms), the system auto-fills coordinates (Nominatim), image URL, description, and link URL (Wikidata 3-layer lookup: direct QID → spatial SPARQL → name search). The link is auto-filled from the English Wikipedia sitelink in the Wikidata entity. The Nominatim query appends the current region name for geo-disambiguation. Auto-fill fires only once — after the first successful lookup, name edits don't re-trigger. After auto-fill, a suggestion info box appears below the name field showing the matched Wikidata entity (label + QID) with a prominent "Re-lookup" link. Clicking Re-lookup re-runs the full auto-fill pipeline (Nominatim + Wikidata), overwriting all previously auto-filled fields. Auto-filled fields use `useRef` flags (including `linkAutoFilled`) so Re-lookup overwrites them but manual edits are preserved. Thumbnail preview shown when image URL is set. Uses `LocationPicker` for coordinate input — supports 4 modes: click-on-map, Nominatim search, multi-format coordinate paste, and AI geocoding. Accepts `regionName` prop from both call sites (Map mode via `useNavigation().selectedRegion.name`, Discover mode via `activeView.regionName`)
- `CurationDialog` fetches full experience detail to populate two link fields: Wikipedia URL (from `metadata.wikipediaUrl`) and Website URL (from `metadata.website`). Both fields are editable and saved via JSONB merge. `AddExperienceDialog` auto-fills the Wikipedia URL from Wikidata lookup and provides a separate Website URL field. The backend edit/create endpoints accept both `wikipediaUrl` and `websiteUrl`
- `CurationDialog` sends a field only when it changed, and an **emptied** field travels as `''` — the API's way of clearing it. It used to fold an emptied box into `undefined`, which `JSON.stringify` drops, so a removal never left the browser: alone it was answered "No fields to update", beside another change it was reported saved with the picture still there (#696). `CurationDialog.test.tsx` pins the request an emptied picture, description, type and link produce
- `CurationDialog` draws the picture the Image URL box names under the box, through `PictureWithCredit` — the same component the create dialog's preview now uses — with `ImageCreditLine` for the stored credit (#801). The credit goes only with the stored address (`creditForPreview`: the row's `image_credit`, which every list the dialog opens from sends beside `image_url`); an address typed and not yet saved is previewed without one, since none exists until `PATCH /experiences/:id/edit` resolves it; an emptied box draws nothing; an address `toThumbnailUrl` refuses draws no frame; and a picture that fails to load takes its credit with it, the failure held by address because the dialog is mounted for as long as the list is. The same test file pins each of those
- External links are unified across all sources — no source-specific rendering logic. Every experience shows up to two links based solely on metadata: a **Wikipedia** button (`MenuBook` icon, from `metadata.wikipediaUrl`) and a **Website** button (`Language` icon, from `metadata.website`). UNESCO page URLs are stored in `metadata.website` during sync, so they appear as "Website" alongside any Wikipedia link. Both Map mode (icon buttons) and Discover mode (text buttons in detail panel) use the same unified logic
- In Map mode (`ExperienceList.tsx`), each kind's group header has a "+" button that opens AddExperienceDialog with `defaultKindId` pre-set for that kind. An "Add experience of a new kind" button at the top opens Create New with no kind pre-selected. Kind name → id mapping is resolved via the `experience-kinds` query
- In Discover mode, add buttons appear in two places: (1) the list header "Add" button when viewing a specific kind for a region — opens with `defaultKindId` pre-set from `activeView.kindId`; (2) a "+" icon button in each region row's kind pills area (in `DiscoverRegionList`) — opens with no kind pre-selected so the curator can pick any kind. The tree-level "+" is scope-aware: `DiscoverPage` fetches curator assignments from `/api/users/me` and passes a `canAddToRegion` predicate to the list. Admins and global/source-scoped curators see "+" on all regions. Region-scoped curators see "+" only on their assigned regions and descendants (detected via breadcrumb ancestry match)
- Cache invalidation after mutations must include `['experiences', 'by-region', regionId]` (Map mode), `['discover-experiences']` (Discover mode) and `['region-locations', regionId]` — the last because the location batch answers for the rows the list is showing, so anything changing that set leaves its markers stale. The key stops at the region on purpose: the full key carries `includeLost` and `includeChildren` as well — three entries with call sites today, since Map mode reads a region without its descendants under either `includeLost` and Discover reads it with them — and a longer invalidation would clear one of them and leave the rest answering from the old set. `invalidateExperiences` (`utils/queryInvalidation.ts`) does all of it; both `AddExperienceDialog` and `CurationDialog` go through it
- Discover's experiences query is keyed `['discover-experiences', regionId]` — **not** by kind. The response is kind-independent; the kind filter (`?kind=`) runs in `select`, per observer. Keying by kind would give each tab its own cache entry and refetch the whole region on every switch
- Creating a manual experience inserts into 4 tables within a transaction: `experiences`, `experience_locations`, `experience_regions`, and `experience_location_regions`. The last one matters — without it the location's `in_region` flag is false. The markers still appear (`representablePlaces()` falls back to *every* out-of-region place, so a hand-assigned experience is not invisible and is drawn as the places it has), but everything that counts in-region locations reads zero: the `0/N` chip on the row, the visited counts, and the mark-all-locations checkbox, which marks in-region locations and so marks nothing
- `LocationPicker` lives in `frontend/src/components/shared/` with coordinate parsing in `frontend/src/utils/coordinateParser.ts`. Accepts `name` prop to pre-populate search/AI fields; coordinates sync across all modes (e.g. map click shows in Coordinates tab). Exposes `onPlaceSelect` callback that passes Wikidata ID from Nominatim search results
- Visited tracking uses location-level system (`user_visited_locations`) for both the root checkbox and the "Mark Visited" button. The experience-level table (`user_visited_experiences`) is maintained for backward compatibility but the UI is driven entirely by location visits. The `markAllLocations` batch endpoint handles both single- and multi-location experiences consistently
- **Batch location fetching**: `useRegionLocations(regionId, includeLost, includeChildren)` hook (`frontend/src/hooks/useRegionLocations.ts`) fetches all locations for all experiences in a region via a single `GET /api/experiences/by-region/:regionId/locations` call. `includeLost` follows the list and is part of the query key, since a row the list shows and the batch omits renders with no markers and a confident `0/N`. `includeChildren` follows the list too, and for the same reason: Discover lists a region *and* its descendants, so a batch fetched without them leaves an object assigned to a descendant region — a curator's hand assignment — with no places at all. Four consumers share the hook (`ExperienceMarkers`, `ExperienceList`, `SelectedObjectFoldControl`, `DiscoverExperienceView`), eliminating ~300 individual API calls for a 150-experience region. Visit checkbox state is derived from the global `useVisitedLocations().isLocationVisited()` rather than per-experience `useExperienceVisitedStatus()` calls. The batch endpoint also returns `region_path` (full ancestor path from root to leaf region, e.g. "Europe > Germany > Bavaria") for each location via a recursive `LEFT JOIN LATERAL` on `experience_location_regions` + `regions`
- **Reads whose response depends on world-view visibility must be authenticated**: they go through `authFetchJson`, not `fetchJson` — `by-region/:regionId`, `by-region/:regionId/locations`, `:id/locations`, `region-counts`, and `GET /api/experiences/:id`. The first four carry `requireVisibleWorldView`, which answers **404, not 401**, when a world view has `is_public = false` and the caller is not an admin, so an unauthenticated read is indistinguishable from a missing region: react-query stores the rejection as `data: undefined` and nothing surfaces. `:id` is different in mechanism and identical in consequence — it is public by design and instead filters the `regions[]` it returns, admitting every assignment only for an admin, so without a token that documented bypass is unreachable and an experience assigned only to hidden world views returns an empty region list rather than an incomplete one. All five are covered by `frontend/src/api/experiences.auth.test.ts`. One membership is prospective rather than active: `:id/locations` is guarded on `regionIdQuery`, which passes the request through when no `regionId` is supplied, and neither caller supplies one — so as called today that response has no visibility dependence, and this guard alone never 404s. The header is what keeps the route correct if a caller starts passing one. The route can still 404 today, for an unrelated reason: the existence check excludes a refused row, matching `:id` — an admission question, not a visibility one.
- **An in-region count is only meaningful once the batch has settled**: `useRegionLocations` reports `locationsResolved`, and four consumers gate on it — the expanded card's ratio, the row's count chip, the visited controls, and `useExperienceCardReady`. The last differs in kind: the others decide *what* a card shows, while it decides *when* the card is shown at all, because those three parts arriving late would grow a row whose height the virtualiser has already measured. The last is not a display concern and must not be dropped as one: visited state is derived from in-region locations, so an unresolved batch makes `inRegionCount` 0, which short-circuits `inRegionVisitedStatus` to `not_visited`; every toggle then passes "mark", always, and a fully-visited experience can be re-marked but never unmarked. The numerator is derived by filtering the batch while the denominator falls back to `experience.location_count`, which arrives with the experience — so an absent batch does not read as "no locations here", it reads as a confident `0/N`. The 404 above was one way to reach that state; a 500, an offline reload or an aborted navigation are others, which is why the fix is the gate rather than the 404
- **Location display in an open card**: locations are split into in-region (first, fully interactive) and out-of-region (dimmed, not hoverable). **Both lists are capped**: in-region shows `IN_REGION_INITIAL` (20) with a "Show all N places" control, out-of-region shows 3 with "Show N more". The in-region cap exists because a serial site mounts every one of its places into the card — the Historic Centre of Saint Petersburg carries 112, and mounting them cost 432 ms before the card could appear. A hover that comes *from the map* opens the rest by itself when it names a place beyond the cap: the place's row is what draws that hover, and a row that was never mounted draws nothing. Each displays its region path with the common prefix stripped — e.g. if all out-of-region locations are in Europe, "Europe > " is removed so you see "Germany > Bavaria", "France > Paris", etc.
- **Finding one by name** (`Search.tsx`, `ExperienceSearchResults.tsx`, [ADR-0042](../decisions/0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md)): the navigation pane's search box answers two questions at once — the regions of the world view on screen, and the experiences of the whole catalogue — each under its own heading. The experiences query is keyed on the debounced text alone (`['search', 'experiences', q]`), **not** on the world view: the answer is the same everywhere, and which of its rows can be opened is decided when they are drawn. `openableRegion(result.regions, worldViewId)` (`utils/openableRegion.ts`, shared since #894 with every link from one card to another — `PlaceLink`) is that decision — the first entry of `regions[]` in the reader's own world view, which is the smallest one because the read orders them so. A row with one is a `ListItemButton` that writes the whole address in a single `go()` (`/wv/5/r/7100-noord-holland/e/6198-rijksmuseum`, slugs included, pushed so Back returns to the search); a row without one is a plain `ListItem` that says "not in this world view" or "not on a map yet" on a line of its own, since in a 320 px pane the reason is the first thing an ellipsis eats. The rows draw no pictures, deliberately — a picture brings the credit line it must be shown with (`ImageCreditLine`), and a jump-to list is not where a photograph earns the two lines that costs. The default world view is never openable: it owns no regions, and an address under it names none
- Rejected experience visibility is scope-dependent and returned by backend
- Multi-location experiences expose `location_count` in region browse responses for map/list UX
- Detailed marker interaction architecture is documented in `experience-map-ui.md`
