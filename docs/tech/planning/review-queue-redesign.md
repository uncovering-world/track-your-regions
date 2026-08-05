# Review queue redesign — curator workflow

**Status:** slice C done (PR #495). Slice F redesigned 2026-08-04 around a per-source trust
setting, **re-cut 2026-08-05** after its spec was verified against the code and the live
database and did not survive — see `slice-f-per-source-curation-gate.md` § 11. A, B, E
specified 2026-08-05. Local working document, never committed.

**This file is the overview.** Each slice has its own self-contained spec and plan — start
there, not here, when implementing one:

| slice | document | issue |
|---|---|---|
| F — per-source curation gate | `slice-f-per-source-curation-gate.md` (spec) + `-plan.md` | #500 |
| A — the bench content | `slice-a-review-bench-content.md` | not filed |
| B — the drainable queue | `slice-b-drainable-queue.md` | not filed |
| E — notifications | `slice-e-notifications.md` — **reader half blocked on one decision** | not filed |
| C — region assignment | done, PR #495 | closed |

Decision of record for F: ADR-0022. Treasures gap: #501.

**Goal:** make `/review` a screen a curator can actually work from — one that shows the
information a decision needs, lets the decision be made per field, and can be emptied.

## Why — findings from the live acceptance run

These are not review comments. They come from working the screen as a curator during the
slice-5 live run (UNESCO run 41, four real conflicts on Aksum, Berlin Modernism Housing
Estates, Garamba National Park and Getbol).

1. **The screen asks for a decision and withholds what the decision rests on.** Values are cut
   at 120 characters (`describe()` in `ReviewQueue.tsx`). Aksum's conflict was 200 characters
   of curator text against 511 of source text; nothing on the page could compare them. There
   is no diff and no way to expand.
2. **The queue cannot be emptied by keeping your edits.** "Keep my edit (current)" is a
   *disabled* button — a dead end shaped like an action. The only way a card leaves is
   accepting the source. A curator who works through 300 conflicts and stands by every one of
   them sees the same 300 the next day, with nothing recording that they were considered.
3. **Acceptance is all-or-nothing per object.** `accept.mutate(proposed.map(f => f.field))`
   sends every proposed field. If the source improved the description and damaged the name,
   there is no way to take one. The API already accepts a field list; only the UI cannot
   express it.
4. **The object itself is absent.** No image, no coordinates, no link to the source page. To
   judge whether the source's new description is better, the curator cannot look at the thing.
5. **No provenance.** The run and its time appear only *after* acting, in the outcome alert.
   Who claimed the field and when is never shown — and the button says "my edit" even when
   another curator made it.

## The workflow this has to serve

The screen is one part of a chain that does not currently connect. Stated whole, because
every slice below is a piece of it:

**sync → assignment → the right curator is told there is work → they can decide it.**

Assignment was the missing second link and is now closed (slice C, PR #495): placement runs
at the end of every run, for what moved. *Being told* still does not exist at all — that is
slice E.

### Who can act, and when — measured, not reasoned

The queue's scope filter (`lifecycleController.ts:77-83`) is
`unrestricted-for-this-row's-category OR EXISTS(experience_regions ∩ curator's regions)`.
Run against fixtures on the live database (an unassigned UNESCO site, "Wadden Sea"):

| role | of 3 open conflicts | an unassigned experience |
|---|---|---|
| admin | 3 | can see |
| category curator (UNESCO) | 3 | **can see** |
| region curator (Africa) | 2 | **cannot see** |
| global curator | 3 | can see |

So assignment is not a convenience for a region curator — it is the precondition for their
work existing at all. Until it runs their queue is empty because the work is *hidden*, not
because there is none. And nothing tells them when that changes.

This also means the "there is work" signal must be computed with **the same** scope filter.
A count that ignores scope would show a region curator work they cannot open. Notification
and scoping are one feature, not two.

## Slicing

Five independent branches, ordered by what unblocks what. Each is worth shipping alone.

- **Slice A — the bench content** (UI only, no schema): full values with a diff, per-field
  decisions, object context, provenance. Fixes findings 1, 3, 4, 5.
- **Slice B — the drainable queue** (schema + API + layout): "keep mine" as a real decision,
  and the master–detail layout. Fixes finding 2.
- **Slice C — incremental region assignment**, automatic on sync completion. **DONE**,
  merged as PR #495 — and it turned out the sync was *destroying* assignments rather than
  failing to create them. What that turned up is under "Done — slice C" below.
- **Slice F — a source is trusted or it is not, and the product says which.** Full section
  below. It **absorbs what was slice D** ("a third kind of item: arrived, nobody has looked
  at it") — approving an arrival *is* reviewing it, so there is one mechanism, not two.
- **Slice E — notification.** A toast, bottom-right, when there is something waiting. Two
  audiences over one mechanism:
  - *curators* — count from the queue, through the scope filter above;
  - *users* — new experiences they have not been shown yet. **This is already computable from
    slice 4**: `user_new_badge_views` records exactly what a reader was shown, so "new and
    unseen" is `is_new` with no impression row for that user. The chip and the toast are the
    same question at different granularity, and neither needs new storage.

  Open question, not yet decided: what makes a new experience *relevant* to a user. A reader
  tracking Europe does not want a toast about 25 arrivals in Asia. Candidate scopes are
  visited regions, the region currently open, or an explicit follow. Must be settled before
  this slice gets a spec.

## Slice F — a source is trusted or it is not, and the product says which

**The detail lives in `slice-f-per-source-curation-gate.md`, which is self-contained.** What
follows is only what the other slices need to know about F; do not re-derive the model from
here.

Decided 2026-08-04, revised the same day — the first version made every source wait for a
curator, which would have removed 1600 of 1603 rows from the product. Nikolay's correction:
some sources are good enough to publish unread, and that difference must be *visible* rather
than assumed. So the gate is a per-source setting
(`experience_categories.requires_curation`), and every experience records how it was checked
in `experiences.curation_state` — `pending` (invisible) / `auto` (published unread, marked) /
`verified` (a curator passed the object now live).

**Re-cut 2026-08-05** after the spec was verified against the code and the live database.
Three things changed that the other slices care about:

- **the gate holds the whole object** — content, the points in `experience_locations`, and the
  treasures in `experience_treasures` — as one proposal answered by one queue item. Holding
  the row alone moved an object's pin while its card named the old place, and left a gated
  museum handing readers unreviewed artworks. **#501 is closed by F**, not deferred.
- **publishing writes all eleven content fields**, not the five `accept-source` writes. Its
  answer for the other six is to release the claim and let the next run apply the value, and
  the gate closes that escape.
- **`pending` is 404 by id**, not merely absent from lists. `GET /:id`, `/:id/locations` and
  `/:id/treasures` carry no lifecycle filter at all, which is why a grep for `hideLostSql`
  never found them.

What slices A, B and E must not break:

- **`curated_fields` stays.** One sentence, and it is in the ADR: **the claim protects a value
  from a run; the gate protects a reader from a run.** Slice A's bench still uses the claim to
  keep hand-written fields out of "accept all".
- **Blocking work and backlog must stay apart.** Blocking is `arrival`, `held`, `conflict`,
  `missing` — somebody is waiting, and for the first two the object is invisible or stale
  until the answer comes. Backlog is the 1603 `auto` rows nobody has passed, drainable over
  months. Slice E's notification must read the blocking kinds only, or the toast is useless
  from the first minute.
- **The queue's new kinds carry the same scope filter** as the existing two.
- **Lists mark only `verified`** — marking `auto` would mark 1600 of 1603 rows, which is noise.
  The object's own card states it either way in words.
- **Throughput, stated once.** The slice-5 round produced 55 arrivals and 84 updates. If
  UNESCO stays gated that is 139 blocking items from one round, for one curator.

Named as *not* closed by F, so no slice inherits them silently: #502 (the anchor and the map
already disagree for 106 objects), #503 (the category total ignores the lifecycle predicate),
#504 (Martin publishes `experiences` as unfiltered tiles), #505 (an arrival point per
location), #506 (how a dispersed nomination is shown).

## Slice A — the bench content

### Per-field rows, not per-object cards

Each conflicted field renders its own row: field label, both values **in full**, a word-level
diff, and its own pair of actions. Object-level "accept all" / "keep all" stay as a
convenience for the common case where every field goes the same way.

`describe()` is deleted. Long values are shown, not summarised — that is the whole point of
the screen. The diff carries the reading load that truncation was standing in for.

Fields the endpoint reports as `acceptable: false` (`location`, the country arrays,
`metadata` — see `docs/tech/experiences.md`) keep their existing note that accepting releases
the claim and the next run applies the value.

### Object context

A compact header block above the fields: thumbnail (`image_url`), coordinates with a link
that opens the object on the map, and links to the source page and Wikipedia. Those two are
**metadata keys — `metadata.website` and `metadata.wikipediaUrl`** — not columns; an earlier
draft of this file said `website_url` / `wikipedia_url`, which do not exist. Region breadcrumb
from `experience_regions`.

Reuse before creating: check `frontend/src/components/shared/` and
`docs/tech/shared-frontend-patterns.md` for an existing thumbnail/link-row component before
writing one, and `CoverageMapPreview` in `frontend/src/components/admin/` for the map preview.

### Provenance

No new storage — all of it is already in `experience_curation_log`:

- which run proposed this, and when — `sync_log_id` on the queue item plus the log's
  `completed_at`;
- who claimed the field and when — the most recent `edited` entry whose `details` mentions
  the field;
- previous decisions on the same field — `accepted_source` and (after slice B) `kept_mine`
  entries.

The queue endpoint gains these as read-only fields. The button label stops saying "my edit"
and names the curator instead.

## Slice B — the drainable queue

### "Keep mine" becomes a decision

New table:

```sql
CREATE TABLE experience_conflict_decisions (
    experience_id  INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field          VARCHAR(64) NOT NULL,
    declined_value JSONB NOT NULL,
    decided_by     INTEGER NOT NULL REFERENCES users(id),
    decided_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (experience_id, field)
);
```

`declined_value` holds the exact source value that was refused. The queue query suppresses a
conflicted field when the proposal it is about to show equals it. A *different* proposal does
not match, so the card comes back — which is the property that keeps this from being a
permanent mute.

Both sides of that comparison must be named precisely, or the rule is untestable. The
proposal is the `new` member of the matching entry in
`experience_sync_changes.changed_fields` for the run the queue item names in `sync_log_id`.
`changed_fields` is `jsonb`, so `declined_value` stores that member verbatim and the
comparison is **jsonb equality on the extracted member**, not text equality on a rendered
form — `"2003"` and `2003` are different proposals and must stay so, which is exactly the
string-versus-number trap the fixture dry run hit on `metadata.dateInscribed`.

- Accepting the source deletes the row (the claim is released anyway).
- **Editing the field again deletes the row.** Agreed judgement call: the curator most likely
  rewrote their text *because* of what the source proposed, so the next run should ask again
  rather than stay silent on a decision made about older text.
- The decision is written to `experience_curation_log` as `kept_mine`, so slice A's provenance
  trail shows it.

Storing the value rather than a hash is deliberate: the trail can then say *which* text was
declined, which is what slice A's provenance section needs.

### Layout — queue left, bench right

One screen, no mode switch: arrow keys move through the list, the bench on the right always
holds the full context for the selected item. `A` accepts, `K` keeps.

The list holds both question types — "gone from the source" and "the source disagrees" — with
a type marker, and the bench renders the controls that type needs. Filters by category and by
type.

This also retires an existing oddity: today a single `offset` pages *both* lists at once.

## Component split

`ReviewQueue.tsx` is 303 lines and will not hold this. Per
`docs/tech/development-guide.md`:

- `ReviewQueue.tsx` — page, layout, selection state, keyboard handling
- `ReviewList.tsx` — the triage list, filters, type markers
- `ReviewBench.tsx` — the selected item: header, fields, actions
- `FieldDiff.tsx` — one field: both values, word-level diff
- `ObjectContext.tsx` — thumbnail, coordinates, links, breadcrumb
- `ProvenanceTrail.tsx` — run, claimant, previous decisions

## Out of scope

- **Cross-item patterns** ("the same proposal appears in N other objects"). Considered and
  dropped — not chosen, and it needs a grouping model the rest of this does not.
- **Multi-select with checkboxes.** The keyboard flow gives the same speed without a selection
  model to maintain.

## Done — slice C, incremental region assignment (PR #495)

Kept because the reasoning matters for the slices still open.

The brainstorm found the premise was wrong. Assignment did not merely *miss* new rows: both
write paths deleted every location of every object each run, and
`experience_location_regions.location_id` is `ON DELETE CASCADE`, so every sync destroyed
every assignment including the manual ones — 6647 of 6677 rows re-created in one day. The
manual re-assignment existed to rebuild what the run had just wrecked.

So the fix was not "make assignment incremental" but "stop destroying". A location is now
identified by `(point, external_ref)` and its row survives a run that does not move it, which
leaves the moved set nearly empty on an ordinary run. `placement.ts` places that set at the
end of the run, across every world view that has geometry.

Still open, filed as issues: #494 (recompute when region geometry changes — a *visitor* GET
can write geometry, so no request is a safe place to drain the queue) and #496 (import tree
operations skip the invalidation entirely).
