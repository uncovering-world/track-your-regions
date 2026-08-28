# Experiences System

This document describes the current Experiences implementation: data model, assignment logic, curation, and API surface.

## Overview

Experiences are location-based entities linked to regions. The system supports:

- Public browsing and map visualization
- User visit tracking (experience-level and location-level)
- Flexible location model (0, 1, or many locations per experience)
- Curator workflows (reject/edit/assign/create)
- Multi-source ingestion (UNESCO, museums, monuments)

## Active Categories

`experience_categories` is ordered by `display_priority` (lower first).

- `UNESCO World Heritage Sites` (priority `1`)
- `Top Art Museums` (priority `2`)
- `Public Art & Monuments` (priority `3`)

## Core Data Model

### Main tables

- `experiences`: canonical experience record (`location`, optional `boundary`, curation metadata)
- `experience_regions`: assignment to regions (`assignment_type = auto | manual`)
- `user_visited_experiences`: per-user visit state
- `experience_sync_logs`: sync audit log by category

### Location model

An experience can have zero, one, or many locations. Location-bound experiences (museums, monuments) have physical coordinates; non-location-bound ones (books, films) are tied to regions conceptually. Multi-location experiences (UNESCO serial nominations) have independently trackable child locations.

- `experience_locations`: locations per experience (0..N)
- `experience_location_regions`: region assignment per location
- `user_visited_locations`: per-user location visits

**Where a reader is told an object is** ([ADR-0028](../decisions/0028-a-reader-is-positioned-by-places-they-can-go-to.md)). An object carries a coordinate of its own, `experiences.location`, and its places carry theirs. They are independent answers, and they disagreed by more than a kilometre for 106 objects and by up to 191 km (#502) — a list row and a map pin naming different countries for the same site. Every reader-facing read now positions an object with `readerPositionSql()`: **the place nearest the object's own published coordinate**, falling back to that coordinate for an object with no visible place.

One rule, and no tolerance in it. For 1382 of 1604 objects the coordinate already *is* one of the places, so the distance is zero and nothing moves; of the rest the average move is 9.5 km, and the largest are the ones the issue was opened about — Wet Tropics of Queensland 191 km, Gondwana 171 km, Virgin Komi 144 km. The rule ADR-0028 first proposed — the coordinate when it matches a place to within ADR-0027's ten metres, the medoid otherwise — was measured and dropped: it is discontinuous, moving eight objects over 100 km because their coordinate misses a place by a few hundred metres, the worst of them 2068 km. The same rule answers `GET /api/experiences?bbox=`, which used to filter on `experiences.location` while returning the nearest place: a box around 144.97,-15.65 matched Wet Tropics of Queensland and answered with a pin 191 km away, and a box around the part a reader is shown matched nothing at all. Nearest is measured in metres, on `geography`, never in degrees: 42 multi-place objects sit above 60° — Struve Geodetic Arc's 34 points reach 70.7°N — where a degree of longitude is a third of a degree of latitude, and degree ordering was measured picking a further place for six objects. A tie is broken by `el.id`, so the two axes always name one place. The places considered are only those the same reader may see, so an object is never positioned at a point that reader is not shown — except that the caller which shows a curator an object the queue has not passed yet relaxes the same gate here, because a curator deciding a coordinate has to preview where publishing will put the pin rather than the anchor they are deciding against. It costs 25 ms on a whole-region read of 661 experiences and the 3725 places under them.

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
the reference — `external_ref` is populated on 6679 of 6680 stored locations, and for museums and
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
  and 787 of the 788 single-point UNESCO sites carry a component reference. This is what the
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
identical return values and identical rows. `requires_curation` is false on all three categories
on the database as it stands today, which is a fact about the data rather than a property to rely
on — an admin gates a source in one click, and from then on this paragraph describes only the
sources they left alone.

`missing_since` here is a machine observation, exactly as it is on an experience. What a reader
sees does not change, because a withdrawn point used to be deleted and so left every list the
moment a run stopped seeing it: the predicate `missing_since IS NULL` keeps it out
of the marker batch, the experience's own location list, `location_count`, the per-user visited
status, "mark all locations visited", the visit a viewed treasure records for its venue, and
region placement. The controllers take it from one fragment, `offeredLocationSql()`
(`experienceLifecycle.ts`); `regionAssignmentService.ts` writes it out, since a service
importing a controller module would be the first such import in the codebase.

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
`visited-experiences` carries no lifecycle predicate at all, deliberately, and a record of somewhere
that has since left the catalogue belongs there.

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
no curator relaxation, since these are a caller's own record, not one of the three by-id reads —
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
  permanent in the visit list once written.
- `getVisitedExperiences` and its count, unfiltered on every axis, now carry `curation_state <>
  'pending'` and *only* that one. `existence`, `admission` and `missing_since` keep their exemption
  here on purpose and it is not the same exemption: someone who saw Palmyra before 2015, stood in a
  since-refused museum, or visited a since-withdrawn point still did those things, and a record of
  that cannot depend on what the row says today. A `pending` row was never shown to anyone by any
  read, so a visit to one could only be the manufactured kind `markVisited` no longer writes —
  filtering it erases nothing genuine.
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

So the rule is stated by **shape** and not as a list, in `experienceLifecycle.ts`'s own doctrine
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
- `experience_treasures`: many-to-many junction linking treasures to venue experiences
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

### Curation support

- `curator_assignments`: scoped permissions (`global`, `region`, `category`)
- `experience_rejections`: region-scoped hidden items for non-curators
- `experience_curation_log`: audit trail of twenty actions — the curator's own edits
  (`created`, `edited`, `rejected`, `unrejected`, `added_to_region`,
  `removed_from_region`), the answers to a source's proposal (`accepted_source`,
  `declined_source`), the verdicts on a rule's refusal (`admission_confirmed`,
  `admission_overridden`), `published`, and the lifecycle verdicts on the object
  (`marked_former`, `marked_lost`, `state_restored`, `missing_dismissed`) and on one of
  its points (the same four, `location_`-prefixed, plus `location_edited`). The list is
  closed by a CHECK in `db/init/01-schema.sql`, so an action cannot be recorded until it
  is named there. What one row *reads as* is `frontend/src/components/shared/curationLog.ts`
  — the chip's words for every action, and the line under it for those whose `details`
  carry something a reader wants — and both screens that name one of these rows with a
  chip take an act's words from there: an object's History and the admin panel's curator
  activity. The queue's `ProvenanceTrail` is the exception on purpose: it puts the two
  source verdicts in a sentence with the person who answered, which a chip's noun phrase
  cannot fill.
  `backend/src/db/curationLogActionLabels.test.ts` requires the CHECK and the label table
  to be equal, since the nine that once printed their column value on screen were each
  added by widening the constraint while nothing compared the two lists

## Sync Architecture

Each source has a dedicated sync service in `backend/src/services/sync/`. All follow the same pattern: `syncX()`, `getXSyncStatus()`, `cancelXSync()`. In-memory progress is tracked via the `runningSyncs` Map; `finally` blocks use a captured `thisProgress` reference to avoid timer race conditions.

### Sync orchestrator

The generic sync lifecycle (progress init, already-running check, sync log creation, processing loop with cancel checks, final status, error handling, delayed cleanup) is implemented once in `syncOrchestrator.ts`. Each service provides a `SyncServiceConfig<T>` with domain-specific callbacks:

- **`fetchItems(progress, errorDetails)`** — Fetch and prepare items. Returns `{ items: T[], fetchedCount, filtered? }`, where `filtered` names entities the source offered that this category cannot hold — a Wikidata collection answering a museum query. Those are counted apart from errors and leave the run's status alone; genuine pre-processing failures still go to `errorDetails`.
- **`processItem(item, progress, context)`** — Process a single item and return a `ProcessItemResult`: the outcome (`'created'` / `'updated'` / `'unchanged'`), the change set, and whether the row had been flagged missing. `context` carries `dryRun`, so a service can skip its own writes in a preview, and `onLocationsChanged(experienceId)`, which a service calls **at the location write** to have the run place that experience before it ends. Called there rather than returned on the result on purpose: a service can throw after moving a point — the museum one upserts treasures afterwards — and a returned field would be lost with the throw while the point had already moved on disk. Throw to count as error.
- **`getItemName(item)`** / **`getItemId(item)`** — Display name and external ID for progress messages and error reporting.

Generic `getSyncStatus(categoryId)` and `cancelSync(categoryId)` replace per-service status/cancel functions. The controller dispatches via a registry map instead of if-else chains.

### Shared modules

Common sync logic lives in ten shared utility files:

- **`syncOrchestrator.ts`** — Generic sync lifecycle orchestration (`orchestrateSync<T>()`), plus `getSyncStatus()` and `cancelSync()` parameterized by category ID, and `isCancellable()` — the single rule for whether a cancel would be acted on, which `cancelSync` enforces, the status endpoint reports as `cancellable`, and the admin panel disables its button on rather than re-deriving.
- **`wikidataUtils.ts`** — SPARQL query execution with retry/backoff (`sparqlQuery()`), QID extraction, WKT point parsing, delay helper, and constants (endpoint URL, user agent, timeouts). Used by museum and landmark services.
- **`syncUtils.ts`** — Experience upsert with curated_fields-aware conflict handling (`upsertExperienceRecord()`), single-location write, delegating to `locationWriter.ts` (`upsertSingleLocation()`), and sync log CRUD (`createSyncLog()`, `updateSyncLog()`, and `annotateClosedSyncLog()` for the narrow status/`error_details` write a follow-up step needs). Used by all three services. It deletes nothing: the FK-ordered category cleanup that force sync used lived here and is gone with it.
- **`locationWriter.ts`** — Writes an experience's locations so a point that has not moved keeps its row, and therefore its region assignments (`writeExperienceLocations()`). Identity is `(point, external_ref)`: the reference alone repeats across a transboundary component's per-country entries, and the point alone repeats across the sub-units of one named locality. A point the source stops offering is marked (`missing_since`, `ordinal` NULL) rather than deleted, and one offered again is found by the same identity and given its place back. Returns the rows inserted, moved or offered again — what the run then assigns — and how many it was the first to find missing. Two modules hold what its statements are built from, split out when the per-point diff took it past the guide's length limit: `locationPairing.ts` — identity (`samePointSql`, `claimedPointSql`), the guard that keeps a claimed column, and what a kept row's own columns say happened to it (`keptChanges`) — and `locationIncoming.ts`, the source's list before anything is known about the store (its CTE, its parameters, and the duplicates the source itself ships)
- **`placement.ts`** — Placing what a run moved, and reporting when that fails (`finishPlacement()`, `placeMovedExperiences()`, `recordPlacementFailure()`, `enterAssigningPhase()`, `terminalStatus()`). Split from the orchestrator because it is a separate responsibility: the loop runs a source's items, this decides where the objects that moved now belong, and it reaches for `regionAssignmentService`, `syncLogMarkers` and `annotateClosedSyncLog` — none of which the loop touches
- **`changeSet.ts`** — Pure diff between the stored row and the incoming record (`computeChangeSet()`). No database, no network. Normalises before comparing: JSONB by value rather than key order, country and tag arrays as sets, coordinates by distance (below 10 m is jitter, above 1 km is `major`), and `null`/`''`/absent as one absence
- **`changeRecorder.ts`** — Batched persistence of the per-object changeset (`recordSyncChanges()`, 500 rows per statement)
- **`missingDetection.ts`** — Whether absence may be acted on (`missingDetectionSkipReason()`) and the flagging itself (`flagMissingExperiences()`)
- **`syncLogMarkers.ts`** — The entries a run leaves in `error_details` that other code reads as facts (`CHANGESET_LOST_MARKER`, `ORPHANED_RUN_MARKER`, `PLACEMENT_FAILED_MARKER`) and the predicate that reads them (`CHANGESET_LANDED_SQL`). Written by the orchestrator and the startup sweep, read by the review queue and `accept-source` — one definition, because a run's status cannot answer whether its changeset landed
- **`fixtureSource.ts`** — Development-only source substitution via `SYNC_SOURCE_FIXTURE`; see § Change provenance below

### Change provenance (issue #480, [ADR-0020](../decisions/0020-experience-lifecycle-and-run-changeset.md))

Every run records what it did to each object in `experience_sync_changes`: one row per
object created, changed, in conflict, held, missing, returned, failed, or filtered, with a
per-field diff in `changed_fields`. Rows that came through **unchanged are counted on the log, never stored** —
a UNESCO run would otherwise write 1247 rows of noise around the few dozen that carry
information. Four kinds of unchanged row are stored anyway, because each carries news the
counters cannot: `conflict`, where `curated_fields` refused the source's edit and the two now
disagree; `held`, where the category's gate refused it (below); `returned`, where an object
flagged `missing_since` is listed again — typically unmodified, after a transient source gap,
which is precisely when a field-change requirement would have hidden it; and one whose own fields
all came through while **what it holds** moved (next section).

`changed_fields` holds the value the source proposed for a field **even when the run refused to
write it**, and each entry says which of the two refusals it was: `curatedConflict` for a field a
curator had claimed, `held` for one the category's gate kept out (#519). Both flags are `false`
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
  because `publishHeldFields.ts` reads the catch-all's `old` as the list of keys that entry
  speaks for — a counter named there would be wiped back to the value the proposal was computed
  against the moment somebody published the field beside it.
- **The upsert writes them past the gate and past a `metadata` claim**, the way `last_seen_at`
  goes past both. Ignoring them in the diff alone would have been worse than the bug: the counter
  would freeze at whatever it read when the gate went up, with nothing left to report it and
  nothing able to correct it.

A sum over some 2500 works moves whenever anybody anywhere adds a language link to any painting a
museum holds, so under a gated source every move became a held proposal. Measured on run 64, 13
of the 15 held changes were `metadata`, and the Louvre's was in full
`totalArtworkSitelinks: 2363 → 2365` — while the row itself still stored 2363, four runs later.
One level down the same rule is already SQL: the treasures upsert writes `sitelinks_count`
unconditionally, "a measurement, not a judgement". `admittedFor` is derived too and is
deliberately not in the set — it names the most famous work a museum holds, which is the reason
the row exists at all, and is worth a look when it changes.

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
Wikidata eleven days after import differed in name, artist, year and image exactly zero times, which
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

Where the numbers come from: `writeExperienceLocations` and `upsertMuseumTreasures` each already
computed their delta and discarded it — the location writer returned ids for region placement, the
museum writer reduced its `RETURNING treasure_id` to a boolean for retiring a curator's pass. Both
now return it. `added`, `withdrawn` and `returned` are read off the statements that perform the
writes, so what the record says arrived is what arrived. `changed` cannot be and must not be: it is
the difference between what was stored and what the source offered, which is a comparison no writing
statement makes — the museum's comes from a snapshot query and the source's list, the location
writer's from the pairing's carried `old_*` against the incoming values. Where a claim holds, the
record and the write are *supposed* to disagree, and that disagreement is the whole content of the
entry.

Three things it deliberately does not say:

- **A held withdrawal is absent.** Where the gate is holding a withdrawal until its replacement is
  published, the point is still on the map with `missing_since IS NULL`; the run performed no
  withdrawal, and reporting one would tell a curator the opposite of what a reader sees. Same rule
  `unoffered` follows.
- **A withdrawn work never appears.** Nothing unlinks a work, because no contents coverage floor
  exists for treasures — sync run 42 fetched 291 artworks where the run before it fetched 1906 and
  reported `success`. A museum row with no `withdrawn` entries is therefore *not* evidence that
  nothing left.
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
`requires_curation AND experiences.curation_state <> 'pending'`, computed inside the upsert because it
depends on the stored state the same statement is about to write, and it rides on every content column
beside that column's own `curated_fields` guard. A row still `pending` is *not* held: nobody can see
it, so the run refreshes it in place and the curator reviews the newest state rather than whatever
landed first.

**A held field is reported as a refused write, not as one the run made.** `computeChangeSet` files
every difference in exactly one of three buckets, and the bucket is what the run reports:
`changedFields` means *written*, `curatedConflicts` means a curator's claim refused it, `heldFields`
means the gate refused it. The hold itself is decided in SQL — it reads the stored `curation_state`
the same statement is about to overwrite — and the statement **answers the question once and hands
the answer back**, as `${HELD} AS was_held` in the upsert's `RETURNING` and the same expression in
the preview's `SELECT`; `heldSql` in `syncUtils.ts` is the rule's only home, and the diff takes the
answer as a boolean rather than re-deriving anything. A row whose only differences were held is
therefore `unchanged` (nothing about it changed) and its changeset row is `change_type = 'held'`.

The answer has to come from `RETURNING` rather than from the `before` CTE, and this is not a detail
of style. Inside `ON CONFLICT DO UPDATE`, `experiences.curation_state` is the stored value **as
re-read under the row lock**, while a CTE reads the statement's own snapshot — and the two differ
whenever a curator's publish commits in between. Measured against a real database: with a publish
landing in that window, the CTE said `pending` while the guards said `verified` for the same run, so
a report derived from the CTE called the write applied while the statement had held it — #519 again,
for one run, self-healing on the next. Deriving the *guards* from the CTE instead would be far
worse: the run would then overwrite a row the curator had just published, leaving unreviewed content
live with no pointer, no card and nothing anywhere to say so — the gate's central promise broken
permanently rather than a report wrong once. Worse still in a second way: the decay does not fire
under a gated source, so the row would go on saying `verified` — asserting a curator's pass over
content nobody had seen. And the divergence is one-directional, because nothing returns a row to
`pending`, so every reachable instance of it is that case rather than the harmless mirror.
`RETURNING` reads the tuple as it stands after the write, which equals the value the guards were
built on only because this statement never assigns `curation_state` — a test pins that, on the
SET-list's text rather than on parsed assignments, since the assignment can be written mid-line.

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
claimed `shortDescription` or `metadata.website` beside an applied `nameLocal` computes `minor`, and the
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
`syncOrchestrator.ts`: the row came through `unchanged` with something in `heldFields`. Structural
rather than empirical — `computeChangeSet` files every unclaimed diff of a held row under
`heldFields`, so its `changedFields` is empty and its `changeType` is `unchanged`; and an insert
under a gate is written `pending` rather than refused, so a `created` row is never held, and the
queue's `arrival` card already carries it. Nor is new *content* under a gate: a point or a work
arriving on a visible object is written `pending` too (`locationWriter.ts`, `museum/treasureWriter.ts`),
files as a `contents` row, and is not in this count — so the number is of held **changes**, and a
run that only hung twelve unread paintings in the Louvre reports Held 0. The count of all three
waiting kinds — arrivals, held changes, unread contents — is per source, not per run:
`waitingCountsByCategory` (`waitingCounts.ts`), which the gate panel shows. The counter is the
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
live status while a run is going (`held` on `GET /api/admin/sync/categories/:categoryId/status`).
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
per service in `SyncServiceConfig`, `ranked` for the two top-N Wikidata sources), the run
finished clean and uncancelled, and it saw at least 90 % of the previously present rows.
When detection is skipped the reason is stored in `experience_sync_logs.detection_skipped_reason`.

**Dry runs** (`POST /sync/categories/:id/start` with `{"dryRun": true}`) walk the same path and
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
- Fetches English Wikipedia article URLs from Wikidata using property P757 (UNESCO World Heritage Site ID) via `schema:about` + `schema:isPartOf` SPARQL pattern, stored as `metadata.wikipediaUrl`. Fails open (sync proceeds without Wikipedia links if Wikidata is unavailable)
- Multi-location support: serial nominations create multiple `experience_locations`
- Images are **not** downloaded: 1260 of the 1272 rows carry a `whc.unesco.org/document/<id>` URL that the reader's browser fetches from UNESCO directly, some of them full-resolution originals up to 40 MB ([#557](https://github.com/uncovering-world/track-your-regions/issues/557)). The `/data/images` machinery exists and holds none of them

**Their rules, read from their own headers** (2026-08-21). `data.unesco.org` runs Opendatasoft's Explore API v2.1, which answers every request with `x-ratelimit-limit: 10000` (calls a day, anonymous), `x-ratelimit-remaining`, and `x-ratelimit-reset` at midnight UTC. `/records` is capped at 100 rows and at `offset + limit <= 10000`; `/exports` has no such cap and is what the platform documents for taking a dataset whole. So the import uses `/exports/json` — one call instead of thirteen paginated ones, and no `while (fetched < total)` loop that a page returning nothing could spin forever. `select=` names the 22 fields the importer reads, which took the answer from 24 MB to 3.7 MB: the descriptions in six languages and the video captions are most of that dataset by weight and none of them are used. The run logs what is left of the day's allowance once, and honours 429 + `Retry-After` through the shared retry.

**Three fields the importer asked for wrongly, and a dry run that found them.** Naming the fields in `select` turned the first into a 400 that said `Unknown field: criteria` — that field does not exist in `whc001` and never did, so `buildUnescoTags` produced no criterion tag for any site: measured on the live database, **0 of 1272**. The real name is `criteria_txt` (`(i)(ii)(iii)(iv)` for the Bamiyan Valley), present on 1256 of 1273 records. The other two were found by previewing the fix: `danger` and `transboundary` are compared against the number `1`, and the portal sends the **strings** `"True"` / `"False"` — from either endpoint. So `metadata.inDanger` was false for all 1272 sites, 58 of which are listed in danger, and not one of the 51 transboundary sites carried its tag. The `in_danger` tag survived only because `danger_list` is a string and was tested beside the flag. `isSet` now reads a yes in any of the shapes a portal might send it, rather than the one shape seen today.

**What the first run after this proposes**, measured by dry run 66: `tags` on 1255 sites, `metadata` on 1255 (the criteria string), `metadata.inDanger` on 58, `shortDescription` on 7 (3 of them curator-claimed, so they arrive as conflicts rather than proposals), `name` and `nameLocal` on one — Getbol drops "(Phase II)" — and `metadata.dateInscribed` on one, Garamba National Park, where the source now says 1980 and the catalogue holds 2026. **Whether that batch is held or written depends on the deployment, not on the source.** `requires_curation` is false for all three categories in the seed (`db/init/01-schema.sql`), and gating one is an admin's click — the dry run above was measured on a database where UNESCO had been gated. Where it has been, all of it waits for a curator: a one-off batch that is four missing years landing at once, not a source that suddenly started changing its mind. Where it has not, the same batch simply lands. The `metadata.inDanger` row of that table is spent on a database that has had migration 035: those 58 rows already carry the flag, so a run finds nothing to propose about it — see below for why that half was repaired rather than queued. A card a run has *already* filed keeps its `false → true` line, since a changeset records what a run did (ADR-0026) and publishing it writes the value the migration wrote; the rest of that card — the criteria string and the criterion tags — is what still needs a curator.

**A site in danger, and since when.** The World Heritage list carries 58 sites inscribed on the [List of World Heritage in Danger](https://whc.unesco.org/en/danger/), and the catalogue stores that fact **twice**: as the `in_danger` tag and as `metadata.inDanger`, which is the field every badge keys on. The two came from different halves of the source — the tag from either of `danger` and `danger_list`, the flag from `danger` alone — so the reading bug above left the tag right on 58 rows and the flag false on all 1272, and the badge three surfaces draw appeared for nobody ([#600](https://github.com/uncovering-world/track-your-regions/issues/600)). Both writers ask one predicate now (`isInDanger`), so a portal that empties either field cannot end the answer in silence, and a delisted site is still not badged: the field's vocabulary is Y/N and the parser reads the answer rather than the field's presence — Belize Barrier Reef Reserve System, off the list since 2018, answers `danger: "False"` with `danger_list: null` (measured 2026-08-27, when the two fields agreed exactly on 58 of 1273 records).

Fixing the reading repairs nothing already stored, and under a gate it cannot: `inDanger` is not a key a run owns outright (`SYNC_OWNED_METADATA_KEYS`), so the hold refuses to overwrite a row a reader can see and the 58 flips would reach a curator as 58 major changes to answer for — this catalogue's own misreading, dressed as the source changing its mind. `db/migrations/035-in-danger-flag.sql` puts the rows right instead, keyed on the tag rather than on UNESCO's field so it speaks about two columns of one catalogue; **Catalogue Checks** watches the pair from there on ("A site whose danger tag and whose In Danger badge disagree"), in both directions, since a badge on a site nothing lists tells a traveller a place is in peril on no evidence at all.

The date is most of what the fact means on the ground, so the list reads send it: `dangerList` is stored as the source wrote it (`"Y 2013"`) and `experienceDanger.ts` reads the year out of it on the way out as `danger_since`, beside `in_danger` as a boolean. The string itself does not leave the server — a client parsing `"Y 2013"` would be a third copy of one rule — and `parseDangerListing` is the same function the importer used to write the flag. The badge says "In Danger since 2013" wherever the year is known and "In Danger" where it is not (`inDangerLabel`), on the expanded list row, Discover's card tooltip and Discover's detail panel.

### Picture credits (`imageCredit.ts`)

The catalogue displays photographs it does not host — UNESCO's, served from `whc.unesco.org`, and Wikimedia Commons files both on the objects and on the works inside them (#582) — and until 2026-08-22 it named nobody. A share of the Commons files are CC BY or CC BY-SA. What both ask of a catalogue that merely *shows* a picture is the same one thing — that the author is named wherever the work appears; CC BY-SA's ShareAlike term binds adaptations, which displaying a photograph is not. The rest are free only because somebody said so. UNESCO's syndication terms ask for the attribution in their own words. This was not a styling gap.

Both sources hand the credit over once asked. **UNESCO** carries `main_image_author` and `main_image_copyright` beside the image URL, on most of its records — two more names in the `select` and nothing else changes. **Commons** answers `extmetadata` for up to 50 files per request — their documented ceiling, and what keeps a run to a handful of questions rather than one per picture: `Artist`, `LicenseShortName`, `LicenseUrl`. Asked of the live API on 2026-08-22, every file in the sample answered — Stonehenge is Stefan Kühn under CC BY-SA 3.0, the Little Mermaid is Benoît Prieur under CC0.

`Artist` arrives as wiki HTML and is reduced to text **server-side**, before storage: it is somebody else's markup, and storing it raw would leave it waiting for the one component that renders something unescaped. The input is capped before any pattern scans it. A credit that cannot be fetched costs a line under a picture, never an import — a failed batch is logged and skipped, and the previous credit stays. Stored as `metadata.imageCredit`, read out as `image_credit` beside `image_url` on both the list and region reads, and rendered by `ImageCreditLine` under the picture on every surface that shows one — and, equally a rule, under none that does not: see § Credits on the works, where the converse and the two rendering rules live. The four visitor surfaces are enumerated below, and the curator screens that also draw it are in that section. **The credits appear only after a run writes them** — nothing backfills the rows already in the database, and under a gated source a run proposes rather than writes, so they appear when a curator passes the metadata change.

**A credit belongs to a picture, and to whoever owns it.** A run reuses a stored credit only while the row still shows the same file — a source whose `wdt:P18` changes while the Commons batch for the new file fails would otherwise write the new photograph and the previous photographer's name in one statement. And a run writes no credit at all for a picture a curator claimed, because the upsert keeps their `image_url` and would set the source's photographer beside it. Both rules live in `creditToWrite`, and **all three collectors go through it** — UNESCO included, which matters most there: it carries more of the catalogue's photographs than any other source, and its credit comes from the record rather than from a fetch, so an unconditional write would have printed the portal's photographer under a picture a curator had chosen. A record naming an author but carrying no picture stores no credit at all.

**The admin "fix missing images" action credits what it puts there.** It writes the picture and its credit in one `UPDATE`, omits the key where Commons could not answer — a stored `null` is what the next run's catch-all diff reports as a change, for the removal of a nothing — and **skips a row whose `image_url` a curator claims**, so clearing a wrong photograph is not undone by the next click. Rows kept that way are counted and named separately from "no image found", which would blame the source for a person's decision.

**A curator who replaces the picture replaces the credit with it.** `PATCH /experiences/:id/edit` writes `metadata.imageCredit` in the same statement as `image_url` and claims `metadata.imageCredit` alongside it. Both halves are load-bearing: without the write, the card would go on naming the photographer of the picture that was just removed — a false claim about a real person, worse than naming nobody; without the claim, the next run would write *its* photographer's name against the curator's photograph, because the sync's metadata clause overwrites an unclaimed key and preserves a claimed one. If the new URL is a Commons file, the credit is resolved for it (one attempt, five seconds, failure is null) — outside the transaction, because a lock held across a request to somebody else's server is a lock held for as long as they feel like taking. **`metadata.imageCredit` alone is claimed only where the edit put a value in it**: claiming a `null` would be permanent, so one slow Commons response would leave a real photograph uncredited for good — and nothing overwrites the gap meanwhile, because a run writes no credit for a picture it does not own. `metadata.website` and `metadata.wikipediaUrl` are the opposite and claimed either way: **clearing** one is a decision, and leaving it unclaimed would have the next run write the source's value straight back over the removal. **Everywhere the picture is, the credit is**: the Discover detail panel, the expanded list card, the map's hover preview and Discover's hover overlay — the credit rides in the hover store's `HoverPreview` for the first of those, since it has no `Experience` in scope. One gap is deliberate and named rather than left to be discovered: the 56×56 thumbnail on a Discover card, which is too small to caption legibly and opens onto a panel that names the photographer.

**A hand-made object is credited when it is made, not by a run that never comes.** `POST /experiences` resolves the credit for whatever `image_url` a curator saved and stores it with the row — before the transaction opens, like the edit path, and answering null on anything that is not a Commons file or does not come back in five seconds. Without it these rows would be the one permanently uncredited shape in the catalogue: they are written `verified` and published in the same statement, so a reader sees the picture immediately, and no collector ever reads them back — a manual row belongs to no source.

#### Credits on the works, and on the curator's screens (#582)

**Every work's photograph is credited too.** Nearly every treasure shows a Commons file, and the museum run asks about them in the same pass as the venues: one `fetchCommonsCredits` call over both sets, and one map so a work and the museum holding it cannot credit the same file differently. The map is the reason, not the request count — sharing a batch cannot reduce the number of titles, only the number of half-empty batches, so batching the two sets together saves at most one request. The credit is stored as `treasures.metadata.imageCredit` through `creditToWrite` like everything else — `treasures.curated_fields` holds `image_url` in its claimable set, so a claimed picture is never described by whoever took a different one — and `treasureMetadata` writes `null` rather than `{}` where there is nothing to say, since the upsert replaces `metadata` whole and some works carry no picture at all.

Two ceilings bound a batch now, not one. The count (50, their documented limit) was enough while the files were named after buildings; an artwork's file is named after the painting, the painter, the museum and the inventory number, so fifty of those titles can build a query string several kilobytes long. `batchTitles` closes a batch on whichever ceiling comes first, because a request over the URL limit fails as a 414 — which this module turns into a batch of silently missing credits rather than an error anybody sees.

**On a dense list the credit draws only where it carries something.** Most of these files are public-domain reproductions of paintings, and for one of those Commons names the *painter* as the file's author — so the credit under *The Night Watch* would read "Rembrandt · Public domain" beside a line that already says "Rembrandt · 1642 · painting". A row that repeats itself teaches a reader to stop reading the line, which is the last thing an attribution should do. `creditAddsBeyond` (in `ImageCreditLine.tsx`) is the rule, opted into by passing `redundantWith`: the line appears where the licence asks to be honoured — the CC BY and CC BY-SA minority, such as the Mesha Stele at the Louvre, photographed by Mbzt under CC BY-SA 4.0 — or where the photographer is somebody the row does not already name. An unrecognised licence counts as one that asks, because over-crediting costs a line where under-crediting breaks a term. The large views pass no `redundantWith` and always show it: the 500 px hover preview over the map (`ArtworkPreviewOverlay`, its own component with its own pale strip, since the overlay behind it is dark), and the full-size dialog on a curator's card. Discover's 100 px contents tile has no room for a caption inside it, so the credit sits under the tile by the same rule, and its tooltip names the photographer whenever the tile draws a picture — regardless of `redundantWith`, and silent when it draws none (`creditLabel`).

**A credit never outlives its picture.** The converse of "wherever the work appears" is a rule of the feature rather than a nicety: a line naming a photographer beside a frame whose picture answered 403 is a claim about a person made where the thing that would justify it is not. Every component that renders `ImageCreditLine` gates it on the image having arrived — an `onError` that takes the picture and the credit together, rather than the older `style.display = 'none'`, which hid the element and left the line standing. On the surfaces that draw UNESCO pictures the refusal is the *ordinary* outcome, not the edge one (#557).

The sharp edge is what the failure is held as. **Where a component outlives one picture, it must remember which URL failed, not that one did** — `ArtworkPreviewOverlay` survives many hovers, and `ObjectContext` and `WaitingToPublish`'s `ObjectPreview` are drawn one card at a time by `ReviewBench` with no `key` anywhere on the chain, so a new object reconciles into the same instance. Held as a boolean, one 403 blanks every object after it and takes a credit off a picture that is there, which is a false statement rather than a missing one. A plain flag is correct wherever the parent keys the child, so that a different picture is a different instance — the rows and tiles of a list, `ArtworkRow`, `ContentTile`, `SearchResultBody` and `WorkRow` among them. The distinction is the lifetime, not the surface: ask whether this instance can be handed a second picture.

**The curator screens name the photographer too.** `objectContextSelectSql` carries `metadata->'imageCredit'` on every queue kind — nine of them now, and stated as a rule rather than a tally so a list added is covered rather than counted — `countedWorksSelectSql` carries each work's, and the search read behind `AddExperienceDialog` carries it for its 40 px result rows. Those screens are the catalogue being worked on rather than published, which changes nothing about the licence — and answers a question only they raise, since a curator deciding whether to replace a photograph needs to know whose it is. The waiting-to-publish preview draws what `GET /experiences/:id` was already sending it in `metadata`.

### Shared retry (`sourceRetry.ts`)

Every source is somebody else's server, and all of them fail the same way. `withRetries` holds the loop — bounded by a `WaitBudget` the whole run shares rather than by a count, waking early when the run is cancelled, reporting each wait through `SourceWait` so a panel can say what is happening — and each client keeps only what its own errors *mean*, as a `classify` function. `sparqlQuery` and `fetchUnescoRecords` are both that loop with a different classifier; `abortOn` gives each attempt a deadline **and** a cancel hook on one signal.

### Top Art Museums (`museumSyncService.ts`, `museum/*.ts`)

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
  recorded under two QIDs) into the venue that holds the ticket
- Once folding settles, each surviving venue must also be an *art* museum (`artTest.ts`) — the
  category holds art museums by product decision (2026-08-05); archaeology, egyptology,
  natural-history and military museums are a separate import with their own category. Thirteen
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
- Prints a diff (moved / gained / lost / dropped) of this run's placements against what
  `experience_treasures` currently holds, before writing anything — during design this caught
  second-order regressions (a corroboration fix that silently routed a work to the wrong museum,
  and the next fix that silently dropped a work's true venue) that no test did
- Writes an admitted museum as an experience with `category = 'art'` and `is_iconic = true`, and
  each work it holds as a treasure whose own `is_iconic` joins at the same 22-sitelink threshold
  and releases only below 18 (`ICONIC_RELEASE`), so the badge does not flicker as Wikipedia's
  coverage grows
- Records what the pass itself counted — `artworkCount` and `totalArtworkSitelinks` in the venue's
  metadata — as the run's own bookkeeping rather than as content: written straight through the
  gate, reported as no change and asked about on no card (§ Change provenance above)
- Departures are marked, not deleted (ADR-0022); a treasure-to-experience link is only ever added,
  never removed — see ADR-0023 for what that means for a work whose venue changes
- Images use remote Wikimedia `Special:FilePath` URLs (not downloaded locally); Wikipedia article
  URL fetched via the same `schema:about` + `schema:isPartOf` SPARQL pattern UNESCO uses

### Public Art & Monuments (`landmarkSyncService.ts`)

Two-phase fetch:

1. **Sculptures** — `wdt:P31 wd:Q860861` (outdoor sculpture), sitelinks > 15, LIMIT 300. Measured at 28 s for 131 rows on 2026-08-21: it answers, but with under half their deadline to spare
2. **Monuments** — **one query per type**, four of them (Q4989906 memorial, Q575759 war memorial, Q721747 monument, Q5003624 cenotaph), sitelinks > 20, LIMIT 160 each, merged by entity. There used to be a combined `VALUES ?type` query tried first with these four as its fallback; measured on 2026-08-21 the combined query returns **nothing in 75 s**, so every run spent the service's whole deadline on a question that could not finish before asking the four that could — 14 s each. The fallback was the working path with a wasted minute in front of it. A type that fails is logged and skipped (unlike a museum pool band, no admission rule reads this count); a run where none answer still fails

Results are merged, deduplicated by QID, sorted by sitelinks descending, and capped at `TARGET_COUNT` (currently 200). Duplicate names are disambiguated by appending location hints from the description. Fetches English Wikipedia article URL and own website URL, stored as `metadata.wikipediaUrl` and `metadata.website`.

**SPARQL reliability**: All Wikidata queries use direct `wdt:P31` (instance-of) rather than `wdt:P31/wdt:P279*` (subclass traversal) to avoid timeouts on the Wikidata endpoint. Requests ask for a **55s** server-side timeout (Blazegraph `timeout`) plus a 70s client-side AbortController safety net. The service's own deadline is 60s and asking above it moves nothing — the query dies there either way, but as a *gateway* error (504, then 502 from their nginx) that says nothing about what went wrong, which is how museum run 61 failed. Under the ceiling the query engine answers instead, and five seconds of their cluster go back to the queue. Retries are bounded by **time rather than by count**: exponential backoff capped at three minutes, `Retry-After` honoured where the service sends one, and a wait budget of fifteen minutes **shared across a phase** rather than granted to each query — the collection's queries share one, and the Commons credit pass that follows gets its own, because by then the first is spent — a collection sends a few hundred, and a quarter of an hour of patience each is arithmetically hours of a run nobody is watching. The count exists as a backstop and is set high enough that the budget is what stops the loop; the old shape (four retries, 30s ceiling) gave up after about a minute, which is "the service was busy", not "the service is down". A cancelled run is noticed **inside** a wait and inside a request, not only between queries: the backoff sleeps in one-second slices and returns early, and an in-flight request is aborted — without that, Cancel sat unhonoured for as long as the current backoff, which from the panel is a button that does nothing. 1s delay between requests, one query at a time — their limit is five parallel per IP. Every collector — museums, landmarks, and the Wikipedia-link query the UNESCO run sends — passes the same three things: the wait reporter, the cancel check, and a shared `WaitBudget` — including the admin-only image-fixing pass, which used to send bare queries and so minted a fresh budget per batch. A query sent without them is a query nobody can stop and a wait nobody can see. The label service is asked for `LABEL_LANGS` everywhere (`en,mul,en-gb,…`): asked for `"en"` alone it answers with the bare QID for anything unlabelled in English, which is how the National Gallery of Art once arrived as the string `Q214867`.

**What a run keeps (ADR-0030)**: the museum collector caches what Wikidata answers, in `wikidata_query_cache`, keyed by the hash of the query text — the query is the question, so a changed filter misses by construction rather than by remembering to invalidate. Two reasons: their front end caches nothing we send, because we POST, so a class closure that has not moved in months is recomputed by their cluster on every run; and a collection that fails in its third phase used to start the next attempt at the first — run 61 threw away 1166 artwork classes it had already paid for. Every row carries its own expiry, written at fetch time, with defaults set to the rate the facts change at: class trees 7 days, work pools 1 day, venue statements and entity edges 12 hours, entity details 6 hours. Per source, and only for the kinds that source's collector describes — the UNESCO run reads that source's own API and the landmarks run sends SPARQL without a descriptor, so neither caches anything. Only the source that keeps something is offered the bypass: `caches` on the categories listing is `CACHED_KINDS_BY_CATEGORY[id].length > 0`, and the panel hides "Sync without cache" where it is false, rather than offering to ignore a cache that does not exist. A run started with `refreshCache` ignores the cache **in both directions** — `withCache` short-circuits before the read *and* the write, so what is kept survives with its original `fetched_at`/`expires_at` and the next ordinary run uses it again. Replacing an answer is what Clear is for; the admin panel shows each kind's age, expiry, size and lifetime, can change that lifetime (which re-dates what is already cached, from each answer's own fetch time) and can clear any of it. A cache failure never fails a run: a read that throws falls through to the source, a write that throws is logged and the answer still returned. **The write and a lifetime change serialise** on a transaction-scoped advisory lock keyed by `(category_id, kind)`, and the write reads the policy inside its own `INSERT`: without both, a row could commit carrying an expiry the panel no longer shows — a policy nothing obeys, which is decision 7 read backwards. The locked section is two database statements; the source's answer is already in hand when `writeCached` is called, so nothing waits on a network request while holding it.

**The broad pool is asked in fame bands, sitelinks first**: `ORDER BY DESC(?sl) LIMIT 3000` over every painting carrying an owner is the query that killed run 61, and measurement on 2026-08-21 showed why it could not be rescued by trimming — without the sort it still timed out, and stripped to two columns it came back 502. The cost is reading a sitelink count for each of half a million instances. So the question is asked the other way round: `?w wikibase:sitelinks ?sl` with Blazegraph's `hint:Query hint:optimizer "None"` and `hint:Prior hint:rangeSafe true` makes the sitelink filter an index range scan, and the class becomes a probe on what that scan found. The top band went from a gateway error to 7s. Because the scan is proportional to the width of the range (10–19 took 61s, 10–11 took 33s), the bands cut the bottom finer than the top: 100+, 50–99, 30–49, 20–29, 15–19, 12–14, 10–11. They tile the range with no gap and no overlap and cache separately, so a run that dies in the fourth band keeps the first three, and `run.step()` between bands is where a cancelled run stops. A band that fails still fails the run: the pool decides which museums the category admits (ADR-0024), and a quietly short pool would withdraw real museums while reporting success. **Narrow classes are not banded** — a class with a few thousand instances is cheap to scan directly, banding them would turn thirty affordable questions into two hundred, and they were never the query that failed.

### Shared patterns

- Proper `User-Agent` header required by Wikimedia policy (constant in `wikidataUtils.ts`)
- SPARQL retries with exponential backoff bounded by a fifteen-minute wait budget shared across a phase (`WaitBudget`) — a collection's queries share one, and the credit pass after it gets its own, 429 + `Retry-After` header handling, 55s server-side + 70s client-side timeouts, an optional `isCancelled` hook that wakes the backoff and aborts the request in flight, and an optional `onWait` reporter so a run can say on screen that it is waiting for the source rather than looking hung (all in `sparqlQuery()`)
- 1.5s delay between image downloads
- `curated_fields` JSONB on `experiences` protects curator edits during sync upserts — each field is checked individually in the `ON CONFLICT` clause (implemented in `upsertExperienceRecord()`)
- Sync log lifecycle: `createSyncLog()` → processing → `updateSyncLog()` (also updates `experience_categories.last_sync_*`)
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
a terminal value, so `isSyncStillRunning` keeps a poller polling for what can be minutes on a
category's first run. `cancelSync` refuses it — placement is past the point `progress.cancel` is read, so
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
one, and `detection_skipped_reason` is `detectMissing`'s answer, which nothing here
recomputes.

The full rebuild (`assignExperiencesToRegions`, `POST /api/admin/experiences/assign-regions`)
stays an admin action, for the case that genuinely needs it: **region geometry changed**, so
every location has to be re-tested against it. That one clears the world view's `auto` rows
first, which is why it is not what a sync uses — the clear and the rebuild are separate
statements, so while it runs the world view has no assignments and a browsing user sees empty
regions.

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
| `admission = 'refused'` | hidden | **shown** | not reachable |
| `curation_state = 'pending'` | hidden | **hidden** | not reachable, except `GET /:id`, `/:id/locations` and `/:id/treasures` for a curator/admin whose scope reaches the experience |

`former` is a claim about the source's catalogue, not about the world: the place still stands
and you can still go, so nothing about who sees it changes. `lost` is a claim about the world,
and offering somewhere demolished as somewhere to go is the one thing this data can get
actively wrong — so it leaves every read that offers a *set* to go through: the lists, the map,
search and the counts. It does **not** leave a visit: someone who saw Palmyra before 2015 saw
it, and that record cannot depend on the thing still standing. Visit history is the one read that
keeps all three of those exemptions — `existence`, `admission` and `missing_since` — which is what
lets the counts elsewhere shrink without erasing anything. It is not exempt from the fourth:
`getVisitedExperiences` and its count carry `curation_state <> 'pending'`, because an unread row
was never shown to this reader, so a visit to one cannot be a visit they made. Filtering the other
three would erase history; filtering this one can only hide something that was never real.

**A by-id read is the documented exception, and it is `lost` only.** `getExperience` and its
siblings hide a row the category refused but leave a `lost` one reachable, so an object judged
lost still answers at its own address rather than 404ing there. That gap predates the admission
axis and closing it is a separate decision about a different question — recorded here because
the code says so in three comments and this file is where a reader looks first. (The `Lost` chip
is a list-surface control, rendered by `ExperienceListItem` and Discover's `ExperienceCard`, so
the by-id answer carries the row without carrying the mark.)

A third axis, `admission` ([ADR-0024](../decisions/0024-a-category-may-refuse-what-the-source-still-lists.md)),
answers a different question again: not whether the source still lists the object, and not
whether it still exists, but whether *this category* accepts it. The works-first museum
importer refuses an archaeological collection, a natural history museum, a church or a painted
wall — and Wikidata goes on listing every one of them, so neither of the other two axes can
say it without asserting something false. `hideRefusedSql()` is a separate fragment from
`hideLostSql()` for the same reason they are separate columns, and because the two are toggled
independently: `includeLost` is a reader asking to see what is gone, and it must leave
admission alone.

`curation_state` ([ADR-0025](../decisions/0025-per-source-curation-gate.md)) is the fourth column
that can take a row off a reader's screen, carried by `experiences`, `experience_locations`,
`experience_treasures` and `treasures` rather than by the experience alone, because a gated
source's points and works are exactly what a run can add unchecked between one curator visit and
the next. It answers a question none of the other three do: has anyone looked at this row yet —
not whether the source still lists it, not whether it still exists, not whether this category
accepts it. A sync run writes it — `pending` for a row from a gated source, `auto` everywhere
else. `createManualExperience` writes `verified` instead, on both the experience and its one
location: there is no source here to gate, and the curator who typed the row in and placed the
point already read it — `auto` would say "published unread" about something a person wrote.
`existence`, `admission`, `missing_since` and `curation_state` answer different questions and
compose rather than collapse: merging any two into one column is forbidden, because it would make
it impossible to ask about either again.

Every reader-facing read now honours it. `hidePendingSql()` gates an experience row and
`publishedContentSql()` gates a content row — a location, a treasure link, a treasure — because
ADR-0025's split is load-bearing: a published museum may hold newly-written, unread paintings, and
a predicate that only checked the experience would publish them the moment a run wrote them. Both
live beside the other three fragments in `experienceLifecycle.ts`, unconditional everywhere a list,
count, search or map feed applies them — there is no `?includeUnread=true`, unlike `?includeLost`,
because a reader has no legitimate reason to ask for what nobody has checked. The by-region
**count**'s two `FILTER` expressions both need it, or a row that is both `lost` and `pending` gets
counted as something the "show what is gone" toggle would reveal when revealing it would still
leave it gated — measured live: without the fix, `lostHidden` read 1 for such a row; with it, 0.

**The relaxation is narrower than the gate.** `GET /:id`, `/:id/locations` and `/:id/treasures` —
and only those three — widen the predicate for a curator or admin whose scope reaches the
experience, resolved by `maySeeUnreadExperience()` (`experienceScope.ts`). Every other read that
carries the gate — the flat list, search, the by-region list and its counts, the category counts,
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

A region-scoped curator (not a global or category one) can meet a narrower gap than that, for a
reason worth naming so nobody debugs it twice: `resolveExperienceScope()` — and so
`maySeeUnreadExperience()` — decides a region-scoped curator's reach via `MIN(er.region_id)` over
`experience_regions`, so a `pending` experience with no `experience_regions` row *yet* answers
"no scope reaches this" to every region-scoped curator, admins and global/category curators
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
`readerRegionMembershipSql()` (`experienceLifecycle.ts`) is the further question — does this
region hold a point of this object that is offered *and* published — and every reader-facing
region read carries it: the by-region list and its count in both branches, the marker batch in
both branches, `region-counts`, `GET /api/experiences?regionId=`, and the `regions[]` of
`GET /:id`. A **manual** assignment is exempt, since a curator adding an object to a region is not
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
dev catalogue, where the predicate changes no row today — all 5368 memberships are backed by a
published point — the cost is the region list unchanged within noise, its count 12 → 27 ms, the
tree counts 5.6 → 10.4 ms at the world's roots, `?regionId` 15 → 33 ms and the marker batch
129 → 143 ms.

The `admission` row in the table above reads "Visit history: shown" beside "Card: not reachable", and those two
cells are not a contradiction — reading them as one is what let another by-id read stay open for a
whole slice. The line they fall either side of: **the catalogue's reads refuse a kept-out row; a
record of what a person did is theirs and stays.** A read that describes an experience — its detail,
where it is, a reader's denominator of points visited there — is the catalogue talking, so it
refuses a kept-out row. A read that lists what *this person* did (`getVisitedExperiences`) is not,
so it does not filter, and neither does the write path: if a traveller stood in the British Museum,
that is true whether or not this category calls it an art museum.

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
rule has to end up where a new one would. Three writes, all skipping a row whose
`curated_fields` holds `admission` and all skipping `is_manual` rows
(`services/sync/admission.ts`):

- `markRefused` — unconditional, for the entities the fetch named and a rule turned down. The
  rule's own words go into `admission_reason` on the row, because a changeset entry is keyed by
  the external id the run named and that is not always the row's.
- `restoreAdmission` — a row this run admits comes back. Without it the axis is a one-way door.
- `markNotAdmitted` — the sweep, only for a source whose `SyncServiceConfig` declares
  `recomputesMembership`. It reaches the case matching by external id cannot: `Roman Forum and
  the Palatine` (Q55685908) was placed by one run and refused by the next under a *different*
  Wikidata item for the same ground. Guarded by the run finishing clean and uncancelled and by
  the admitted set holding at least half the previous one — looser than missing detection's
  90 %, because that floor guards a listing and this one guards a rule, and a rule is meant to
  move the set.

Restore and the sweep are order-independent — restore only sees refused rows the run admits,
the sweep only admitted rows it does not — but both must run after `markRefused`, so a venue a
run both names as filtered and admits ends that run admitted rather than hidden until the next
one.

An object a run merely flagged looks completely ordinary. That is the point of leaving both
verdicts to a curator: a source outage must not change what anyone sees.

`hideLostSql()` / `lifecycleSelectSql()` / `includeLost()` live in
`controllers/experience/experienceLifecycle.ts` rather than inline, because the predicate goes
into a dozen queries built by string concatenation and the one that forgets it is the one that
lies. Two traps it has already caught: `searchExperiences` needs brackets round its two name
alternatives (unbracketed, `OR` binds looser than the lifecycle `AND` and every lost object
matching by trigram comes straight back), and the by-region **count** has to carry the same
rule as the list or the page says one number and shows another. `listCategories` carries both
predicates in its per-category `experience_count` for the same reason — without them it
reported 128 experiences in *Top Art Museums* where the catalogue offers 101 — the 27 rows that
category's own rule turned down (#503). Both, though the `hideLostSql()` half changes nothing
today: measured 2026-08-09, all three categories hold zero `lost` rows, so the whole 128→101 gap
is refusals. It is still the half to have, because the vision promises that what no longer exists
leaves "the lists, the map and the counts" (`docs/vision/vision.md`, *Places that changed*), and
without the predicate that promise would only be accidentally true. The rule that makes this
checkable holds everywhere a count appears: **no count advertises more than its list shows by
default, and a count that labels a category rather than a page does not move when a caller widens
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
the control that would not compete with its category filters.

## API Endpoints

### Public browse

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/experiences` | Filters: `categoryId`, `category`, `country`, `regionId`, `search`, `bbox`, `includeLost`, `limit`, `offset`. `bbox` matches a place the same caller may see, and the object's own coordinate only where it has none — the same set of places the position is drawn from (ADR-0028), so a box can no longer match an object on a coordinate the row does not answer with. What one coordinate per row still cannot promise is that the pin is *inside* the box: a serial site matched on one part is answered with the part nearest its anchor, which may be another one — four of the 47 objects an Alps-sized box holds, the Beech Forests among them, matched in the Alps and answered in the Carpathians. Drawing every part is [#558](https://github.com/uncovering-world/track-your-regions/issues/558). A box with `west > east` crosses the antimeridian and is matched as its two halves. Also excludes `pending` rows unconditionally — no `includeUnread` toggle exists |
| GET | `/api/experiences/:id` | Full detail. 404s for a refused row — the class rule, not this row's exception: every read that describes an experience refuses one the category kept out, and every by-id read whose answer *is* the row answers 404 (see § Lifecycle filtering, which also says what shape the refusal takes where the answer is not the row). Also 404s a `pending` row, except for a curator/admin whose scope reaches the experience (`maySeeUnreadExperience()`) |
| GET | `/api/experiences/by-region/:regionId` | Supports `includeChildren`, `includeLost`, `limit` (default 100, max 5000), `offset`; optional auth affects rejection visibility. Rows come back `ORDER BY e.name`, so a `limit` under the region's size truncates alphabetically rather than paging — both callers pass `WHOLE_REGION_LIMIT` and take the region whole. `total` is a `COUNT(DISTINCT e.id) FILTER (…)` over the same predicate the list uses — which includes the lifecycle rule, so it follows `includeLost` — and not the page size, so `offset + experiences.length < total` says rows remain beyond the returned window — truncation for a caller that started at `offset` 0 and asked for the whole region, plain `hasMore` for one that is paging; the server cannot distinguish those, since the difference is intent. Distinct because the rejection join can multiply rows per experience. `lostHidden` reports how many the region holds that no longer exist and are **not** being shown — zero once `includeLost` is on, since nothing is hidden then, and it excludes `pending` rows too, or a row gated for both reasons would be counted as something the toggle would reveal. `pending` rows are excluded from both the list and the count unconditionally, for every caller including a curator: this is a *set*, not one of the three by-id reads the pending gate relaxes |
| GET | `/api/experiences/by-region/:regionId/locations` | Batch: all locations for all experiences in region, grouped by `experience_id`. Supports `includeChildren` and `includeLost`, the latter because this batch has to follow the list: a row the list shows but this omits arrives with no markers and a confident `0/N in region`. Eliminates N+1 per-experience location fetches. Excludes a `pending` container or a `pending` location, unconditionally |
| GET | `/api/experiences/search` | `q`, `limit`. Also excludes `pending` rows unconditionally |
| GET | `/api/experiences/categories` | Active categories ordered by priority. `experience_count` excludes `lost`, `admission = 'refused'` and `curation_state = 'pending'` rows, unconditionally — it labels the category, not a page, and no caller passes `includeLost` here |
| GET | `/api/experiences/region-counts` | `worldViewId` required, optional `parentRegionId`. Also excludes `pending` rows unconditionally |
| GET | `/api/experiences/:id/locations` | Multi-location list; optional `regionId` adds `in_region`. 404s for a refused row, like `/:id`. Also 404s a `pending` container, and excludes a `pending` location from the list — both relaxed together for a curator/admin whose scope reaches the experience, so a queue item that is itself one pending location inside an otherwise-published experience is still visible once past the gate |
| GET | `/api/experiences/:id/treasures` | Treasures list (artworks/artifacts). Carries `hideRefusedSql()` on the container, so a refused museum's works come back empty: the contents follow the container, and answering with them would put back on screen exactly what hiding the museum took off it. Three more predicates gate `curation_state` — on the experience, the `experience_treasures` link and the treasure itself — because any of the three can be `pending` independently; all three relax together for a curator/admin whose scope reaches the experience |

### User visits (`requireAuth`)

| Method | Endpoint |
|--------|----------|
| GET | `/api/users/me/visited-experiences` |
| GET | `/api/users/me/visited-experiences/ids` |
| POST | `/api/users/me/visited-experiences/:experienceId` |
| PATCH | `/api/users/me/visited-experiences/:experienceId` |
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
category later decides about the building.

### Curator (`requireAuth + requireCurator`)

| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/experiences` | Create manual experience. Required `categoryId` (no default). Optional `websiteUrl` and `wikipediaUrl` stored in `metadata.website` / `metadata.wikipediaUrl`, and the saved `imageUrl` has its `metadata.imageCredit` resolved and stored with it — resolved before the transaction opens, so a slow Commons never holds a lock |
| POST | `/api/experiences/:id/reject` | `{ regionId, reason? }` |
| POST | `/api/experiences/:id/unreject` | `{ regionId }` |
| POST | `/api/experiences/:id/assign` | `{ regionId }` |
| DELETE | `/api/experiences/:id/assign/:regionId` | Manual assignment removal |
| DELETE | `/api/experiences/:id/remove-from-region/:regionId` | Full removal (any assignment type). Keeps rejection as guard against spatial recompute |
| PATCH | `/api/experiences/:id/edit` | Editable fields (`name`, descriptions, `category`, `imageUrl`, `tags`, `websiteUrl`, `wikipediaUrl`). The last two are stored in `metadata.website` / `metadata.wikipediaUrl` via JSONB merge, and an `imageUrl` change writes `metadata.imageCredit` in the same statement — three per-key metadata claims in all |
| GET | `/api/experiences/:id/curation-log` | Latest curation actions, filtered to the caller's curator scope (see Curation Guarantees) |
| GET | `/api/experiences/review/queue` | What a run could not decide: `missing` objects awaiting a verdict, `refused` rows a category rule turned down, `conflicts` where the source and a curator disagree, `arrivals` a gated source wrote that nobody has passed, `held` where an already-visible row is holding a newer proposal, `contents` where a visible row holds unread points or works of its own, and `withdrawn` where a point the source stopped offering is waiting on a verdict — plus two lists that are answered rather than waiting and appear on no other surface: `keptOut`, the confirmed refusals, and `answeredWithdrawals`, the points a curator has decided about and which no reader can see as a result. No totals: each array's own length is the count, and `paging` says per kind where it is and whether another page waits behind it. Every kind carries what the object *is* — `image_url`, `latitude`/`longitude`, `website_url` and `wikipedia_url` from `metadata`, `image_credit`, `region_names`, and how much it holds (`offered_locations`, `counted_works_total`) — through one shared fragment, so no card can show less about an object than its neighbour. `conflicts` additionally carry `run_completed_at` and, per proposed field, `claim` (who claimed it and when, read from the newest `edited` log entry under the *column* name) and `decidedBefore` (every earlier answer on that field, newest first — both `accepted_source` and `declined_source`, each entry carrying its `action`, since a refusal rendered as an acceptance is its own opposite). A `conflicts` entry lists the claimed fields that are still *open*: one whose current proposal matches a stored refusal is dropped, and an object with none left leaves the array. `refused` and `keptOut` additionally carry `counted_works` — the venue's famous works from `experience_treasures`, named, most widely known first, capped at twelve. The *array* is those two kinds only, because UNESCO sites hold no works and every other query would carry a join for an empty list; the total beside it is universal, which is what lets the capped array say how many it is not showing, and what a refusal naming one work rather than counting has to reconcile against. A `withdrawn` entry carries `withdrawn_points`, each with its `id` (the verdict is per point), `name`, `externalRef`, `missingSince`, coordinates, `visited` — which is what makes the verdict matter rather than tidy-up — and `replacedMetres`: how far away the source now offers that same part, or `null` where it offers it nowhere. That last one is the field the card's whole sentence turns on, and the reason it is a distance rather than a flag is measured: the catalogue's first withdrawal has a replacement **1.2 cm** away, a coordinate rewritten at finer precision, which a flag would have called a move. An `answeredWithdrawals` entry carries `answered_points` instead — capped at `CONTENTS_ROWS_SHOWN` with `answered_points_total` beside it, newest answer first, because this is the one per-object list that only *grows*: a point enters when it is answered and leaves only if the verdict is taken back, so an object worked through over months would otherwise arrive as one card of hundreds of rows. Each entry carries the same `id`, `name`, `externalRef`, `missingSince` (nullable here, a run having possibly cleared the flag since), coordinates and `visited`, plus what makes it answered — both lifecycle axes, which are what the take-back's `expected` is built from and which decide how many ways back the card offers; `decidedAt` and `note` off the row; and `decidedBy`, read from the curation log under the log's own scope rather than off `state_decided_by`, so a verdict from a region this reader does not cover arrives unnamed rather than naming somebody the log endpoint would have dropped. No `replacedMetres`: that field tells a rewritten coordinate from a component that really moved, which is the question this list is not re-asking. A `contents` entry carries the rows themselves rather than only their counts: `pending_points`, each with `id`, `name`, `externalRef` and coordinates, and `pending_works`, each with `id`, `name`, `artist`, `year`, `imageUrl` and `iconic`, most widely known first — both capped at `CONTENTS_ROWS_SHOWN` (25, the page size), with the two counts beside them as the totals, so a card that is showing twelve of ninety-three can say so instead of implying twelve is all there is. Params `limit` (default 25), `categoryId`, and one offset per kind — `missingOffset`, `refusedOffset`, `keptOutOffset`, `conflictsOffset`, `arrivalsOffset`, `heldOffset`, `contentsOffset`, `withdrawnOffset`, `answeredWithdrawalsOffset`. One each, because these are one query with one LIMIT each: a shared offset moved all of them at once, so a kind whose page was full had a page 2 that no control could ask for. Scoped like the curation log |
| POST | `/api/experiences/:id/state` | `{ membership?: 'present' \| 'former', existence?: 'extant' \| 'lost', note?, expected: { membership, existence, flagged } }` — a verdict on one or both axes; at least one required. `expected` is **not** optional: it is the row as the caller saw it, compared under the write lock, and without it the server cannot tell a stale view from a deliberate correction |
| POST | `/api/experiences/locations/:locationId/state` | The same body, about one point inside the object (ADR-0026). Answers whether a point the source stopped offering is delisted, gone, or was never gone. Three things differ from the object-level verdict. Scope: a point carries none of its own, so the id is resolved to its containing experience server-side and `resolveExperienceScope` is asked about that. `missing_since`: only the false alarm (`present` + `extant`) clears it, because on a location that column is *one of the two terms* a reader-facing read carries (ADR-0026 decision 7), and each verdict is held by a different one — `former` by the flag, which is why clearing it would put back a pin for a place the source no longer lists; `lost` by its own axis, whatever the flag says, which is what makes that verdict outlive a run and also makes it the one answer here that can hide a point readers could see. Leaving the flag standing is what takes an answered row out of the queue without any read learning a filter for the queue's sake. A source that lists the point again takes the delisting back, in one direction only and wherever that point is — every arm of the writer that matches an offered row writes `source_membership = 'present'`, the one that gives a withdrawn point its place back and the one that keeps a point never withdrawn, and the fast path counts a delisted-but-listed row as unmatched so one of them is reached at all (ADR-0026 decision 6). Never the reverse, as the experience upsert has it (ADR-0021); `existence` is untouched, because a listing says nothing about whether the thing still stands. Without that the point would come back visible while recorded as delisted, and its next departure would raise no card at all, since the queue reads the axes as "nobody has answered". The one answer with no transition to name is the false alarm, and it is the *only* one: re-sending a verdict a row already carries answers 409 rather than writing a dismissal into the trail beside a flag nothing dismissed. And the audit row hangs off the *experience*, with the point named in `details.locationId`, so a serial site's seven components cannot record seven indistinguishable verdicts. The response says `offeredToReaders`, rather than leaving a client to infer visibility from two axes — and, where the answer changed what a reader sees and re-placing the point failed, `placementFailed`/`placementFailedWorldViews`, named as the sibling endpoints name them: a verdict is a placement event in either direction, because a withdrawn point holds no `auto` region rows and a `lost` one must hold none, so a curator has to be told when the regions are out of date. Needs migration 024 applied, or the audit insert violates the `action` CHECK and the whole call 500s |
| PATCH | `/api/experiences/locations/:locationId/edit` | `{ name?, latitude?, longitude? }` — a curator's *correction* to one point, as against the verdict above about its standing. The coordinate arrives as a pair or not at all: half a move is not a place, and on a single-point object it is where the object itself would go. Each value written also writes a claim on that column (`experience_locations.curated_fields`, migration 027), which is what makes the correction survive the next run — every arm of `locationWriter` otherwise writes the source's name and coordinate over whatever is stored. The claim set is re-read under the write lock and *added to*; the one path that takes a key back off a point's claims is `accept-source` on the object's `location`, which releases the coordinate on the point and the object together, since the two are one fact and releasing half of it puts the object's coordinate on the source's pin and its only visible point on the curator's (ADR-0029 § Consequences); and `external_ref` and `ordinal` are never claimable, because the pairing reads both to decide whether a point moved or was replaced. **The object's anchor follows the point where the object holds exactly one point a reader is positioned over — offered, published, and this one**, claimed there too: ADR-0028 positions a reader at the place nearest the object's own coordinate, so with one place the reader already follows the edit while the object's published coordinate stays behind — the disagreement #550 is about, 106 objects and 191 km at its worst. Both the count and the edited row's own membership are inside the statement's own `WHERE` rather than a read before it: a second point arriving in between cannot leave the anchor moved for a reason that stopped being true, and counting the visible points without asking whether *this* is one of them would move the object onto a coordinate no reader is ever sent to — by correcting a withdrawn, `lost` or unread sibling. A gated arrival's only point is `pending`, so correcting it moves nothing until publication, which is the same rule read consistently rather than an omission. Scope is resolved through the containing experience, as the verdict above does. A move re-places the experience into regions after the commit — answering `placementFailed`/`placementFailedWorldViews` where that failed, as the sibling `/state` route does and for the same reason: the remedy is admin-only, so a curator has to be told which world view is out of date rather than that something is. A rename places nothing, since region rows are computed from coordinates. Records `location_edited` naming both sides of what changed and whether the anchor moved — needs migration 028, or the audit insert violates the `action` CHECK and the whole call 500s |
| POST | `/api/experiences/:id/admission` | `{ decision: 'confirm' \| 'override', note? }` — answer a refusal. `confirm` keeps the row refused and hidden, `override` admits it again. Both pin `admission` in `curated_fields`, which is what takes the card out of the queue and what stops a later run reversing either answer; no `expected` block is needed, because a second curator collides with that pin and gets 409. `override` on a row that was `pending` also publishes it, in the same transaction (ADR-0025 § 4.5) — `curation_state = 'verified'`, `published_at = COALESCE(published_at, NOW())` — because that verdict is the only thing that ever un-hides an arrival nobody had read; `override` on an `auto` row and `confirm` on any row never publish. The response's `published` field says which happened. See § Publishing for the mechanism and why it does not place |
| POST | `/api/experiences/:id/accept-source` | `{ fields: string[], expectedSyncLogId }` — apply the values that run proposed for those fields and release the curator's claim on them. `expectedSyncLogId` is required: a newer proposal is refused rather than substituted. Also deletes any standing refusal of those fields, since a refusal belongs to the claim being released. Accepting `imageUrl` releases `metadata.imageCredit` with it, drops the stored key, and **says so where there was one** — `releasedCredit` in the response, in the `accepted_source` audit row, and as a clause in the curator's confirmation line. The deletion is unconditional and the report is not: an edit that could not resolve a credit stores the key as `null`, and announcing that as a removal would name something nobody could see. Reported on the same footing as the released pin and for the same reason: the value deleted is the curator's own and the card they answered never mentioned a photographer. It does so for the reason the coordinate below gives: the two were written in one transaction and mean one thing, and releasing half would leave the source's photograph credited to the curator's photographer — permanently, since the per-key re-apply would put that name back on every later run. Accepting `location` releases the claim on **the point the anchor was taken from** as well, and answers `releasedPoints` naming it: the object's coordinate and that point's are the same fact (ADR-0028), the only path that claims `location` on an experience is `/locations/:locationId/edit`, which claims both together, and releasing one of them alone would have the next run write the source's coordinate to the object while the pin a curator corrected stays where they put it — #550, made by the two endpoints written to close it. That point is matched by its coordinate rather than by re-deriving the anchor rule, and the difference is not academic: an object that gains a second published point and has *it* corrected carries a claim the anchor never came from, and a release written as "every claiming point" would undo that correction in answer to a card about the anchor. Each released point is also **put back on the coordinate that run offered for it**, and those are answered as `movedPoints`: the pairing bounds a point's identity by the reference *and* ten metres, and the claim was the only thing letting a corrected row pair at any distance, so releasing alone would have the run retire the row and insert the source's point beside it — a `withdrawn` card for a component nobody delisted, with the visit record left on a pin no reader is shown. The coordinate is the source's own for that row, read from the same run's contents record; where that run offered none, nothing is written. A moved pin re-places the experience after the commit and answers `placementFailed`/`placementFailedWorldViews` where that failed — which is also why the route is rate-limited (`authenticatedLimiter`), like every other curator route whose work outlives its transaction. The object's own coordinate is not written here and follows at the next run, since `location` is not an acceptable field |
| POST | `/api/experiences/:id/decline-source` | `{ fields: string[], expectedSyncLogId }` — the opposite answer to the same card: record that the curator stands by the stored value, so the queue stops asking. Writes nothing to the experience — the stored value has already won every run since the disagreement began. The refused **value** is read from the locked proposal, never from the request, because the queue suppresses by comparing it against what the source proposes now. Every field is refusable, including the ones `accept-source` cannot write. Needs migration 022 applied, or the audit insert violates the `action` CHECK and the whole call 500s |
| POST | `/api/experiences/:id/publish` | `{ contentsOnly?: true, fieldsOnly?: true, locationIds?: number[], treasureIds?: number[], expectedSyncLogId? }` — say that a reader may see this (ADR-0025). An empty body publishes the object: any held content fields, `curation_state = 'verified'`, `published_at` if the row was `pending`, the pointer cleared, and every unread point and work it holds. `contentsOnly: true` or naming either array is a contents publish, leaving the experience's own state alone — `contentsOnly` for every pending content row, naming an array for exactly those rows. `fieldsOnly: true` is the mirror and closes the first half of #524: it applies what the run proposed for the object's own fields and leaves every unread point and work where it is, so a curator doubting one proposed sentence no longer holds back twelve checked paintings by answering it. It is exclusive with all three contents shapes, since a body naming both halves is asking for the object publish it could have asked for by naming nothing. The trail records which of the three this was — `scope`, one of `object`, `contents` or `fields` — because the numbers cannot say: an object publish over a row holding no unread contents writes the same zeros as a fields-only one. All four are explicit and mutually exclusive (schema `.refine`s): leaving everything absent used to be read as "the object", full stop, and a card with no ids to send had no other way to ask for its contents alone. `expectedSyncLogId` is the run the caller's card named, compared under the write lock against `pending_change_sync_log_id`, and only when the call will actually write a held field or the caller named a run at all — a pointer whose one held field is already claimed writes nothing and answers success rather than 409 forever. It may not accompany a contents publish, named or bare. A field the curator claims in `curated_fields` is skipped rather than refused; a row its category refused answers 409, because admission is asked first (ADR-0025 decision 4) and `override` on the refusal is what publishes it; a point the source has withdrawn is never published, matching the `contents` card. Needs migration 019 applied, or the audit insert violates the `action` CHECK and the whole call 500s. See § Publishing for what it writes and why it does not place |
| POST | `/api/experiences/categories/:categoryId/publish-waiting` | no body — release everything this source is holding: every unread object as an object publish, every visible object holding unread contents as a contents publish. One transaction and one `published` log row per object. Held field proposals are deliberately left for their own cards. Answers `published[]` (each object with `locationsPublished`, `treasureLinksPublished`/`treasuresPublished` — both axes, since a work passed in one venue and unread in another moves the link and not the row — `withdrawalsReleased`, and with `placementFailed`/`placementFailedWorldViews` where re-placing failed), `refused[]`, `outOfScope` and `heldLeftForReview` — `null` where the count itself failed after the publications had committed — all scoped to the caller. Rate-limited (`authenticatedLimiter`) |
| POST | `/api/experiences/new-badges/seen` | `{ experienceIds: number[] }` — records that these chips were shown to the caller. Rate-limited (`authenticatedLimiter`), unlike the curator routes beside it: this is an ordinary authenticated action and the only one here a client sends on its own initiative. Only the first impression per experience is kept; a stale id is ignored rather than failing the call, and the response names what was actually recorded |

### Geocoding (public + admin)

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/geocode/search` | Nominatim proxy. Params: `q`, `limit` (default 5). Rate-limited 1 req/sec. Returns `wikidataId` from Nominatim extratags |
| POST | `/api/geocode/ai` | AI geocoding (curator/admin). Body: `{ description }`. Returns `{ lat, lng, name, confidence }` |
| GET | `/api/geocode/suggest-image` | Wikidata image suggestion (curator/admin). Params: `name`, `lat`, `lng`, `wikidataId` (at least one required). Layered lookup: direct QID → SPARQL spatial → name search. Returns `{ imageUrl, source, entityLabel, wikidataId, wikipediaUrl?, description? }`. `wikipediaUrl` is extracted from Wikidata entity sitelinks (enwiki) |

### Admin (`/api/admin`, admin-only)

| Method | Endpoint |
|--------|----------|
| GET | `/api/admin/sync/categories` |
| PUT | `/api/admin/sync/categories/reorder` |
| POST | `/api/admin/sync/categories/:categoryId/start` |
| GET | `/api/admin/sync/categories/:categoryId/status` |
| POST | `/api/admin/sync/categories/:categoryId/cancel` |
| PUT | `/api/admin/sync/categories/:categoryId/curation-gate` |
| GET | `/api/admin/sync/categories/:categoryId/cache` — what this source keeps: per kind, its entries, age, next expiry, size and lifetime (ADR-0030) |
| DELETE | `/api/admin/sync/categories/:categoryId/cache` — clears one kind (`?kind=`) or all of them; the next run asks the source again |
| PUT | `/api/admin/sync/categories/:categoryId/cache/:kind/ttl` — `{ hours }`, bounded a minute to a month. Re-stamps what is already kept from each answer's own `fetched_at`, and answers how many were re-dated. A kind the source does not declare is refused 400 rather than written as a policy nothing reads |
| POST | `/api/admin/sync/categories/:categoryId/fix-images` |
| GET | `/api/admin/sync/logs` |
| GET | `/api/admin/sync/logs/:logId` |
| GET | `/api/admin/sync/logs/:logId/changes` |
| POST | `/api/admin/experiences/assign-regions` |
| GET | `/api/admin/experiences/assign-regions/status` |
| POST | `/api/admin/experiences/assign-regions/cancel` |
| GET | `/api/admin/experiences/counts-by-region` |
| GET | `/api/admin/curators` |
| POST | `/api/admin/curators` |
| DELETE | `/api/admin/curators/:assignmentId` |
| GET | `/api/admin/curators/:userId/activity` |

### Field limits

What a curator edits or creates is bounded by the column it is stored in, not
by a number chosen at the API — the rule and its reasoning are in
`world-views.md` § "Field limits":

| Field | Limit | Column |
|-------|-------|--------|
| Experience name | 500 | `experiences.name`, and `experience_locations.name` for the location created with it |
| Category label | 100 | `experiences.category` |
| Image URL | 1000 | `experiences.image_url` |
| Country code | 10 | one element of `experiences.country_codes` |
| Country name | 255 | one element of `experiences.country_names` |

Short description, description, tags, and the website and Wikipedia URLs are
not on this list: the first three are `TEXT`/`JSONB` columns and the last two
live inside the `metadata` JSONB, so none of them has a width to align with.
`backend/src/types/columnBounds.test.ts` holds every entry above to its column.

### What a URL field may hold

`imageUrl`, `websiteUrl` and `wikipediaUrl` are held to a shape as well as a
width, and the shape is decided by the URL parser rather than by a pattern over
the string: a link must be an absolute `http(s)` URL, and a picture must be that
or a path that stays on our own origin (`/images/…`, for a file we host
ourselves). The rule is declared once, in `backend/src/types/urlSafety.ts`, and
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

## The "New" chip

`is_new` is decided server-side and means **the reader could first see it recently** — not
"recently created", and no longer "arrived in the latest run". All three mark a first
appearance, of different things. `created_at` is when the row entered *this database*, which
for a bulk-loaded category is one instant for thousands of objects that entered the source
years apart; the client-side `isNewExperience(created_at)` this replaced measured that while
the chip claimed to mean arrival.

**Why the anchor moved from the run to publication (#529).** Under a gated source, arriving and
becoming visible are different moments, and the gap is a curator's working week. An arrival is
invisible until someone passes it, so a chip keyed to the run that found it failed in the
ordinary case rather than an exotic one: a museum arrives Monday, Top Art Museums runs again
Wednesday, the curator answers Thursday — and by then the arrival's own run is not the latest,
so the chip never appeared for anyone. With no intervening run it was no better: the window was
counted from the run's completion, so it was being spent while nobody could see the row.
`published_at` is when a reader could first see it, which is the only moment "new" can honestly
mean once a gate exists.

```text
is_new = published_at IS NOT NULL
         AND ( published_at inside category.new_badge_days
               OR this reader first saw the chip < 7 days ago )
```

The two clauses are a **maximum, not a choice**. The category window is the floor everyone gets
— sources have different cadences, so it is per category — and a reader who arrives near its end
keeps the chip a week from their own first sighting rather than losing it the next day. Anonymous
readers get the first clause alone; there is nobody to have shown it to, and `v.user_id = NULL`
is never true, so the personal clause drops out without needing a second query.

**Two clauses were removed with the old anchor, and both removals are deliberate.** The
`EXISTS … change_type = 'created'` proof of a sighting existed only because migration 009
backfilled `first_seen_sync_log_id` to the newest run of each category, so the column alone
credited 1547 of 1547 rows to a run that never inserted them; `published_at` is never
backfilled — migration 018 left 1603 of 1604 rows NULL on purpose — so a publication needs no
proof. And the latest-completed-run bound existed to stop chips accumulating, which the window
already does; under piecemeal approval "the newest batch" has stopped being a unit, because a
curator answers eighteen arrivals across a week and no run divides them.

**Two consequences, stated here rather than discovered later.** Chips no longer clear when a
category next runs — each lasts its own full window, so a weekly source shows roughly four
windows' worth at once instead of one batch. And everything published before the gate existed
wears no chip at all, because `published_at` is NULL for it: the column starts meaning something
from the first publication forward. Nothing re-inserts a whole category any more — force sync is
gone — so no single act can chip a whole source, which is the property the removed bound was
protecting. No retention job is needed for `user_new_badge_views` either: the personal clause is
bounded by its own seven days.

Both clauses are correlated subqueries, so they run once per output row — 5000 of them on a
whole-region read. Each is now a primary-key lookup rather than a sorted scan: the window clause
reads `experience_categories` by `id` for `new_badge_days`, and the personal clause hits
`user_new_badge_views` by `(user_id, experience_id)`. The `published_at` comparison itself is on
the row already being returned.

`idx_experience_sync_logs_latest` (`category_id, completed_at DESC, id DESC`) was built for the
predicate this replaced, and `isNewSql` no longer reads `experience_sync_logs` at all — `grep -rn
"completed_at DESC" backend/src` returns nothing. Whether the index earns its keep for other
queries is a separate question; what matters here is that the chip is no longer the reason it
exists, so nothing about the chip should be read from it.

The `completed_at`-versus-id warning that used to live here went with the clause it was about: a
run that starts earlier can finish later, so ordering runs by id could name a months-old run as
the latest and switch every chip in a category off at once. Nothing in the predicate orders runs
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

`experience_categories.new_badge_days` (default 30) arrived with ADR-0020's schema and has a
consumer as of this slice.

## Review Queue

`GET /api/experiences/review/queue` is the other half of change provenance: the run
records what it could not decide, and this is where a curator decides it. Seven kinds of
question, kept apart because they are answered differently — and two lists that are not
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

**No counts, and each kind pages on its own.** The response carries no total and no `COUNT(*)`
over any of its arrays. "Is there another page" is answered by the rows themselves: each
query asks for `limit + 1` and the extra row is dropped before the array is returned, so the
answer costs nothing and no kind needs a count. A count belongs with a later rebuild of this
page that needs one for its own reasons (a notification floor, a backlog figure); adding one
here would be a second source of truth for a number nothing yet reads.

That also made the headings honest. "first 25" used to be inferred from a page being *full*, so
a kind holding exactly one page always claimed a backlog it did not have; it is now said only
where `paging.<kind>.hasMore` is true. The three gated kinds share one control on the screen —
they are shown as one list grouped by experience, so a curator cannot tell which of the three a
row came from — but they keep three separate offsets, and the control moves whichever have more.

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
legitimate member of *Top Art Museums*, so not `former`; and the refusal was right, so not a
false alarm. Its two answers are its own — the rule was right, or the rule was wrong — and the
card carries the rule's objection, because "refused" alone leaves a curator guessing while the
reason lets them confirm a rule or spot a bad one. A confirmed row is not deleted: the refused
set is the list the archaeology category will be built from. Refused rows are excluded from
the missing group, or the same row would appear twice under two contradictory framings.

**A refusal is shown in two sizes.** `admission_reason` is written by and for the rule —
`painting-share: 2 painting(s) vs 9 sculptural work(s)`, `site, not a venue: church building;
Catholic cathedral — named by The Elevation of the Cross (24 sitelinks)`. It names internal
tests, states no threshold, and never says where its numbers came from. `refusalReason.ts`
splits it in two: a sentence for the card, and the reasoning — the threshold, what the counts
are of, and the stored text verbatim — behind a question mark (`RuleHelp`). Every shape the
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
hides and two curators clicking it reach the same state. `confirm` keeps the curated-fields
pin as its concurrency check, so a stale card cannot silently re-hide a row someone just put
back. If the kept-out row was a `pending` arrival nobody had read before it was confirmed,
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
both sides, since a row that can never be seen would otherwise drag the category toward the
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
clears `missing_since` and touches neither axis (`syncUtils.ts`), so a queue card still
matches on both while the question it asks has been withdrawn — and answering `former` there
records as delisted an object the source currently lists, which drops it out of all three
detection predicates and leaves the correction path as the only way back.

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
Migration 011 widened the action CHECK to admit all four. A decision is one transaction over
a `pool.connect()` client — `pool.query('BEGIN')` does not pin a connection, so the UPDATE
and its log rows could otherwise land on different ones — and it re-reads both axes under
the object lock first. Every verdict writes both columns, the axis the curator did not decide
defaulting to what is already stored, so reading that from outside the transaction would let
one curator's verdict silently revert another's. Two curators on one item is the ordinary
case: every region-scoped curator covering any of its regions sees it, as do its category
curator and every admin.

**The object lock is `OBJECT_LOCK` — `FOR NO KEY UPDATE`, not `FOR UPDATE`** — and a
transaction that locks a row of an existing object's contents takes it on the object first.
Both halves matter, and both were learned from the same failure. The rule is about
transactions and about which rows they hold, and what it leaves outside is named rather than
counted — the count went stale here once already — each for its own reason: `upsertMuseumTreasures` runs each statement on the pool with no
`BEGIN`, so it holds nothing across them and can wait for a lock without ever being half of a
cycle; `createManualExperience` creates the object in the same transaction, so the INSERT's
own row lock is the "object first" the rule asks for; the region and rejection writers
touch rows no lock-holder waits for, reaching `experiences` only through the audit row's key
share, which the mode below is chosen never to conflict with; and **placement**
(`assignRegionsForExperiences`) does key-share the point rows through
`experience_location_regions`, so a transaction that changes a point's key column — the
writer's ordinal parking — can wait for it, but it never waits in turn, since its own reach
into `experiences` is another key share. `db/locks.ts` says the same in the same order, and is
where a writer that joins the set will look.

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
writes **no changeset row at all** (`worthRecording` in `syncOrchestrator.ts`), so a missing
newer conflict is not evidence that the old one stands. What such a run does leave is
`last_seen_sync_log_id`, and a value newer than the conflict's run means a later run saw the
object and had nothing to propose — **once that run has finished**. `last_seen` is stamped
per item inside the loop while the changeset is written in one batch after it, so mid-run the
newer value exists and the rows it would be read against do not; without the completion check
every conflict in a category would vanish for the length of the run, and a curator clicking a
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
carry. (Those two keys used to be a pre-existing hole in metadata protection too —
the upsert guarded metadata only with `curated_fields ? 'metadata'`, which neither
satisfies. That guard now also honours a per-key claim on each of them directly (#488),
re-applying just that key over the source's value. `CURATED_KEY_BY_FIELD` still does
not carry either key, though, so that fallback is still what represents them here.)

`computeChangeSet` now carries that same fallback (#488) for the metadata keys
`CURATED_KEY_BY_FIELD` does not carry: such a key, claimed individually and still present on
the stored row, is diffed on its own, under `metadata.<key>`, and checked against that
identical name, so a curator's claim on it reports as its own conflict rather than
disappearing inside the catch-all `metadata` diff. (A claim whose key the row no longer
carries gets none of that: the guard would not re-apply it either, so it falls through and is
diffed as part of the catch-all instead, exactly like a key nobody claimed.)
Before this, `metadataChanges` never produced a diff a per-key claim could match against — the
claimed key and whatever else changed were one `metadata` diff, which `CURATED_KEY_BY_FIELD`
protects only as a whole-column claim — so a run that correctly kept the curator's value (the
per-key guard above) still filed `changed_fields: metadata, curatedConflict: false`: a write
that never happened, reported as one that did, with no conflict for a queue card to raise. (The gate
has the same shape one layer out, and #519 is that story: a write the hold refused, filed as one the
run made. Both are fixed the same way — the field says which refusal kept it out.) The
keys nobody claimed individually — other than `inDanger`/`dateInscribed`, which the catch-all
never carries, claimed or not — still fall into the catch-all and still report as applied,
because the run did apply them; a claim on `metadata` itself is unaffected and still protects
the whole column.

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
than a live one. The credit joined that list with the picture credits and takes the same
fallback, being no more a major key than the other two. The rule holds for the keys the map does not carry: there,
the claim key the queue reads and the claim key the upsert honours are the same string, and
`computeChangeSet` — producing the very `changed_fields` and `curatedConflicts` the queue
reads — uses that same string too.

Accepting is always a claim release; whether the value is *also* written on the spot is what
`ACCEPTABLE_FIELDS` (`acceptableFields.ts`) decides — `name`, `shortDescription`,
`description`, `category`, `imageUrl`. Their **claim keys** are `name`, `short_description`,
`description`, `category`, `image_url`, and each of those is a real column, which is what
lets `CURATED_KEY_BY_FIELD` answer both questions for them: the field name itself is
camelCase and matches no column, so the map is doing work in every case, not only for the
exceptions. (`category` is the varchar subtype — `cultural`, `monument` — not the
`category_id` foreign key, which no source proposes and this endpoint never touches.) `location` and the country arrays need
more than an assignment, and `metadata` is claimed per key, so writing it wholesale would
discard the keys the curator did not touch. Those fields come back marked
`acceptable: false`, and accepting them releases the claim without writing: the **next run**
then applies the source's value through the ordinary upsert, and the response reports them
under `released` rather than `applied`.

That is the only way such an item leaves the queue, and it is why the endpoint does the
release rather than pointing the curator at the edit dialog. `applyProposedFields` is the
only code anywhere that removes a key from `curated_fields` — `editExperience` unions into
it (`curationController.ts:383`) and never subtracts — so a curator told to "settle it by
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

**The switch.** `PUT /api/admin/sync/categories/:categoryId/curation-gate`, admin-only like
everything on that router, and beside the other category writes because the gate is a property
of the source rather than of any object. Two promises are properties of its single statement
rather than of anything it checks: it touches `experience_categories` and nothing else, so
**turning it on is not retroactive** — rows the source already published stay `auto` and stay
visible, and one category can hold `auto` rows from before the switch beside `pending` ones from
after it. And it names no content column, so **turning it off publishes nothing** — the statement moves
no row. What a backlog does next depends on its kind. Unread objects and unread contents stay put,
because only the insert arm ever writes `pending` and only a person moves a row out of it. A change
a run is holding does the opposite: the hold is `requires_curation AND curation_state <> 'pending'`,
so it stops existing with the gate, and the next ungated run writes the proposed values and clears
the pointer with nobody involved. The flip is logged with
the actor's id; there is no per-category audit table, and the switch that decides whether a
whole source reaches readers unreviewed should not leave no trace at all.

**What a source is holding.** `getCategories` answers `requires_curation` and a `waiting` object
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
counted in their own `try` and answered as `null` when the aggregate fails. Three screens share
that query and read only its data: a throw used to leave an admin with a heading, no sources, no
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

**Letting it go.** `POST /api/experiences/categories/:categoryId/publish-waiting`, curator or
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

**Arrivals** — a row from a gated source, `curation_state = 'pending'`, that nobody has looked
at. The whole object is the proposal, so there is nothing to show beside it but the object
itself; the queue's own version of "created," for a source that does not get to publish on its
own say. Ordered newest-arrived first by `first_seen_sync_log_id`. A row the source has since
stopped offering withdraws instead of raising a card, guarded by `missing_since IS NULL`
(ADR-0025 § 3.6) — nobody has ever seen it, so there is no verdict to give either about whether
it disappeared. That same row raises no `missing` card either, per the predicate change noted
above, so it is correctly invisible under both headings rather than wrongly visible under one.

**Held** — an already-visible row (`curation_state <> 'pending'`) whose newest content proposal
was kept out by the upsert's own gate rather than applied — the mechanism `syncUtils.ts`
documents under "A gated source may not overwrite what a reader can already see" (above), and
reported by the run as `change_type = 'held'` with each kept-out field flagged `held`.
`pending_change_sync_log_id` names the run whose proposal is waiting, and the proposal itself is
read straight from that run's changeset row.

The pointer is not proof the gate is what held every field on it. `syncUtils.ts`'s
`proposedAnything` sets the pointer for *any* refused proposal — a curator's own `curated_fields`
claim included, and not only the gate-held fields this card is about — so without a filter a field
refused only by a claim would carry two contradictory cards at once: `conflicts`, which
`accept-source` can answer, and a `held` twin answered by publishing, and the twin would
outlive an `accept-source` call showing a value already written. The query therefore requires
`(f->>'held')::boolean` on each field — this card is only ever the fields the *category's gate*
held, never one a claim refused for its own, separately-answerable reason. Read off the field's own
flag, not inferred from the absence of a claim (#519): the elimination was right only while the gate
was the sole other reason a write could be refused, and a third reason would have been silently
reclassified as gate-held here and handed to publishing, which writes all eleven columns.
`e.missing_since IS NULL` guards the row for the same reason `arrivals` carries it: a visible row
can be flagged missing *and* holding a proposal at the same time, and that is `missing`'s
question, not this one.

**`POST /:id/publish` is the only thing that answers a `held` card**, and the only writer that
clears the pointer in response to a person — `syncUtils.ts` clears it otherwise only when a
*later run* proposes nothing at all, the source having come back to what is stored. The field
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
alone would be worse at the other end, since the largest serial nomination holds 758 points, so the
cap stays and the card says *"showing 25 of 93 points"* rather than letting a short list stand for a
long one. `hideRefusedSql()` on
the container is what keeps a refused museum's newly-arrived paintings from raising a card here
too — the museum already has its own card in `refused`, and its contents are not a second
question.

This kind and `withdrawn` live in `reviewQueueContents.ts` rather than in the handler: both read
`experience_locations` rather than `experiences`, both carry the only per-row lists the queue
returns, and listing the rows took the controller past the length the development guide sets.
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
`pending_change_sync_log_id IS NOT NULL`, and the pointer is only ever *set* on a row whose
`curation_state <> 'pending'` (`upsertExperienceRecord`'s guard, `syncUtils.ts`), while
`contents` requires `hidePendingSql()` directly. Both therefore exclude `curation_state =
'pending'` by construction, the same column `arrivals` requires to equal it — not a coincidence
enforced by extra code, but the same column read two ways. A `pending` experience *can* hold a
`pending` location at the same time (the location's own gate is keyed off the category, not off
the container's current state), and such a row is real; it is classified only as an `arrival`,
never as `contents`, for exactly that reason. `missing` and `held` are not mutually exclusive the
same way, though — both read a row's *own* `missing_since` and `pending_change_sync_log_id`
independently, so `held` carries its own `missing_since IS NULL` guard rather than relying on
`arrivals`'s structural argument.

The queue pages (`limit` default 25). The page labels a full first page "first N" rather than
printing its length as a total, and carries Previous / Show more so the items behind it are
reachable — otherwise the label would name a backlog the curator could only reach by
answering everything in front of it.

The page lives at `/review` (`frontend/src/components/curation/ReviewQueue.tsx`), reachable
from the header for curators. That gate is convenience: every action it offers is checked
server-side against the caller's scope.

**The three gated kinds share one section and group by experience.**
`frontend/src/components/curation/WaitingToPublish.tsx` renders "Waiting to be published" — one
heading, one sentence (nothing here has reached a visitor), and one card per experience whatever
mix of `arrival` / `held` / `contents` named it. `groupGated()` does the joining, because the API
answers `held` and `contents` separately so each query stays simple while a museum whose label is
held *and* which gained twelve paintings is one object and one decision to the person looking at it.
Inside a card the rows follow ADR-0025 § 4.2 — `fields` with both versions, `points` and `works` as
counts — and `ItemHeader` and `messageFor` come from `queueCard.tsx`, which exists so every page
file rendering a card shares the idiom without importing another one (`lint:circular`). There are
three of them today, grouped by what raises the section, and the module's own docblock names them:
a fourth is a section added rather than a count to revise.

What the card does that is not a free choice:

- **One publish button, not one per row.** An object publish is one act at the endpoint: naming no
  contents applies the held fields, marks the row read *and* releases every unread point and work
  under it. A separate "publish the points" would need their ids, and this queue counts contents
  rather than listing them — so it would either send the same request under a narrower promise or
  409. The label says what the click covers ("Publish the change and what arrived with it").
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
else), while this page's ordinary reader is a region- or category-scoped curator — so the response
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
that experience rolls back. `db/migrations/README.md` records nothing about which files a database
has already seen (#435), so both are hand-applications to remember, not something the code can
detect.

**Four shapes, all explicit, none of them inferred from the others' absence.** An empty body
publishes the object: its held fields, `curation_state = 'verified'`, and every unread point and
work it holds. `{ contentsOnly: true }` publishes every pending content row and leaves the
experience's own row alone — a visible museum that gained three checked paintings has not thereby
been read. `{ locationIds }` / `{ treasureIds }` (or both) do the same for exactly those rows.
`{ fieldsOnly: true }` is the mirror of the second (#524): the held fields land and every unread
point and work stays where it is, so declining one proposed sentence stops holding back twelve
checked paintings. It answers **409 on a row nobody has passed yet** — an arrival has no held
fields to publish on their own, and publishing it this way would put an object in front of readers
with nothing on the map, which is what the writer's deferral machinery exists to prevent. The trail
records which of the three acts it was — `scope`, one of `object`, `contents` or `fields` — because
an object publish over a row holding no unread contents writes the same zeros as a fields-only one.
The schema's `.refine`s make the four mutually exclusive: `contentsOnly` beside a named array says
"contents only" twice, any contents publish beside `expectedSyncLogId` answers a question it
is not asking, and `fieldsOnly` beside any contents shape asks for the object publish an empty body
already means. An empty array is a 400 rather than either reading, since it would mean "publish
nothing and do not publish the object either". A named work publishes two rows, its link
(`experience_treasures`) and the work itself (`treasures`), because a reader's treasure list gates
both and a work is passed once globally while its link is passed as being *here*; both writes are
scoped through this experience's own links, so an id belonging to another venue changes nothing.

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
only once its category's own rule has answered yes (ADR-0024). All three of the gate's queue kinds
carry `hideRefusedSql()` for the same reason, and the consequence of allowing it is not cosmetic:
nothing returns a `verified` row to `pending`, so the row would leave `arrivals` for ever and a
later `override` would put it in front of readers with nobody having reviewed its contents. The way
through is `POST /:id/admission` with `override`, which publishes in the same transaction — see
"Overriding a refusal is the other half" below for what that writes. Contents publishes are refused
on a refused container too, since the `contents` card excludes it as well.

**`expectedSyncLogId` is compared against `experiences.pending_change_sync_log_id`**, not against
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
covering it. A `pending` row never holds a pointer — `syncUtils.ts` sets one only where
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

`metadata` is the one field that cannot be assigned from what the changeset carries.
`computeChangeSet` reports it in parts and strips the individually reported keys out of both sides
before diffing the rest, so the catch-all's `new` is the source's object *minus* those keys.
Publishing reconstructs it: keys the catch-all's `old` does not mention were not its business and
are kept, everything it does speak for is replaced wholesale — deletions included, since a dropped
key is recorded only by its absence and a `||` merge would leave it proposed for ever — each
per-key entry then decides its own key, and finally every `metadata.<key>` a curator claims is
re-applied from what is stored, exactly as the upsert re-applies it.

**A claim is skipped, not refused.** Publishing answers "may readers see this"; a
`curated_fields` claim answers "whose text is it". Both can be open at once, so a claimed field is
left alone and named back in `claimedFieldsSkipped` while the rest of the call succeeds. The writer
takes only the fields flagged `held`, which is the same predicate the queue's `held` card uses, so
it writes exactly what that card showed and nothing beside it — and reads the flag rather than
inferring it from the absence of a claim (#519), since an elimination would hand this writer, which
assigns all eleven content columns, any future field refused for some third reason.

**`published_at` is stamped only where the row was `pending`.** `COALESCE(published_at, NOW())`
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

### Overriding a refusal is the other half (ADR-0025 § 4.5)

`POST /:id/admission` (`setExperienceAdmission`, `lifecycleController.ts`) is where a refused row
comes back, and `override` on a **`pending`** row is the only path that publishes without going
through `publishExperience` at all — the two assignments are appended to the same `UPDATE
experiences` this endpoint already runs, inside the transaction that already holds the row `FOR
UPDATE`, rather than a second call to the publish writer. `confirm` never publishes, on any state:
it is the verdict that leaves an already-invisible row invisible.

The decision is narrower than "override publishes":

- **Only `override`.** `confirm` says the rule was right, so the row stays refused and hidden — the
  opposite of a publication.
- **Only from `pending`.** An `auto` row was already visible before its category refused it — the
  refusal is what hid it, not the gate — so putting it back changes `admission` alone.
  `curation_state` and `published_at` are untouched, and the response's `published: false` says so.
  Only a row nobody had looked at (`pending`) turns "the rule was wrong" into a first publish.

`curation_state` is set to **`verified`, not `auto`.** The default a run leaves behind means "nobody
has looked"; a curator did — they read the card, the reason and the object's name, and overruled a
category rule about this specific row. That claim is real but narrower than `publishExperience`'s:
nobody has passed the description, the image or the treasures underneath, only the admission
question. That is the deliberate cost of not asking the same question twice — the alternative is
leaving a `pending` row unread forever because the one card that could resolve it is answered
"admit", not "publish".

`published_at = COALESCE(published_at, NOW())`, gated by the same `before.curation_state ===
'pending'` check as the assignment itself, for the reason `publicationAssignments` states: 1603 of
the catalogue's 1604 rows are undated because migration 018 left them so, and stamping an
already-visible row would invent a New-chip window for something visitors could see all along.

**Resolved in TypeScript, not a `CASE` over `$2`.** `nextReason` a few lines above is the same
lesson already paid for once: a parameter used both as a varchar value and as the left side of a
text comparison gives Postgres two types to deduce for one placeholder — "inconsistent types
deduced for parameter $2" — invisible to a mocked-pool test and immediate on the first real click.
`publishes` is a plain boolean computed from the locked read, and the `SET` fragment it selects is
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
  and curators of the experience's category see everything. The predicate is
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
  above; for admins, global curators, and curators of the experience's category,
  `NULL`, since no single region is where their authority came from and a row
  naming none stays visible to every curator who can reach the log. Every other
  curation handler is told its region by the request — `regionId` in the body or
  the path — so this is the only place the question arises

## Frontend Integration Notes

- Discover and Map UIs share `CurationDialog` and `AddExperienceDialog`
- `AddExperienceDialog` has Create New as the first (default) tab, Search & Add as the second. Props: `defaultCategoryId` pre-selects the category dropdown, `defaultTab` controls which tab opens (0=Create, 1=Search). Dialog closes automatically on successful creation and invalidates experience queries so map markers and lists refresh immediately. Category selector filters out "Curator Picks" — curators must assign new experiences to an existing category (UNESCO, Top Art Museums, or Public Art & Monuments). Category is required for creation. When the curator types a name (3+ chars, debounced 800ms), the system auto-fills coordinates (Nominatim), image URL, description, and link URL (Wikidata 3-layer lookup: direct QID → spatial SPARQL → name search). The link is auto-filled from the English Wikipedia sitelink in the Wikidata entity. The Nominatim query appends the current region name for geo-disambiguation. Auto-fill fires only once — after the first successful lookup, name edits don't re-trigger. After auto-fill, a suggestion info box appears below the name field showing the matched Wikidata entity (label + QID) with a prominent "Re-lookup" link. Clicking Re-lookup re-runs the full auto-fill pipeline (Nominatim + Wikidata), overwriting all previously auto-filled fields. Auto-filled fields use `useRef` flags (including `linkAutoFilled`) so Re-lookup overwrites them but manual edits are preserved. Thumbnail preview shown when image URL is set. Uses `LocationPicker` for coordinate input — supports 4 modes: click-on-map, Nominatim search, multi-format coordinate paste, and AI geocoding. Accepts `regionName` prop from both call sites (Map mode via `useNavigation().selectedRegion.name`, Discover mode via `activeView.regionName`)
- `CurationDialog` fetches full experience detail to populate two link fields: Wikipedia URL (from `metadata.wikipediaUrl`) and Website URL (from `metadata.website`). Both fields are editable and saved via JSONB merge. `AddExperienceDialog` auto-fills the Wikipedia URL from Wikidata lookup and provides a separate Website URL field. The backend edit/create endpoints accept both `wikipediaUrl` and `websiteUrl`
- External links are unified across all sources — no source-specific rendering logic. Every experience shows up to two links based solely on metadata: a **Wikipedia** button (`MenuBook` icon, from `metadata.wikipediaUrl`) and a **Website** button (`Language` icon, from `metadata.website`). UNESCO page URLs are stored in `metadata.website` during sync, so they appear as "Website" alongside any Wikipedia link. Both Map mode (icon buttons) and Discover mode (text buttons in detail panel) use the same unified logic
- In Map mode (`ExperienceList.tsx`), each category group header has a "+" button that opens AddExperienceDialog with `defaultCategoryId` pre-set for that category. An "Add experience of a new category" button at the top opens Create New with no category pre-selected. Category name → ID mapping is resolved via the `experience-categories` query
- In Discover mode, add buttons appear in two places: (1) the list header "Add" button when viewing a specific category for a region — opens with `defaultCategoryId` pre-set from `activeView.categoryId`; (2) a "+" icon button in each region row's category pills area (in `DiscoverRegionList`) — opens with no category pre-selected so the curator can pick any category. The tree-level "+" is scope-aware: `DiscoverPage` fetches curator assignments from `/api/users/me` and passes a `canAddToRegion` predicate to the list. Admins and global/category-scoped curators see "+" on all regions. Region-scoped curators see "+" only on their assigned regions and descendants (detected via breadcrumb ancestry match)
- Cache invalidation after mutations must include `['experiences', 'by-region', regionId]` (Map mode), `['discover-experiences']` (Discover mode) and `['region-locations', regionId]` — the last because the location batch answers for the rows the list is showing, so anything changing that set leaves its markers stale. The key stops at the region on purpose: the full key carries `includeLost` and `includeChildren` as well — three entries with call sites today, since Map mode reads a region without its descendants under either `includeLost` and Discover reads it with them — and a longer invalidation would clear one of them and leave the rest answering from the old set. `invalidateExperiences` (`utils/queryInvalidation.ts`) does all of it; both `AddExperienceDialog` and `CurationDialog` go through it
- Discover's experiences query is keyed `['discover-experiences', regionId]` — **not** by category. The response is category-independent; the category filter runs in `select`, per observer. Keying by category would give each tab its own cache entry and refetch the whole region on every switch
- Creating a manual experience inserts into 4 tables within a transaction: `experiences`, `experience_locations`, `experience_regions`, and `experience_location_regions`. The last one matters — without it the location's `in_region` flag is false. The markers still appear (`representablePlaces()` falls back to *every* out-of-region place, so a hand-assigned experience is not invisible and is drawn as the places it has), but everything that counts in-region locations reads zero: the `0/N` chip on the row, the visited counts, and the mark-all-locations checkbox, which marks in-region locations and so marks nothing
- `LocationPicker` lives in `frontend/src/components/shared/` with coordinate parsing in `frontend/src/utils/coordinateParser.ts`. Accepts `name` prop to pre-populate search/AI fields; coordinates sync across all modes (e.g. map click shows in Coordinates tab). Exposes `onPlaceSelect` callback that passes Wikidata ID from Nominatim search results
- Visited tracking uses location-level system (`user_visited_locations`) for both the root checkbox and the "Mark Visited" button. The experience-level table (`user_visited_experiences`) is maintained for backward compatibility but the UI is driven entirely by location visits. The `markAllLocations` batch endpoint handles both single- and multi-location experiences consistently
- **Batch location fetching**: `useRegionLocations(regionId, includeLost, includeChildren)` hook (`frontend/src/hooks/useRegionLocations.ts`) fetches all locations for all experiences in a region via a single `GET /api/experiences/by-region/:regionId/locations` call. `includeLost` follows the list and is part of the query key, since a row the list shows and the batch omits renders with no markers and a confident `0/N`. `includeChildren` follows the list too, and for the same reason: Discover lists a region *and* its descendants, so a batch fetched without them leaves an object assigned to a descendant region — a curator's hand assignment — with no places at all. Four consumers share the hook (`ExperienceMarkers`, `ExperienceList`, `SelectedObjectFoldControl`, `DiscoverExperienceView`), eliminating ~300 individual API calls for a 150-experience region. Visit checkbox state is derived from the global `useVisitedLocations().isLocationVisited()` rather than per-experience `useExperienceVisitedStatus()` calls. The batch endpoint also returns `region_path` (full ancestor path from root to leaf region, e.g. "Europe > Germany > Bavaria") for each location via a recursive `LEFT JOIN LATERAL` on `experience_location_regions` + `regions`
- **Reads whose response depends on world-view visibility must be authenticated**: they go through `authFetchJson`, not `fetchJson` — `by-region/:regionId`, `by-region/:regionId/locations`, `:id/locations`, `region-counts`, and `GET /api/experiences/:id`. The first four carry `requireVisibleWorldView`, which answers **404, not 401**, when a world view has `is_public = false` and the caller is not an admin, so an unauthenticated read is indistinguishable from a missing region: react-query stores the rejection as `data: undefined` and nothing surfaces. `:id` is different in mechanism and identical in consequence — it is public by design and instead filters the `regions[]` it returns, admitting every assignment only for an admin, so without a token that documented bypass is unreachable and an experience assigned only to hidden world views returns an empty region list rather than an incomplete one. All five are covered by `frontend/src/api/experiences.auth.test.ts`. One membership is prospective rather than active: `:id/locations` is guarded on `regionIdQuery`, which passes the request through when no `regionId` is supplied, and neither caller supplies one — so as called today that response has no visibility dependence, and this guard alone never 404s. The header is what keeps the route correct if a caller starts passing one. The route can still 404 today, for an unrelated reason: the existence check excludes a refused row, matching `:id` — an admission question, not a visibility one. `GET /api/experiences` carries the same guard on its `regionId` query param and is listed in `SECURITY.md`, but has no frontend client — which is why it is absent here and from the test
- **An in-region count is only meaningful once the batch has settled**: `useRegionLocations` reports `locationsResolved`, and four consumers gate on it — the expanded card's ratio, the row's count chip, the visited controls, and `useExperienceCardReady`. The last differs in kind: the others decide *what* a card shows, while it decides *when* the card is shown at all, because those three parts arriving late would grow a row whose height the virtualiser has already measured. The last is not a display concern and must not be dropped as one: visited state is derived from in-region locations, so an unresolved batch makes `inRegionCount` 0, which short-circuits `inRegionVisitedStatus` to `not_visited`; every toggle then passes "mark", always, and a fully-visited experience can be re-marked but never unmarked. The numerator is derived by filtering the batch while the denominator falls back to `experience.location_count`, which arrives with the experience — so an absent batch does not read as "no locations here", it reads as a confident `0/N`. The 404 above was one way to reach that state; a 500, an offline reload or an aborted navigation are others, which is why the fix is the gate rather than the 404
- **Location display in an open card**: locations are split into in-region (first, fully interactive) and out-of-region (dimmed, not hoverable). **Both lists are capped**: in-region shows `IN_REGION_INITIAL` (20) with a "Show all N places" control, out-of-region shows 3 with "Show N more". The in-region cap exists because a serial site mounts every one of its places into the card — the Historic Centre of Saint Petersburg carries 112, and mounting them cost 432 ms before the card could appear. A hover that comes *from the map* opens the rest by itself when it names a place beyond the cap: the place's row is what draws that hover, and a row that was never mounted draws nothing. Each displays its region path with the common prefix stripped — e.g. if all out-of-region locations are in Europe, "Europe > " is removed so you see "Germany > Bavaria", "France > Paris", etc.
- Rejected experience visibility is scope-dependent and returned by backend
- Multi-location experiences expose `location_count` in region browse responses for map/list UX
- Detailed marker interaction architecture is documented in `experience-map-ui.md`
