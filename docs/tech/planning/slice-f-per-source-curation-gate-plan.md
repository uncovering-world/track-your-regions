# Slice F — per-source curation gate — IMPLEMENTATION PLAN

**Read `slice-f-per-source-curation-gate.md` (the spec) first.** It carries the reasoning;
this document carries the steps. **Decision:** ADR-0022. **Issue:** #500, also closes #501.

**Revised 2026-08-05** together with the spec, after the first version was verified against the
code and the live database. Every line anchor below was checked on that date. Local working
document, never committed (`docs/tech/planning/` is gitignored).

---

## How to execute this

Branch `feat/per-source-curation-gate` off `main`. Thirteen tasks, in this order. Each ends with
a commit; the branch as a whole must be green before it leaves the machine, but an
intermediate commit may be red (`docs/tech/development-guide.md` § Granular Commits).

**Before task 1, check `git status`.** ADR-0022 is in the working tree uncommitted —
`docs/decisions/0022-per-source-curation-gate.md` (untracked) and `docs/decisions/README.md`
(modified, carrying the index rows for 0022 and a missing one for 0016). Carry both onto the
branch; a branch created without them silently leaves them behind. They are committed in
task 12, with the implementation they govern.

**Commit message format** (`development-guide.md` § Commit Messages):

```
back: Hold a gated source's content until a curator passes it.

<body, wrapped at 72, explaining what and why>

[Issue: #500]

Signed-off-by: ...
Co-Authored-By: ...
```

`<Type>` is `back`, `front`, `deploy`, or blank for docs. No Conventional-Commit prefixes.

**Gates, per commit:** `npm run check`, `TEST_REPORT_LOCAL=1 npm test`, `npm run test:py`,
`/security-check`. **Before pushing:** `npm run security:all` and `npm run test:e2e:smoke`.
Python gates need Docker on this machine — `scripts/require-py-tools.sh` prints the container
command when `python3.12` is absent.

**Check exit codes, not output.** `npm run … | tail -40` returns `tail`'s status and a red run
reads as green.

**Before opening the PR:** no commit may exist only to fix an earlier commit of the same
branch. Fold with `/pr-changes-amend`.

## Global constraints

- ADR-0004: Drizzle for relational work, raw `pool` for PostGIS. The sync path here is already
  raw `pool` — stay with it rather than converting.
- `backend/src/db/schema.ts` is a **partial** Drizzle model (`experienceCategories` at :136 has
  neither `display_priority` nor `new_badge_days`). Add a column only where a Drizzle query
  needs it. Do not "complete" the model as a side errand.
- File size: ~500 lines is the guideline, 800 means split now.
- `sonarjs/cognitive-complexity` is capped at 15.
- Constant format strings in `console.*` — a template literal lets a value forge a log line and
  Semgrep flags it. Use `%s` / `%d`.
- Never concatenate user input into SQL; `$1, $2, …` only.

---

## Task 1 — schema and migration

**Files:** create `db/migrations/013-curation-gate.sql`; modify `db/init/01-schema.sql`.

Migration 012 is the style reference: `\set ON_ERROR_STOP on`, `BEGIN; … COMMIT;`, a header
comment explaining *why*, and the apply command in the header.

- [ ] **Step 1.1** — write `db/migrations/013-curation-gate.sql`:

```sql
-- 013: per-source curation gate (issue #500, ADR-0022)
--
-- A source is trusted or it is not, and every experience records how it was
-- checked. `pending` is invisible; `auto` is published unread and marked;
-- `verified` means a curator passed the object that is live now.
--
-- There is deliberately NO backfill statement. Every existing row takes the
-- `auto` default: visible exactly as today, marked truthfully as unread.
-- Compare migration 009, which did write a value and thereby credited 1547
-- rows to a run that never saw them (caught in PR #493). A migration must
-- state the truth about rows that predate its feature.
--
-- The default is `auto` and not `pending` on purpose. The sync path sets
-- `pending` explicitly because it knows about the gate, so any other writer
-- keeps today's behaviour. The other default would make a writer that forgets
-- the column remove its rows from the product silently.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/013-curation-gate.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_categories
    ADD COLUMN IF NOT EXISTS requires_curation BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN experience_categories.requires_curation IS
    'True = this source proposes; a curator publishes. False = it publishes directly, marked as unread.';

ALTER TABLE experiences
    ADD COLUMN IF NOT EXISTS curation_state VARCHAR(16) NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pending_change_sync_log_id INTEGER
        REFERENCES experience_sync_logs(id) ON DELETE SET NULL;

COMMENT ON COLUMN experiences.curation_state IS
    'pending = never shown to anyone; auto = shown, nobody checked it; verified = a curator passed the object now live.';
COMMENT ON COLUMN experiences.published_at IS
    'When this row became visible. NULL while pending and for every row predating the gate. Anchors the New chip.';
COMMENT ON COLUMN experiences.pending_change_sync_log_id IS
    'The run whose proposal is held for a visible row. NULL when nothing is held.';

ALTER TABLE experiences
    DROP CONSTRAINT IF EXISTS experiences_curation_state_check;
ALTER TABLE experiences
    ADD CONSTRAINT experiences_curation_state_check
    CHECK (curation_state IN ('pending', 'auto', 'verified'));

-- Every list read filters on this, and the queue reads the two narrow states.
CREATE INDEX IF NOT EXISTS idx_experiences_curation_state
    ON experiences(curation_state) WHERE curation_state <> 'auto';
CREATE INDEX IF NOT EXISTS idx_experiences_pending_change
    ON experiences(pending_change_sync_log_id) WHERE pending_change_sync_log_id IS NOT NULL;

-- A run under a gate proposes without applying. That is neither 'updated' (it
-- changed nothing) nor 'conflict' (no curator claim refused it), and the
-- existing CHECK would reject it.
ALTER TABLE experience_sync_changes
    DROP CONSTRAINT IF EXISTS experience_sync_changes_change_type_check;
ALTER TABLE experience_sync_changes
    ADD CONSTRAINT experience_sync_changes_change_type_check
    CHECK (change_type IN ('created', 'updated', 'conflict', 'held',
                           'missing', 'returned', 'failed', 'filtered'));

ALTER TABLE experience_sync_logs
    ADD COLUMN IF NOT EXISTS total_held INTEGER DEFAULT 0;

-- Publishing is a curator action and belongs in the same trail as the rest.
ALTER TABLE experience_curation_log
    DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log
    ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited',
                      'added_to_region', 'removed_from_region',
                      'marked_former', 'marked_lost', 'state_restored',
                      'accepted_source', 'missing_dismissed', 'published'));

COMMIT;
```

Verified against the live database: the two existing CHECKs carry exactly the value lists
above minus the new member, and `experience_sync_logs`'s other counters are
`integer DEFAULT 0`, so `total_held` matches the house style.

- [ ] **Step 1.2** — mirror every one of those into `db/init/01-schema.sql`, the only init file,
  which must stand alone for a fresh database. Put the category column beside `new_badge_days`;
  put the `experiences` columns with the other `experiences` alterations; **edit the three
  existing CHECK constraints in place** rather than appending `ALTER … DROP/ADD` pairs — a
  fresh database should read as one definition.
- [ ] **Step 1.3** — apply and confirm nothing moved:

```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/013-curation-gate.sql
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c \
  "SELECT curation_state, count(*) FROM experiences GROUP BY 1;"
```

Expected: `auto | 1603`, nothing else.

- [ ] **Step 1.4** — commit. `Add the schema for a per-source curation gate.`

---

## Task 2 — the change set learns to hold

**Files:** modify `backend/src/services/sync/changeSet.ts`; test `changeSet.test.ts`.

`computeChangeSet` (`:216`) currently splits differences into `changedFields` (applied) and
`curatedConflicts` (refused by a claim). The gate adds a third reason a difference is not
applied, and the queue must tell them apart — slice A shows different text for each.

- [ ] **Step 2.1** — write the failing tests first:

```ts
describe('computeChangeSet under a gate', () => {
  it('holds every difference and applies none', () => {
    const result = computeChangeSet(before, incoming, [], { holdAll: true });
    expect(result.changedFields).toEqual([]);
    expect(result.heldFields.map(f => f.field)).toEqual(['name', 'description']);
    expect(result.heldFields.every(f => f.held)).toBe(true);
  });

  it('marks a field that is both claimed and held', () => {
    const result = computeChangeSet(before, incoming, ['name'], { holdAll: true });
    const name = [...result.heldFields, ...result.curatedConflicts].find(f => f.field === 'name');
    expect(name).toMatchObject({ held: true, curatedConflict: true });
  });

  it('reports a held-only row as updated, not unchanged', () => {
    // 'unchanged' means the source proposed nothing. Under a gate it proposed
    // plenty and the run declined to apply it; calling that unchanged would
    // drop the row out of `worthRecording` and lose the proposal entirely.
    expect(computeChangeSet(before, incoming, [], { holdAll: true }).changeType).toBe('updated');
  });

  it('is unchanged when a gated run finds nothing to propose', () => {
    expect(computeChangeSet(before, before, [], { holdAll: true }).changeType).toBe('unchanged');
  });
});
```

- [ ] **Step 2.2** — run them, confirm they fail for the right reason (`holdAll` unknown).
- [ ] **Step 2.3** — implement. `FieldChange` (`:30`) gains `held: boolean`; `ChangeSetResult`
  (`:38`) gains `heldFields: FieldChange[]`; the signature gains a fourth parameter
  `options: { holdAll?: boolean } = {}`. Keep `curatedConflict` meaning exactly what it means
  now — a claim refused this field — so the existing queue predicate keeps working unchanged.
  `changeType` is `'updated'` when `changedFields.length > 0 || heldFields.length > 0`.
  Significance already weighs conflicts as well as applied changes (comment at `:237`); weigh
  held fields the same way, and extend that comment rather than leaving it describing two
  buckets out of three.
- [ ] **Step 2.4** — run the full `changeSet` suite; the existing cases must be untouched.
- [ ] **Step 2.5** — commit. `back: Let the change set say a field was held, not refused.`

---

## Task 3 — probes for the two parts the change set does not diff

**Files:** modify `backend/src/services/sync/locationWriter.ts`; new
`backend/src/services/sync/treasureSet.ts` (or beside the museum sync's writer); tests.

The change set diffs eleven columns. It has never diffed the location set or the treasure set,
and the gate needs to know whether either differs *without writing*.

- [ ] **Step 3.1** — extract the probe already inside `writeExperienceLocations`
  (`locationWriter.ts:142-160`) as `probeExperienceLocations(experienceId, offered)`, returning
  `{ differs, stored, matched, offered }`. It is one round trip and already exists; the point
  is that the writer and the gate ask the same question in the same way. Have
  `writeExperienceLocations` call the probe rather than keeping a second copy of the query.
- [ ] **Step 3.2** — the same shape for treasures: given an experience and the offered
  artworks, answer `{ differs, added, unchanged }` by comparing offered `external_id`s against
  `experience_treasures` for that experience. Read-only.

  Note while you are here, but **do not fix it in this slice**:
  `upsertMuseumTreasures` (`museumSyncService.ts:391`) links with `ON CONFLICT DO NOTHING` and
  never unlinks, so a treasure the source stopped offering stays attached. That is a separate
  defect; the probe therefore reports `added` and `unchanged`, and there is no `removed`.
- [ ] **Step 3.3** — the anchor distance for the card's summary is already computed:
  `collectDifferences` produces a `location` diff with old and new coordinates whenever the
  points are more than `LOCATION_UNCHANGED_METERS` apart. Read it from the change set rather
  than recomputing.
- [ ] **Step 3.4** — tests against the live database, not mocks. A mocked query cannot tell a
  correct spatial predicate from a wrong one; that is what caught the destroyed region
  assignments in slice C. Cover: an unchanged set probes `differs: false`; adding one point
  probes true; a 758-point object probes in one query.
- [ ] **Step 3.5** — commit. `back: Ask whether an object's points or treasures changed without writing them.`

---

## Task 4 — the upsert holds a visible row's content

**Files:** modify `backend/src/services/sync/syncUtils.ts` (`upsertExperienceRecord` at `:137`,
`previewUpsert` at `:94`), `backend/src/services/sync/types.ts`,
`backend/src/services/sync/syncOrchestrator.ts`, and all three sync services.

- [ ] **Step 4.1** — `requiresCuration` is read **once per run** and threaded to the upsert.
  `orchestrateSync` reads the category's column at the top and puts it on `SyncRunContext`
  (`types.ts`); each service passes it through. All three call sites change:
  `unescoSyncService.ts:370`, `museumSyncService.ts:373`, `landmarkSyncService.ts:202` — they
  currently pass `{ dryRun, syncLogId }`. Defaulting to `false` when absent is deliberate: a
  service that forgets fails toward today's behaviour, matching the column default.
- [ ] **Step 4.2** — the `before` CTE already selects what is needed except the state. Add
  `curation_state` to its select list and to the `RETURNING` list.

  Note the coupling, because it is not obvious: reading the state from `RETURNING` gives the
  *post*-update value, and that equals the pre-update value only because `curation_state` is
  never assigned in the `DO UPDATE SET` list. Keep it that way; step 4.6 is what makes it true.
- [ ] **Step 4.3** — the hold condition is per row and must be computed **in SQL**, because it
  depends on the stored state the same statement is about to overwrite:

```sql
-- $16 is requiresCuration. A row nobody has seen has nothing to protect, so a
-- gated source refreshes a `pending` row in place and the curator reviews the
-- newest content rather than whatever arrived first.
$16::boolean AND experiences.curation_state <> 'pending'
```

Verified experimentally in Postgres: inside `ON CONFLICT DO UPDATE`, `experiences.<col>` reads
the pre-update value even when the same statement assigns that column.

Wrap each guard, for **all eleven content columns**:

```sql
name = CASE WHEN ($16::boolean AND experiences.curation_state <> 'pending')
              OR experiences.curated_fields ? 'name'
            THEN experiences.name ELSE EXCLUDED.name END,
```

…and the same for `name_local`, `description`, `short_description`, `category`, `tags`,
`location`, `country_codes`, `country_names`, `image_url`, `metadata`. The sync writes neither
`boundary` nor `area_km2`, so that list is complete.

**Do not touch** `last_seen_sync_log_id`, `last_seen_at`, `missing_since`, `source_membership`,
`updated_at` (`syncUtils.ts:171-182`). Provenance is not content: a gated run must still record
that the source listed the object, or missing detection starts flagging everything the gate
holds (spec § 3.4).

- [ ] **Step 4.4** — one more assignment in the same `DO UPDATE SET`:

```sql
        pending_change_sync_log_id = CASE
          WHEN ($16::boolean AND experiences.curation_state <> 'pending')
          THEN COALESCE(EXCLUDED.last_seen_sync_log_id, experiences.pending_change_sync_log_id)
          ELSE experiences.pending_change_sync_log_id END,
```

- [ ] **Step 4.5** — the INSERT arm gains two columns in its column list and VALUES:

```sql
        curation_state = CASE WHEN $16::boolean THEN 'pending' ELSE 'auto' END,
        published_at   = CASE WHEN $16::boolean THEN NULL ELSE NOW() END,
```

- [ ] **Step 4.6** — `verified` decays only on a *change*, and the statement cannot tell — the
  `CASE` guards fire whether or not a value differs. Resolve it in TypeScript, after the write,
  against the change set the function already computes and the two probes from task 3:

```ts
// Only a real change decays the mark. `updated_at` moves on every pass and the
// CASE guards fire whether or not a value differs, so the statement cannot
// answer this; the change set and the probes can, and both are already computed.
if (!requiresCuration && (changeSet.changedFields.length > 0 || pointsChanged || treasuresChanged)) {
  await pool.query(
    `UPDATE experiences SET curation_state = 'auto'
     WHERE id = $1 AND curation_state = 'verified'`,
    [row.id],
  );
}
```

`pointsChanged` and `treasuresChanged` are wired up in task 5 — the upsert does not know about
either yet. Ship this task with the content term alone and add the other two there, rather than
inventing a parameter task 5 will replace. Note it in the commit body so the gap is deliberate
rather than forgotten.

- [ ] **Step 4.7** — `previewUpsert` (the dry-run path) must reflect the gate or a preview lies
  about what the run would do. It already reads the stored row; add `curation_state`, compute
  the same hold condition, pass `{ holdAll }` to `computeChangeSet`, and make `nameSnapshot`
  return the stored name when content is held — the comment at `:120` explains why the snapshot
  emulates the guard, and this is the same reason one layer out.
- [ ] **Step 4.8** — tests, against the live database:

  1. gated update to a visible row: content unchanged, `last_seen_at` moved,
     `pending_change_sync_log_id` = this run;
  2. gated arrival: row exists, `curation_state = 'pending'`, `published_at IS NULL`, content
     present;
  3. second gated run over a `pending` row: content updated in place, state still `pending`;
  4. trusted update to a `verified` row: content applied, state now `auto`;
  5. trusted pass with no differences over a `verified` row: state still `verified`;
  6. gated run where the source proposes nothing: `pending_change_sync_log_id` untouched.

- [ ] **Step 4.9** — commit. `back: Hold a gated source's content until a curator passes it.`

---

## Task 5 — the run holds points and treasures too

**Files:** modify `backend/src/services/sync/unescoSyncService.ts` (`:374`, `:402`),
`museumSyncService.ts` (`:375`, `:592`), `landmarkSyncService.ts` (`:204`).

This is the half the first version of the spec missed, and it is what makes the gate mean
anything for the source it was designed for.

- [ ] **Step 5.1** — each service's post-upsert block becomes: probe; if held, skip the write
  and hand the offered set back for the changeset; otherwise write as today and register
  `onLocationsChanged`.

  Held means `requiresCuration && storedState !== 'pending'` — the **same** condition as the
  content half, and it must be read from the upsert's result rather than recomputed, or the two
  halves can disagree about one row.

- [ ] **Step 5.2** — a `pending` row writes its points and treasures as normal. This is
  load-bearing, not an oversight: placement runs over what moved, so an arrival lands in its
  regions and a region curator can see it at all. Say so in a comment at each site.
- [ ] **Step 5.3** — the museum service's treasure call (`:592`) gets the same treatment. It is
  already guarded by `if (!context.dryRun)`; the gate is a second reason to skip.
- [ ] **Step 5.4** — the proposal goes into the changeset as two extra entries in
  `changed_fields`, shaped like the existing ones so slice A inherits the format:

```
{ field: 'locations', new: [...offered], summary: { stored, offered, matched, anchorMovedMeters } }
{ field: 'treasures', new: [...offered], summary: { added, unchanged } }
```

Worst case measured: 77 kB for the 758-point object, and only for a gated UNESCO run.

- [ ] **Step 5.5** — tests on the live database: a gated museum that gained artworks has **no**
  new `experience_treasures` rows and a changeset entry saying `added: N`; a gated multi-point
  object keeps its `experience_locations` rows untouched; a gated arrival gets both written.
- [ ] **Step 5.6** — commit. `back: Hold a gated source's points and treasures with its content.`

---

## Task 6 — the run reports what it held

**Files:** modify `changeRecorder.ts`, `syncOrchestrator.ts`, `types.ts`, `missingDetection.ts`,
`syncUtils.ts` (`updateSyncLog`), `frontend/src/components/admin/SyncChangeList.tsx`,
`SyncHistoryPanel.tsx`.

- [ ] **Step 6.1** — `ChangeRecord['changeType']` gains `'held'`. Extend the doc comment at
  `changeRecorder.ts:18` — it currently explains `conflict` alone, and a reader needs to know
  which of the two a row means.
- [ ] **Step 6.2** — `resolveChangeType` (`syncOrchestrator.ts:143`). A held row's outcome is
  now `'updated'`, because `processItem` returns `outcome: changeSet.changeType` — so it would
  be filed as `updated`, which says the run changed the object and it did not:

```ts
if (result.returnedFromMissing && result.outcome !== 'created') return 'returned';
if (result.changeSet.heldFields.length > 0 || result.heldParts) return 'held';
if (result.outcome === 'unchanged') return 'conflict';
return result.outcome;
```

`held` outranks `conflict` when both are present: the object is waiting on a curator, and that
is the more urgent of the two facts. The per-field flags keep the detail.

- [ ] **Step 6.3** — `recordItemOutcome` (`:156`): the fields written to the changeset become
  `[...changedFields, ...curatedConflicts, ...heldFields]` plus the two proposal entries from
  task 5, and `worthRecording` (`:175-177`) gains the held case. Without it a gated run that
  proposes changes to an otherwise-unchanged row records nothing and the proposal is lost.
- [ ] **Step 6.4** — counters. `SyncProgress` gains `held: number`, initialised at
  `syncOrchestrator.ts:115` beside `curatedConflicts`, and carried through `updateSyncLog`'s
  stats into `total_held`. **Both call sites**: the success path at `:506` and the failure path
  at `:374`.

  A held row counts in `held` **and nowhere else** — add the branch to `:166-168` rather than
  letting it fall through to `updated`, which is where it would land today.

  And `computeFinalStatus` (`:308`) computes `seen = created + updated + unchanged`. Add `held`,
  or a gated run whose items were all held reports `failed` the moment one item errors.
- [ ] **Step 6.5** — missing detection skips `pending` rows in **three** places, all in
  `missingDetection.ts` and all sharing the same predicate block: `countActiveExperiences`
  (`:72`), `countSeenAmongActive` (`:96`) and `flagMissingExperiences` (`:127`). Add
  `AND curation_state <> 'pending'` to each. Both sides of the ratio and the flag predicate —
  skipping in one and not the other was a real bug in #487, and the comment at `:89` is the one
  that says why the two counts must be drawn from the same set. Extend it.

  Both counts are taken before the item loop (`:440` and `:459`), so no row this run creates is
  in either, which is what keeps the predicate consistent.
- [ ] **Step 6.6** — the run card. `SyncChangeList.tsx` and `SyncHistoryPanel.tsx` render change
  types; add `held` with its own label ("held for review") and the `total_held` figure beside
  the others. Check `SyncChangeList.test.tsx` for the shape the existing types are asserted in.
- [ ] **Step 6.7** — tests: a gated run's log row carries `total_held`; the changeset row is
  `held`; `countActiveExperiences` excludes a `pending` row (live DB); a category that is
  entirely `pending` produces no coverage-failure skip reason.
- [ ] **Step 6.8** — commit. `back: Report what a run held rather than filing it as changed.`

---

## Task 7 — nothing pending reaches a reader

**Files:** modify `experienceLifecycle.ts`, `experienceQueryController.ts`,
`experienceRegionQuery.ts`, `experienceLocationController.ts`, `experienceTreasureController.ts`.

- [ ] **Step 7.1** — add the sibling to `hideLostSql` (`experienceLifecycle.ts:30`), in the same
  file and the same shape:

```ts
/**
 * Hides rows nobody has published yet. `alias` is the `experiences` alias.
 *
 * A separate fragment from `hideLostSql` rather than one combined predicate:
 * they answer different questions and one read wants exactly one of them. A
 * visit hides neither — see the note there — and `?includeLost=true` must not
 * reveal a `pending` row, which a merged predicate would make easy to get
 * wrong.
 */
export function hideUnpublishedSql(alias = 'e'): string {
  return `${alias}.curation_state <> 'pending'`;
}
```

Extend the file's header comment: it describes two lifecycle axes and now has a third,
unrelated reason to hide a row. Say plainly that curation state is not a lifecycle axis — it is
about whether anyone has looked, not about what the object is.

- [ ] **Step 7.2** — apply at the six `hideLostSql` sites. Verified 2026-08-05; the spec's
  earlier "eight" was wrong:

| file | line | site |
|---|---|---|
| `experienceQueryController.ts` | 25 | list conditions (feeds both the list and its count) |
| `experienceQueryController.ts` | 316 | search |
| `experienceQueryController.ts` | 370 | region counts |
| `experienceRegionQuery.ts` | 44 | region list filter |
| `experienceRegionQuery.ts` | 48 | region count predicate |
| `experienceLocationController.ts` | 31 | locations batch |

The `pending` filter is **unconditional** — there is no `?includePending`, and `includeLost`
must not reveal it.

- [ ] **Step 7.3** — the four reads that carry **no** lifecycle filter at all, and so never
  appeared in a `hideLostSql` grep. Each answers **404 for `pending`** unless the caller is a
  curator or admin, so following a queue item to the object's page works:

| file | line | route |
|---|---|---|
| `experienceQueryController.ts` | 132 | `GET /api/experiences/:id` |
| `experienceLocationController.ts` | 182 | `GET /api/experiences/:id/locations` |
| `experienceTreasureController.ts` | 15 | `GET /api/experiences/:id/treasures` |
| `experienceQueryController.ts` | 278 | the category total in `listCategories` |

`getExperience` already takes `optionalAuth` and knows `isAdmin`; extend that to the curator
role rather than inventing a second check. The category total is a defect in its own right
(#503 — it ignores `lost` too); this slice adds `pending` and leaves `lost` to that issue.

- [ ] **Step 7.4** — `experienceVisitController.ts` (`:42`) uses `lifecycleSelectSql` and no
  filter. Leave it, and say so in a comment: a visit already made outlives any later question
  about the object, exactly as it outlives `lost`.
- [ ] **Step 7.5** — `lifecycleSelectSql()` (`:43`) gains `${alias}.curation_state` so a card
  can render the mark (task 11). One place, and every consumer already spreads the row.
- [ ] **Step 7.6** — the trap from slice 3b, checked explicitly: `searchExperiences` needs
  **brackets** around its two name alternatives (`:315`). Unbracketed, `OR` binds looser than
  the surrounding `AND` and every filtered row returns through the trigram branch. Read both
  search sites and confirm the parenthesisation before and after the change.
- [ ] **Step 7.7** — `lostHidden` in `experienceRegionQuery.ts:114` counts `existence = 'lost'`
  without the new predicate, so a row that is both `lost` and `pending` would offer a
  "show them" affordance that reveals nothing. Add it.
- [ ] **Step 7.8** — tests: an anonymous read of a region containing one `pending` row returns
  neither the row nor a count including it; a search for its exact name returns nothing; the
  locations batch omits it; `GET /:id` is 404 anonymously and 200 for a curator; a visit record
  still renders.
- [ ] **Step 7.9** — commit. `back: Keep unpublished experiences out of every reader's view.`

**Not closable here:** Martin publishes `experiences` and `experience_locations` as unfiltered
tile sources (#504). Do not let the PR body claim otherwise.

---

## Task 8 — the New chip anchors on becoming visible

**Files:** modify `backend/src/controllers/experience/experienceNewBadge.ts`.

- [ ] **Step 8.1** — replace the body of `isNewSql()` (`:69`):

```ts
export function isNewSql(alias = 'e', userIdParam: NewBadgeReaderParam = 'NULL'): string {
  return `(
    ${alias}.published_at IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM experience_categories c
        WHERE c.id = ${alias}.category_id
          AND ${alias}.published_at > NOW() - (c.new_badge_days || ' days')::interval
      )
      OR EXISTS (
        SELECT 1 FROM user_new_badge_views v
        WHERE v.user_id = ${userIdParam}
          AND v.experience_id = ${alias}.id
          AND v.first_shown_at > NOW() - INTERVAL '${NEW_BADGE_PERSONAL_DAYS} days'
      )
    )
  )`;
}
```

- [ ] **Step 8.2** — **rewrite the file's header comment** (`:1-40`). Every trap it describes is
  now about a mechanism the file no longer has, and a comment restating the belief behind a
  removed mechanism is worse than a stale one. Keep what still holds — why not `created_at`
  (bulk loads share an instant); why the personal window is a maximum and not a choice — and
  write the new anchor plainly, with the two removals, their reasons, and their consequences:
  - the `change_type = 'created'` proof is gone because `published_at` is never backfilled;
  - the latest-completed-run bound is gone because the category window already bounds the chip,
    and under piecemeal approval "the newest batch" is not a unit;
  - **so** chips no longer clear when a category next runs — a weekly source shows roughly four
    batches at once — and a force run chips its whole category for the full window.
- [ ] **Step 8.3** — leave the index `idx_experience_sync_logs_latest` in place. Do not drop an
  index as a side effect of a feature; if it is truly unused, that is its own change with its
  own measurement.
- [ ] **Step 8.4** — tests: a row published today is new; one published 40 days ago is not; one
  with `published_at IS NULL` is never new whatever its changeset says; the personal window
  still extends past the category window.
- [ ] **Step 8.5** — record the one-time effect in the commit body: the **54** rows currently
  wearing the chip lose it, because `published_at` is NULL for everything predating the
  migration. (Measured 2026-08-05; the spec's earlier 55 was stale.)
- [ ] **Step 8.6** — commit. `back: Anchor the New chip on becoming visible, not on a run.`

---

## Task 9 — the queue's new kinds, and publishing

**Files:** modify `lifecycleController.ts`, `backend/src/routes/experienceRoutes.ts`,
`backend/src/types/index.ts`, `frontend/src/components/curation/ReviewQueue.tsx`,
`frontend/src/api/experiences.ts`.

Note the path: `ReviewQueue.tsx` is in `components/curation/`, not `components/`.

- [ ] **Step 9.1** — `getReviewQueue` (`:68`) gains two queries beside `missing` and `conflict`,
  both carrying `scopeFilter` (`:77-83`) and `categoryFilter` exactly as the existing two do:

```sql
-- arrivals: the whole object is the proposal
SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
       e.missing_since, e.source_membership, e.existence,
       'arrival' AS kind, e.first_seen_sync_log_id AS sync_log_id,
       NULL::jsonb AS proposed
FROM experiences e
JOIN experience_categories c ON c.id = e.category_id
WHERE e.curation_state = 'pending'
  ${categoryFilter} AND ${scopeFilter}
ORDER BY e.id
```

An arrival has `experience_regions` rows only once placement has run, and the region half of
`scopeFilter` cannot match it before then — so a region curator sees arrivals only after
placement. That is correct and measured (`review-queue-redesign.md` § "Who can act, and when");
placement runs at the end of every sync (slice C), so the window is short. Say this in a
comment; it will otherwise be read as a bug.

```sql
-- held: the proposal is in the named run's changeset
SELECT e.id, …, 'held' AS kind, e.pending_change_sync_log_id AS sync_log_id,
       (SELECT jsonb_agg(f || jsonb_build_object('acceptable', $N::jsonb ? (f->>'field')))
        FROM experience_sync_changes ch
        JOIN LATERAL jsonb_array_elements(ch.changed_fields) f ON TRUE
        WHERE ch.experience_id = e.id
          AND ch.sync_log_id = e.pending_change_sync_log_id
          AND ((f->>'held')::boolean OR f->>'field' IN ('locations', 'treasures'))) AS proposed
FROM experiences e …
WHERE e.pending_change_sync_log_id IS NOT NULL
```

`held` needs no withdrawal check: the column is cleared when the proposal is answered and
overwritten when a newer run proposes again, so it names the current proposal by construction.
The `conflict` kind needs one because nothing clears a changeset row — keep that predicate as
it is (`:159-163`).

It **does** need the `WHERE q.proposed IS NOT NULL` guard the `conflict` kind has (`:168`).
`jsonb_agg` over an empty set returns NULL — verified — and an empty card is worse than none.

- [ ] **Step 9.2** — the response gains `arrivals` and `held` arrays. Note for the reviewer and
  for slice B: the existing single `offset` already pages both lists at once, and this makes it
  four. Do not fix that here — slice B replaces the paging model wholesale.
- [ ] **Step 9.3** — `publishExperience`, modelled on `applyProposedFields` (`:449`) and sharing
  its discipline: **everything the decision rests on is read inside the transaction that
  writes, under the row lock.** Read `applyProposedFields` in full first; the comment at `:439`
  explains the exposure and it applies unchanged here.

```
BEGIN
  SELECT curation_state, curated_fields, pending_change_sync_log_id
    FROM experiences WHERE id = $1 FOR UPDATE
  refuse 409 if pending_change_sync_log_id (or, for an arrival, first_seen_sync_log_id)
    <> expectedSyncLogId
  if a proposal is held:
    read the held fields, the offered locations and the offered treasures
      from that run's changeset
    skip content fields the curator claims in curated_fields — publishing answers
      "may readers see this", the claim answers "whose text is it"
    UPDATE all eleven content columns
    writeExperienceLocations(id, offeredLocations)
    write the offered treasures
  UPDATE experiences
     SET curation_state = 'verified',
         published_at = COALESCE(published_at, NOW()),
         pending_change_sync_log_id = NULL,
         updated_at = NOW()
   WHERE id = $1
  INSERT INTO experience_curation_log (…, action) VALUES (…, 'published')
COMMIT
then place the object
```

**All eleven columns, not five.** `ACCEPTABLE_FIELDS` (`:33`) is `{name, shortDescription,
description, category, imageUrl}`, and `accept-source`'s answer for the other six is to release
the claim and let the next ordinary run apply the value. The gate closes that escape — the next
run holds them too — so a five-field writer would leave six fields proposed for ever and
applied never. `location` needs `ST_SetSRID(ST_MakePoint($n, $n), 4326)`; `tags`, `name_local`
and `metadata` are jsonb; the country arrays are `text[]`.

`COALESCE` on `published_at`: a second pass over an already-visible object must not restart its
New-chip window. There is a test for this.

**Placement happens after the commit**, not inside it: publishing can move an object between
regions, and placement otherwise runs only at the end of a sync. Use `placeMovedExperiences`
(`placement.ts:31`) for the single id. It reports rather than throws, so a placement failure
must not undo a publication that already committed — surface it, do not roll back.

Use `rollbackQuietly` and the `client.release(unusable)` pattern from `applyProposedFields` — a
client whose ROLLBACK also failed must be destroyed, not pooled.

- [ ] **Step 9.4** — route, beside the two existing curator writes (`experienceRoutes.ts:121-122`):

```ts
router.post('/:id/publish', validate(idParamSchema, 'params'), requireAuth, requireCurator,
  validate(publishBodySchema), publishExperience);
```

`publishBodySchema` in `backend/src/types/index.ts` beside `acceptSourceBodySchema` (`:376`):
`{ expectedSyncLogId: z.number().int().positive() }`.

- [ ] **Step 9.5** — scope check. Reuse `resolveExperienceScope` exactly as `acceptSourceValue`
  does (`:402`) — do not re-derive the check.
- [ ] **Step 9.6** — minimal frontend: `ReviewQueue.tsx` renders the two new kinds as cards with
  a Publish button and the **summary** from spec § 4.2 — fields changed, `points 420 → 423,
  anchor moved 4.2 km`, `treasures +12`. Not a per-point diff: nobody approves 758 coordinates
  one at a time. Deliberately minimal — the bench is slice A. The file is 302 lines; keep it
  under 400 or split the card out now rather than growing past the guideline.
- [ ] **Step 9.7** — tests: publishing an arrival makes it visible and sets `published_at`;
  publishing twice does not move `published_at`; a stale `expectedSyncLogId` gets a 409; a
  claimed field is not overwritten; a held `metadata` change **is** applied; held locations and
  treasures land; a curator outside scope gets 403; the curation log carries a `published` row.
- [ ] **Step 9.8** — commit (two, if the frontend is more than a screenful):
  `back: Let a curator publish what a gated run proposed.` and
  `front: Show arrivals and held changes in the review queue.`

---

## Task 10 — a curator can fix a coordinate

**Files:** modify `backend/src/controllers/experience/curationController.ts` (`editExperience`
at `:430`), `backend/src/types/index.ts`, the curation dialog in
`frontend/src/components/shared/`.

Holding a coordinate for review while offering no way to correct it leaves "take the wrong
point" and "keep the wrong point" — the dead end this whole redesign started from.

- [ ] **Step 10.1** — `editExperience` accepts `longitude`/`latitude`, validated with Zod, and
  claims `location` in `curated_fields` like any other edit. The read at `:442-444` does not
  select `location`; add it so the before/after in the curation log is truthful.
- [ ] **Step 10.2** — **write both the anchor and the point.** The list, search and `GET /:id`
  read `experiences.location`; the map draws `experience_locations`. Writing only the first
  fixes the list and leaves the pin — which is exactly the defect measured in #502, where the
  two already disagree by over a kilometre for 106 objects.
- [ ] **Step 10.3** — **single-location objects only** — 1119 of 1603: 788 UNESCO sites, all
  128 museums, all 203 public-art objects. A dispersed nomination has no one point to edit; its
  coordinates arrive with #505, where each location carries its own arrival point. Refuse with a
  clear message rather than silently ignoring, and say so in the dialog.
- [ ] **Step 10.4** — register the object for placement afterwards: moving a point can move it
  between regions.
- [ ] **Step 10.5** — tests: editing a coordinate moves both the anchor and the location row and
  claims `location`; the next sync does not overwrite it; a multi-location object is refused
  with a message naming #505; the region assignment follows.
- [ ] **Step 10.6** — commit. `back: Let a curator correct an experience's coordinate.` and
  `front: Offer coordinates in the curation dialog.`

---

## Task 11 — the admin's switch, and what waits behind it

**Files:** modify `backend/src/controllers/admin/syncController.ts`,
`backend/src/routes/adminRoutes.ts`, `backend/src/db/schema.ts`,
`frontend/src/components/admin/SyncPanel.tsx`, `frontend/src/api/admin/`.

- [ ] **Step 11.1** — the toggle goes **beside the existing category writes**, in
  `adminRoutes.ts` next to `PUT /sync/categories/reorder` (`:150`) and
  `reorderCategories` (`syncController.ts:511`) — not on the public experiences router.
  `requireAuth` + `requireAdmin` (`middleware/auth.ts:65`), body `{ requiresCuration: boolean }`,
  validated with Zod. Drizzle for the write (ADR-0004: relational, no PostGIS); add
  `requiresCuration` to `experienceCategories` in `schema.ts:136`.
- [ ] **Step 11.2** — the switch on each source card in `SyncPanel.tsx` (`orderedSources.map` at
  `:106`, the card at `:241`). Label it in the product's terms: **"Hold new and changed content
  for review"**, with the consequence underneath — "New objects stay invisible and changes wait
  until a curator publishes them." A second line where the state is `false`: "Objects appear
  immediately, marked as unchecked."
- [ ] **Step 11.3** — say in the UI that switching **on** is not retroactive: rows this source
  already published stay visible. Without that line an admin will expect 1272 objects to
  disappear and be alarmed when they do not, or expect them to and be alarmed when they do.
- [ ] **Step 11.4** — switching **off** publishes nothing either. Show the waiting count per
  source and offer **"publish all waiting"** as its own explicit action, reusing the publish
  path so each object gets its `published_at`, its `verified` state and its own `published`
  curation-log row. One click that published forty unreviewed objects silently is the thing the
  gate exists to prevent; one click that does it *deliberately, with the number in front of
  you* is an admin decision.
- [ ] **Step 11.5** — tests: a non-admin gets 403; the toggle round-trips; flipping it either
  way changes no `experiences` row (assert the `pending` count before and after — invariant 7);
  "publish all waiting" publishes exactly the waiting set and writes one log row each.
- [ ] **Step 11.6** — commit. `back: Let an admin choose whether a source needs curation.` and
  `front: Add the per-source curation switch to the sync panel.`

---

## Task 12 — the mark a reader sees

**Files:** modify `frontend/src/components/shared/LifecycleChip.tsx` (or add a sibling),
`frontend/src/components/ExperienceList/ExperienceListItem.tsx` (`:242` renders
`<LifecycleChip>`), the object card, `frontend/src/types/index.ts`.

- [ ] **Step 12.1** — read `docs/tech/shared-frontend-patterns.md` and
  `frontend/src/components/shared/` before writing anything. `LifecycleChip` is the closest
  precedent and may be the right component to extend rather than duplicate. Reuse before
  creating is a project rule, not a preference.
- [ ] **Step 12.2** — lists mark **only `verified`**: a small check. Marking `auto` would mark
  1600 of 1603 rows, which is noise rather than information. Put that number in the code
  comment — a later reader will otherwise "fix" the asymmetry.
- [ ] **Step 12.3** — the object's card states it either way, in words. "Checked by a curator" /
  "Imported automatically, not yet checked."
- [ ] **Step 12.4** — the type gains `curationState?: 'pending' | 'auto' | 'verified'`. It
  arrives through `lifecycleSelectSql` (task 7.5).
- [ ] **Step 12.5** — tests: a `verified` row renders the check, an `auto` row renders nothing in
  a list and the words on a card.
- [ ] **Step 12.6** — commit. `front: Show whether a person checked an experience.`

---

## Task 13 — the hand-created experience, and documentation

- [ ] **Step 13.1** — `insertManualExperience` (`curationController.ts:662`) sets
  `curation_state = 'verified'` explicitly. A person wrote it; `auto` would have its card say
  "imported automatically, not yet checked" about something typed in by hand. The e2e fixture
  (`db/seed/e2eFixture.ts:111`) keeps the `auto` default, which is what its assertions expect.
- [ ] **Step 13.2** — `docs/tech/experiences.md`: a section for the gate — the setting, the
  three states, the run matrix from the spec's § 3.3, the three parts an object has, and the
  one-line rule about the two guards. This is the committed artefact; it describes what exists.
- [ ] **Step 13.3** — `docs/vision/vision.md`: readers see a mark and unchecked arrivals no
  longer appear unannounced; curators gain two queue kinds, a Publish action and the ability to
  correct a coordinate; admins gain a per-source setting and a way to release what is waiting.
- [ ] **Step 13.4** — `docs/security/SECURITY.md`: one new admin-only write
  (`PATCH …/sync/categories/:id`), two new curator writes (`POST …/:id/publish` and coordinates
  on `PATCH …/:id/edit`), all server-side authorised; and `pending` objects answering 404 to
  anonymous reads. Check whether a line in `docs/security/asvs-checklist.yaml` moves.
- [ ] **Step 13.5** — **ADR-0022 must be rewritten before it is committed.** Its current text
  puts treasures out of scope, and the reasoning behind that — "giving them the column without
  giving the queue a treasure item would hide them permanently" — no longer applies, because a
  treasure now rides its experience's proposal and needs no state of its own. Immutability
  starts when a decision lands in history; this one never has. Update the decision, the
  consequences and the reference to #501, keep the date, and commit it here with
  `docs/decisions/README.md`.
- [ ] **Step 13.6** — commit. `Document the per-source curation gate.`

---

## Manual verification on the live database

Spec § 10 carries the list. Run it before opening the PR, through the admin UI where possible.

## PR

`/pr-create`. Body: the problem in the spec's § 1 numbers, the model, the migration's honesty,
the one-time chip effect on 54 rows, and the fact that this **closes #501**. Say plainly what
it does *not* close: Martin's unfiltered tile sources (#504), the anchor/map divergence (#502),
the category total's `lost` half (#503), and the arrival point (#505). A reviewer who finds any
of those unaided will reasonably assume it was missed.
