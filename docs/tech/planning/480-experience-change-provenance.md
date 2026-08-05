# Plan — #480: experience change provenance, lifecycle, and the "New" chip

Local working document. Not committed (`docs/tech/planning/` is gitignored).

## 1. Measured baseline

Read from the live database on 2026-08-02, matching the table in issue #480:

| Category | Rows | Curator-edited | Last run | Status | fetched / created / updated / errors |
|---|---|---|---|---|---|
| UNESCO World Heritage Sites (1) | 1247 | 0 | 2026-07-26 | `partial` | 1248 / 1247 / 0 / **1** |
| Top Museums (2) | 100 | 0 | 2026-07-26 | `partial` | 1906 / 32 / 68 / **8** |
| Public Art & Monuments (3) | 200 | 0 | 2026-07-26 | `success` | 208 / 200 / 0 / 0 |

Other facts the design depends on:

- UNESCO rows carry `metadata.inDanger` and `metadata.dangerList` (all 1247). A change in that
  field is a product event, not noise.
- Museum and landmark rows carry `metadata.wikidataQid` (all 300); UNESCO rows do not (only
  `metadata.wikipediaUrl`, resolved via P757).
- The 8 museum errors are `No valid coordinates after resolution`, raised in `fetchItems` —
  i.e. before any write, and therefore reproducible in a dry run.
- Database size is 14 GB (GADM geometry). Whole-database rollback is not a practical dev loop.
- Backend has 43 unit tests, all `vi.mock`-based. **No test touches a real database.**
- E2E stack exists: `npm run test:e2e:smoke`, fixture seeded by `backend/src/db/seed/runE2eFixture.ts`.
- `curator_assignments` supports `scope_type` of `global` / `category` / `region`, and
  `backend/src/middleware/auth.ts` already exposes a `curator_scoped_regions` recursive SQL prelude.
- `/api/admin/*` is admin-only (`backend/src/routes/index.ts`); curator endpoints live under
  `/api/experiences/*` with `requireCurator`.
- `experience_curation_log` already exists, with actions `created`, `rejected`, `unrejected`,
  `edited`, `added_to_region`, `removed_from_region`.

## 2. What a "change" can actually mean

An object disappearing from a source is six different events, and the source never says which:

| # | Event | Example | Visitable |
|---|---|---|---|
| A | Delisted from the collection | Dresden Elbe Valley (2009), Liverpool (2021) | **Yes** |
| B | Physically destroyed | Colston statue (2020), monuments in war zones | No |
| C | Merged / re-issued under a new ID | UNESCO extension absorbing an older inscription | Yes, under a different ID |
| D | Dropped out of **our** selection | museum falls below the top-100 sitelink cut | Yes |
| E | Run under-fetched (SPARQL timeout, partial API response) | our own `partial` run of 26 July | Yes — nothing happened |
| F | Stopped matching source criteria | P31 changed in Wikidata | Yes |

A and B are **independent axes**, not degrees of one status:

- Bamiyan Buddhas — destroyed, but still listed by UNESCO.
- Dresden Elbe Valley — intact, but no longer listed.

A single `active | former | lost` enum cannot represent both without lying about one of them.

An object being *updated* is likewise five different events, currently collapsed into one counter:

1. **Touched but identical** — ~99 % of rows. `total_updated` counts these today, which is why the
   next UNESCO run would report "1247 updated" and mean nothing.
2. **Cosmetic** — description rewritten, image swapped.
3. **Significant** — name, coordinates, country set, `metadata.inDanger`, `dateInscribed`.
4. **Conflict with curation** — source changed a field protected by `curated_fields`. The curator
   edit survives (that part works), but the divergence accumulates silently and forever.
5. **Return** — an object previously marked missing shows up again.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope of the report | Sync runs now; curation gets a place in the model from day one | `experience_curation_log` already exists, so the report can read both streams without a later schema change |
| Lifecycle model | **Two axes**: membership (`present`/`former`) × existence (`extant`/`lost`) | Bamiyan and Dresden are both representable; neither truth gets discarded |
| Who sets `former` / `lost` | **Curator only.** Machine records `missing_since` and reports it | Deliberate: a source outage must never change what users see |
| User-facing visibility | `former` stays visible with a chip; `lost` leaves lists/map but stays in visit history and behind a filter | You can still travel to a delisted site; you cannot travel to a demolished one |
| Progress denominator | active + visited `former`/`lost` | A visit to Dresden must not vanish when Dresden was delisted |
| "New" chip | Run-based **plus** personal, window configurable per category | Sources have different cadences; a rare visitor must not miss a batch |
| Report shape | Run card (admin) + decision queue (curator) | A feed is unbounded; decisions need a worklist |
| Slicing | Core+dry-run → recon → curation → chip → live run | The live run is a one-shot resource and belongs at the end |
| New e2e | Heavy scenarios in `test:e2e:full`, one thin check in smoke | Keeps the per-PR gate fast |

## 4. Data model

### 4.1 `experiences` — two axes plus provenance

```sql
ALTER TABLE experiences
  -- axis 1: membership in the source collection
  ADD COLUMN last_seen_sync_log_id  INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
  ADD COLUMN last_seen_at           TIMESTAMPTZ,
  ADD COLUMN first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
  ADD COLUMN missing_since          TIMESTAMPTZ,
  ADD COLUMN source_membership      VARCHAR(10) NOT NULL DEFAULT 'present'
      CHECK (source_membership IN ('present', 'former')),
  -- axis 2: physical existence
  ADD COLUMN existence              VARCHAR(10) NOT NULL DEFAULT 'extant'
      CHECK (existence IN ('extant', 'lost')),
  -- who decided, on either axis
  ADD COLUMN state_decided_by       INTEGER REFERENCES users(id),
  ADD COLUMN state_decided_at       TIMESTAMPTZ,
  ADD COLUMN state_note             TEXT;

CREATE INDEX idx_experiences_missing     ON experiences(category_id) WHERE missing_since IS NOT NULL;
CREATE INDEX idx_experiences_membership  ON experiences(source_membership) WHERE source_membership <> 'present';
CREATE INDEX idx_experiences_existence   ON experiences(existence) WHERE existence <> 'extant';
CREATE INDEX idx_experiences_first_seen  ON experiences(first_seen_sync_log_id);
```

`missing_since` is a machine fact. `source_membership` and `existence` are human conclusions.
The existing `status (active|draft|archived)` is untouched — it means "we removed it from
circulation", not "the world changed".

### 4.2 `experience_sync_changes` — one row per **touched** object

```sql
CREATE TABLE experience_sync_changes (
    id             BIGSERIAL PRIMARY KEY,
    sync_log_id    INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    experience_id  INTEGER REFERENCES experiences(id) ON DELETE SET NULL,
    external_id    VARCHAR(255) NOT NULL,
    name_snapshot  VARCHAR(500),
    change_type    VARCHAR(20) NOT NULL
        CHECK (change_type IN ('created', 'updated', 'missing', 'returned', 'failed')),
    changed_fields JSONB,        -- [{field, old, new, significance, curated_conflict}]
    significance   VARCHAR(10) CHECK (significance IN ('major', 'minor')),
    error          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_changes_log    ON experience_sync_changes(sync_log_id);
CREATE INDEX idx_sync_changes_exp    ON experience_sync_changes(experience_id);
CREATE INDEX idx_sync_changes_review ON experience_sync_changes(sync_log_id, change_type);
```

`unchanged` is **not** stored — only counted. Otherwise every UNESCO run writes 1247 rows of noise
to preserve ~50 meaningful ones.

`significance` on the row is the maximum significance across `changed_fields` — one `major` field
makes the row `major`. It exists as a column so the "significant only" filter is an indexed
predicate rather than a JSONB scan.

`name_snapshot` keeps the report readable after a row is deleted. `changed_fields[].new` holds the
value the source proposed **even when the upsert rejected it** because of `curated_fields` — without
that, the curator's "Accept source" action would have nothing to apply.

### 4.3 `experience_sync_logs` and `experience_categories`

```sql
ALTER TABLE experience_sync_logs
  ADD COLUMN total_unchanged          INTEGER DEFAULT 0,
  ADD COLUMN total_missing            INTEGER DEFAULT 0,
  ADD COLUMN total_curated_conflicts  INTEGER DEFAULT 0,
  ADD COLUMN is_dry_run               BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN detection_skipped_reason TEXT;

ALTER TABLE experience_categories
  ADD COLUMN new_badge_days INTEGER NOT NULL DEFAULT 30;
```

Source completeness (`authoritative` vs `ranked`) lives in **code**, in `SyncServiceConfig` — it is a
property of the fetch algorithm (UNESCO takes the whole list; `landmarkSyncService` does
`slice(0, TARGET_COUNT)`), and no database setting can change that.

### 4.4 `user_new_badge_views`

```sql
CREATE TABLE user_new_badge_views (
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sync_log_id    INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    first_shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, sync_log_id)
);
```

### 4.5 Curation log actions

Extend the `experience_curation_log.action` CHECK with `marked_former`, `marked_lost`,
`state_restored`, `accepted_source`. `details` carries `{axis, from, to, reason}` or
`{fields, sync_log_id}`.

### 4.6 Migration and backfill

`db/init/01-schema.sql` gets the canonical definitions; `db/migrations/` gets the one-shot for the
existing database, including a backfill that assigns `first_seen_sync_log_id` and
`last_seen_sync_log_id` to the current 1547 rows from logs 1 / 3 / 4. This reconstructs provenance
retroactively, so the first real re-sync has an honest baseline to diff against.

## 5. Change detection

### 5.1 Getting "before" and "after" in one statement

`upsertExperienceRecord()` currently issues one `INSERT … ON CONFLICT` and loses the prior state.
Rewrite as a CTE so both sides come back atomically:

```sql
WITH before AS (
  SELECT <fields> FROM experiences WHERE category_id = $1 AND external_id = $2
), ins AS (
  INSERT INTO experiences (…) VALUES (…)
  ON CONFLICT (category_id, external_id) DO UPDATE SET … -- curated_fields guards unchanged
  RETURNING id, (xmax = 0) AS inserted, <fields>
)
SELECT ins.*, before.* FROM ins LEFT JOIN before ON before.id = ins.id;
```

The field list is generated from one array so it is declared once, not three times.

### 5.2 `computeChangeSet(before, incoming)` — pure function

Lives in a new `backend/src/services/sync/changeSet.ts`. Returns
`{ changeType, changedFields[], significance, curatedConflicts[] }`. Normalization is mandatory or
the diff produces false positives:

- JSONB compared by value, not key order
- `country_codes` / `country_names` / `tags` compared as sets
- coordinates compared by distance: < 10 m is not a change, > 1 km is `major`
- `null` vs `''` vs missing treated as equal

Significance: `major` — `name`, `location`, `country_codes`, `metadata.inDanger`,
`metadata.dateInscribed`. `minor` — descriptions, tags, image swap.

A field the source changed but `curated_fields` protected is recorded with
`curated_conflict: true` and does **not** by itself make the row `updated` — it is counted
separately in `total_curated_conflicts`.

**Compatibility note:** this redefines `total_updated`. Today it counts every row that passed
through `ON CONFLICT DO UPDATE`, identical or not — which is why the museum run of 26 July reports
68 "updates" that may contain no actual change. After slice 1 it counts rows that really changed,
and `total_unchanged` absorbs the rest. Historical logs (ids 1–4) are therefore not comparable with
later ones; the run card labels pre-migration runs accordingly.

### 5.3 Dry run

Same code path, no writes to `experiences`: `SELECT` the current row, run `computeChangeSet`, and
persist the log plus `experience_sync_changes` rows with `is_dry_run = true`. This makes a real
source delta inspectable in the admin run card **without consuming it** — the reason the live run
can be deferred to the last slice.

A dry run predicts `missing` rows too — it writes `change_type = 'missing'` into the changeset while
leaving `experiences.missing_since` untouched, so "what would disappear" is reviewable before
anything is flagged.

**Dry-run logs are excluded from every "latest run" query** — `first_seen_sync_log_id`,
`last_seen_sync_log_id` and the `is_new` computation all filter on `is_dry_run = FALSE`. Without
this, a preview would silently reset the New chip and the provenance pointers.

### 5.4 Missing detection — three safeguards

`missing_since` is set only when **all** hold:

1. `config.sourceCompleteness === 'authoritative'`
2. the run finished with `errors === 0` and was not cancelled
3. `seenCount >= 0.9 × previous active count`

`seenCount` is the number of objects this run actually processed (created + updated + unchanged),
not `fetchedCount` — the UNESCO run of 26 July fetched 1248 and stored 1247, and it is the second
number that says how much of the collection we really saw. "Previous active count" is the count of
rows in the category with `source_membership = 'present'` before the run.

Otherwise the run writes `detection_skipped_reason` and touches nothing. The 26 July UNESCO run
(`partial`, 1 error) would have been skipped by rule 2 — correctly.

`returned` clears `missing_since` but does **not** restore `source_membership`: if only a curator
can set `former`, only a curator can lift it.

### 5.5 Known hazard: force sync

`cleanupCategoryData()` deletes and recreates every row, destroying curator decisions
(`former`/`lost`) and provenance along with them. Slice 1 adds a UI warning and logs the fact.
Preserving decisions by `external_id` across a wipe is listed as an open item (§12).

## 6. API

Admin (`/api/admin`, admin-only):

- `GET /sync-logs/:id/changes?type=&significance=&limit=&offset=` — paginated changeset
- `POST /sync/:categoryId/dry-run` — start a dry run

Curator (`/api/experiences`, `requireAuth + requireCurator`, filtered by curator scope):

- `GET /review/queue?categoryId=&limit=&offset=` — objects needing a decision (missing, conflicts)
- `POST /:id/state` — `{membership?, existence?, note?}`; writes `experiences` + `experience_curation_log`
- `POST /:id/accept-source` — `{fields: []}`; drops the field from `curated_fields` and applies the
  value stored in `changed_fields[].new` of the most recent non-dry-run change for that experience.
  The response states which run the accepted value came from, since a newer run may have proposed a
  different value than the one the curator was looking at

Public/user:

- `POST /experiences/new-badges/seen` — `{syncLogIds: []}`; upserts `user_new_badge_views`

Scope enforcement is server-side on every curator route (ASVS: authorization server-side, IDOR
prevention). The queue reuses the `curator_scoped_regions` prelude.

## 7. UI

### 7.1 Admin — run card

Extend `frontend/src/components/admin/SyncHistoryPanel.tsx` (`SyncLogDialog`). Seven tiles:
Fetched / Created / Changed / **Unchanged** / Missing / Conflicts / Errors. Below, the change list
with a **"significant only" filter on by default**, paginated.

A row reads as a sentence, not as JSON:

```
Serengeti National Park (156)              major
  inDanger:     false → true
  description:  changed (340 → 512 chars)   [expand]
```

Long text is never dumped inline — only the fact and the length, with the full value behind a click.
Dry-run cards are visually distinct and labelled "preview — nothing was written".

### 7.2 Curator — decision queue

New route `/review`, gated on `isCurator` (admins pass via implicit curator powers). Only items
needing a human decision:

- **Gone from source** → `Former` / `Lost` / `False alarm` (clears `missing_since`)
- **Curation conflict** → "source now: X / ours: Y" → `Accept source` / `Keep edit`

### 7.3 User-facing

- `New` chip — computed server-side, delivered as a boolean `is_new`
- `Former` chip on the card; the object stays in lists and on the map
- `lost` objects leave lists, map and recommendations, but remain in visit history and behind a
  "show lost" filter
- progress denominator = active + visited `former`/`lost`

An object carrying only `missing_since` — flagged by the machine, not yet judged by a curator —
looks completely ordinary to users. Nothing about the public surface changes until a human decides,
which is the whole point of leaving both axes in curator hands.

`experienceQueryController.ts` is already 487 lines against a ~500-line guideline, so the new SQL
fragments (lifecycle filter, `is_new`) are extracted into a sibling module rather than inlined.

## 8. The "New" chip

```
is_new = first_seen_sync_log_id = latest successful run of the category
         AND ( run.completed_at > now() - category.new_badge_days
               OR  user_new_badge_views.first_shown_at > now() - NEW_BADGE_PERSONAL_DAYS )
```

`NEW_BADGE_PERSONAL_DAYS = 7`. Anonymous users get the first clause only. The effective lifetime is
`max(category window, one week from the session where the user first saw it)`: a frequent visitor
stops seeing the chip after a week, a rare visitor still gets the batch that arrived while they were
away.

`first_shown_at` is recorded by an explicit `POST …/new-badges/seen` sent after the chips actually
render — GET stays idempotent and the timestamp reflects a real impression.

This replaces `isNewExperience()` / `NEW_BADGE_DAYS` in
`frontend/src/components/ExperienceList/utils.ts`, whose 7-day window from `created_at` means
"recently created", not "arrived in the latest sync".

## 9. Test strategy

**Unit (no database, runs in `npm test`)**

- `computeChangeSet`: JSONB order, country sets, coordinate thresholds (10 m / 1 km), major vs minor,
  curated conflict, touched-but-identical, null/empty equivalence
- missing-detection safeguards: ranked source, `errors > 0`, coverage < 90 %, cancelled run
- orchestrator against a fixture source with `syncUtils` mocked: correct change types persisted

**E2E on the isolated stack (real database, real UI)**

`runE2eFixture.ts` gains two source generations and runs the sync twice, so the database ends up
holding created / updated-major / updated-minor / unchanged / missing / returned / curated-conflict
/ former / lost simultaneously.

Playwright (`test:e2e:full`): run card renders the breakdown; curator queue marks an item `Former`;
a user sees the `New` and `Former` chips and does **not** see a `lost` object. One thin smoke check
(`test:e2e:smoke`): the run card opens and renders.

**Fixture source**

The fixture is fed to the **existing UNESCO service** by substituting the data source, not by adding
a parallel fake service — otherwise the test would exercise a surrogate rather than the code that
ships. Seed and tests inject it programmatically; `SYNC_SOURCE_FIXTURE` (env) exists only for manual
development, is refused when `NODE_ENV === 'production'`, and resolves paths under a fixed fixture
directory (no traversal).

## 10. Slices

| # | Slice | Contents | Database changes |
|---|---|---|---|
| 1 | Core + dry run | schema + migration/backfill, `changeSet.ts`, CTE upsert, safeguards, changes API, run card, dry-run button, fixture source, unit tests | schema only |
| 2 | Recon (#480 proper) | dry runs across all three categories against live sources; chase the 1 UNESCO + 8 museum errors; confirm `regionAssignmentService` places newly created rows | **none** |
| 3 | Curation | `/review` queue, state API, `former`/`lost`, curation log actions, user-facing visibility, progress denominator | fixture only |
| 4 | New chip | `new_badge_days`, `is_new`, `user_new_badge_views`, seen endpoint, frontend | fixture only |
| 5 | Live run (acceptance) | dump the 7 experience-domain tables; curate 2–3 objects by hand to force a real conflict; run for real; verify report, queue and chips on genuine data | yes, once |

Slice 5 note: curating a few objects deliberately is the only way the `curated_fields` branch ever
executes — nobody has edited anything (0 of 1547 rows), so a conflict cannot arise on its own.

Rollback, if slice 5 uncovers a defect, is a targeted restore of `experiences`,
`experience_locations`, `experience_regions`, `experience_location_regions`, `experience_sync_logs`,
`experience_sync_changes`, `user_visited_*` — megabytes, not the 14 GB database.

## 11. Documentation obligations

- **ADR-0020** — "Two-axis experience lifecycle and per-run changeset". Required: this changes a
  database schema pattern and would be inexplicable in six months otherwise.
- `docs/tech/experiences.md` — sync architecture, provenance, lifecycle, curator queue (slices 1, 3, 4)
- `docs/vision/vision.md` — user-visible: `New` chip semantics, `Former` chip, hidden `lost`,
  progress denominator (slices 3, 4)
- `docs/security/SECURITY.md` — new curator endpoints and the fixture-source env switch (slice 1, 3)
- Issue #480 checklist ticks off as slices land

## 12. Open items

1. **Force sync destroys curator decisions.** Slice 1 warns; preserving `former`/`lost` by
   `external_id` across a wipe is not designed yet.
2. **Merges (case C).** A merged inscription appears as `missing` + `created` in the same run. A
   later improvement could propose merge candidates by proximity and name similarity within the run.
3. **Treasures.** `treasures` has the same problem (a painting moves, is sold, is stolen) and the
   same model would apply. Explicitly out of scope here.
4. **Wikidata hints for `existence`.** `metadata.wikidataQid` exists on museums and landmarks, so
   P576 (demolished/dissolved date) could suggest `lost` to the curator. Not in scope; it would be a
   hint, never an automatic decision.
5. **Category window defaults.** `new_badge_days = 30` for all three initially; UNESCO's annual
   cadence may want more, museums less. Tune after the live run.
