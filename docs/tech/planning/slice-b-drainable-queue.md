# Slice B — the drainable queue — SPEC + PLAN

**Status:** specified, not implemented. Local working document, never committed.
**Wider context:** `review-queue-redesign.md`.
**Depends on:** slice A (the bench components it arranges) and, for the extra item kinds,
slice F (#500). Implementable after A alone.

---

# SPECIFICATION

## 1. The finding

**The queue cannot be emptied by keeping your edits.** "Keep my edit (current)" is a
*disabled* button (`ReviewQueue.tsx:272`) — a dead end shaped like an action. The only way a
card leaves is accepting the source.

A curator who works through 300 conflicts and stands by every one of them sees the same 300
the next day, with nothing anywhere recording that they were considered. The comment at :270
states the reasoning honestly — refusing *is* the current state — and that is exactly the
problem: the system cannot tell "not yet looked at" from "looked at and kept".

## 2. Keeping your edit becomes a decision

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

`declined_value` holds the exact source value that was refused. The queue suppresses a
conflicted field when the proposal it is about to show equals it. **A different proposal does
not match, so the card comes back** — which is the property that keeps this from being a
permanent mute.

Both sides of that comparison must be named precisely, or the rule is untestable:

> The proposal is the `new` member of the matching entry in
> `experience_sync_changes.changed_fields` for the run the queue item names in `sync_log_id`.
> `changed_fields` is `jsonb`, so `declined_value` stores that member **verbatim**, and the
> comparison is **jsonb equality on the extracted member** — not text equality on a rendered
> form.

`"2003"` and `2003` are different proposals and must stay different. That is precisely the
string-versus-number trap the fixture dry run hit on `metadata.dateInscribed`.

Three rules on the row's lifetime:

- **Accepting the source deletes it** — the claim is released anyway.
- **Editing the field again deletes it.** Agreed judgement call: the curator most likely
  rewrote their text *because* of what the source proposed, so the next run should ask again
  rather than stay silent about a decision made against older text.
- It is written to `experience_curation_log` as `kept_mine`, so slice A's provenance trail
  shows it.

Storing the value rather than a hash is deliberate: the trail can then say *which* text was
declined, which is what slice A's provenance section needs.

## 3. Layout — queue left, bench right

One screen, no mode switch. Arrow keys move through the list; the bench on the right always
holds the full context for the selected item. `A` accepts, `K` keeps.

The list holds every question type — "gone from the source", "the source disagrees", and
(after slice F) "arrived, awaiting approval" and "changed, awaiting approval" — with a type
marker, and the bench renders the controls that type needs. Filters by category and by type.

## 4. One paging model

Today a single `offset` pages *both* lists at once (`ReviewQueue.tsx:34`), which is already
odd; slice F makes it four lists behind one offset, which is untenable. B replaces it with one
ordered stream: a `UNION ALL` over the kinds with a stable ordering, paged once.

Volume is bounded and small — the slice-5 round produced 139 blocking items — so an offset
over the union is adequate. **The `auto` backlog is not in this stream**: 1603 rows nobody has
checked are a backlog, not questions, and putting them here would drown the four kinds that
are (see slice F § 4.2).

## 5. Out of scope

- **Multi-select with checkboxes.** The keyboard flow gives the same speed without a selection
  model to maintain.
- Anything about *what* a card shows — that is slice A.

---

# PLAN

Branch `feat/drainable-review-queue`. Six commits.

## Task B1 — schema

**Files:** create `db/migrations/014-conflict-decisions.sql`; modify `db/init/01-schema.sql`.

- [ ] **B1.1** — the table above, plus the action CHECK on `experience_curation_log` extended
  with `'kept_mine'`. That constraint has now been edited by migrations 011 and (if F landed)
  013 — **re-read the live constraint before writing this**, or the rewrite drops whichever
  action the other migration added:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "\d experience_curation_log" \
  | grep -A3 "Check constraints"
```

- [ ] **B1.2** — index: the suppression check is per (experience, field) and the primary key
  already serves it. No further index; say so in the migration comment so nobody adds one.
- [ ] **B1.3** — mirror into `db/init/01-schema.sql`, editing the CHECK in place.
- [ ] **B1.4** — apply, confirm, commit. `Add a table for conflicts a curator decided to keep.`

## Task B2 — the decision endpoint

**Files:** modify `backend/src/controllers/experience/lifecycleController.ts`,
`backend/src/routes/experienceRoutes.ts`, `backend/src/types/index.ts`.

- [ ] **B2.1** — `POST /api/experiences/:id/keep-mine`, curator-scoped, body
  `{ fields: string[], expectedSyncLogId: number }`.
- [ ] **B2.2** — resolve the proposal **inside the transaction, under the row lock**, exactly
  as `applyProposedFields` (:449) does, and for the same reason spelled out in its comment at
  :439. Read that function before writing this one; the two are siblings and should look it.
- [ ] **B2.3** — refuse with 409 when `expectedSyncLogId` does not name the current proposal.
  A card drawn before a newer run must not record a decision about text nobody is proposing.
- [ ] **B2.4** — `INSERT … ON CONFLICT (experience_id, field) DO UPDATE` — a second decision
  about a *newer* proposal replaces the first. `decided_by` and `decided_at` move with it.
- [ ] **B2.5** — write `experience_curation_log` with `kept_mine` and the declined value in
  `details`.
- [ ] **B2.6** — deletion rule 1: `applyProposedFields` deletes the row for every field it
  accepts, in its own transaction.
- [ ] **B2.7** — deletion rule 2: `editExperience`
  (`controllers/experience/curationController.ts:~426`) deletes the row for every field it
  writes. Read that function's existing `curated_fields` handling and put the delete in the
  same transaction — an edit that succeeds while the delete fails would leave the curator
  silently unasked about their own new text.
- [ ] **B2.8** — tests: keeping suppresses the field; a *different* proposal for the same
  field reappears; an identical proposal stays suppressed; `"2003"` vs `2003` counts as
  different (this is the regression test for the jsonb-versus-text trap); accepting deletes;
  editing deletes; a stale run id gets 409.
- [ ] **B2.9** — commit. `back: Let a curator keep their edit as a decision, not a silence.`

## Task B3 — the queue suppresses decided fields

**Files:** modify `lifecycleController.ts` (`getReviewQueue`).

- [ ] **B3.1** — the `proposed` aggregate already filters per field
  (`lifecycleController.ts:129-134`). Add to that filter:

```sql
AND NOT EXISTS (
  SELECT 1 FROM experience_conflict_decisions d
  WHERE d.experience_id = e.id
    AND d.field = f->>'field'
    AND d.declined_value = (f->'new')          -- jsonb equality, not ::text
)
```

`f->'new'`, not `f->>'new'`: the second renders to text and would make `"2003"` and `2003`
equal, which is the whole thing this must not do.

- [ ] **B3.2** — the outer query already drops rows whose `proposed` came back NULL
  (`WHERE q.proposed IS NOT NULL`, :168), so an object whose every field is decided leaves the
  queue with no further work. Verify that rather than assuming it — `jsonb_agg` over an empty
  set returns NULL, which is what makes it work, and a later refactor to
  `COALESCE(jsonb_agg(...), '[]')` would silently keep every decided object in the queue
  forever. Add a test that pins it.
- [ ] **B3.3** — commit. `back: Drop decided conflicts from the queue until the source changes its mind.`

## Task B4 — one paged stream

**Files:** modify `lifecycleController.ts`, `frontend/src/api/experiences.ts`.

- [ ] **B4.1** — replace the separate queries with one `UNION ALL` producing a common column
  set (`kind` plus the fields slice A added), ordered by a fixed kind rank then `id` so paging
  is stable while items are answered.
- [ ] **B4.2** — filters: `categoryId` (exists) and `kind`.
- [ ] **B4.3** — return `total` per kind alongside the page, so the list can show "12 of 139"
  rather than "the first 25". The current `countLabel` hedge (`ReviewQueue.tsx:73`) exists only
  because no total is available; delete it once one is.
- [ ] **B4.4** — response shape changes; update `frontend/src/api/experiences.ts` and every
  caller. Grep `fetchReviewQueue` — the CuratorPanel may also read it.
- [ ] **B4.5** — tests: ordering is stable across two pages; answering an item on page 1 does
  not skip an item on page 2 (this is the bug offset paging causes and the reason the total
  matters).
- [ ] **B4.6** — commit. `back: Page the review queue as one ordered stream.`

## Task B5 — master–detail layout

**Files:** create `frontend/src/components/curation/ReviewList.tsx` and `ReviewBench.tsx`;
modify `ReviewQueue.tsx`.

- [ ] **B5.1** — `ReviewQueue.tsx` keeps the page, the layout, the selection state and the
  keyboard handling, and nothing else. `ReviewList` renders the stream with type markers and
  filters. `ReviewBench` renders the selected item using slice A's components.
- [ ] **B5.2** — keyboard: ↑/↓ move selection, `A` accepts, `K` keeps. Bind on the page, not
  on the document, and do not fire while focus is in a text field — the note input on
  `MissingCard` is a text field and `K` is a letter.
- [ ] **B5.3** — selection must survive a refetch. After answering, select the *next* item
  rather than resetting to the first, or a curator working a long list is thrown back to the
  top on every decision.
- [ ] **B5.4** — the trap from slice 4, one layer over: state that must reset when the
  underlying list changes has to be reset **during render**, not in an effect, and tracked in
  **state, not a ref** — a ref survives a discarded render while a queued reset does not. If
  selection is keyed on the item id, this does not arise; if it is keyed on an index, it does.
  Prefer the id.
- [ ] **B5.5** — mobile: the two-pane layout needs a single-pane fallback. Check what
  `docs/tech/shared-frontend-patterns.md` says about the existing responsive breakpoints
  before inventing one.
- [ ] **B5.6** — commit. `front: Lay the review screen out as a list and a bench.`

## Task B6 — docs

- [ ] **B6.1** — `docs/tech/experiences.md` § Review Queue: the decision table, the three
  lifetime rules, the paging model.
- [ ] **B6.2** — `docs/vision/vision.md`: a curator can now empty the queue by standing by
  their edits, and the queue remembers.
- [ ] **B6.3** — commit. `Document how a kept edit leaves the review queue.`

## Verification

The finding was "300 conflicts and the same 300 tomorrow". Reproduce it: keep every open
conflict, re-run the category, and confirm the queue is empty afterwards — then change one
value at the source (a fixture run is enough) and confirm exactly that one comes back.
