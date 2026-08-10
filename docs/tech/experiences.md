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

**A location is marked, never deleted.** When a run offers an experience without one of its
stored points, `locationWriter` sets `experience_locations.missing_since` and nulls the row's
`ordinal` instead of removing it. Deleting it would take the row's `user_visited_locations`
record and every `experience_location_regions` row with it — both are `ON DELETE CASCADE`,
manual assignments included — and a person's record of having stood somewhere is the one thing
no later run can rebuild. A source that offers the point again finds the same row by its
`(point, external_ref)` identity, clears `missing_since`, restores its ordinal, and sends it
for placement; the visit and any manual assignment were never touched.

`missing_since` here is a machine observation, exactly as it is on an experience. What a reader
sees does not change, because a withdrawn point used to be deleted and so left every list the
moment a run stopped seeing it: the predicate `missing_since IS NULL` keeps it out
of the marker batch, the experience's own location list, `location_count`, the per-user visited
status, "mark all locations visited", the visit a viewed treasure records for its venue, and
region placement. The controllers take it from one fragment, `offeredLocationSql()`
(`experienceLifecycle.ts`); `regionAssignmentService.ts` writes it out, since a service
importing a controller module would be the first such import in the codebase. The rule is not "visits are exempt" but a line between two kinds of
statement. **What a reader asked for, exactly as they asked** — recording a visit, removing
one, and the lookup of which experience it belonged to — is unfiltered: the first because they
are acting on what they were just shown, the second because a record on an invisible point
could otherwise never be cleared. **What the system decides on their behalf** carries the
filter: every read that puts a point on screen, the per-experience progress view included, and
equally the count that infers from what remains whether the experience-level visit record
should go with the last visible tick. So both unmark handlers hold an unfiltered DELETE beside
a filtered count, which is that one line drawn through a single handler.
That view counts offered points only because identity is the point together with the source's
reference: an edit to either — a corrected coordinate, a renumbered component — is a withdrawal
plus an insert, and the reader would otherwise meet the same place twice.
`getVisitedLocationIds` is the third unfiltered read and stays that way: every consumer uses it
as a set-membership test over a list that is already filtered, so it draws no pin and inflates
no count. The visit
row is untouched either way; what a withdrawn point means is a curator's verdict, and until
there is one it is simply not shown.

### Treasures (artworks/artifacts)

Treasures are independently trackable things inside venue experiences. Currently implemented for museum artworks. Treasures have a many-to-many relationship with venues via `experience_treasures` junction table; iconic treasures are called **highlights** (`is_iconic` flag). See [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md) for the full concept.

- `treasures`: globally unique treasures (artworks, artifacts), keyed by `external_id`
- `experience_treasures`: many-to-many junction linking treasures to venue experiences
- `user_viewed_treasures`: per-user treasure tracking

### Curation support

- `curator_assignments`: scoped permissions (`global`, `region`, `category`)
- `experience_rejections`: region-scoped hidden items for non-curators
- `experience_curation_log`: audit trail (`created`, `edited`, `rejected`, `unrejected`, `added_to_region`, `removed_from_region`)

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
- **`locationWriter.ts`** — Writes an experience's locations so a point that has not moved keeps its row, and therefore its region assignments (`writeExperienceLocations()`). Identity is `(point, external_ref)`: the reference alone repeats across a transboundary component's per-country entries, and the point alone repeats across the sub-units of one named locality. A point the source stops offering is marked (`missing_since`, `ordinal` NULL) rather than deleted, and one offered again is found by the same identity and given its place back. Returns the rows inserted, moved or offered again — what the run then assigns — and how many it was the first to find missing
- **`placement.ts`** — Placing what a run moved, and reporting when that fails (`finishPlacement()`, `placeMovedExperiences()`, `recordPlacementFailure()`, `enterAssigningPhase()`, `terminalStatus()`). Split from the orchestrator because it is a separate responsibility: the loop runs a source's items, this decides where the objects that moved now belong, and it reaches for `regionAssignmentService`, `syncLogMarkers` and `annotateClosedSyncLog` — none of which the loop touches
- **`changeSet.ts`** — Pure diff between the stored row and the incoming record (`computeChangeSet()`). No database, no network. Normalises before comparing: JSONB by value rather than key order, country and tag arrays as sets, coordinates by distance (below 10 m is jitter, above 1 km is `major`), and `null`/`''`/absent as one absence
- **`changeRecorder.ts`** — Batched persistence of the per-object changeset (`recordSyncChanges()`, 500 rows per statement)
- **`missingDetection.ts`** — Whether absence may be acted on (`missingDetectionSkipReason()`) and the flagging itself (`flagMissingExperiences()`)
- **`syncLogMarkers.ts`** — The entries a run leaves in `error_details` that other code reads as facts (`CHANGESET_LOST_MARKER`, `ORPHANED_RUN_MARKER`, `PLACEMENT_FAILED_MARKER`) and the predicate that reads them (`CHANGESET_LANDED_SQL`). Written by the orchestrator and the startup sweep, read by the review queue and `accept-source` — one definition, because a run's status cannot answer whether its changeset landed
- **`fixtureSource.ts`** — Development-only source substitution via `SYNC_SOURCE_FIXTURE`; see § Change provenance below

### Change provenance (issue #480, [ADR-0020](../decisions/0020-experience-lifecycle-and-run-changeset.md))

Every run records what it did to each object in `experience_sync_changes`: one row per
object created, changed, in conflict, missing, returned, failed, or filtered, with a
per-field diff in `changed_fields`. Rows that came through **unchanged are counted on the log, never stored** —
a UNESCO run would otherwise write 1247 rows of noise around the few dozen that carry
information. Two kinds of unchanged row are stored anyway, because each carries news the
counters cannot: `conflict`, where `curated_fields` refused the source's edit and the two now
disagree, and `returned`, where an object flagged `missing_since` is listed again — typically
unmodified, after a transient source gap, which is precisely when a field-change requirement
would have hidden it.

`changed_fields` holds the value the source proposed for a field **even when `curated_fields`
rejected it**, marked `curatedConflict`. That is what makes a curator's later "accept source"
possible; without it the proposed value exists nowhere.

**A gated source may not overwrite what a reader can already see.** Contents arriving from a gated
source are written invisible rather than withheld ([ADR-0025](../decisions/0025-per-source-curation-gate.md)),
but an experience row that is already published has no second row to hide an unreviewed value behind
— so for that row alone the run keeps the stored content instead. The condition is
`requires_curation AND experiences.curation_state <> 'pending'`, computed inside the upsert because it
depends on the stored state the same statement is about to write, and it rides on every content column
beside that column's own `curated_fields` guard. A row still `pending` is *not* held: nobody can see
it, so the run refreshes it in place and the curator reviews the newest state rather than whatever
landed first.

The proposal itself is already recorded, per object, in the run's changeset. What the row adds is
`pending_change_sync_log_id`, the pointer saying whose proposal is being held, so the curator's screen
can find it. It is written only by a run that actually proposed something — the upsert's own guards
fire whether or not a value differs, so the statement cannot tell a change from a pass that touched
nothing. *Proposed* counts both kinds of refusal: a value the hold kept out and a value
`curated_fields` kept out are both decisions waiting on a curator, so a row whose only difference is
in a claimed field is still holding a proposal and still points at the run that made it. The pointer
is cleared again when a later run proposes nothing at all — nothing written and nothing refused —
because a source that has come back to what is stored is no longer proposing anything. A row that is
no longer held loses the pointer too: a run free to write the content leaves nothing waiting.

**A `verified` row decays when a trusted source changes it.** `curation_state`
([ADR-0025](../decisions/0025-per-source-curation-gate.md)) can also hold `verified`: a curator's
pass on the object as it stood when they looked. `upsertExperienceRecord` returns a `verified` row
to `auto` the moment a run from a source nobody gated writes a real change
to it — the pass covered the object that was there, and a changed object has not been passed. A
provenance-only pass, one that reaches the row and changes nothing, leaves `verified` standing.
So does a change from a **gated** source: there the same statement's hold refused to write the new
values, so what a reader sees is still exactly what the curator passed, and retiring the pass would
punish the row for a proposal nobody has answered yet.

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
touched. The endpoint that lets a curator promote an existing `pending` or `auto` row to
`verified` arrives with the rest of this feature.

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

### UNESCO (`unescoSyncService.ts`)

- Fetches the full UNESCO World Heritage list via the UNESCO API
- Fetches English Wikipedia article URLs from Wikidata using property P757 (UNESCO World Heritage Site ID) via `schema:about` + `schema:isPartOf` SPARQL pattern, stored as `metadata.wikipediaUrl`. Fails open (sync proceeds without Wikipedia links if Wikidata is unavailable)
- Multi-location support: serial nominations create multiple `experience_locations`
- Images downloaded locally to `/data/images/`

### Top Art Museums (`museumSyncService.ts`, `museum/*.ts`)

Works-first: the sync decides what belongs in the catalogue by which artworks the world knows,
then admits the museums holding them — not by which Wikidata entity happens to own a famous
painting. See [ADR-0023](../decisions/0023-works-first-museum-selection.md).

- Collects artworks via SPARQL: the three broad classes (painting, sculpture, statue) anchored by
  both `wdt:P195` (owner) and `wdt:P276` (location) — so an unowned work such as *Sunflowers* is
  not missed — plus every narrower artwork class found by a bounded `wdt:P279*` closure below
  those three roots. A hop that would multiply the class set (e.g. under `sculpture` or `print`)
  is refused rather than followed
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
- Departures are marked, not deleted (ADR-0022); a treasure-to-experience link is only ever added,
  never removed — see ADR-0023 for what that means for a work whose venue changes
- Images use remote Wikimedia `Special:FilePath` URLs (not downloaded locally); Wikipedia article
  URL fetched via the same `schema:about` + `schema:isPartOf` SPARQL pattern UNESCO uses

### Public Art & Monuments (`landmarkSyncService.ts`)

Two-phase fetch:

1. **Sculptures** — `wdt:P31 wd:Q860861` (outdoor sculpture), sitelinks > 15, LIMIT 300
2. **Monuments** — `wdt:P31 ?type` with `VALUES` for 4 monument types (Q4989906 memorial, Q575759 war memorial, Q721747 monument, Q5003624 cenotaph), sitelinks > 20, LIMIT 300. Falls back to per-type queries if the combined query fails

Results are merged, deduplicated by QID, sorted by sitelinks descending, and capped at `TARGET_COUNT` (currently 200). Duplicate names are disambiguated by appending location hints from the description. Fetches English Wikipedia article URL and own website URL, stored as `metadata.wikipediaUrl` and `metadata.website`.

**SPARQL reliability**: All Wikidata queries use direct `wdt:P31` (instance-of) rather than `wdt:P31/wdt:P279*` (subclass traversal) to avoid timeouts on the Wikidata endpoint. Requests include a 120s server-side timeout parameter (Blazegraph `timeout`) plus a 130s client-side AbortController safety net. Exponential backoff retries (up to 5 attempts) with 1s delay between requests. Falls back to per-type queries if the combined monument query fails.

### Shared patterns

- Proper `User-Agent` header required by Wikimedia policy (constant in `wikidataUtils.ts`)
- SPARQL retries with exponential backoff, 429 + `Retry-After` header handling, 120s server-side + 130s client-side timeouts (all in `sparqlQuery()`)
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

`former` is a claim about the source's catalogue, not about the world: the place still stands
and you can still go, so nothing about who sees it changes. `lost` is a claim about the world,
and offering somewhere demolished as somewhere to go is the one thing this data can get
actively wrong — so it leaves every read that offers a *set* to go through: the lists, the map,
search and the counts. It does **not** leave a visit: someone who saw Palmyra before 2015 saw
it, and that record cannot depend on the thing still standing. Visit history is the one read
left unfiltered, which is what lets the counts elsewhere shrink without erasing anything.

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
point already read it — `auto` would say "published unread" about something a person wrote. No
reader-facing query consults the column yet; the predicate that hides a `pending` row and the
endpoint a curator uses to publish one arrive with the curator-facing half of this feature.
`existence`, `admission`, `missing_since` and `curation_state` answer different questions and
compose rather than collapse: merging any two into one column is forbidden, because it would make
it impossible to ask about either again.

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
the count query that was already running — so the list can offer "3 here no longer exist —
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
| GET | `/api/experiences` | Filters: `categoryId`, `category`, `country`, `regionId`, `search`, `bbox`, `includeLost`, `limit`, `offset` |
| GET | `/api/experiences/:id` | Full detail. 404s for a refused row — the class rule, not this row's exception: every read that describes an experience refuses one the category kept out, and every by-id read whose answer *is* the row answers 404 (see § Lifecycle filtering, which also says what shape the refusal takes where the answer is not the row) |
| GET | `/api/experiences/by-region/:regionId` | Supports `includeChildren`, `includeLost`, `limit` (default 100, max 5000), `offset`; optional auth affects rejection visibility. Rows come back `ORDER BY e.name`, so a `limit` under the region's size truncates alphabetically rather than paging — both callers pass `WHOLE_REGION_LIMIT` and take the region whole. `total` is a `COUNT(DISTINCT e.id) FILTER (…)` over the same predicate the list uses — which includes the lifecycle rule, so it follows `includeLost` — and not the page size, so `offset + experiences.length < total` says rows remain beyond the returned window — truncation for a caller that started at `offset` 0 and asked for the whole region, plain `hasMore` for one that is paging; the server cannot distinguish those, since the difference is intent. Distinct because the rejection join can multiply rows per experience. `lostHidden` reports how many the region holds that no longer exist and are **not** being shown — zero once `includeLost` is on, since nothing is hidden then |
| GET | `/api/experiences/by-region/:regionId/locations` | Batch: all locations for all experiences in region, grouped by `experience_id`. Supports `includeChildren` and `includeLost`, the latter because this batch has to follow the list: a row the list shows but this omits arrives with no markers and a confident `0/N in region`. Eliminates N+1 per-experience location fetches |
| GET | `/api/experiences/search` | `q`, `limit` |
| GET | `/api/experiences/categories` | Active categories ordered by priority. `experience_count` excludes `lost` and `admission = 'refused'` rows, unconditionally — it labels the category, not a page, and no caller passes `includeLost` here |
| GET | `/api/experiences/region-counts` | `worldViewId` required, optional `parentRegionId` |
| GET | `/api/experiences/:id/locations` | Multi-location list; optional `regionId` adds `in_region`. 404s for a refused row, like `/:id` |
| GET | `/api/experiences/:id/treasures` | Treasures list (artworks/artifacts). Carries `hideRefusedSql()` on the container, so a refused museum's works come back empty: the contents follow the container, and answering with them would put back on screen exactly what hiding the museum took off it |

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
| POST | `/api/experiences` | Create manual experience. Required `categoryId` (no default). Optional `websiteUrl` stored in `metadata.website` |
| POST | `/api/experiences/:id/reject` | `{ regionId, reason? }` |
| POST | `/api/experiences/:id/unreject` | `{ regionId }` |
| POST | `/api/experiences/:id/assign` | `{ regionId }` |
| DELETE | `/api/experiences/:id/assign/:regionId` | Manual assignment removal |
| DELETE | `/api/experiences/:id/remove-from-region/:regionId` | Full removal (any assignment type). Keeps rejection as guard against spatial recompute |
| PATCH | `/api/experiences/:id/edit` | Editable fields (`name`, descriptions, `category`, `imageUrl`, `tags`, `websiteUrl`, `wikipediaUrl`). The last two are stored in `metadata.website` / `metadata.wikipediaUrl` via JSONB merge |
| GET | `/api/experiences/:id/curation-log` | Latest curation actions, filtered to the caller's curator scope (see Curation Guarantees) |
| GET | `/api/experiences/review/queue` | What a run could not decide: `missing` objects awaiting a verdict, `refused` rows a category rule turned down, and `conflicts` where the source and a curator disagree — plus `keptOut`, the confirmed refusals, which are answered rather than waiting and appear on no other surface. Params `limit` (default 25), `offset`, `categoryId`. Scoped like the curation log |
| POST | `/api/experiences/:id/state` | `{ membership?: 'present' \| 'former', existence?: 'extant' \| 'lost', note?, expected: { membership, existence, flagged } }` — a verdict on one or both axes; at least one required. `expected` is **not** optional: it is the row as the caller saw it, compared under the write lock, and without it the server cannot tell a stale view from a deliberate correction |
| POST | `/api/experiences/:id/admission` | `{ decision: 'confirm' \| 'override', note? }` — answer a refusal. `confirm` keeps the row refused and hidden, `override` admits it again. Both pin `admission` in `curated_fields`, which is what takes the card out of the queue and what stops a later run reversing either answer; no `expected` block is needed, because a second curator collides with that pin and gets 409 |
| POST | `/api/experiences/:id/accept-source` | `{ fields: string[], expectedSyncLogId }` — apply the values that run proposed for those fields and release the curator's claim on them. `expectedSyncLogId` is required: a newer proposal is refused rather than substituted |
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

## The "New" chip

`is_new` is decided server-side and means **was observed arriving in the latest completed
non-dry run of its category**, not "recently created". The distinction is the whole point. Both dates mark a first
appearance, but of different things: `created_at` is when the row entered *this database*,
which for a bulk-loaded category is the same instant for thousands of rows that entered the
source years apart. The client-side `isNewExperience(created_at)` this replaces measured that
while the chip claimed to mean arrival.

The run has to have been **observed** creating the row, not merely credited with it. Migration
009 backfilled `first_seen_sync_log_id` to the newest run of each category for every
pre-existing row — a reasonable guess about where they came from, but not a sighting. Taking
it at face value puts the chip on the whole catalogue the day this ships and keeps it there
until each category next runs; measured against the current database, that is 1547 rows of
1547. So `isNewSql` also requires a changeset row of type `created` for that run and
experience, which only a run that actually inserted it leaves behind. Nothing re-inserts a
whole category any more — force sync, which did, is gone — so that clause now only ever sees
rows a run genuinely brought in for the first time.

`first_seen_sync_log_id` is written on INSERT and never on update, so `is_new` means genuinely
first seen: a row that went missing and came back keeps the run it originally arrived in and
does not wear the chip a second time. That is the right answer — it is not new to anyone who
was here before — and the return is recorded as a `returned` changeset row instead.

```text
is_new = a run was observed creating the row (a `created` changeset row for it)
         AND first_seen_sync_log_id = the latest completed non-dry run of the category
         AND ( that run finished inside category.new_badge_days
               OR this reader first saw the chip < 7 days ago )
```

The two clauses are a **maximum, not a choice**. The category window is the floor everyone
gets — sources have different cadences, so it is per category — and a reader who happens to
arrive near its end keeps the chip a week from their own first sighting rather than losing it
the next day. Anonymous readers get the first clause alone; there is nobody to have shown it
to, and `v.user_id = NULL` is never true, so the personal clause drops out without needing a
second query.

The bound on all of it is the **next completed non-dry run**: once the category runs again for
real, `first_seen_sync_log_id` no longer names the latest run and the chip goes, whatever
either window says. A preview finishes without moving it — dry runs are excluded from the
lookup, which is the same reason they cannot disturb provenance. That is what stops a batch accumulating chips indefinitely, and it is why no
retention job is needed for `user_new_badge_views`.

The lookup is a correlated scalar subquery, so it runs once per output row — 5000 of them on a
whole-region read. `idx_experience_sync_logs_latest` (`category_id, completed_at DESC, id DESC`,
partial on the same predicate) turns each into an index-only scan; `id` is in the key because
it is the tiebreak in the same `ORDER BY`, and without it the scan is presorted only on
`completed_at` and still pays an incremental sort.

"Latest" is by `completed_at`, **not** by id (`isNewSql` in `experienceNewBadge.ts`). A run
that starts earlier can finish later, and id order is creation order — so ordering by id can
name a run from months ago as the latest and switch every chip in the category off at once.
This was found by running the predicate against real rows; the shape tests passed either way.

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
records what it could not decide, and this is where a curator decides it. Three kinds of
question, kept apart because they are answered differently — and one list that is not a
question at all, carried here because nowhere else can carry it.

**Refused rows** — the one kind of item here a run has *already* acted on, and the exception
to the page's standing promise that nothing on it has changed what visitors see. None of the
three answers below is true of one: the British Museum is open, so not `lost`; it was never a
legitimate member of *Top Art Museums*, so not `former`; and the refusal was right, so not a
false alarm. Its two answers are its own — the rule was right, or the rule was wrong — and the
card carries `admission_reason` verbatim, because "refused" alone leaves a curator guessing
while *"not a museum class — named by Column of Phocas (36 sitelinks)"* lets them confirm a
rule or spot a bad one. A confirmed row is not deleted: the refused set is the list the
archaeology category will be built from. Refused rows are excluded from the missing group, or
the same row would appear twice under two contradictory framings.

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
back.

**Missing objects** — rows the machine flagged `missing_since` and nobody has judged yet
(`source_membership = 'present'`, and not refused). Three answers, and only two of them change anything:
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
`FOR UPDATE` first. Every verdict writes both columns, the axis the curator did not decide
defaulting to what is already stored, so reading that from outside the transaction would let
one curator's verdict silently revert another's. Two curators on one item is the ordinary
case: every region-scoped curator covering any of its regions sees it, as do its category
curator and every admin.

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
name: `editExperience` claims `metadata.website` and `metadata.wikipediaUrl` per key, which
no column matches, so the query falls back to the field's own name for keys the map does not
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
that never happened, reported as one that did, with no conflict for a queue card to raise. The
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
produces such a claim today: `editExperience` (`curationController.ts`) only ever adds
`metadata.website` and `metadata.wikipediaUrl` per key, never the two major ones, so this is a
doc-truth gap rather than a live one. The rule holds for the keys the map does not carry: there,
the claim key the queue reads and the claim key the upsert honours are the same string, and
`computeChangeSet` — producing the very `changed_fields` and `curatedConflicts` the queue
reads — uses that same string too.

Accepting is always a claim release; whether the value is *also* written on the spot is what
`ACCEPTABLE_FIELDS` (`lifecycleController.ts`) decides — `name`, `shortDescription`,
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

The accept path reads `curated_fields` **inside** the transaction that rewrites it, under
`FOR UPDATE`. The whole column is rewritten, not one element of it, so a value read before
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

The queue pages (`limit` default 25). The page labels a full first page "first N" rather than
printing its length as a total, and carries Previous / Show more so the items behind it are
reachable — otherwise the label would name a backlog the curator could only reach by
answering everything in front of it.

The page lives at `/review` (`frontend/src/components/curation/ReviewQueue.tsx`), reachable
from the header for curators. That gate is convenience: every action it offers is checked
server-side against the caller's scope.

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
- Cache invalidation after mutations must include `['experiences', 'by-region', regionId]` (Map mode), `['discover-experiences']` (Discover mode) and `['region-locations', regionId]` — the last because the location batch answers for the rows the list is showing, so anything changing that set leaves its markers stale. The key stops at the region on purpose: it also carries `includeLost`, and a longer key would clear one variant and leave its sibling answering from the old set. `invalidateExperiences` (`utils/queryInvalidation.ts`) does all of it; both `AddExperienceDialog` and `CurationDialog` go through it
- Discover's experiences query is keyed `['discover-experiences', regionId]` — **not** by category. The response is category-independent; the category filter runs in `select`, per observer. Keying by category would give each tab its own cache entry and refetch the whole region on every switch
- Creating a manual experience inserts into 4 tables within a transaction: `experiences`, `experience_locations`, `experience_regions`, and `experience_location_regions`. The last one matters — without it the location's `in_region` flag is false. The marker still appears (`buildExperienceMarkers` falls back to a location of any kind, flagged `inRegion: false`, so a hand-assigned experience is not invisible), but everything that counts in-region locations reads zero: the `0/N` chip on the row, the visited counts, and the mark-all-locations checkbox, which marks in-region locations and so marks nothing
- `LocationPicker` lives in `frontend/src/components/shared/` with coordinate parsing in `frontend/src/utils/coordinateParser.ts`. Accepts `name` prop to pre-populate search/AI fields; coordinates sync across all modes (e.g. map click shows in Coordinates tab). Exposes `onPlaceSelect` callback that passes Wikidata ID from Nominatim search results
- Visited tracking uses location-level system (`user_visited_locations`) for both the root checkbox and the "Mark Visited" button. The experience-level table (`user_visited_experiences`) is maintained for backward compatibility but the UI is driven entirely by location visits. The `markAllLocations` batch endpoint handles both single- and multi-location experiences consistently
- **Batch location fetching**: `useRegionLocations(regionId, includeLost)` hook (`frontend/src/hooks/useRegionLocations.ts`) fetches all locations for all experiences in a region via a single `GET /api/experiences/by-region/:regionId/locations` call. `includeLost` follows the list and is part of the query key, since a row the list shows and the batch omits renders with no markers and a confident `0/N`. Both `ExperienceMarkers` and `ExperienceList` consume this shared hook, eliminating ~300 individual API calls for a 150-experience region. Visit checkbox state is derived from the global `useVisitedLocations().isLocationVisited()` rather than per-experience `useExperienceVisitedStatus()` calls. The batch endpoint also returns `region_path` (full ancestor path from root to leaf region, e.g. "Europe > Germany > Bavaria") for each location via a recursive `LEFT JOIN LATERAL` on `experience_location_regions` + `regions`
- **Reads whose response depends on world-view visibility must be authenticated**: they go through `authFetchJson`, not `fetchJson` — `by-region/:regionId`, `by-region/:regionId/locations`, `:id/locations`, `region-counts`, and `GET /api/experiences/:id`. The first four carry `requireVisibleWorldView`, which answers **404, not 401**, when a world view has `is_public = false` and the caller is not an admin, so an unauthenticated read is indistinguishable from a missing region: react-query stores the rejection as `data: undefined` and nothing surfaces. `:id` is different in mechanism and identical in consequence — it is public by design and instead filters the `regions[]` it returns, admitting every assignment only for an admin, so without a token that documented bypass is unreachable and an experience assigned only to hidden world views returns an empty region list rather than an incomplete one. All five are covered by `frontend/src/api/experiences.auth.test.ts`. One membership is prospective rather than active: `:id/locations` is guarded on `regionIdQuery`, which passes the request through when no `regionId` is supplied, and neither caller supplies one — so as called today that response has no visibility dependence, and this guard alone never 404s. The header is what keeps the route correct if a caller starts passing one. The route can still 404 today, for an unrelated reason: the existence check excludes a refused row, matching `:id` — an admission question, not a visibility one. `GET /api/experiences` carries the same guard on its `regionId` query param and is listed in `SECURITY.md`, but has no frontend client — which is why it is absent here and from the test
- **An in-region count is only meaningful once the batch has settled**: `useRegionLocations` reports `locationsResolved`, and three consumers gate on it — the expanded card's ratio, the row's count chip, and the visited controls. The last is not a display concern and must not be dropped as one: visited state is derived from in-region locations, so an unresolved batch makes `inRegionCount` 0, which short-circuits `inRegionVisitedStatus` to `not_visited`; every toggle then passes "mark", always, and a fully-visited experience can be re-marked but never unmarked. The numerator is derived by filtering the batch while the denominator falls back to `experience.location_count`, which arrives with the experience — so an absent batch does not read as "no locations here", it reads as a confident `0/N`. The 404 above was one way to reach that state; a 500, an offline reload or an aborted navigation are others, which is why the fix is the gate rather than the 404
- **Out-of-region location display**: In the expanded sidebar details, locations are split into in-region (shown first, fully interactive) and out-of-region (collapsible section). Out-of-region locations show the first 3 with a "Show N more" toggle. Each displays its region path with the common prefix stripped — e.g. if all out-of-region locations are in Europe, "Europe > " is removed so you see "Germany > Bavaria", "France > Paris", etc.
- Rejected experience visibility is scope-dependent and returned by backend
- Multi-location experiences expose `location_count` in region browse responses for map/list UX
- Detailed marker interaction architecture is documented in `experience-map-ui.md`
