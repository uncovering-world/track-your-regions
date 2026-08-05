# Slice F — per-source curation gate — SPECIFICATION

**Status:** specified, not implemented. Local working document, never committed.
**Issue:** #500 · **Also closes:** #501 · **Decision:** ADR-0022
(`docs/decisions/0022-per-source-curation-gate.md`, uncommitted — ships with this branch)
**Plan:** `slice-f-per-source-curation-gate-plan.md` — read this document first.
**Wider context:** `review-queue-redesign.md` (slices A, B, E depend on this one).

> **Partly superseded, 2026-08-05 (later the same day).** Everything below that has the gate
> hold an experience's points and treasures as one bundled proposal is replaced by
> `catalogue-curation-model.md`: curation applies to experiences, locations and treasures
> independently, with the same three states. The per-source setting, the three states, the
> migration's honesty, the New chip re-anchoring and `curated_fields` staying are all unchanged
> and still stand. **Do not implement §§ 3.1, 3.3, 3.5 and 4.2 as written.** The re-cut waits on
> `museum-import.md`, because a gate over a catalogue in which the Louvre is absent and four of
> its departments are present would curate the wrong things.

**Revised 2026-08-05** after the first version was verified against the code and the live
database and did not survive. What changed and why is § 11; the findings are also recorded as
a comment on #500. This document is self-contained and does not assume the conversation that
produced it.

---

## 1. The problem, measured

Everything the product shows arrived from a sync run, and nobody looked at any of it.

Measured on the dev database, 5 August 2026:

| source | experiences | with any `curated_fields` | multi-location | max locations | venues with treasures | treasures |
|---|---|---|---|---|---|---|
| UNESCO World Heritage Sites | 1272 | | 484 | 758 | 0 | 0 |
| Top Museums | 128 | | 0 | 1 | **128 of 128** | 1014 (avg 8.5, max 103) |
| Public Art & Monuments | 203 | | 0 | 1 | 0 | 0 |
| **total** | **1603** | **3** | 484 | | 128 | 1014 |

A run's output is live the moment it lands. Issue #480 made a run's effects *legible* — a
changeset per run, provenance on every row, a queue for the two questions a run leaves open —
but changed nothing about what reaches a reader.

The two ends of the catalogue are genuinely different. UNESCO is an official register with
stable identifiers. The Wikidata-derived sources are community-edited, and the same sync has
already had to discard collections-as-entities that its own SPARQL returned (PR #486) — the
kind of thing a person spots and a predicate does not.

A single global rule is wrong in both directions:

- **gate everything** → 1603 existing rows must be approved by hand, or blessed by a
  migration pretending they were read; and a curator becomes the bottleneck for a register
  that review would rarely improve;
- **gate nothing** → community data reaches users unchecked, and the only lever is switching
  the source off entirely.

And in either case the reader is told nothing.

**The source split above is load-bearing and was measured, not assumed.** Complex geometry
lives entirely in UNESCO — the source least likely to be gated. Treasures live entirely in Top
Museums — the source the gate exists for. Any design that protects an experience's row and
leaves its contents alone protects the wrong thing.

## 2. The model

### 2.1 The setting

`experience_categories.requires_curation BOOLEAN NOT NULL DEFAULT true`.

A category *is* a source in this codebase — UNESCO, Top Museums, Public Art each have one row
and one sync service. An admin sets this per source, in the sync panel.

### 2.2 The three states

`experiences.curation_state` — `pending` | `auto` | `verified`.

| state | visible to readers | in the curator queue | means |
|---|---|---|---|
| `pending` | **no** | yes, as `arrival` | arrived from a gated source, nobody has passed it |
| `auto` | yes | as backlog only | published unread, and the product says so |
| `verified` | yes | no | a curator passed the content that is live now |

Two supporting columns:

- `experiences.published_at TIMESTAMPTZ` — when the row became visible. NULL while `pending`
  and NULL for every row that predates this feature. Anchors the "New" chip (§ 5.3).
- `experiences.pending_change_sync_log_id INTEGER` — the run whose proposal is being held for
  a *visible* row. NULL when nothing is held.

### 2.3 The rule that keeps two guards straight

`curated_fields` is not retired. Under a trusted source the sync still writes straight to the
live row, so the per-field claim is again the only thing standing between a hand-written value
and the next run.

> **`curated_fields` protects a value from a run. The gate protects a reader from a run.**
> They answer different questions and neither replaces the other.

Any change to either mechanism must be checked against this sentence. It is the whole reason
both exist.

## 3. What a run does

### 3.1 An object is three things, and the gate holds all three

The gate is not "a run withholds some columns". It is **a run proposes an object and a curator
publishes it**. An experience has three parts, written by three different mechanisms:

| part | written by | held how |
|---|---|---|
| content — the 11 diffed fields | the upsert's `CASE` guards | live values untouched; the proposal waits in the run's changeset |
| points — `experience_locations` | `writeExperienceLocations` | not called; the offered set waits in the run's changeset |
| treasures — `experience_treasures` | `upsertMuseumTreasures` | not called; the offered set waits in the run's changeset |

Holding only the first was the first version's mistake, and the data says why. Every gated
object today has exactly one location, so holding content while `writeExperienceLocations`
runs anyway would move the pin, re-place the object into another region, and leave its card
naming the old one. And every museum carries treasures, so a gated museum whose text did not
change would still hand readers a dozen unreviewed artworks.

### 3.2 The hold condition — per row, not per run

```
hold = category.requires_curation AND storedRow.curation_state <> 'pending'
```

**Only a visible row is held.** A row nobody has ever seen has nothing to protect, so a gated
source keeps refreshing a `pending` row in place — content, points and treasures alike — and
the curator ends up reviewing the newest state rather than whatever arrived first.

That `pending` rows keep writing their points is deliberate and load-bearing: placement runs
over what moved, so an arrival lands in its regions and a **region** curator can see it at
all. Without that their queue would be empty by construction (`review-queue-redesign.md`
§ "Who can act, and when").

The condition is computed in SQL for the content half, because it depends on the stored state
the same statement is about to overwrite. Inside `ON CONFLICT DO UPDATE`, a reference to
`experiences.curation_state` reads the value *before* the update even when the same statement
also assigns that column — verified experimentally, not assumed.

### 3.3 The matrix

| event | gated source | trusted source |
|---|---|---|
| arrival | row inserted with content, points and treasures written, `curation_state = 'pending'`, `published_at = NULL` — invisible | everything written, `curation_state = 'auto'`, `published_at = NOW()` |
| any change to a `pending` row | applied in place, all three parts; state and `published_at` unchanged | n/a |
| content change to a visible row | **held**; `pending_change_sync_log_id` = this run | applied, still subject to `curated_fields`; `verified` → `auto` |
| points change to a visible row | **held**; `writeExperienceLocations` not called | applied; `verified` → `auto` |
| treasures change to a visible row | **held**; `upsertMuseumTreasures` not called | applied; `verified` → `auto` |
| provenance-only pass (`last_seen_at`, `last_seen_sync_log_id`, `missing_since`, `source_membership`) | applied | applied |
| the source stops listing a `pending` row | nothing — see § 3.6 | n/a |

A run holds an object if **any** of the three parts differs. One queue item covers all three.

### 3.4 Provenance is not content

The provenance columns sit outside the upsert's `CASE` guards today and must stay outside
them. **A gated run still records that the source listed the object.** If it did not, missing
detection would start flagging everything the gate holds, and one gated source would
manufacture a category-wide false alarm.

Verified in the code: `last_seen_sync_log_id`, `last_seen_at`, `missing_since`,
`source_membership` and `updated_at` are plain assignments outside every guard
(`syncUtils.ts:171-182`). This is the property that makes the content half of the slice cheap.

### 3.5 Where a held proposal lives

In the run's changeset — `experience_sync_changes.changed_fields`, the same jsonb array the
`conflict` kind already reads, with two additional entries:

- `{ field: 'locations', new: [...offered], summary: { stored, offered, matched, anchorMovedMeters } }`
- `{ field: 'treasures', new: [...offered], summary: { added, unchanged } }`

No new table. The worst case in the catalogue is 758 points, which weighs 77 kB as JSON —
measured, not estimated — and only ever for a gated UNESCO object.

Whether the points differ is answered by the **fast path already inside**
`writeExperienceLocations`: one round trip comparing stored count, matched count and offered
count. Extract it as a read-only probe and have the writer call the same probe, so there is
one implementation of "did the geometry change".

### 3.6 An arrival that goes away before anyone saw it

Missing detection skips `pending` rows, exactly as it already skips `existence = 'lost'` — it
was never visible, so there is no verdict to give and nothing to tell a user.

Skipping must cover **the flag predicate and both sides of the coverage ratio**. That
asymmetry — skipping in one place and not the other — was a real bug in #487. Both counts are
taken before the item loop runs, so adding the same predicate to both keeps the ratio drawn
from one set.

### 3.7 `verified` decays

Any change from a trusted source returns the row to `auto` — content, points or treasures. A
curator's pass covered the object that was there; a changed object has not been passed.

A provenance-only pass does not decay it. The statement cannot tell the difference — the
`CASE` guards fire whether or not a value differs — so the decay is resolved in TypeScript
against the computed change set, after the write.

## 4. What the curator does

### 4.1 Two new queue kinds

`getReviewQueue` currently returns `missing` and `conflict`. It gains:

- **`arrival`** — `curation_state = 'pending'`. The whole object is the proposal.
- **`held`** — `pending_change_sync_log_id IS NOT NULL`. The proposal is read from that run's
  changeset.

Both go through the **same scope filter** as the existing kinds
(`curatorUnrestrictedScopeExists` OR region intersection). This is not optional: a count
computed without it shows a region curator work they cannot open. Notification and scoping are
one feature, not two.

`held` needs no withdrawal check — the column is cleared when the proposal is answered and
overwritten when a newer run proposes again, so it names the current proposal by construction.
It **does** need the `proposed IS NOT NULL` guard the `conflict` kind has, because `jsonb_agg`
over an empty set returns NULL and an empty card is worse than no card.

### 4.2 The card is a summary, not a diff

One card per object, covering all three parts. A per-point diff is unreadable at this scale
and unjudgeable — nobody approves 758 coordinates one at a time — so the points and treasures
render as counts and one distance:

```
Frontiers of the Roman Empire            proposed by run #47
fields    3 changed — name, description, short description
points    420 → 423, anchor moved 4.2 km
treasures unchanged
```

For a museum the same card reads `treasures  +12`, which is the risk this whole slice exists
to catch.

Field-level values keep the shape `conflict` already returns, so slice A's bench inherits it
without a second format.

### 4.3 Blocking work versus backlog

The queue now carries two populations, and mixing them makes it useless:

- **blocking** — `arrival`, `held`, `conflict`, `missing`. Somebody is waiting on the answer,
  and for the first two the object is invisible or stale until it comes.
- **backlog** — `auto` rows nobody has passed. **1603 of them on day one.** Drainable over
  months. Must not drive counts or the slice-E notification.

### 4.4 Publishing

`POST /api/experiences/:id/publish`, curator-scoped. Inside one transaction, under the row
lock:

1. applies the held content fields, leaving fields the curator claims in `curated_fields`
   alone;
2. writes the held points through `writeExperienceLocations`;
3. writes the held treasures through the museum sync's treasure writer;
4. `curation_state = 'verified'`;
5. `published_at = COALESCE(published_at, NOW())` — a second pass over an already-visible
   object must not restart its New-chip window;
6. `pending_change_sync_log_id = NULL`;
7. writes `experience_curation_log` with action `published`;
8. **places the object**, because publishing can move it between regions and placement
   otherwise only runs at the end of a sync.

**Publishing must be able to write all eleven content fields.** `accept-source` writes five
(`ACCEPTABLE_FIELDS`), and its answer for the other six is to release the claim and let the
*next ordinary run* apply the value. The gate closes that escape: the next run holds it too.
Without a full writer, six fields would be proposed every run and applied never.

Carries `expectedSyncLogId`, like `accept-source`: a card naming a run must not apply a
proposal a newer run has replaced. Everything the decision rests on is read **inside the
transaction that writes, under the row lock** — the reasoning is spelled out in
`applyProposedFields`, and this endpoint has the same exposure.

A curator may publish an object without accepting a claimed field: publishing answers "may
readers see this", the claim answers "whose text is it". Both questions can be open at once.

### 4.5 A curator can fix a coordinate, not only accept one

Holding a coordinate for review while offering no way to correct it leaves the curator with
"take the wrong point" and "keep the wrong point" — the same dead end as the disabled
"Keep my edit" button that started this redesign.

So `editExperience` gains a coordinate, claimed in `curated_fields` like any other edit.

**It must write both the anchor and the point.** The list, search and the object's own read
show `experiences.location`; the map draws `experience_locations`. Editing only the first
would fix the list and leave the pin where it was — which is exactly the defect measured in
#502, where the two already disagree by more than a kilometre for 106 objects.

**Restricted to single-location objects** — 1119 of 1603: 788 UNESCO sites, all 128 museums and
all 203 public-art objects. A dispersed nomination has no single point to edit; its coordinates
become editable with #505, where each location carries its own arrival point. The restriction
is stated in the UI, not silently enforced.

## 5. What a reader sees

### 5.1 The mark

- **Lists** mark only `verified` — a small check, rare now and growing as curators work.
  Marking `auto` would mark 1600 of 1603 rows, which is noise rather than information.
- **The object's card** states it either way, in words.

### 5.2 `pending` is absent everywhere, including by id

Absent from lists, map, search and counts — and **`GET /api/experiences/:id`,
`/:id/locations` and `/:id/treasures` answer 404**. Invisible has to mean invisible; nothing
links to an unpublished object, but nothing stops walking the ids either.

Curators and admins are served normally, so following a queue item through to the object's
page works.

Those three reads, plus the category total in `listCategories`, carry **no lifecycle filter at
all** today, which is why a grep for `hideLostSql` could not find them. That is six real
`hideLostSql` sites, not eight. The category total is a pre-existing defect in its own right
and is filed as #503; this slice adds the `pending` predicate to it either way.

`pending` rows are *not* absent from a visit — the same asymmetry `lost` already has, for the
same reason. In practice a visit to a `pending` row cannot exist, since it was never offered.

**Martin publishes `experiences` and `experience_locations` as unfiltered tile sources**
(`auto_publish: { tables: true }`), and no controller change can close that. Filed as #504;
this slice does not fix it and must not claim to.

### 5.3 The "New" chip re-anchors on becoming visible

`isNewSql()` currently keys on *the run that created the row being the latest completed
non-dry run of its category*. Under a gate that is wrong: an object approved after its
category window (30 days) would appear with no chip at all — silently, the opposite of what
the chip is for.

New anchor:

```
is_new = published_at IS NOT NULL
         AND ( published_at > NOW() - category window
               OR this reader first saw the chip < 7 days ago )
```

This **removes** code, and both removals need stating so they are not re-added:

- the `EXISTS … change_type = 'created'` clause exists only because migration 009 backfilled
  `first_seen_sync_log_id` for rows that predate it. `published_at` is never backfilled, so a
  sighting needs no proof.
- the latest-completed-run clause exists to stop chips accumulating. The 30-day window already
  bounds them, and under piecemeal approval "the newest batch" has stopped being a unit.

Two consequences of the second removal, stated rather than discovered later:

- chips no longer clear when a category next runs; they last their full window per row, so a
  weekly source shows roughly four batches at once instead of one;
- a **force** run re-inserts a whole category, stamping `published_at = NOW()` on every row,
  so it chips the category for the full window rather than until the next run.

One-time effect: **the 54 rows currently wearing the chip lose it**, because `published_at` is
NULL for everything that predates the migration.

## 6. What an admin does

### 6.1 The switch

One switch per source in the sync panel, labelled in the product's terms rather than the
column's: **"Hold new and changed content for review"**, with the consequence written
underneath. Admin-only, beside the existing category writes in `adminRoutes.ts` /
`controllers/admin/syncController.ts` — that is where category writes live, not on the public
experiences router.

Switching a source's gate **on is not retroactive**: rows it already published stay `auto` and
stay visible. Flipping a setting must not remove 1272 objects from the product. This does mean
one category can hold `auto` rows from before the switch beside `pending` ones from after it —
intended, and worth saying in the UI copy.

### 6.2 Turning it off does not publish anything

Nothing moves a row out of `pending` on its own; only the insert arm ever sets it. So a
category whose gate is switched off keeps whatever was waiting.

That is deliberate — a switch that published forty unreviewed objects in one click is the
thing the gate exists to prevent — but it must not be silent. The sync panel shows the waiting
count per source and offers **"publish all waiting"** as its own explicit action, curator- or
admin-authorised, writing one `published` curation-log row per object.

## 7. Migration — the trap this design removes

Migration 013 writes **no `UPDATE` at all**. Every existing row takes the `auto` default:
visible exactly as today, marked truthfully as unread. Nothing to backfill, nothing to lose.

Contrast migration 009, which *did* write a value — crediting 1547 rows to a run that never
saw them, and would have chipped the entire catalogue had PR #493 not caught it. A migration
must state the truth about rows that predate its feature.

The column default is `auto`, **not** `pending`, and this is a safety choice rather than a
convenience: the sync path sets `pending` explicitly because it knows about the gate, so any
other writer keeps today's behaviour. Defaulting to `pending` would make a writer that forgets
the column remove its rows from the product silently, and silence is what makes that class of
bug unrecoverable.

One writer is explicit rather than defaulted: **an experience a curator creates by hand is
`verified`**. A person wrote it; a card saying "imported automatically, not yet checked" about
it would be false. The e2e fixture keeps the `auto` default, which is what its assertions
expect.

## 8. Invariants a reviewer should check

1. A gated run still writes `last_seen_at` / `last_seen_sync_log_id` for every listed object.
2. Nothing `pending` is reachable by any anonymous read, including by id; the visit path is
   unaffected.
3. Every count carries the same predicate as the list it describes.
4. `published_at` is set exactly once per row per publication and never restarted.
5. Missing detection ignores `pending` in the flag predicate **and** on both sides of the
   coverage ratio.
6. The queue's new kinds carry the scope filter.
7. Switching the gate on changes no existing row; switching it off changes no existing row.
8. Nothing in the upsert moves a content column outside its `CASE` guard.
9. A gated run writes no `experience_locations` and no `experience_treasures` row for a
   *visible* object, and writes both for a `pending` one.
10. Publishing can write every field it can hold.

## 9. Out of scope, deliberately

- **The dispersed-object display model** — #506. What the gate holds does not depend on how a
  multi-point object is drawn.
- **The arrival point per location** — #505. § 4.5 ships a single-location coordinate editor
  and says so; #505 replaces it.
- **Martin's unfiltered tile sources** — #504. Not closable from a controller.
- **The category total's missing lifecycle predicate as a general fix** — #503. This slice adds
  `pending` to it; `lost` is that issue's business.
- **Per-field decisions and the master–detail bench** — slices A and B.
- **Notifications** — slice E, which must read the blocking kinds only (§ 4.3).
- **A reader-side "only human-checked" filter.** Considered in ADR-0022 and rejected as the
  mechanism that decides what is published; not excluded as a later addition.
- **A UI for `new_badge_days`**, which remains DB-only.

## 10. Manual verification on the live database

Automated tests do not cover what this slice is about — what a reader sees.

1. **Nothing moved.** Count rows visible to an anonymous reader before and after migration 013.
   Equal.
2. **Gate Top Museums**, dry-run, then run for real. New museums land invisible; the anonymous
   catalogue count is unchanged; a museum that gained artworks appears as `held` with
   `treasures +N` and its artworks are **not** in the database yet.
3. **Publish it.** The artworks land, the object shows the check, the chip appears.
4. **Edit a museum's coordinate as a curator.** The list and the pin move together.
5. **Gate UNESCO and run it.** A multi-point object that changed shows the summary line, not a
   per-point list.
6. **Flip a gate off.** No row changes state; the panel shows the waiting count; "publish all
   waiting" clears it.
7. **A `pending` object by id** returns 404 anonymously and renders for a curator.
8. **A region curator's queue** shows arrivals once placement has run.

## 11. What changed on 2026-08-05, and why

The first version of this spec was written the same day and verified before implementation.
Recorded here so the reasoning is not lost and the same ground is not re-covered.

| changed | because |
|---|---|
| the gate holds points and treasures, not only content | every gated object has one location, so holding content alone moved the pin and re-placed the object; and all 128 museums carry treasures, so a gated museum's contents reached readers unchecked. #501 is closed here rather than deferred |
| publishing writes all eleven fields | `accept-source` writes five and releases the rest to the next run; under a gate the next run holds them, so six fields would never be applicable |
| `pending` is 404 by id | `GET /:id`, `/:id/locations` and `/:id/treasures` carry no lifecycle filter at all, so a grep for `hideLostSql` could never have found them |
| the curator can fix a coordinate | holding a point for review with no way to correct it is the "Keep my edit" dead end again |
| turning the gate off is explicit | nothing releases a `pending` row, so the switch was a one-way door with no way out but manual labour |
| a hand-created experience is `verified` | `auto` would say "imported automatically" about something a person typed |
| eight read sites → six | that is the real count of `hideLostSql` call sites |
| 55 chipped rows → 54 | re-measured |
| Martin named as an unclosable hole | `auto_publish: { tables: true }` serves every row as a tile; #504 |
