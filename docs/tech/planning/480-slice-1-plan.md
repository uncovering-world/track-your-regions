# Slice 1 — Change Provenance Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Local working document. Not committed (`docs/tech/planning/` is gitignored).
Spec: `docs/tech/planning/480-experience-change-provenance.md`.

**Goal:** Make every sync run record *which* experiences it created, changed, left alone, or failed to see — with a per-field diff — and make that inspectable in the admin run card, including as a dry run that writes nothing to `experiences`.

**Architecture:** A pure `computeChangeSet()` function diffs the source record against the stored row; `upsertExperienceRecord()` is rewritten as a CTE that returns both sides in one statement, so "before" is never lost; the orchestrator persists the resulting rows into a new `experience_sync_changes` table and, for authoritative sources that passed three safeguards, flags rows the run never saw. Dry run reuses the same path with writes suppressed.

**Tech Stack:** TypeScript, Express, PostgreSQL/PostGIS (raw `pool` for geometry), vitest + `vi.mock` on the backend, React/MUI + React Testing Library on the frontend.

## Global Constraints

- Database name is `track_regions`; container is `tyr-ng-db`. Shell access: `docker exec -i tyr-ng-db psql -U postgres -d track_regions`.
- `db/init/01-schema.sql` is the canonical schema and **must stay idempotent** (`IF NOT EXISTS` / `OR REPLACE`) — it is re-applied to live databases. One-shot work for databases holding data goes in `db/migrations/`, applied with `npm run db:run-sql -- -v ON_ERROR_STOP=1 < file`.
- Backend imports use explicit `.js` extensions (ESM). Tests live beside the code as `*.test.ts`.
- No backend test may touch a real database — mock `../../db/index.js` with `vi.mock`.
- Keep files under ~500 lines (`docs/tech/development-guide.md`). `backend/src/controllers/experience/experienceQueryController.ts` is already at 487.
- Commit messages: imperative sentence, capitalized, ending with a period, optional area prefix (`back:`, `front:`, `deploy:`). Not conventional-commits.
- Never concatenate user input into SQL — parameterized queries only (OWASP ASVS 5.0 L2).
- Pre-commit gate: `npm run check` + `TEST_REPORT_LOCAL=1 npm test`. The branch must be green before it leaves the machine; individual layered commits may be red.
- Field significance is fixed by the spec: `major` = `name`, `location`, `countryCodes`, `metadata.inDanger`, `metadata.dateInscribed`. Everything else is `minor`.
- Coordinate thresholds: below 10 m is not a change; above 1000 m is `major`; between is `minor`.
- Missing-detection coverage floor: `MISSING_DETECTION_MIN_COVERAGE = 0.9`.
- Personal new-badge window (used in slice 4, defined here for the schema): `new_badge_days` default 30.

---

### Task 1: Schema and migration

**Files:**
- Modify: `db/init/01-schema.sql`
- Create: `db/migrations/009-experience-change-provenance.sql`

**Interfaces:**
- Consumes: nothing
- Produces: table `experience_sync_changes`; columns `experiences.last_seen_sync_log_id`, `experiences.last_seen_at`, `experiences.first_seen_sync_log_id`, `experiences.missing_since`, `experiences.source_membership`, `experiences.existence`, `experiences.state_decided_by`, `experiences.state_decided_at`, `experiences.state_note`; columns `experience_sync_logs.total_unchanged`, `total_missing`, `total_curated_conflicts`, `is_dry_run`, `detection_skipped_reason`; column `experience_categories.new_badge_days`

- [ ] **Step 1: Add the columns and table to the canonical schema**

In `db/init/01-schema.sql`, the `experiences` table is declared at ~line 1630 and `experience_sync_logs` at ~line 1732. The provenance columns carry foreign keys to `experience_sync_logs`, so they must be added **after** that table exists — put this block immediately after the `CREATE INDEX ... idx_experience_sync_logs_status` line (~1752):

```sql
-- Change provenance (issue #480): who saw this row last, and what state it is in.
-- Axis 1 (membership) is machine-observed but curator-decided; axis 2 (existence)
-- is curator-only. See ADR-0020.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS last_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS existence VARCHAR(10) NOT NULL DEFAULT 'extant';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_decided_by INTEGER REFERENCES users(id);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_decided_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_source_membership_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_source_membership_check
            CHECK (source_membership IN ('present', 'former'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_existence_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_existence_check
            CHECK (existence IN ('extant', 'lost'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experiences_missing ON experiences(category_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_membership ON experiences(source_membership) WHERE source_membership <> 'present';
CREATE INDEX IF NOT EXISTS idx_experiences_existence ON experiences(existence) WHERE existence <> 'extant';
CREATE INDEX IF NOT EXISTS idx_experiences_first_seen ON experiences(first_seen_sync_log_id);
```

Then, in the same place, add the log and changeset definitions:

```sql
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_unchanged INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_missing INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_curated_conflicts INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS is_dry_run BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS detection_skipped_reason TEXT;

COMMENT ON COLUMN experience_sync_logs.total_updated IS 'Rows whose fields actually changed. Runs before migration 009 counted every row that passed through ON CONFLICT, changed or not — the two are not comparable.';
COMMENT ON COLUMN experience_sync_logs.is_dry_run IS 'TRUE for preview runs: the changeset was computed but experiences were not written. Excluded from every "latest run" query.';

-- Per-object record of what a run did. 'unchanged' is deliberately NOT stored;
-- it is only counted, or every UNESCO run would write 1247 rows of noise.
CREATE TABLE IF NOT EXISTS experience_sync_changes (
    id             BIGSERIAL PRIMARY KEY,
    sync_log_id    INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    experience_id  INTEGER REFERENCES experiences(id) ON DELETE SET NULL,
    external_id    VARCHAR(255) NOT NULL,
    name_snapshot  VARCHAR(500),
    change_type    VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'updated', 'missing', 'returned', 'failed')),
    changed_fields JSONB,
    significance   VARCHAR(10) CHECK (significance IN ('major', 'minor')),
    error          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_sync_changes IS 'Per-object provenance for a sync run (issue #480). See ADR-0020.';
COMMENT ON COLUMN experience_sync_changes.changed_fields IS 'Array of {field, old, new, significance, curatedConflict}. Holds the value the source proposed even when curated_fields rejected it, so a curator can accept it later.';

CREATE INDEX IF NOT EXISTS idx_sync_changes_log ON experience_sync_changes(sync_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_exp ON experience_sync_changes(experience_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_review ON experience_sync_changes(sync_log_id, change_type);
```

And after the `experience_categories` table:

```sql
ALTER TABLE experience_categories ADD COLUMN IF NOT EXISTS new_badge_days INTEGER NOT NULL DEFAULT 30;
COMMENT ON COLUMN experience_categories.new_badge_days IS 'How long an object created by the latest run keeps the "New" chip. Per category, because sources have different cadences.';
```

- [ ] **Step 2: Write the migration with backfill**

Create `db/migrations/009-experience-change-provenance.sql`:

```sql
-- 009: change provenance for experiences (issue #480)
--
-- Adds the provenance and lifecycle columns, the per-run changeset table, and
-- backfills provenance for rows that predate all of it: every existing row is
-- attributed to the newest successful-or-partial run of its category, which is
-- how it actually got there.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/009-experience-change-provenance.sql

\set ON_ERROR_STOP on

BEGIN;

-- The DDL is identical to db/init/01-schema.sql and idempotent; re-applying the
-- schema file instead of this block is equally valid.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS last_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS existence VARCHAR(10) NOT NULL DEFAULT 'extant';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_decided_by INTEGER REFERENCES users(id);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_decided_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_source_membership_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_source_membership_check
            CHECK (source_membership IN ('present', 'former'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_existence_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_existence_check
            CHECK (existence IN ('extant', 'lost'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experiences_missing ON experiences(category_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_membership ON experiences(source_membership) WHERE source_membership <> 'present';
CREATE INDEX IF NOT EXISTS idx_experiences_existence ON experiences(existence) WHERE existence <> 'extant';
CREATE INDEX IF NOT EXISTS idx_experiences_first_seen ON experiences(first_seen_sync_log_id);

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_unchanged INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_missing INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_curated_conflicts INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS is_dry_run BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS detection_skipped_reason TEXT;

ALTER TABLE experience_categories ADD COLUMN IF NOT EXISTS new_badge_days INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS experience_sync_changes (
    id             BIGSERIAL PRIMARY KEY,
    sync_log_id    INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    experience_id  INTEGER REFERENCES experiences(id) ON DELETE SET NULL,
    external_id    VARCHAR(255) NOT NULL,
    name_snapshot  VARCHAR(500),
    change_type    VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'updated', 'missing', 'returned', 'failed')),
    changed_fields JSONB,
    significance   VARCHAR(10) CHECK (significance IN ('major', 'minor')),
    error          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_log ON experience_sync_changes(sync_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_exp ON experience_sync_changes(experience_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_review ON experience_sync_changes(sync_log_id, change_type);

-- Backfill: attribute every existing row to the newest non-dry run of its
-- category that actually wrote something. Rows whose category never had such a
-- run keep NULL, which reads correctly as "provenance unknown".
WITH newest_run AS (
    SELECT DISTINCT ON (category_id) category_id, id, started_at
    FROM experience_sync_logs
    WHERE status IN ('success', 'partial')
    ORDER BY category_id, started_at DESC
)
UPDATE experiences e
SET first_seen_sync_log_id = COALESCE(e.first_seen_sync_log_id, r.id),
    last_seen_sync_log_id  = COALESCE(e.last_seen_sync_log_id, r.id),
    last_seen_at           = COALESCE(e.last_seen_at, r.started_at)
FROM newest_run r
WHERE e.category_id = r.category_id
  AND e.last_seen_sync_log_id IS NULL;

COMMIT;
```

- [ ] **Step 3: Apply the migration and verify**

Run:

```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/009-experience-change-provenance.sql
```

Then verify:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "\d experience_sync_changes"
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "SELECT category_id, count(*) AS rows, count(last_seen_sync_log_id) AS with_provenance FROM experiences GROUP BY 1 ORDER BY 1;"
```

Expected: the table exists with the three indexes, and all three categories report `rows = with_provenance` (1247 / 100 / 200), attributed to logs 1, 3 and 4 respectively.

- [ ] **Step 4: Verify idempotency**

Run the migration a second time. Expected: no error, and the counts above are unchanged (the `COALESCE` guards prevent re-attribution).

- [ ] **Step 5: Commit**

```bash
git add db/init/01-schema.sql db/migrations/009-experience-change-provenance.sql
git commit -m "Record which run each experience came from, and what a run did."
```

---

### Task 2: `computeChangeSet()` — the diff

**Files:**
- Create: `backend/src/services/sync/changeSet.ts`
- Test: `backend/src/services/sync/changeSet.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports from the codebase)
- Produces:
  - `interface ExperienceSnapshot { name, nameLocal, description, shortDescription, category, tags, lon, lat, countryCodes, countryNames, imageUrl, metadata }`
  - `type FieldSignificance = 'major' | 'minor'`
  - `interface FieldChange { field: string; old: unknown; new: unknown; significance: FieldSignificance; curatedConflict: boolean }`
  - `interface ChangeSetResult { changeType: 'created' | 'updated' | 'unchanged'; changedFields: FieldChange[]; significance: FieldSignificance | null; curatedConflicts: FieldChange[] }`
  - `function computeChangeSet(before: ExperienceSnapshot | null, incoming: ExperienceSnapshot, curatedFields: string[]): ChangeSetResult`
  - `const LOCATION_UNCHANGED_METERS = 10`, `const LOCATION_MAJOR_METERS = 1000`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/sync/changeSet.test.ts`:

```typescript
/**
 * Tests for the sync change-set diff.
 *
 * The diff decides what a run reports, so its false positives are expensive:
 * a JSONB key reordering or a 3-metre coordinate jitter must not be announced
 * as a change to 1247 objects.
 */

import { describe, it, expect } from 'vitest';
import { computeChangeSet, type ExperienceSnapshot } from './changeSet.js';

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Serengeti National Park',
    nameLocal: { en: 'Serengeti National Park', fr: 'Parc national du Serengeti' },
    description: null,
    shortDescription: 'Vast plains of the Serengeti.',
    category: 'natural',
    tags: ['natural', 'unesco'],
    lon: 34.8333,
    lat: -2.3333,
    countryCodes: ['TZ'],
    countryNames: ['Tanzania'],
    imageUrl: 'https://whc.unesco.org/uploads/sites/site_156.jpg',
    metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476300 },
    ...overrides,
  };
}

describe('computeChangeSet', () => {
  it('reports created when there is no prior row', () => {
    const result = computeChangeSet(null, snapshot(), []);

    expect(result.changeType).toBe('created');
    expect(result.changedFields).toEqual([]);
    expect(result.significance).toBeNull();
  });

  it('reports unchanged when nothing differs', () => {
    const result = computeChangeSet(snapshot(), snapshot(), []);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
    expect(result.significance).toBeNull();
  });

  it('ignores JSONB key order', () => {
    const before = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476300 } });
    const incoming = snapshot({ metadata: { areaHectares: 1476300, dateInscribed: 1981, inDanger: false } });

    expect(computeChangeSet(before, incoming, []).changeType).toBe('unchanged');
  });

  it('treats country arrays as sets, not sequences', () => {
    const before = snapshot({ countryCodes: ['FR', 'ES'], countryNames: ['France', 'Spain'] });
    const incoming = snapshot({ countryCodes: ['ES', 'FR'], countryNames: ['Spain', 'France'] });

    expect(computeChangeSet(before, incoming, []).changeType).toBe('unchanged');
  });

  it('treats null, empty string and missing text as the same absence', () => {
    const before = snapshot({ description: null });
    const incoming = snapshot({ description: '' });

    expect(computeChangeSet(before, incoming, []).changeType).toBe('unchanged');
  });

  it('ignores coordinate jitter below the threshold', () => {
    // ~5 m north of the original point
    const incoming = snapshot({ lat: -2.3333 + 0.000045 });

    expect(computeChangeSet(snapshot(), incoming, []).changeType).toBe('unchanged');
  });

  it('reports a moderate coordinate shift as minor', () => {
    // ~500 m east
    const incoming = snapshot({ lon: 34.8333 + 0.0045 });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['location']);
    expect(result.significance).toBe('minor');
  });

  it('reports a kilometre-scale coordinate shift as major', () => {
    // ~5 km east
    const incoming = snapshot({ lon: 34.8333 + 0.045 });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('major');
  });

  it('reports a description rewrite as minor', () => {
    const incoming = snapshot({ shortDescription: 'A completely rewritten summary.' });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.changeType).toBe('updated');
    expect(result.significance).toBe('minor');
    expect(result.changedFields[0]).toMatchObject({ field: 'shortDescription', significance: 'minor' });
  });

  it('reports a danger-list entry as a major metadata change', () => {
    const incoming = snapshot({ metadata: { inDanger: true, dateInscribed: 1981, areaHectares: 1476300 } });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('major');
    expect(result.changedFields).toContainEqual({
      field: 'metadata.inDanger',
      old: false,
      new: true,
      significance: 'major',
      curatedConflict: false,
    });
  });

  it('reports unremarkable metadata edits as one minor change', () => {
    const incoming = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476999 } });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('minor');
    expect(result.changedFields.map(f => f.field)).toEqual(['metadata']);
  });

  it('records a curated field as a conflict and not as an applied change', () => {
    const incoming = snapshot({ name: 'Serengeti NP (renamed upstream)' });
    const result = computeChangeSet(snapshot(), incoming, ['name']);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
    expect(result.curatedConflicts).toEqual([{
      field: 'name',
      old: 'Serengeti National Park',
      new: 'Serengeti NP (renamed upstream)',
      significance: 'major',
      curatedConflict: true,
    }]);
  });

  it('still reports unprotected fields when another field is curated', () => {
    const incoming = snapshot({
      name: 'Serengeti NP (renamed upstream)',
      shortDescription: 'New summary.',
    });
    const result = computeChangeSet(snapshot(), incoming, ['name']);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['shortDescription']);
    expect(result.curatedConflicts).toHaveLength(1);
  });

  it('escalates the row to major when any field is major', () => {
    const incoming = snapshot({ name: 'Renamed', shortDescription: 'New summary.' });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('major');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/services/sync/changeSet.test.ts`
Expected: FAIL — `Cannot find module './changeSet.js'`.

- [ ] **Step 3: Implement the module**

Create `backend/src/services/sync/changeSet.ts`:

```typescript
/**
 * Sync change-set computation.
 *
 * Pure: no database, no network. Given the row as it stands and the record the
 * source just produced, decide what actually changed — and how much it matters.
 *
 * The normalisation here is the point. A source that reorders JSONB keys, lists
 * two countries the other way round, or jitters a coordinate by three metres
 * has not changed anything, and reporting it as change would bury the handful
 * of edits that are real.
 */

export interface ExperienceSnapshot {
  name: string;
  nameLocal: Record<string, string> | null;
  description: string | null;
  shortDescription: string | null;
  category: string | null;
  tags: string[] | null;
  lon: number;
  lat: number;
  countryCodes: string[] | null;
  countryNames: string[] | null;
  imageUrl: string | null;
  metadata: Record<string, unknown> | null;
}

export type FieldSignificance = 'major' | 'minor';

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
  significance: FieldSignificance;
  curatedConflict: boolean;
}

export interface ChangeSetResult {
  changeType: 'created' | 'updated' | 'unchanged';
  changedFields: FieldChange[];
  significance: FieldSignificance | null;
  curatedConflicts: FieldChange[];
}

/** Below this, a coordinate difference is source jitter, not a move. */
export const LOCATION_UNCHANGED_METERS = 10;
/** Above this, the object has moved far enough to matter to a traveller. */
export const LOCATION_MAJOR_METERS = 1000;

/** Metadata keys whose change is a product event, not bookkeeping. */
const MAJOR_METADATA_KEYS = ['inDanger', 'dateInscribed'] as const;

/** Snapshot fields that are `major` when they differ. `location` is synthetic. */
const MAJOR_FIELDS = new Set(['name', 'location', 'countryCodes']);

/**
 * The curated_fields entry that protects a given change. Column names, because
 * that is what `experiences.curated_fields` holds.
 */
const CURATED_KEY_BY_FIELD: Record<string, string> = {
  name: 'name',
  nameLocal: 'name_local',
  description: 'description',
  shortDescription: 'short_description',
  category: 'category',
  tags: 'tags',
  location: 'location',
  countryCodes: 'country_codes',
  countryNames: 'country_names',
  imageUrl: 'image_url',
  metadata: 'metadata',
  'metadata.inDanger': 'metadata',
  'metadata.dateInscribed': 'metadata',
};

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function textEquals(a: unknown, b: unknown): boolean {
  if (isAbsent(a) && isAbsent(b)) return true;
  return a === b;
}

function setEquals(a: string[] | null, b: string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every(item => seen.has(item));
}

/** Deep value equality with object keys compared as sets, not sequences. */
function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isAbsent(a) && isAbsent(b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEquals(item, b[i]));
  }

  if (typeof a === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => jsonEquals(left[key], right[key]));
  }

  return false;
}

/** Great-circle distance in metres. */
function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fieldSignificance(field: string): FieldSignificance {
  return MAJOR_FIELDS.has(field) ? 'major' : 'minor';
}

function metadataChanges(
  before: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
): Array<{ field: string; old: unknown; new: unknown; significance: FieldSignificance }> {
  const changes: Array<{ field: string; old: unknown; new: unknown; significance: FieldSignificance }> = [];
  const left = before ?? {};
  const right = incoming ?? {};

  for (const key of MAJOR_METADATA_KEYS) {
    if (!jsonEquals(left[key], right[key])) {
      changes.push({ field: `metadata.${key}`, old: left[key], new: right[key], significance: 'major' });
    }
  }

  const rest = (source: Record<string, unknown>) => {
    const copy = { ...source };
    for (const key of MAJOR_METADATA_KEYS) delete copy[key];
    return copy;
  };

  if (!jsonEquals(rest(left), rest(right))) {
    changes.push({ field: 'metadata', old: before, new: incoming, significance: 'minor' });
  }

  return changes;
}

function collectDifferences(
  before: ExperienceSnapshot,
  incoming: ExperienceSnapshot,
): Array<{ field: string; old: unknown; new: unknown; significance: FieldSignificance }> {
  const diffs: Array<{ field: string; old: unknown; new: unknown; significance: FieldSignificance }> = [];

  const textFields = ['name', 'description', 'shortDescription', 'category', 'imageUrl'] as const;
  for (const field of textFields) {
    if (!textEquals(before[field], incoming[field])) {
      diffs.push({ field, old: before[field], new: incoming[field], significance: fieldSignificance(field) });
    }
  }

  if (!jsonEquals(before.nameLocal, incoming.nameLocal)) {
    diffs.push({ field: 'nameLocal', old: before.nameLocal, new: incoming.nameLocal, significance: 'minor' });
  }

  if (!setEquals(before.tags, incoming.tags)) {
    diffs.push({ field: 'tags', old: before.tags, new: incoming.tags, significance: 'minor' });
  }

  for (const field of ['countryCodes', 'countryNames'] as const) {
    if (!setEquals(before[field], incoming[field])) {
      diffs.push({ field, old: before[field], new: incoming[field], significance: fieldSignificance(field) });
    }
  }

  const moved = distanceMeters(before.lon, before.lat, incoming.lon, incoming.lat);
  if (moved >= LOCATION_UNCHANGED_METERS) {
    diffs.push({
      field: 'location',
      old: { lon: before.lon, lat: before.lat },
      new: { lon: incoming.lon, lat: incoming.lat },
      significance: moved > LOCATION_MAJOR_METERS ? 'major' : 'minor',
    });
  }

  diffs.push(...metadataChanges(before.metadata, incoming.metadata));

  return diffs;
}

/**
 * Diff a stored row against the record the source just produced.
 *
 * Fields protected by `curated_fields` are reported separately: the upsert will
 * not apply them, so they are a divergence to show a curator rather than a
 * change the run made. A row whose only differences are protected is
 * `unchanged` — because nothing about it changed.
 */
export function computeChangeSet(
  before: ExperienceSnapshot | null,
  incoming: ExperienceSnapshot,
  curatedFields: string[],
): ChangeSetResult {
  if (before === null) {
    return { changeType: 'created', changedFields: [], significance: null, curatedConflicts: [] };
  }

  const curated = new Set(curatedFields);
  const changedFields: FieldChange[] = [];
  const curatedConflicts: FieldChange[] = [];

  for (const diff of collectDifferences(before, incoming)) {
    const protectedBy = CURATED_KEY_BY_FIELD[diff.field];
    const isProtected = protectedBy !== undefined && curated.has(protectedBy);
    const change: FieldChange = { ...diff, curatedConflict: isProtected };
    if (isProtected) curatedConflicts.push(change);
    else changedFields.push(change);
  }

  const significance: FieldSignificance | null = changedFields.length === 0
    ? null
    : changedFields.some(f => f.significance === 'major') ? 'major' : 'minor';

  return {
    changeType: changedFields.length === 0 ? 'unchanged' : 'updated',
    changedFields,
    significance,
    curatedConflicts,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/services/sync/changeSet.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sync/changeSet.ts backend/src/services/sync/changeSet.test.ts
git commit -m "back: Work out what a sync run actually changed, field by field."
```

---

### Task 3: Upsert that returns both sides

**Files:**
- Modify: `backend/src/services/sync/syncUtils.ts:37-86`
- Test: `backend/src/services/sync/syncUtils.upsert.test.ts`

**Interfaces:**
- Consumes: `ExperienceSnapshot`, `ChangeSetResult`, `computeChangeSet` from Task 2
- Produces:
  - `interface UpsertOutcome { experienceId: number; changeSet: ChangeSetResult; nameSnapshot: string }`
  - `function upsertExperienceRecord(params: ExperienceUpsertParams, options?: { dryRun?: boolean; syncLogId?: number | null }): Promise<UpsertOutcome>`
  - unchanged export: `interface ExperienceUpsertParams`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/sync/syncUtils.upsert.test.ts`:

```typescript
/**
 * Tests for the provenance-aware experience upsert.
 *
 * The upsert has to answer two questions in one round trip: what the row looked
 * like before, and what it looks like now. These tests pin the shape of that
 * answer and the promise that a dry run writes nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './syncUtils.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const PARAMS: ExperienceUpsertParams = {
  categoryId: 1,
  externalId: '156',
  name: 'Serengeti National Park',
  nameLocal: { en: 'Serengeti National Park' },
  description: null,
  shortDescription: 'Vast plains.',
  category: 'natural',
  tags: ['natural'],
  lon: 34.8333,
  lat: -2.3333,
  countryCodes: ['TZ'],
  countryNames: ['Tanzania'],
  imageUrl: 'https://example.org/serengeti.jpg',
  metadata: { inDanger: false, dateInscribed: 1981 },
};

/** The row shape the CTE returns: new values, plus `old_*` for the prior row. */
function returnedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    inserted: false,
    curated_fields: [],
    name: PARAMS.name,
    name_local: PARAMS.nameLocal,
    description: PARAMS.description,
    short_description: PARAMS.shortDescription,
    category: PARAMS.category,
    tags: PARAMS.tags,
    lon: PARAMS.lon,
    lat: PARAMS.lat,
    country_codes: PARAMS.countryCodes,
    country_names: PARAMS.countryNames,
    image_url: PARAMS.imageUrl,
    metadata: PARAMS.metadata,
    old_name: PARAMS.name,
    old_name_local: PARAMS.nameLocal,
    old_description: PARAMS.description,
    old_short_description: PARAMS.shortDescription,
    old_category: PARAMS.category,
    old_tags: PARAMS.tags,
    old_lon: PARAMS.lon,
    old_lat: PARAMS.lat,
    old_country_codes: PARAMS.countryCodes,
    old_country_names: PARAMS.countryNames,
    old_image_url: PARAMS.imageUrl,
    old_metadata: PARAMS.metadata,
    ...overrides,
  };
}

describe('upsertExperienceRecord', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('reports a created row when the insert did not conflict', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ inserted: true, old_name: null })] });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.experienceId).toBe(501);
    expect(result.changeSet.changeType).toBe('created');
    expect(result.nameSnapshot).toBe('Serengeti National Park');
  });

  it('reports unchanged when the stored row already matched', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.changedFields).toEqual([]);
  });

  it('reports the fields that differ from the stored row', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_short_description: 'An older summary.' })],
    });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('surfaces a curated field as a conflict, using the stored curated_fields', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ curated_fields: ['short_description'], old_short_description: 'Curator wording.' })],
    });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.curatedConflicts.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reads without writing in dry-run mode', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: [],
        name: 'Serengeti National Park',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: 'An older summary.',
        category: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('SELECT');
    expect(sql).not.toContain('INSERT');
    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reports created in dry-run mode when no row exists yet', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(result.changeSet.changeType).toBe('created');
    expect(result.experienceId).toBe(0);
  });

  it('stamps provenance on the written row', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('last_seen_sync_log_id');
    expect(sql).toContain('first_seen_sync_log_id');
    expect(mockedQuery.mock.calls[0][1]).toContain(9);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/services/sync/syncUtils.upsert.test.ts`
Expected: FAIL — the current `upsertExperienceRecord` returns `{ experienceId, isCreated }` and has no `changeSet`.

- [ ] **Step 3: Rewrite the upsert**

In `backend/src/services/sync/syncUtils.ts`, add the import and replace the whole `upsertExperienceRecord` function (lines 37-86) with:

```typescript
import { computeChangeSet, type ChangeSetResult, type ExperienceSnapshot } from './changeSet.js';

export interface UpsertOutcome {
  experienceId: number;
  changeSet: ChangeSetResult;
  nameSnapshot: string;
}

/** Columns the diff reads, in the order the CTE returns them. */
const SNAPSHOT_COLUMNS = [
  'name', 'name_local', 'description', 'short_description', 'category', 'tags',
  'country_codes', 'country_names', 'image_url', 'metadata',
] as const;

function snapshotFromRow(row: Record<string, unknown>, prefix: '' | 'old_'): ExperienceSnapshot {
  const get = (column: string) => row[`${prefix}${column}`];
  return {
    name: (get('name') as string) ?? '',
    nameLocal: (get('name_local') as Record<string, string> | null) ?? null,
    description: (get('description') as string | null) ?? null,
    shortDescription: (get('short_description') as string | null) ?? null,
    category: (get('category') as string | null) ?? null,
    tags: (get('tags') as string[] | null) ?? null,
    lon: Number(get('lon')),
    lat: Number(get('lat')),
    countryCodes: (get('country_codes') as string[] | null) ?? null,
    countryNames: (get('country_names') as string[] | null) ?? null,
    imageUrl: (get('image_url') as string | null) ?? null,
    metadata: (get('metadata') as Record<string, unknown> | null) ?? null,
  };
}

function snapshotFromParams(params: ExperienceUpsertParams): ExperienceSnapshot {
  return {
    name: params.name,
    nameLocal: params.nameLocal,
    description: params.description,
    shortDescription: params.shortDescription,
    category: params.category,
    tags: params.tags,
    lon: params.lon,
    lat: params.lat,
    countryCodes: params.countryCodes,
    countryNames: params.countryNames,
    imageUrl: params.imageUrl,
    metadata: params.metadata,
  };
}

/**
 * Read the stored row and diff it against the incoming record without writing.
 * Backs dry runs: the preview must be able to say what would change without
 * changing it.
 */
async function previewUpsert(params: ExperienceUpsertParams): Promise<UpsertOutcome> {
  const result = await pool.query(
    `SELECT id, curated_fields, ${SNAPSHOT_COLUMNS.join(', ')},
            ST_X(location) AS lon, ST_Y(location) AS lat
     FROM experiences
     WHERE category_id = $1 AND external_id = $2`,
    [params.categoryId, params.externalId]
  );

  const incoming = snapshotFromParams(params);

  if (result.rows.length === 0) {
    return {
      experienceId: 0,
      changeSet: computeChangeSet(null, incoming, []),
      nameSnapshot: params.name,
    };
  }

  const row = result.rows[0];
  return {
    experienceId: row.id,
    changeSet: computeChangeSet(snapshotFromRow(row, ''), incoming, row.curated_fields ?? []),
    nameSnapshot: params.name,
  };
}

/**
 * Upsert an experience with curated_fields-aware conflict handling, returning
 * both the prior and resulting state.
 *
 * The `before` CTE is what makes provenance possible: `RETURNING` alone can only
 * hand back the row as it now stands, so the previous values are captured in the
 * same statement or they are gone.
 */
export async function upsertExperienceRecord(
  params: ExperienceUpsertParams,
  options: { dryRun?: boolean; syncLogId?: number | null } = {},
): Promise<UpsertOutcome> {
  if (options.dryRun) return previewUpsert(params);

  const syncLogId = options.syncLogId ?? null;

  const result = await pool.query(
    `WITH before AS (
      SELECT id, curated_fields, ${SNAPSHOT_COLUMNS.join(', ')},
             ST_X(location) AS lon, ST_Y(location) AS lat
      FROM experiences
      WHERE category_id = $1 AND external_id = $2
    ), ins AS (
      INSERT INTO experiences (
        category_id, external_id, name, name_local, description, short_description,
        category, tags, location, country_codes, country_names, image_url, metadata,
        first_seen_sync_log_id, last_seen_sync_log_id, last_seen_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        ST_SetSRID(ST_MakePoint($9, $10), 4326),
        $11, $12, $13, $14, $15, $15, NOW(), NOW(), NOW()
      )
      ON CONFLICT (category_id, external_id) DO UPDATE SET
        name = CASE WHEN experiences.curated_fields ? 'name' THEN experiences.name ELSE EXCLUDED.name END,
        name_local = CASE WHEN experiences.curated_fields ? 'name_local' THEN experiences.name_local ELSE EXCLUDED.name_local END,
        description = CASE WHEN experiences.curated_fields ? 'description' THEN experiences.description ELSE EXCLUDED.description END,
        short_description = CASE WHEN experiences.curated_fields ? 'short_description' THEN experiences.short_description ELSE EXCLUDED.short_description END,
        category = CASE WHEN experiences.curated_fields ? 'category' THEN experiences.category ELSE EXCLUDED.category END,
        tags = CASE WHEN experiences.curated_fields ? 'tags' THEN experiences.tags ELSE EXCLUDED.tags END,
        location = CASE WHEN experiences.curated_fields ? 'location' THEN experiences.location ELSE EXCLUDED.location END,
        country_codes = CASE WHEN experiences.curated_fields ? 'country_codes' THEN experiences.country_codes ELSE EXCLUDED.country_codes END,
        country_names = CASE WHEN experiences.curated_fields ? 'country_names' THEN experiences.country_names ELSE EXCLUDED.country_names END,
        image_url = CASE WHEN experiences.curated_fields ? 'image_url' THEN experiences.image_url ELSE EXCLUDED.image_url END,
        metadata = CASE WHEN experiences.curated_fields ? 'metadata' THEN experiences.metadata ELSE EXCLUDED.metadata END,
        last_seen_sync_log_id = COALESCE(EXCLUDED.last_seen_sync_log_id, experiences.last_seen_sync_log_id),
        last_seen_at = NOW(),
        missing_since = NULL,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted, curated_fields, ${SNAPSHOT_COLUMNS.join(', ')},
                ST_X(location) AS lon, ST_Y(location) AS lat
    )
    SELECT ins.*,
           ${SNAPSHOT_COLUMNS.map(c => `before.${c} AS old_${c}`).join(', ')},
           before.lon AS old_lon, before.lat AS old_lat
    FROM ins LEFT JOIN before ON before.id = ins.id`,
    [
      params.categoryId,
      params.externalId,
      params.name,
      JSON.stringify(params.nameLocal),
      params.description,
      params.shortDescription,
      params.category,
      JSON.stringify(params.tags),
      params.lon,
      params.lat,
      params.countryCodes,
      params.countryNames,
      params.imageUrl,
      JSON.stringify(params.metadata),
      syncLogId,
    ]
  );

  const row = result.rows[0];
  const incoming = snapshotFromParams(params);
  const before = row.inserted ? null : snapshotFromRow(row, 'old_');

  return {
    experienceId: row.id,
    changeSet: computeChangeSet(before, incoming, row.curated_fields ?? []),
    nameSnapshot: params.name,
  };
}
```

Note `missing_since = NULL` in the `DO UPDATE`: a row the source produced again is, by definition, no longer missing. Restoring `source_membership` is deliberately *not* done here — only a curator lifts `former`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/services/sync/syncUtils.upsert.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sync/syncUtils.ts backend/src/services/sync/syncUtils.upsert.test.ts
git commit -m "back: Keep the row's prior state through the upsert that replaces it."
```

---

### Task 4: Persisting the changeset

**Files:**
- Create: `backend/src/services/sync/changeRecorder.ts`
- Test: `backend/src/services/sync/changeRecorder.test.ts`

**Interfaces:**
- Consumes: `FieldChange`, `FieldSignificance` from Task 2
- Produces:
  - `interface ChangeRecord { syncLogId: number; experienceId: number | null; externalId: string; nameSnapshot: string | null; changeType: 'created' | 'updated' | 'missing' | 'returned' | 'failed'; changedFields: FieldChange[] | null; significance: FieldSignificance | null; error: string | null }`
  - `function recordSyncChanges(records: ChangeRecord[]): Promise<void>`
  - `const CHANGE_INSERT_BATCH_SIZE = 500`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/sync/changeRecorder.test.ts`:

```typescript
/**
 * Tests for changeset persistence.
 *
 * A run can produce thousands of rows, so these go in batched multi-row inserts
 * rather than one statement per object.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { recordSyncChanges, CHANGE_INSERT_BATCH_SIZE, type ChangeRecord } from './changeRecorder.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function record(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    syncLogId: 9,
    experienceId: 501,
    externalId: '156',
    nameSnapshot: 'Serengeti National Park',
    changeType: 'updated',
    changedFields: [{ field: 'shortDescription', old: 'a', new: 'b', significance: 'minor', curatedConflict: false }],
    significance: 'minor',
    error: null,
    ...overrides,
  };
}

describe('recordSyncChanges', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('writes nothing when there is nothing to write', async () => {
    await recordSyncChanges([]);

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('inserts one parameterised row per record', async () => {
    await recordSyncChanges([record(), record({ externalId: '157', experienceId: 502 })]);

    expect(mockedQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO experience_sync_changes');
    expect(params).toHaveLength(16);
    expect(params).toContain('156');
    expect(params).toContain('157');
  });

  it('serialises changed fields as JSON', async () => {
    await recordSyncChanges([record()]);

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    const serialised = params.find(p => typeof p === 'string' && p.startsWith('[{'));
    expect(serialised).toBeDefined();
    expect(JSON.parse(String(serialised))[0].field).toBe('shortDescription');
  });

  it('splits large runs into batches', async () => {
    const many = Array.from({ length: CHANGE_INSERT_BATCH_SIZE + 3 }, (_, i) =>
      record({ externalId: String(i), experienceId: i }));

    await recordSyncChanges(many);

    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('accepts a failed record with no experience id', async () => {
    await recordSyncChanges([record({
      changeType: 'failed',
      experienceId: null,
      changedFields: null,
      significance: null,
      error: 'No valid coordinates',
    })]);

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('No valid coordinates');
    expect(params).toContain(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/services/sync/changeRecorder.test.ts`
Expected: FAIL — `Cannot find module './changeRecorder.js'`.

- [ ] **Step 3: Implement the recorder**

Create `backend/src/services/sync/changeRecorder.ts`:

```typescript
/**
 * Changeset persistence for sync runs.
 *
 * One row per object a run touched — created, changed, gone, returned, or
 * failed. Rows that passed through unchanged are counted on the log and not
 * written here: a UNESCO run would otherwise store 1247 rows of noise to
 * preserve the few dozen that carry information.
 */

import { pool } from '../../db/index.js';
import type { FieldChange, FieldSignificance } from './changeSet.js';

export interface ChangeRecord {
  syncLogId: number;
  experienceId: number | null;
  externalId: string;
  nameSnapshot: string | null;
  changeType: 'created' | 'updated' | 'missing' | 'returned' | 'failed';
  changedFields: FieldChange[] | null;
  significance: FieldSignificance | null;
  error: string | null;
}

/** Postgres caps a statement at 65535 parameters; 500 rows × 8 stays far below. */
export const CHANGE_INSERT_BATCH_SIZE = 500;

const COLUMNS_PER_ROW = 8;

async function insertBatch(batch: ChangeRecord[]): Promise<void> {
  const values: unknown[] = [];
  const tuples = batch.map((record, index) => {
    const base = index * COLUMNS_PER_ROW;
    values.push(
      record.syncLogId,
      record.experienceId,
      record.externalId,
      record.nameSnapshot,
      record.changeType,
      record.changedFields ? JSON.stringify(record.changedFields) : null,
      record.significance,
      record.error,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8})`;
  });

  await pool.query(
    `INSERT INTO experience_sync_changes
       (sync_log_id, experience_id, external_id, name_snapshot, change_type, changed_fields, significance, error)
     VALUES ${tuples.join(', ')}`,
    values
  );
}

/**
 * Persist the per-object records for a run, in batches.
 */
export async function recordSyncChanges(records: ChangeRecord[]): Promise<void> {
  for (let i = 0; i < records.length; i += CHANGE_INSERT_BATCH_SIZE) {
    await insertBatch(records.slice(i, i + CHANGE_INSERT_BATCH_SIZE));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/services/sync/changeRecorder.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sync/changeRecorder.ts backend/src/services/sync/changeRecorder.test.ts
git commit -m "back: Store what a run did to each object, not just the totals."
```

---

### Task 5: Missing detection and its safeguards

**Files:**
- Create: `backend/src/services/sync/missingDetection.ts`
- Test: `backend/src/services/sync/missingDetection.test.ts`

**Interfaces:**
- Consumes: `ChangeRecord`, `recordSyncChanges` from Task 4
- Produces:
  - `type SourceCompleteness = 'authoritative' | 'ranked'`
  - `interface MissingDetectionInput { sourceCompleteness: SourceCompleteness; errors: number; cancelled: boolean; seenCount: number; previousActiveCount: number }`
  - `function missingDetectionSkipReason(input: MissingDetectionInput): string | null`
  - `function flagMissingExperiences(categoryId: number, syncLogId: number, dryRun: boolean): Promise<ChangeRecord[]>`
  - `function countActiveExperiences(categoryId: number): Promise<number>`
  - `const MISSING_DETECTION_MIN_COVERAGE = 0.9`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/sync/missingDetection.test.ts`:

```typescript
/**
 * Tests for missing-object detection.
 *
 * The guards matter more than the detection: a source outage that returns half
 * the collection must never be read as half the collection disappearing. The
 * partial UNESCO run of 26 July 2026 is the shape of failure being defended
 * against.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  missingDetectionSkipReason,
  flagMissingExperiences,
  countActiveExperiences,
  MISSING_DETECTION_MIN_COVERAGE,
  type MissingDetectionInput,
} from './missingDetection.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function input(overrides: Partial<MissingDetectionInput> = {}): MissingDetectionInput {
  return {
    sourceCompleteness: 'authoritative',
    errors: 0,
    cancelled: false,
    seenCount: 1247,
    previousActiveCount: 1247,
    ...overrides,
  };
}

describe('missingDetectionSkipReason', () => {
  it('allows detection on a clean, complete run', () => {
    expect(missingDetectionSkipReason(input())).toBeNull();
  });

  it('refuses on a ranked source', () => {
    const reason = missingDetectionSkipReason(input({ sourceCompleteness: 'ranked' }));

    expect(reason).toContain('ranked');
  });

  it('refuses when the run had errors', () => {
    const reason = missingDetectionSkipReason(input({ errors: 1 }));

    expect(reason).toContain('error');
  });

  it('refuses when the run was cancelled', () => {
    expect(missingDetectionSkipReason(input({ cancelled: true }))).toContain('cancelled');
  });

  it('refuses when coverage fell below the floor', () => {
    const reason = missingDetectionSkipReason(input({ seenCount: 1000 }));

    expect(reason).toContain('coverage');
  });

  it('allows detection at exactly the coverage floor', () => {
    const seenCount = Math.ceil(1247 * MISSING_DETECTION_MIN_COVERAGE);

    expect(missingDetectionSkipReason(input({ seenCount }))).toBeNull();
  });

  it('allows detection for a category that was empty before', () => {
    expect(missingDetectionSkipReason(input({ seenCount: 0, previousActiveCount: 0 }))).toBeNull();
  });
});

describe('flagMissingExperiences', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('stamps missing_since and returns one record per row', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 77, external_id: '1234', name: 'Dresden Elbe Valley' },
        { id: 78, external_id: '1235', name: 'Arabian Oryx Sanctuary' },
      ],
    });

    const records = await flagMissingExperiences(1, 9, false);

    expect(String(mockedQuery.mock.calls[0][0])).toContain('UPDATE experiences');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      syncLogId: 9,
      experienceId: 77,
      externalId: '1234',
      nameSnapshot: 'Dresden Elbe Valley',
      changeType: 'missing',
    });
  });

  it('only reads in dry-run mode', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 77, external_id: '1234', name: 'Dresden Elbe Valley' }] });

    const records = await flagMissingExperiences(1, 9, true);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('SELECT');
    expect(sql).not.toContain('UPDATE');
    expect(records).toHaveLength(1);
  });
});

describe('countActiveExperiences', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('counts only rows still considered present', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1247' }] });

    const count = await countActiveExperiences(1);

    expect(count).toBe(1247);
    expect(String(mockedQuery.mock.calls[0][0])).toContain("source_membership = 'present'");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/services/sync/missingDetection.test.ts`
Expected: FAIL — `Cannot find module './missingDetection.js'`.

- [ ] **Step 3: Implement the module**

Create `backend/src/services/sync/missingDetection.ts`:

```typescript
/**
 * Detection of objects the source stopped listing.
 *
 * An upsert never deletes, so a delisted site would otherwise sit in the
 * database forever, indistinguishable from a current one. Flagging it is only
 * safe under three conditions, because the alternative reading of "not in this
 * run" is "this run did not see everything":
 *
 *   1. the source hands over its whole collection (UNESCO does; a top-200
 *      Wikidata query does not — falling out of a ranking is not a delisting)
 *   2. the run completed without errors and was not cancelled
 *   3. it saw at least 90% of what was there before
 *
 * The flag is a machine observation. Turning it into `former` or `lost` is a
 * curator's decision, made elsewhere.
 */

import { pool } from '../../db/index.js';
import type { ChangeRecord } from './changeRecorder.js';

export type SourceCompleteness = 'authoritative' | 'ranked';

export interface MissingDetectionInput {
  sourceCompleteness: SourceCompleteness;
  errors: number;
  cancelled: boolean;
  /** Objects this run actually processed — not what it fetched. */
  seenCount: number;
  previousActiveCount: number;
}

export const MISSING_DETECTION_MIN_COVERAGE = 0.9;

/**
 * Why detection must not run, or null when it may.
 */
export function missingDetectionSkipReason(input: MissingDetectionInput): string | null {
  if (input.sourceCompleteness !== 'authoritative') {
    return 'source is ranked, not authoritative: absence means a lower rank, not a delisting';
  }
  if (input.cancelled) {
    return 'run was cancelled before it could see the whole collection';
  }
  if (input.errors > 0) {
    return `run finished with ${input.errors} error(s), so absence may be a fetch failure`;
  }
  if (input.previousActiveCount === 0) {
    return null;
  }
  const coverage = input.seenCount / input.previousActiveCount;
  if (coverage < MISSING_DETECTION_MIN_COVERAGE) {
    return `coverage ${(coverage * 100).toFixed(1)}% is below the ${MISSING_DETECTION_MIN_COVERAGE * 100}% floor`;
  }
  return null;
}

/**
 * Count the rows a run is expected to see again.
 */
export async function countActiveExperiences(categoryId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM experiences
     WHERE category_id = $1 AND source_membership = 'present'`,
    [categoryId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Mark every still-present row this run did not touch, and describe each one.
 *
 * In dry-run mode the same rows are identified and reported, but nothing is
 * stamped — the preview says what would be flagged without flagging it.
 */
export async function flagMissingExperiences(
  categoryId: number,
  syncLogId: number,
  dryRun: boolean,
): Promise<ChangeRecord[]> {
  const predicate = `category_id = $1
      AND source_membership = 'present'
      AND missing_since IS NULL
      AND (last_seen_sync_log_id IS DISTINCT FROM $2)`;

  const result = dryRun
    ? await pool.query(
        `SELECT id, external_id, name FROM experiences WHERE ${predicate}`,
        [categoryId, syncLogId]
      )
    : await pool.query(
        `UPDATE experiences SET missing_since = NOW()
         WHERE ${predicate}
         RETURNING id, external_id, name`,
        [categoryId, syncLogId]
      );

  return result.rows.map((row: { id: number; external_id: string; name: string }) => ({
    syncLogId,
    experienceId: row.id,
    externalId: row.external_id,
    nameSnapshot: row.name,
    changeType: 'missing' as const,
    changedFields: null,
    significance: null,
    error: null,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/services/sync/missingDetection.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sync/missingDetection.ts backend/src/services/sync/missingDetection.test.ts
git commit -m "back: Notice what a source stopped listing, but only when sure."
```

---

### Task 6: Orchestrator — counts, changeset, dry run

**Files:**
- Modify: `backend/src/services/sync/syncOrchestrator.ts`
- Modify: `backend/src/services/sync/types.ts:8-19`
- Modify: `backend/src/services/sync/syncUtils.ts:139-168` (`updateSyncLog`), `:122-133` (`createSyncLog`)
- Test: `backend/src/services/sync/syncOrchestrator.test.ts`

**Interfaces:**
- Consumes: `recordSyncChanges`, `ChangeRecord` (Task 4); `missingDetectionSkipReason`, `flagMissingExperiences`, `countActiveExperiences`, `SourceCompleteness` (Task 5); `ChangeSetResult` (Task 2)
- Produces:
  - `interface ProcessItemResult { outcome: 'created' | 'updated' | 'unchanged'; experienceId: number | null; nameSnapshot: string; changeSet: ChangeSetResult }`
  - `SyncServiceConfig<T>` gains `sourceCompleteness: SourceCompleteness` and `processItem: (item: T, progress: SyncProgress, context: SyncRunContext) => Promise<ProcessItemResult>`
  - `interface SyncRunContext { dryRun: boolean; syncLogId: number | null }`
  - `orchestrateSync(config, triggeredBy, options?: { force?: boolean; dryRun?: boolean })`
  - `SyncProgress` gains `unchanged: number`, `missing: number`, `curatedConflicts: number`, `dryRun: boolean`
  - `createSyncLog(categoryId, triggeredBy, isDryRun?)`
  - `updateSyncLog(categoryId, logId, status, stats, errorDetails?)` where `stats` gains `unchanged`, `missing`, `curatedConflicts`, `detectionSkippedReason`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/services/sync/syncOrchestrator.test.ts` (and extend the existing `vi.mock` of `./syncUtils.js` with nothing new — it already mocks what is needed; add mocks for the two new modules at the top of the file):

```typescript
vi.mock('./changeRecorder.js', () => ({
  recordSyncChanges: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
}));

import { recordSyncChanges } from './changeRecorder.js';
import { missingDetectionSkipReason, flagMissingExperiences } from './missingDetection.js';
```

Then add these tests. Note `makeConfig` must be updated to return the new `processItem` shape and `sourceCompleteness`:

```typescript
function processed(outcome: 'created' | 'updated' | 'unchanged', overrides = {}) {
  return {
    outcome,
    experienceId: 501,
    nameSnapshot: 'Item',
    changeSet: {
      changeType: outcome,
      changedFields: outcome === 'updated'
        ? [{ field: 'shortDescription', old: 'a', new: 'b', significance: 'minor' as const, curatedConflict: false }]
        : [],
      significance: outcome === 'updated' ? ('minor' as const) : null,
      curatedConflicts: [],
    },
    ...overrides,
  };
}

describe('orchestrateSync changeset recording', () => {
  it('counts unchanged rows separately from updated ones', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('updated'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'success',
      expect.objectContaining({ created: 0, updated: 1, unchanged: 1 }),
      undefined,
    );
  });

  it('does not record unchanged rows in the changeset', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changeType).toBe('created');
  });

  it('records a failed item with its error and no experience id', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded[0]).toMatchObject({
      changeType: 'failed',
      experienceId: null,
      error: 'No valid coordinates',
    });
  });

  it('counts curated conflicts across the run', async () => {
    const conflicted = processed('unchanged');
    conflicted.changeSet.curatedConflicts = [
      { field: 'name', old: 'ours', new: 'theirs', significance: 'major', curatedConflict: true },
    ];
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValue(conflicted),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ curatedConflicts: 2 }),
      undefined,
    );
  });

  it('flags missing objects when the guards allow it', async () => {
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      syncLogId: 42, experienceId: 77, externalId: '1234', nameSnapshot: 'Dresden Elbe Valley',
      changeType: 'missing', changedFields: null, significance: null, error: null,
    }]);

    await orchestrateSync(makeConfig(), 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ missing: 1 }),
      undefined,
    );
  });

  it('skips missing detection and records why', async () => {
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValueOnce('source is ranked');

    await orchestrateSync(makeConfig(), 1);

    expect(flagMissingExperiences).not.toHaveBeenCalled();
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ detectionSkippedReason: 'source is ranked' }),
      undefined,
    );
  });

  it('marks the log as a dry run and tells processItem', async () => {
    const config = makeConfig();

    await orchestrateSync(config, 1, { dryRun: true });

    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1, true);
    expect(config.processItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true, syncLogId: 42 }),
    );
  });

  it('refuses to combine a dry run with force cleanup', async () => {
    await expect(orchestrateSync(makeConfig(), 1, { force: true, dryRun: true }))
      .rejects.toThrow(/dry run/i);
  });
});
```

Update the existing `makeConfig` helper to:

```typescript
function makeConfig(overrides?: Partial<SyncServiceConfig<TestItem>>): SyncServiceConfig<TestItem> {
  return {
    categoryId: TEST_CATEGORY_ID,
    logPrefix: '[Test Sync]',
    sourceCompleteness: 'authoritative',
    fetchItems: vi.fn().mockResolvedValue({ items: [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }], fetchedCount: 2 }),
    processItem: vi.fn().mockResolvedValue(processed('created')),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
    ...overrides,
  };
}
```

The three pre-existing tests that assert `updateSyncLog` was called with `{ fetched, created, updated, errors }` must be updated to `expect.objectContaining({ ... })` since the stats object now carries more keys.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/services/sync/syncOrchestrator.test.ts`
Expected: FAIL — `orchestrateSync` takes a boolean third argument, `SyncProgress` has no `unchanged`.

- [ ] **Step 3: Extend `SyncProgress`**

In `backend/src/services/sync/types.ts`, replace the `SyncProgress` interface with:

```typescript
export interface SyncProgress {
  cancel: boolean;
  status: 'fetching' | 'processing' | 'assigning' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string;
  progress: number;
  total: number;
  created: number;
  updated: number;
  /** Rows the run touched that turned out identical — counted, never stored. */
  unchanged: number;
  /** Rows still present that this run did not see. */
  missing: number;
  /** Field-level divergences the curated_fields guard refused to apply. */
  curatedConflicts: number;
  errors: number;
  currentItem: string;
  logId: number | null;
  /** A preview run: the changeset is computed, experiences are not written. */
  dryRun: boolean;
}
```

- [ ] **Step 4: Extend the sync log helpers**

In `backend/src/services/sync/syncUtils.ts`, replace `createSyncLog` and `updateSyncLog` with:

```typescript
/**
 * Create a new sync log entry with status 'running'.
 */
export async function createSyncLog(
  categoryId: number,
  triggeredBy: number | null,
  isDryRun: boolean = false,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status, is_dry_run)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [categoryId, triggeredBy, isDryRun]
  );
  return result.rows[0].id;
}

export interface SyncLogStats {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  curatedConflicts: number;
  errors: number;
  detectionSkippedReason?: string | null;
}

/**
 * Update a sync log entry with final status and stats.
 *
 * A dry run leaves `experience_categories.last_sync_*` alone: it did not sync
 * anything, and claiming otherwise would make the next run's provenance lie.
 */
export async function updateSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  stats: SyncLogStats,
  errorDetails?: unknown[],
): Promise<void> {
  const result = await pool.query(
    `UPDATE experience_sync_logs SET
      completed_at = NOW(),
      status = $2,
      total_fetched = $3,
      total_created = $4,
      total_updated = $5,
      total_errors = $6,
      error_details = $7,
      total_unchanged = $8,
      total_missing = $9,
      total_curated_conflicts = $10,
      detection_skipped_reason = $11
     WHERE id = $1
     RETURNING is_dry_run`,
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null,
     stats.unchanged, stats.missing, stats.curatedConflicts,
     stats.detectionSkippedReason ?? null]
  );

  if (result.rows[0]?.is_dry_run) return;

  await pool.query(
    `UPDATE experience_categories SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [categoryId, status, status === 'failed' ? 'See sync log for details' : null]
  );
}
```

- [ ] **Step 5: Rewrite the orchestrator**

In `backend/src/services/sync/syncOrchestrator.ts`, replace the imports, the config/result types, `initSyncProgress`, `processItemsLoop`, `recordSyncFailure` and `orchestrateSync` with:

```typescript
import { createSyncLog, updateSyncLog, cleanupCategoryData } from './syncUtils.js';
import { recordSyncChanges, type ChangeRecord } from './changeRecorder.js';
import {
  missingDetectionSkipReason,
  flagMissingExperiences,
  countActiveExperiences,
  type SourceCompleteness,
} from './missingDetection.js';
import type { ChangeSetResult } from './changeSet.js';
import type { SyncProgress } from './types.js';
import { runningSyncs } from './types.js';

export interface ErrorDetail {
  externalId: string;
  error: string;
}

export interface FetchResult<T> {
  items: T[];
  fetchedCount: number;
}

/** What a run is doing, handed to every `processItem` call. */
export interface SyncRunContext {
  dryRun: boolean;
  syncLogId: number | null;
}

export interface ProcessItemResult {
  outcome: 'created' | 'updated' | 'unchanged';
  experienceId: number | null;
  nameSnapshot: string;
  changeSet: ChangeSetResult;
}

export interface SyncServiceConfig<T> {
  categoryId: number;
  logPrefix: string;
  /**
   * Whether the source hands over its whole collection. Only `authoritative`
   * sources can have absence read as a delisting — a top-N Wikidata query
   * drops objects for reasons that have nothing to do with them existing.
   */
  sourceCompleteness: SourceCompleteness;
  fetchItems: (progress: SyncProgress, errorDetails: ErrorDetail[]) => Promise<FetchResult<T>>;
  processItem: (item: T, progress: SyncProgress, context: SyncRunContext) => Promise<ProcessItemResult>;
  getItemName: (item: T) => string;
  getItemId: (item: T) => string;
  cleanup?: (progress: SyncProgress) => Promise<void>;
}

function initSyncProgress(dryRun: boolean): SyncProgress {
  return {
    cancel: false,
    status: 'fetching',
    statusMessage: dryRun ? 'Initializing preview...' : 'Initializing...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun,
  };
}

async function processItemsLoop<T>(
  config: SyncServiceConfig<T>,
  items: T[],
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
  changes: ChangeRecord[],
  context: SyncRunContext,
): Promise<void> {
  progress.status = 'processing';
  progress.total = items.length;
  progress.progress = 0;

  for (let i = 0; i < items.length; i++) {
    if (progress.cancel) throw new Error('Sync cancelled');
    const item = items[i];
    progress.currentItem = config.getItemName(item);
    progress.statusMessage = `Processing ${i + 1}/${items.length}: ${progress.currentItem}`;
    try {
      const result = await config.processItem(item, progress, context);
      progress.curatedConflicts += result.changeSet.curatedConflicts.length;

      if (result.outcome === 'created') progress.created++;
      else if (result.outcome === 'updated') progress.updated++;
      else progress.unchanged++;

      // Unchanged rows are counted, not stored: the signal would drown in them.
      if (result.outcome !== 'unchanged' && progress.logId !== null) {
        changes.push({
          syncLogId: progress.logId,
          experienceId: result.experienceId,
          externalId: config.getItemId(item),
          nameSnapshot: result.nameSnapshot,
          changeType: result.outcome,
          changedFields: result.changeSet.changedFields,
          significance: result.changeSet.significance,
          error: null,
        });
      }
    } catch (err) {
      progress.errors++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ externalId: config.getItemId(item), error: errorMsg });
      if (progress.logId !== null) {
        changes.push({
          syncLogId: progress.logId,
          experienceId: null,
          externalId: config.getItemId(item),
          nameSnapshot: config.getItemName(item),
          changeType: 'failed',
          changedFields: null,
          significance: null,
          error: errorMsg,
        });
      }
      console.error('%s Error processing %s:', config.logPrefix, config.getItemId(item), errorMsg);
    }
    progress.progress = i + 1;
  }
}

/**
 * Flag what the source stopped listing, unless a guard says the run cannot be
 * trusted to know. Returns the reason detection was skipped, if it was.
 */
async function detectMissing<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  previousActiveCount: number,
  changes: ChangeRecord[],
): Promise<string | null> {
  const skipReason = missingDetectionSkipReason({
    sourceCompleteness: config.sourceCompleteness,
    errors: progress.errors,
    cancelled: progress.cancel,
    seenCount: progress.created + progress.updated + progress.unchanged,
    previousActiveCount,
  });

  if (skipReason !== null || progress.logId === null) return skipReason;

  const missing = await flagMissingExperiences(config.categoryId, progress.logId, progress.dryRun);
  progress.missing = missing.length;
  changes.push(...missing);
  return null;
}

async function recordSyncFailure<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  err: unknown,
  errorDetails: ErrorDetail[],
  changes: ChangeRecord[],
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  progress.status = progress.cancel ? 'cancelled' : 'failed';
  progress.statusMessage = errorMsg;

  if (progress.logId) {
    errorDetails.push({ externalId: 'system', error: errorMsg });
    await recordSyncChanges(changes);
    await updateSyncLog(config.categoryId, progress.logId, progress.status, {
      fetched: progress.total,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      errors: progress.errors,
    }, errorDetails);
  }

  if (progress.status === 'cancelled') {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- logPrefix is a module constant supplied by the sync services
    console.log(`${config.logPrefix} Cancelled:`, errorMsg);
  } else {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- logPrefix is a module constant supplied by the sync services
    console.error(`${config.logPrefix} Failed:`, errorMsg);
  }
}

/**
 * Run a sync operation with full lifecycle management.
 *
 * A dry run walks the same path — same fetch, same diff, same changeset — and
 * writes everything except the experiences themselves. That makes a real source
 * delta reviewable without spending it.
 */
export async function orchestrateSync<T>(
  config: SyncServiceConfig<T>,
  triggeredBy: number | null,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  const { categoryId, logPrefix } = config;
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;

  if (force && dryRun) {
    throw new Error(`${logPrefix} cannot run a dry run in force mode: force deletes before it previews`);
  }

  if (isSyncStillRunning(runningSyncs.get(categoryId))) {
    throw new Error(`${logPrefix} sync already in progress`);
  }

  const progress = initSyncProgress(dryRun);
  runningSyncs.set(categoryId, progress);
  const errorDetails: ErrorDetail[] = [];
  const changes: ChangeRecord[] = [];

  try {
    progress.logId = await createSyncLog(categoryId, triggeredBy, dryRun);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}${dryRun ? ' [DRY RUN]' : ''}`);

    const previousActiveCount = await countActiveExperiences(categoryId);

    if (force) await runForceCleanup(config, progress);

    const { items, fetchedCount } = await config.fetchItems(progress, errorDetails);
    progress.errors = errorDetails.length;

    const context: SyncRunContext = { dryRun, syncLogId: progress.logId };
    await processItemsLoop(config, items, progress, errorDetails, changes, context);

    const detectionSkippedReason = await detectMissing(config, progress, previousActiveCount, changes);

    const finalStatus = computeFinalStatus(progress);
    progress.status = 'complete';
    progress.statusMessage = `Complete: ${progress.created} created, ${progress.updated} updated, ${progress.unchanged} unchanged, ${progress.missing} missing, ${progress.errors} errors`;

    await recordSyncChanges(changes);
    await updateSyncLog(categoryId, progress.logId, finalStatus, {
      fetched: fetchedCount,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      errors: progress.errors,
      detectionSkippedReason,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`${logPrefix} Complete: created=${progress.created}, updated=${progress.updated}, unchanged=${progress.unchanged}, missing=${progress.missing}, errors=${progress.errors}`);
  } catch (err) {
    await recordSyncFailure(config, progress, err, errorDetails, changes);
    throw err;
  } finally {
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(categoryId) === thisProgress) {
        runningSyncs.delete(categoryId);
      }
    }, 30000);
  }
}
```

- [ ] **Step 6: Fix `computeFinalStatus` for runs that changed nothing**

The existing implementation reads `progress.created + progress.updated === 0` as "nothing worked". Now that identical rows are counted separately, a run where every object was already up to date and one item failed would be reported as `failed` despite having seen the whole collection. In `backend/src/services/sync/syncOrchestrator.ts`, replace it with:

```typescript
function computeFinalStatus(progress: SyncProgress): 'success' | 'partial' | 'failed' {
  if (progress.errors === 0) return 'success';
  // A run that touched nothing at all failed; one that found everything already
  // current did not, even if a straggler errored.
  const seen = progress.created + progress.updated + progress.unchanged;
  return seen === 0 ? 'failed' : 'partial';
}
```

Add the covering test to `syncOrchestrator.test.ts`:

```typescript
  it('calls a run partial, not failed, when everything was already current', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('unchanged'))
        .mockRejectedValueOnce(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'partial', expect.objectContaining({ unchanged: 1, errors: 1 }), expect.anything(),
    );
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/services/sync/syncOrchestrator.test.ts`
Expected: PASS — the nine new tests plus the pre-existing ones.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/sync/syncOrchestrator.ts backend/src/services/sync/syncOrchestrator.test.ts backend/src/services/sync/types.ts backend/src/services/sync/syncUtils.ts
git commit -m "back: Have a run report what it changed, what it left, and what vanished."
```

---

### Task 7: Sync services on the new contract, plus the fixture source

**Files:**
- Modify: `backend/src/services/sync/unescoSyncService.ts:281-303`, `:358-385`
- Modify: `backend/src/services/sync/museumSyncService.ts` (its `upsert*` function and `orchestrateSync` call)
- Modify: `backend/src/services/sync/landmarkSyncService.ts:184`, `:288`
- Create: `backend/src/services/sync/fixtureSource.ts`
- Test: `backend/src/services/sync/fixtureSource.test.ts`

**Interfaces:**
- Consumes: `ProcessItemResult`, `SyncRunContext` (Task 6); `upsertExperienceRecord` (Task 3)
- Produces:
  - `function fixtureSourcePath(): string | null`
  - `function readFixtureRecords<T>(fileName: string): Promise<T[] | null>`
  - `const FIXTURE_ENV_VAR = 'SYNC_SOURCE_FIXTURE'`

- [ ] **Step 1: Write the failing tests for the fixture source**

Create `backend/src/services/sync/fixtureSource.test.ts`:

```typescript
/**
 * Tests for the development fixture source.
 *
 * This exists so a sync can be exercised without hammering UNESCO or Wikidata.
 * It must be inert in production and must not read outside its directory —
 * an env var is operator-controlled, but a path is still a path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { fixtureSourcePath, readFixtureRecords, FIXTURE_ENV_VAR } from './fixtureSource.js';

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

describe('fixtureSourcePath', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedReadFile.mockReset();
    delete process.env[FIXTURE_ENV_VAR];
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is inactive when the variable is unset', () => {
    expect(fixtureSourcePath()).toBeNull();
  });

  it('is inactive in production even when the variable is set', () => {
    process.env.NODE_ENV = 'production';
    process.env[FIXTURE_ENV_VAR] = '/srv/fixtures';

    expect(fixtureSourcePath()).toBeNull();
  });

  it('returns the configured directory outside production', () => {
    process.env[FIXTURE_ENV_VAR] = '/srv/fixtures';

    expect(fixtureSourcePath()).toBe('/srv/fixtures');
  });
});

describe('readFixtureRecords', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedReadFile.mockReset();
    process.env.NODE_ENV = 'test';
    process.env[FIXTURE_ENV_VAR] = '/srv/fixtures';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when no fixture directory is configured', async () => {
    delete process.env[FIXTURE_ENV_VAR];

    expect(await readFixtureRecords('unesco-gen1.json')).toBeNull();
  });

  it('reads and parses a fixture file', async () => {
    mockedReadFile.mockResolvedValueOnce('[{"id_no": "156"}]');

    const records = await readFixtureRecords<{ id_no: string }>('unesco-gen1.json');

    expect(records).toEqual([{ id_no: '156' }]);
    expect(String(mockedReadFile.mock.calls[0][0])).toBe('/srv/fixtures/unesco-gen1.json');
  });

  it('refuses a file name that escapes the fixture directory', async () => {
    await expect(readFixtureRecords('../../etc/passwd')).rejects.toThrow(/fixture/i);
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('refuses a file name with a path separator', async () => {
    await expect(readFixtureRecords('nested/file.json')).rejects.toThrow(/fixture/i);
    expect(mockedReadFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/services/sync/fixtureSource.test.ts`
Expected: FAIL — `Cannot find module './fixtureSource.js'`.

- [ ] **Step 3: Implement the fixture source**

Create `backend/src/services/sync/fixtureSource.ts`:

```typescript
/**
 * Local fixture source for sync development.
 *
 * Wikidata answers in tens of seconds and rate-limits; UNESCO's list is a single
 * large fetch. Neither makes a workable inner loop, and neither can be told to
 * produce "the same list, minus one object" so a delisting can be exercised.
 * Pointing SYNC_SOURCE_FIXTURE at a directory of JSON files does both.
 *
 * Refused in production: this substitutes the source of truth, which is exactly
 * what must never be possible on real data.
 */

import { readFile } from 'node:fs/promises';

export const FIXTURE_ENV_VAR = 'SYNC_SOURCE_FIXTURE';

/**
 * The configured fixture directory, or null when fixtures are not in play.
 */
export function fixtureSourcePath(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  return process.env[FIXTURE_ENV_VAR] || null;
}

/**
 * Read a fixture file by bare name from the configured directory.
 *
 * The name must be a bare file name. Anything with a separator or a parent
 * reference is refused rather than resolved — the directory is the boundary.
 */
export async function readFixtureRecords<T>(fileName: string): Promise<T[] | null> {
  const directory = fixtureSourcePath();
  if (directory === null) return null;

  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`Invalid fixture file name: ${fileName}`);
  }

  const contents = await readFile(`${directory}/${fileName}`, 'utf8');
  return JSON.parse(contents) as T[];
}
```

- [ ] **Step 4: Run the fixture tests**

Run: `cd backend && npx vitest run src/services/sync/fixtureSource.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Move the UNESCO service onto the new contract**

In `backend/src/services/sync/unescoSyncService.ts`, replace `upsertExperience` (lines 281-303) with:

```typescript
async function upsertExperience(
  exp: ProcessedExperience,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot } = await upsertExperienceRecord({
    categoryId: exp.categoryId,
    externalId: exp.externalId,
    name: exp.name,
    nameLocal: exp.nameLocal,
    description: exp.description,
    shortDescription: exp.shortDescription,
    category: exp.category,
    tags: exp.tags,
    lon: exp.lon,
    lat: exp.lat,
    countryCodes: exp.countryCodes,
    countryNames: exp.countryNames,
    imageUrl: exp.imageUrl,
    metadata: exp.metadata,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // A preview writes nothing downstream either: locations belong to a row that
  // was never touched.
  if (!context.dryRun) {
    await upsertExperienceLocations(experienceId, exp);
  }

  return {
    outcome: changeSet.changeType,
    experienceId: context.dryRun ? null : experienceId,
    nameSnapshot,
    changeSet,
  };
}
```

Add to the imports at the top of the file:

```typescript
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
```

Replace the `fetchItems` and `processItem` entries in `syncUnescoSites` (lines 362-384) with:

```typescript
  return orchestrateSync<UnescoApiRecord>({
    categoryId: UNESCO_CATEGORY_ID,
    logPrefix: '[UNESCO Sync]',
    // UNESCO publishes its whole list, so an absent site really is absent.
    sourceCompleteness: 'authoritative',
    fetchItems: async (progress) => {
      const fixture = await readFixtureRecords<UnescoApiRecord>('unesco.json');
      if (fixture !== null) {
        console.log(`[UNESCO Sync] Using fixture source: ${fixture.length} records`);
        wikipediaUrls = new Map();
        return { items: fixture, fetchedCount: fixture.length };
      }

      const records = await fetchAllUnescoRecords(progress);
      console.log(`[UNESCO Sync] Fetched ${records.length} total records`);

      progress.statusMessage = 'Fetching Wikipedia URLs from Wikidata...';
      wikipediaUrls = await fetchWikipediaUrls();

      return { items: records, fetchedCount: records.length };
    },
    processItem: async (record, _progress, context) => {
      const processed = transformRecord(record, wikipediaUrls.get(String(record.id_no)));
      if (!processed) {
        throw new Error('No valid coordinates');
      }
      return upsertExperience(processed, context);
    },
    getItemName: (record) => record.name_en || `Site ${record.id_no}`,
    getItemId: (record) => String(record.id_no),
  }, triggeredBy, options);
```

And change the signature to accept options:

```typescript
export function syncUnescoSites(
  triggeredBy: number | null,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<void> {
```

Add `import { readFixtureRecords } from './fixtureSource.js';` to the imports.

- [ ] **Step 6: Move the museum service onto the new contract**

In `backend/src/services/sync/museumSyncService.ts`, change the signature and return of `upsertMuseumExperience` (lines 333-374) — the body between stays as it is:

```typescript
async function upsertMuseumExperience(
  museum: CollectedMuseum,
  context: SyncRunContext,
): Promise<{ experienceId: number; changeSet: ChangeSetResult; nameSnapshot: string }> {
  // ... unchanged: details, totalSitelinks, metadata, imageUrl ...

  const { experienceId, changeSet, nameSnapshot } = await upsertExperienceRecord({
    // ... unchanged parameter object ...
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  if (!context.dryRun) {
    await upsertSingleLocation(experienceId, museum.qid, details.lon!, details.lat!);
  }

  return { experienceId, changeSet, nameSnapshot };
}
```

Replace `processMuseum` (lines 563-567) with:

```typescript
async function processMuseum(
  museum: CollectedMuseum,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot } = await upsertMuseumExperience(museum, context);

  // Treasures hang off a row a preview never wrote.
  if (!context.dryRun) {
    await upsertMuseumTreasures(experienceId, museum.artworks);
  }

  return {
    outcome: changeSet.changeType,
    experienceId: context.dryRun ? null : experienceId,
    nameSnapshot,
    changeSet,
  };
}
```

Replace `syncMuseums` (line 576-586) with:

```typescript
export function syncMuseums(
  triggeredBy: number | null,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  return orchestrateSync<CollectedMuseum>({
    categoryId: MUSEUM_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    // A top-100 Wikidata ranking: a museum absent from a run slipped down the
    // sitelink order, which says nothing about whether it still exists.
    sourceCompleteness: 'ranked',
    fetchItems: fetchMuseumItems,
    processItem: processMuseum,
    getItemName: (m) => m.details?.museumLabel || m.label,
    getItemId: (m) => m.qid,
    cleanup: cleanupMuseumData,
  }, triggeredBy, options);
}
```

Add to its imports:

```typescript
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import type { ChangeSetResult } from './changeSet.js';
import type { SyncProgress } from './types.js';
```

(`SyncProgress` may already be imported — check before adding.)

- [ ] **Step 7: Move the landmark service onto the new contract**

In `backend/src/services/sync/landmarkSyncService.ts`, the upsert helper becomes:

```typescript
async function upsertLandmarkExperience(
  landmark: WikidataLandmark,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot } = await upsertExperienceRecord(
    buildLandmarkUpsertParams(landmark),
    { dryRun: context.dryRun, syncLogId: context.syncLogId },
  );

  if (!context.dryRun) {
    await upsertSingleLocation(experienceId, landmark.qid, landmark.lon, landmark.lat);
  }

  return {
    outcome: changeSet.changeType,
    experienceId: context.dryRun ? null : experienceId,
    nameSnapshot,
    changeSet,
  };
}
```

Extract the existing parameter object literal at `landmarkSyncService.ts:184` into `buildLandmarkUpsertParams(landmark)` so the call above stays readable.

Then change its config and exported entry point (around line 288):

```typescript
export function syncLandmarks(
  triggeredBy: number | null,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  return orchestrateSync<WikidataLandmark>({
    categoryId: LANDMARK_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    // Results are sorted by sitelinks and cut at TARGET_COUNT, so absence from
    // a run means "ranked lower", not "gone".
    sourceCompleteness: 'ranked',
    fetchItems: fetchLandmarkItems,
    processItem: upsertLandmarkExperience,
    getItemName: (l) => l.label,
    getItemId: (l) => l.qid,
  }, triggeredBy, options);
}
```

Keep the existing property names for `fetchItems`, `getItemName` and `getItemId` exactly as the file already has them — only `sourceCompleteness`, `processItem`'s signature and the final argument change.

- [ ] **Step 8: Update the sync registry and run the whole suite**

In `backend/src/controllers/admin/syncController.ts`, the registry values now take `(triggeredBy, options)`. Change the `syncFn(triggeredBy, force)` call to `syncFn(triggeredBy, { force, dryRun })` — `dryRun` arrives in Task 8; for now pass `{ force }`.

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/sync/ backend/src/controllers/admin/syncController.ts
git commit -m "back: Let every source report changes, and let a run be a rehearsal."
```

---

### Task 8: API — dry run and the changeset endpoint

**Files:**
- Modify: `backend/src/types/index.ts` (`startSyncBodySchema`, new `syncChangesQuerySchema`)
- Modify: `backend/src/routes/adminRoutes.ts:151`, `:166`
- Modify: `backend/src/controllers/admin/syncController.ts:37-89`
- Create: `backend/src/controllers/admin/syncController.changes.test.ts`

**Interfaces:**
- Consumes: `orchestrateSync` options (Task 6)
- Produces:
  - `GET /api/admin/sync/logs/:logId/changes?type=&significance=&limit=&offset=` → `{ changes: SyncChange[], total: number, limit: number, offset: number }`
  - `POST /api/admin/sync/categories/:categoryId/start` accepts `{ force?: boolean, dryRun?: boolean }`
  - `function getSyncLogChanges(req, res): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/controllers/admin/syncController.changes.test.ts`:

```typescript
/**
 * Tests for the changeset endpoint.
 *
 * The filters are the point: a run with 1200 rows of noise and 12 rows of
 * meaning is only useful if the 12 can be asked for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getSyncLogChanges } from './syncController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function makeReq(query: Record<string, string> = {}) {
  return { params: { logId: '9' }, query } as never;
}

const CHANGE_ROW = {
  id: 1,
  experience_id: 501,
  external_id: '156',
  name_snapshot: 'Serengeti National Park',
  change_type: 'updated',
  changed_fields: [{ field: 'metadata.inDanger', old: false, new: true, significance: 'major', curatedConflict: false }],
  significance: 'major',
  error: null,
};

describe('getSyncLogChanges', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('returns the changes for a run with a total', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [CHANGE_ROW] });
    const res = makeRes();

    await getSyncLogChanges(makeReq(), res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      changes: [CHANGE_ROW],
      total: 1,
    }));
  });

  it('filters by change type', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ type: 'missing' }), makeRes() as never);

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toContain('change_type = ');
    expect(params).toContain('missing');
  });

  it('filters to significant changes only', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ significance: 'major' }), makeRes() as never);

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('major');
  });

  it('never interpolates the filters into the SQL text', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getSyncLogChanges(makeReq({ type: 'missing', significance: 'major' }), makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).not.toContain('missing');
    expect(sql).not.toContain('major');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/controllers/admin/syncController.changes.test.ts`
Expected: FAIL — `getSyncLogChanges` is not exported.

- [ ] **Step 3: Add the validation schemas**

In `backend/src/types/index.ts`, replace `startSyncBodySchema` (lines 324-326) with:

```typescript
export const startSyncBodySchema = z.object({
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
```

and add next to it:

```typescript
export const syncChangesQuerySchema = z.object({
  type: z.enum(['created', 'updated', 'missing', 'returned', 'failed']).optional(),
  significance: z.enum(['major', 'minor']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 4: Implement the endpoint and dry-run flag**

In `backend/src/controllers/admin/syncController.ts`, add:

```typescript
/**
 * List what a run did, object by object.
 * GET /api/admin/sync/logs/:logId/changes
 */
export async function getSyncLogChanges(req: Request, res: Response): Promise<void> {
  const logId = parseInt(String(req.params.logId));
  const { type, significance, limit = 50, offset = 0 } = req.query as {
    type?: string; significance?: string; limit?: number; offset?: number;
  };

  const conditions = ['sync_log_id = $1'];
  const params: unknown[] = [logId];

  if (type) {
    params.push(type);
    conditions.push(`change_type = $${params.length}`);
  }
  if (significance) {
    params.push(significance);
    conditions.push(`significance = $${params.length}`);
  }
  const where = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM experience_sync_changes WHERE ${where}`,
    params
  );

  const rowsResult = await pool.query(
    `SELECT id, experience_id, external_id, name_snapshot, change_type,
            changed_fields, significance, error
     FROM experience_sync_changes
     WHERE ${where}
     ORDER BY (significance = 'major') DESC, change_type, external_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  res.json({
    changes: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    limit: Number(limit),
    offset: Number(offset),
  });
}
```

The `where` clause is assembled only from literal fragments; every value travels as a bound parameter.

In `startSync`, replace the force handling and dispatch with:

```typescript
  const force = req.body.force === true;
  const dryRun = req.body.dryRun === true;

  if (force && dryRun) {
    res.status(400).json({ error: 'A dry run cannot be combined with force: force deletes before it previews' });
    return;
  }

  const syncFn = syncRegistry[categoryId];
  if (!syncFn) {
    res.status(400).json({ error: `Sync not implemented for source: ${source.rows[0].name}` });
    return;
  }

  syncFn(triggeredBy, { force, dryRun }).catch((err) => {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- categoryId is a parseInt result, so it cannot carry a format specifier
    console.error(`[Sync Controller] Sync error for category ${categoryId}:`, err);
  });

  res.json({
    started: true,
    categoryId,
    categoryName: source.rows[0].name,
    force,
    dryRun,
    message: dryRun
      ? 'Dry run started: the changeset will be recorded, experiences will not be written.'
      : force
        ? 'Force sync started (existing data will be deleted). Poll /status endpoint for progress.'
        : 'Sync started. Poll /status endpoint for progress.',
  });
```

- [ ] **Step 5: Register the route**

In `backend/src/routes/adminRoutes.ts`, next to the existing log routes:

```typescript
router.get('/sync/logs/:logId/changes', validate(logIdParamSchema, 'params'), validate(syncChangesQuerySchema, 'query'), getSyncLogChanges);
```

Add `getSyncLogChanges` to the controller import and `syncChangesQuerySchema` to the schema import.

- [ ] **Step 6: Run the tests**

Run: `cd backend && npx vitest run src/controllers/admin/syncController.changes.test.ts && npx tsc --noEmit`
Expected: PASS, 4 tests, no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/admin/syncController.ts backend/src/controllers/admin/syncController.changes.test.ts backend/src/routes/adminRoutes.ts backend/src/types/index.ts
git commit -m "back: Serve a run's changeset, and let a run be started as a preview."
```

---

### Task 9: Admin run card

**Files:**
- Modify: `frontend/src/api/admin/index.ts:42-62` (types), plus a new `getSyncLogChanges` call
- Create: `frontend/src/components/admin/SyncChangeList.tsx`
- Modify: `frontend/src/components/admin/SyncHistoryPanel.tsx:179-263` (`SyncLogDialog`)
- Test: `frontend/src/components/admin/SyncChangeList.test.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/sync/logs/:logId/changes` (Task 8)
- Produces:
  - `interface SyncFieldChange { field: string; old: unknown; new: unknown; significance: 'major' | 'minor'; curatedConflict: boolean }`
  - `interface SyncChange { id: number; experience_id: number | null; external_id: string; name_snapshot: string | null; change_type: 'created' | 'updated' | 'missing' | 'returned' | 'failed'; changed_fields: SyncFieldChange[] | null; significance: 'major' | 'minor' | null; error: string | null }`
  - `function getSyncLogChanges(logId: number, params: { type?: string; significance?: string; limit?: number; offset?: number }): Promise<SyncChangesResponse>`
  - `function SyncChangeList({ logId }: { logId: number })`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/admin/SyncChangeList.test.tsx`:

```tsx
/**
 * Tests for the run changeset list.
 *
 * The default filter is the behaviour worth pinning: a run card that opens
 * showing 1200 cosmetic edits has buried the two that matter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/admin', () => ({
  getSyncLogChanges: vi.fn(),
}));

import { getSyncLogChanges } from '../../api/admin';
import { SyncChangeList } from './SyncChangeList';

const mockedGet = getSyncLogChanges as unknown as ReturnType<typeof vi.fn>;

const MAJOR_CHANGE = {
  id: 1,
  experience_id: 501,
  external_id: '156',
  name_snapshot: 'Serengeti National Park',
  change_type: 'updated' as const,
  changed_fields: [
    { field: 'metadata.inDanger', old: false, new: true, significance: 'major' as const, curatedConflict: false },
  ],
  significance: 'major' as const,
  error: null,
};

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncChangeList logId={9} />
    </QueryClientProvider>
  );
}

describe('SyncChangeList', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue({ changes: [MAJOR_CHANGE], total: 1, limit: 50, offset: 0 });
  });

  it('asks for significant changes only by default', async () => {
    renderList();

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(mockedGet).toHaveBeenCalledWith(9, expect.objectContaining({ significance: 'major' }));
  });

  it('shows the object and the field that changed', async () => {
    renderList();

    expect(await screen.findByText('Serengeti National Park')).toBeInTheDocument();
    expect(screen.getByText(/metadata.inDanger/)).toBeInTheDocument();
    expect(screen.getByText(/false → true/)).toBeInTheDocument();
  });

  it('drops the significance filter when the toggle is turned off', async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByText('Serengeti National Park');
    await user.click(screen.getByRole('checkbox', { name: /significant only/i }));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenLastCalledWith(9, expect.not.objectContaining({ significance: 'major' }));
    });
  });

  it('summarises long text instead of printing it', async () => {
    mockedGet.mockResolvedValue({
      changes: [{
        ...MAJOR_CHANGE,
        significance: 'minor' as const,
        changed_fields: [{
          field: 'description',
          old: 'x'.repeat(340),
          new: 'y'.repeat(512),
          significance: 'minor' as const,
          curatedConflict: false,
        }],
      }],
      total: 1, limit: 50, offset: 0,
    });
    renderList();

    expect(await screen.findByText(/changed \(340 → 512 chars\)/)).toBeInTheDocument();
    expect(screen.queryByText('y'.repeat(512))).not.toBeInTheDocument();
  });

  it('reports an empty run plainly', async () => {
    mockedGet.mockResolvedValue({ changes: [], total: 0, limit: 50, offset: 0 });
    renderList();

    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/SyncChangeList.test.tsx`
Expected: FAIL — `Cannot find module './SyncChangeList'`.

- [ ] **Step 3: Add the API client types and call**

In `frontend/src/api/admin/index.ts`, extend `SyncLog` with the new counters and add the changes call:

```typescript
export interface SyncLog {
  id: number;
  category_id: number;
  category_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_unchanged: number;
  total_missing: number;
  total_curated_conflicts: number;
  total_errors: number;
  is_dry_run: boolean;
  detection_skipped_reason: string | null;
  triggered_by: number | null;
  triggered_by_name: string | null;
}

export interface SyncFieldChange {
  field: string;
  old: unknown;
  new: unknown;
  significance: 'major' | 'minor';
  curatedConflict: boolean;
}

export interface SyncChange {
  id: number;
  experience_id: number | null;
  external_id: string;
  name_snapshot: string | null;
  change_type: 'created' | 'updated' | 'missing' | 'returned' | 'failed';
  changed_fields: SyncFieldChange[] | null;
  significance: 'major' | 'minor' | null;
  error: string | null;
}

export interface SyncChangesResponse {
  changes: SyncChange[];
  total: number;
  limit: number;
  offset: number;
}

export async function getSyncLogChanges(
  logId: number,
  params: { type?: string; significance?: string; limit?: number; offset?: number } = {},
): Promise<SyncChangesResponse> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.significance) search.set('significance', params.significance);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  const query = search.toString();
  return authFetchJson<SyncChangesResponse>(
    `${API_URL}/api/admin/sync/logs/${logId}/changes${query ? `?${query}` : ''}`
  );
}
```

`authFetchJson` and `API_URL` are already imported in this file (line 7 and the module header) — every call there is `authFetchJson<T>(`${API_URL}/api/admin/…`)`, and this one follows the same shape.

Also extend `startSync`'s body in the same file so the dry-run flag can be sent:

```typescript
export async function startSync(
  categoryId: number,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<{ started: boolean; dryRun: boolean; message: string }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/${categoryId}/start`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}
```

Match the existing `startSync` signature in the file; if it currently takes `(categoryId, force)`, update its two call sites in `SyncPanel.tsx` to pass `{ force }`.

- [ ] **Step 4: Implement the change list**

Create `frontend/src/components/admin/SyncChangeList.tsx`:

```tsx
/**
 * Per-object breakdown of a sync run.
 *
 * Reads as sentences rather than JSON, and defaults to significant changes:
 * a run that rewrites 1200 descriptions and moves one site is a run about the
 * site.
 */

import { useState } from 'react';
import {
  Box, Typography, Chip, FormControlLabel, Switch, TablePagination, Stack,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getSyncLogChanges, type SyncChange, type SyncFieldChange } from '../../api/admin';
import { LoadingSpinner } from '../shared/LoadingSpinner';

const PAGE_SIZE = 25;

const CHANGE_TYPE_COLOR: Record<SyncChange['change_type'], 'success' | 'info' | 'warning' | 'error' | 'default'> = {
  created: 'success',
  updated: 'info',
  missing: 'warning',
  returned: 'info',
  failed: 'error',
};

/** Long text is described, not reproduced — the diff is a summary, not a dump. */
function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function FieldRow({ change }: { change: SyncFieldChange }) {
  const oldText = describeValue(change.old);
  const newText = describeValue(change.new);
  const isLong = oldText.length > 80 || newText.length > 80;

  return (
    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', pl: 2 }}>
      <Box component="span" sx={{ color: 'text.secondary' }}>{change.field}: </Box>
      {isLong
        ? `changed (${oldText.length} → ${newText.length} chars)`
        : `${oldText} → ${newText}`}
      {change.curatedConflict && (
        <Chip label="curated" size="small" color="warning" sx={{ ml: 1, height: 16, fontSize: '0.6rem' }} />
      )}
    </Typography>
  );
}

function ChangeRow({ change }: { change: SyncChange }) {
  return (
    <Box sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {change.name_snapshot ?? change.external_id}
        </Typography>
        <Typography variant="caption" color="text.secondary">({change.external_id})</Typography>
        <Chip label={change.change_type} size="small" color={CHANGE_TYPE_COLOR[change.change_type]} />
        {change.significance === 'major' && <Chip label="major" size="small" color="warning" variant="outlined" />}
      </Stack>
      {change.changed_fields?.map((field, i) => <FieldRow key={i} change={field} />)}
      {change.error && (
        <Typography variant="body2" color="error" sx={{ pl: 2, fontFamily: 'monospace', fontSize: '0.8rem' }}>
          {change.error}
        </Typography>
      )}
    </Box>
  );
}

export function SyncChangeList({ logId }: { logId: number }) {
  const [significantOnly, setSignificantOnly] = useState(true);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'syncChanges', logId, significantOnly, page],
    queryFn: () => getSyncLogChanges(logId, {
      ...(significantOnly ? { significance: 'major' } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  });

  return (
    <Box>
      <FormControlLabel
        control={(
          <Switch
            checked={significantOnly}
            onChange={(e) => { setSignificantOnly(e.target.checked); setPage(0); }}
          />
        )}
        label="Significant only"
      />

      {isLoading && <LoadingSpinner padding={4} />}

      {!isLoading && data?.changes.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 3 }}>
          No changes recorded for this run.
        </Typography>
      )}

      {!isLoading && data?.changes.map((change) => <ChangeRow key={change.id} change={change} />)}

      {!isLoading && (data?.total ?? 0) > PAGE_SIZE && (
        <TablePagination
          component="div"
          rowsPerPageOptions={[PAGE_SIZE]}
          count={data?.total ?? 0}
          rowsPerPage={PAGE_SIZE}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 5: Wire it into the run dialog**

In `frontend/src/components/admin/SyncHistoryPanel.tsx`, inside `SyncLogDialog`, replace the four-tile grid with seven tiles and mount the list. Add after the existing `Completed` field and before the error details block:

```tsx
            {log.is_dry_run && (
              <Chip label="Preview — nothing was written" color="info" sx={{ mb: 2 }} />
            )}

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(4, 1fr)', mb: 3 }}>
              <Tile value={log.total_fetched} label="Fetched" bg="grey.100" />
              <Tile value={log.total_created} label="Created" bg="success.light" />
              <Tile value={log.total_updated} label="Changed" bg="info.light" />
              <Tile value={log.total_unchanged} label="Unchanged" bg="grey.100" />
              <Tile value={log.total_missing} label="Missing" bg={log.total_missing > 0 ? 'warning.light' : 'grey.100'} />
              <Tile value={log.total_curated_conflicts} label="Conflicts" bg={log.total_curated_conflicts > 0 ? 'warning.light' : 'grey.100'} />
              <Tile value={log.total_errors} label="Errors" bg={log.total_errors > 0 ? 'error.light' : 'grey.100'} />
            </Box>

            {log.detection_skipped_reason && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Missing detection skipped: {log.detection_skipped_reason}
              </Typography>
            )}

            <SyncChangeList logId={log.id} />
```

And add the small helper above `SyncLogDialog`:

```tsx
function Tile({ value, label, bg }: { value: number; label: string; bg: string }) {
  return (
    <Box sx={{ p: 2, bgcolor: bg, borderRadius: 1 }}>
      <Typography variant="h4">{value.toLocaleString()}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Box>
  );
}
```

Add `import { SyncChangeList } from './SyncChangeList';` to the imports.

- [ ] **Step 6: Add the dry-run button**

In `frontend/src/components/admin/SyncPanel.tsx`, the sync mutation at line 162 currently reads `startSync(source.id, forceSync)`. Change it to carry both flags, and add a second mutation for the preview:

```typescript
  const syncMutation = useMutation({
    mutationFn: () => startSync(source.id, { force: forceSync }),
    onSuccess: () => {
      setForceSync(false);
      // ... keep the existing onSuccess body ...
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: () => startSync(source.id, { dryRun: true }),
    onSuccess: syncMutation.options.onSuccess,
  });
```

Add the button next to the existing Start Sync button (around line 303), outside the `forceSync` conditional so it is always available:

```tsx
              <Button
                variant="outlined"
                disabled={isRunning || forceSync}
                onClick={() => dryRunMutation.mutate()}
              >
                Dry run
              </Button>
```

Disabled under `forceSync` because the backend refuses that combination — force deletes before it could preview anything.

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npx vitest run src/components/admin/SyncChangeList.test.tsx && npx tsc --noEmit`
Expected: PASS, 5 tests, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/admin/index.ts frontend/src/components/admin/SyncChangeList.tsx frontend/src/components/admin/SyncChangeList.test.tsx frontend/src/components/admin/SyncHistoryPanel.tsx frontend/src/components/admin/SyncPanel.tsx
git commit -m "front: Show what a sync run did, object by object, and let it be rehearsed."
```

---

### Task 10: ADR and documentation

**Files:**
- Create: `docs/decisions/0020-experience-lifecycle-and-run-changeset.md`
- Modify: `docs/decisions/README.md` (index)
- Modify: `docs/tech/experiences.md` (§ Sync Architecture)
- Modify: `docs/security/SECURITY.md` (fixture source)
- Modify: `db/migrations/README.md` (mention 009)

**Interfaces:**
- Consumes: everything above
- Produces: no code

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0020-experience-lifecycle-and-run-changeset.md` following the template in `docs/decisions/adr-template.md`. Content, in the template's sections:

- **Context** — a sync run left only aggregate counters, and `total_updated` counted rows that were identical. Nothing recorded which objects a run touched, so "what did the 2 August run bring in?" was unanswerable once the 7-day chip window passed. Separately, an upsert never deletes, so a delisted UNESCO site stayed forever, indistinguishable from a current one.
- **Decision** — (1) per-run, per-object changeset in `experience_sync_changes`, storing changed rows only; (2) two independent lifecycle axes on `experiences` — membership (`present`/`former`) and existence (`extant`/`lost`) — both set by curators, with the machine recording only `missing_since`; (3) missing detection gated on source completeness, a clean run, and 90 % coverage; (4) dry runs write the log and changeset but not the experiences, and are excluded from every "latest run" query.
- **Consequences** — the report becomes answerable and the New chip can become run-based; `total_updated` changes meaning, so logs 1–4 are not comparable with later ones; a wipe-and-reload force sync still destroys curator decisions (tracked); one extra CTE per upsert; `unchanged` rows are unrecoverable after the fact by design.
- **Alternatives considered** — a single `active|former|lost` enum (rejected: cannot express destroyed-but-still-listed, e.g. the Bamiyan Buddhas, or intact-but-delisted, e.g. Dresden); automatic `former` on absence (rejected: a source outage would change what users see); storing `unchanged` rows too (rejected: 1247 rows of noise per UNESCO run).

- [ ] **Step 2: Add the ADR to the index**

In `docs/decisions/README.md`, add the row for ADR-0020 to the index table, matching the format of the existing entries.

- [ ] **Step 3: Update the experiences doc**

In `docs/tech/experiences.md`, in § Sync Architecture, document under "Shared modules": `changeSet.ts` (pure diff with normalisation and significance rules), `changeRecorder.ts` (batched changeset persistence), `missingDetection.ts` (the three safeguards), `fixtureSource.ts` (development-only source substitution). Add a short subsection describing the run lifecycle: provenance columns, the two lifecycle axes, dry runs, and that `unchanged` is counted but not stored. State the `total_updated` redefinition explicitly.

- [ ] **Step 4: Update the security doc**

In `docs/security/SECURITY.md`, note the `SYNC_SOURCE_FIXTURE` switch: development-only (refused when `NODE_ENV === 'production'`), accepts bare file names only, no path separators or parent references, and substitutes the source of truth for a sync — which is why it is gated.

- [ ] **Step 5: Note the migration**

In `db/migrations/README.md`, add `009-experience-change-provenance.sql` to the narrative the same way earlier migrations are described, including that it backfills provenance from the newest successful run per category.

- [ ] **Step 6: Run the full gate**

Run:

```bash
npm run check
TEST_REPORT_LOCAL=1 npm test
```

Expected: both clean. `npm run check` includes knip — if it reports the new exports as unused, verify they are imported where the plan says, rather than deleting them.

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/0020-experience-lifecycle-and-run-changeset.md docs/decisions/README.md docs/tech/experiences.md docs/security/SECURITY.md db/migrations/README.md
git commit -m "Document how a run's changes are recorded, and why the model has two axes."
```

---

## Verification before the slice is done

- [ ] `npm run check` clean
- [ ] `TEST_REPORT_LOCAL=1 npm test` clean
- [ ] `/security-check` on the changed files
- [ ] Start a dry run for UNESCO from the admin UI, then confirm the database is untouched:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "SELECT max(updated_at) FROM experiences WHERE category_id = 1;"
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "SELECT id, is_dry_run, total_created, total_updated, total_unchanged, total_missing FROM experience_sync_logs ORDER BY id DESC LIMIT 1;"
```

Expected: `max(updated_at)` still 2026-07-26, and the newest log row has `is_dry_run = t` with a populated breakdown.

- [ ] Before pushing: `npm run security:all` and `npm run test:e2e:smoke`
