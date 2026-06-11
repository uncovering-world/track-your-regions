# Import Review Workflow Redesign — Plan 1/4: Backend Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the work-unit / sign-off state model and all backend endpoints for the per-country import-review workflow (spec: `docs/tech/planning/import-review-workflow-redesign.md`).

**Architecture:** New columns on `region_import_state` + `world_views`; a `workUnits` service (staleness chokepoint) wired into `syncImportMatchStatus`; a `verifyWorkUnit` service composing scoped coverage + overlap checks; one new controller (`wvImportWorkflowController.ts`) with seven endpoints; matcher and rematch extended to maintain the new flags. No UI in this plan.

**Tech Stack:** Express + raw `pg` pool (PostGIS), Zod validation, Vitest with mocked pool (project pattern: SQL-shape assertions, see `backend/src/controllers/worldView/helpers.test.ts`).

**Plan series:** 1/4 backend foundation (this) → 2/4 dashboard UI → 3/4 country workspace UI → 4/4 cutover + docs. Plans 2–4 are written after this plan lands.

**Conventions for every commit in this plan:**
- Title format `back: <Topic>.` (or blank type for DB-only commits), imperative, ≤72 chars. Body explains what + why, wrapped at 72. Sign off with `-s` and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Backend tests: `cd backend && npx vitest run <file>` (no Docker needed).
- ESM: relative imports end in `.js` even from `.ts` files.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `db/migrations/006-wv-import-workflow-state.sql` | Create | Idempotent DDL for the six new columns |
| `db/init/01-schema.sql` | Modify (~line 1868) | Same DDL for fresh databases |
| `backend/src/services/worldViewImport/workUnits.ts` | Create | `touchWorkUnitForRegion` (staleness chokepoint helper) |
| `backend/src/services/worldViewImport/workUnits.test.ts` | Create | SQL-shape tests for the chokepoint |
| `backend/src/controllers/worldView/helpers.ts` | Modify (`syncImportMatchStatus`, line 81) | Call the chokepoint on every member-driven sync |
| `backend/src/services/worldViewImport/verifyWorkUnit.ts` | Create | Reference resolution + scoped coverage + overlap + blockers |
| `backend/src/services/worldViewImport/verifyWorkUnit.test.ts` | Create | Unit tests for blocker assembly + scoped SQL |
| `backend/src/controllers/admin/wvImportWorkflowController.ts` | Create | 7 endpoints: dashboard, verify, set-reference, work-unit, confirm-hierarchy, confirm-skeleton, sign-off, reopen |
| `backend/src/controllers/admin/wvImportWorkflowController.test.ts` | Create | Endpoint logic tests (sign-off gate, IDOR guard) |
| `backend/src/types/index.ts` | Modify (~line 560) | Zod schemas for the new POST bodies |
| `backend/src/routes/adminRoutes.ts` | Modify (~line 558) | Route registrations |
| `backend/src/services/worldViewImport/matcher.ts` | Modify (lines ~371, ~402–460, ~565–600) | Matcher writes `is_work_unit` + `reference_division_ids` |
| `backend/src/controllers/admin/wvImportRematchController.ts` | Modify (~line 95) | Re-match resets sign-off fields, keeps curation flags |
| `backend/src/scripts/backfillWorkUnits.ts` | Create | One-off backfill for the in-flight import |
| `backend/src/controllers/admin/wvImportFinalizeController.ts` | Modify (`finalizeReview`, line 18) | New finalize gate conditions |

---

### Task 1: Schema — migration 006 + 01-schema.sql

**Files:**
- Create: `db/migrations/006-wv-import-workflow-state.sql`
- Modify: `db/init/01-schema.sql` (region_import_state block, ~line 1868; world_views table definition)

- [ ] **Step 1: Write the migration**

```sql
-- Migration 006: Work-unit / sign-off state for the import-review workflow
--
-- Adds the per-country workflow state designed in
-- docs/tech/planning/import-review-workflow-redesign.md: work-unit flags,
-- hierarchy confirmation, sign-off status, assignment waivers, and the
-- reference territory used by strict tiling verification.
--
-- Idempotent: IF NOT EXISTS guards and a DO-block for the CHECK constraint.

ALTER TABLE region_import_state
    ADD COLUMN IF NOT EXISTS is_work_unit            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hierarchy_confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS signoff_status          TEXT    NOT NULL DEFAULT 'not_started',
    ADD COLUMN IF NOT EXISTS signed_off_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assignment_waived       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS reference_division_ids  INTEGER[];

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'region_import_state_signoff_status_check'
    ) THEN
        ALTER TABLE region_import_state
            ADD CONSTRAINT region_import_state_signoff_status_check
            CHECK (signoff_status IN ('not_started', 'in_progress', 'signed_off'));
    END IF;
END $$;

ALTER TABLE world_views
    ADD COLUMN IF NOT EXISTS skeleton_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN region_import_state.is_work_unit IS 'Node appears on the import dashboard as a country (work unit)';
COMMENT ON COLUMN region_import_state.hierarchy_confirmed IS 'Admin confirmed the work unit''s subtree shape (workflow stage 1)';
COMMENT ON COLUMN region_import_state.signoff_status IS 'Work-unit workflow status: not_started / in_progress / signed_off';
COMMENT ON COLUMN region_import_state.signed_off_at IS 'Retained on staleness revert (in_progress + non-null = "modified after sign-off"); cleared only by explicit reopen';
COMMENT ON COLUMN region_import_state.assignment_waived IS 'Leaf intentionally has no geometry; its territory must be tiled by siblings';
COMMENT ON COLUMN region_import_state.reference_division_ids IS 'Work units: GADM division IDs defining the unit''s territory for verification';
COMMENT ON COLUMN world_views.skeleton_confirmed IS 'Admin confirmed continents/work-unit list (import workflow skeleton pass)';
```

- [ ] **Step 2: Apply to the dev database and verify**

Run: `docker exec -i tyr-ng-db psql -U postgres -d track_regions < db/migrations/006-wv-import-workflow-state.sql`
Expected: `ALTER TABLE`, `DO`, `ALTER TABLE`, then 7 × `COMMENT`.

Run: `docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "\d region_import_state" | grep -E "is_work_unit|signoff_status|reference_division_ids"`
Expected: the three columns listed with their types.

Re-run the migration file once more. Expected: same output, no errors (idempotency).

- [ ] **Step 3: Mirror the DDL in `db/init/01-schema.sql`**

Add the same six columns inline to the `region_import_state` CREATE TABLE (after `hierarchy_warnings TEXT[]`, ~line 1869), the CHECK constraint in the table definition, `skeleton_confirmed BOOLEAN NOT NULL DEFAULT FALSE` to `world_views`, and the same `COMMENT ON COLUMN` statements next to the existing ones (~line 1880).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/006-wv-import-workflow-state.sql db/init/01-schema.sql
git commit -s -m "Add work-unit sign-off schema for import review.

Six new columns on region_import_state (is_work_unit,
hierarchy_confirmed, signoff_status, signed_off_at,
assignment_waived, reference_division_ids) plus
world_views.skeleton_confirmed, per the import-review workflow
redesign spec. Idempotent migration mirrored into 01-schema.sql.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Staleness chokepoint — `touchWorkUnitForRegion`

**Files:**
- Create: `backend/src/services/worldViewImport/workUnits.ts`
- Test: `backend/src/services/worldViewImport/workUnits.test.ts`
- Modify: `backend/src/controllers/worldView/helpers.ts:81` (`syncImportMatchStatus`)

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/services/worldViewImport/workUnits.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { touchWorkUnitForRegion } from './workUnits.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('touchWorkUnitForRegion', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('walks ancestors (including self) to the nearest work unit', async () => {
    await touchWorkUnitForRegion(42);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/WITH RECURSIVE walk_up/);
    expect(sql).toMatch(/is_work_unit = TRUE/);
    expect(sql).toMatch(/LIMIT 1/);
  });

  it('moves not_started and signed_off to in_progress, never touches in_progress rows', async () => {
    await touchWorkUnitForRegion(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/SET signoff_status = 'in_progress'/);
    expect(sql).toMatch(/signoff_status IN \('not_started', 'signed_off'\)/);
  });

  it('retains signed_off_at (badge semantics: in_progress + non-null = modified after sign-off)', async () => {
    await touchWorkUnitForRegion(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).not.toMatch(/signed_off_at\s*=\s*NULL/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/worldViewImport/workUnits.test.ts`
Expected: FAIL — `Cannot find module './workUnits.js'`.

- [ ] **Step 3: Implement the service**

```typescript
// backend/src/services/worldViewImport/workUnits.ts
/**
 * Work-unit workflow helpers (import-review redesign).
 *
 * touchWorkUnitForRegion is the staleness chokepoint: any mutation inside a
 * work unit's subtree marks the unit active. not_started → in_progress on
 * first activity; signed_off → in_progress on later edits, RETAINING
 * signed_off_at so the dashboard can badge "modified after sign-off"
 * (spec: docs/tech/planning/import-review-workflow-redesign.md).
 */
import { pool } from '../../db/index.js';

export async function touchWorkUnitForRegion(regionId: number): Promise<void> {
  await pool.query(
    `WITH RECURSIVE walk_up AS (
       SELECT r.id, r.parent_region_id, 0 AS depth
       FROM regions r WHERE r.id = $1
       UNION ALL
       SELECT r.id, r.parent_region_id, w.depth + 1
       FROM regions r JOIN walk_up w ON r.id = w.parent_region_id
     ),
     nearest_unit AS (
       SELECT w.id
       FROM walk_up w
       JOIN region_import_state ris ON ris.region_id = w.id
       WHERE ris.is_work_unit = TRUE
       ORDER BY w.depth
       LIMIT 1
     )
     UPDATE region_import_state
     SET signoff_status = 'in_progress'
     WHERE region_id IN (SELECT id FROM nearest_unit)
       AND signoff_status IN ('not_started', 'signed_off')`,
    [regionId],
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/worldViewImport/workUnits.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Wire into `syncImportMatchStatus`**

In `backend/src/controllers/worldView/helpers.ts`, add the import at the top with the other service imports:

```typescript
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';
```

and at the END of `syncImportMatchStatus` (after the early `return` for non-imported regions — line 87 — so non-imported regions stay a no-op), append:

```typescript
  // Workflow staleness: any member-driven change marks the owning work unit
  // active / modified-after-sign-off (import-review redesign).
  await touchWorkUnitForRegion(regionId);
```

Place it after the existing `if (currentStatus !== newStatus)` block so it runs even when match_status is unchanged (a member add that keeps `manual_matched` still invalidates a sign-off).

- [ ] **Step 6: Add a regression test in `helpers.test.ts`**

Append to `backend/src/controllers/worldView/helpers.test.ts` (it already mocks `pool`):

```typescript
import { syncImportMatchStatus } from './helpers.js';

describe('syncImportMatchStatus — workflow staleness chokepoint', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('touches the owning work unit after a member-driven sync', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ match_status: 'manual_matched' }] }) // ris lookup
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })                     // member count
      .mockResolvedValue({ rows: [] });                                      // remaining queries
    await syncImportMatchStatus(5);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /WITH RECURSIVE walk_up/.test(s))).toBe(true);
  });

  it('does NOT touch work units for non-imported regions (early return)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // no ris row
    await syncImportMatchStatus(5);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /walk_up/.test(s))).toBe(false);
  });
});
```

- [ ] **Step 7: Run both test files**

Run: `cd backend && npx vitest run src/services/worldViewImport/workUnits.test.ts src/controllers/worldView/helpers.test.ts`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/worldViewImport/workUnits.ts backend/src/services/worldViewImport/workUnits.test.ts backend/src/controllers/worldView/helpers.ts backend/src/controllers/worldView/helpers.test.ts
git commit -s -m "back: Add work-unit staleness chokepoint for import review.

touchWorkUnitForRegion walks up to the nearest is_work_unit ancestor
and moves not_started/signed_off to in_progress, retaining
signed_off_at for the modified-after-sign-off badge. Wired into
syncImportMatchStatus so every member mutation (admin panel AND
WorldViewEditor paths) invalidates sign-offs automatically.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: All mutation paths call the chokepoint

**Files:**
- Modify: `backend/src/controllers/worldView/helpers.ts` (hoist the touch above the early return)
- Modify: `backend/src/controllers/worldView/helpers.test.ts`, `backend/src/services/worldViewImport/workUnits.test.ts` (adjust/strengthen tests)
- Modify: `backend/src/controllers/admin/wvImportTreeOpsController.ts` (every mutating handler)
- Modify: `backend/src/controllers/admin/wvImportFinalizeController.ts` (`addChildRegion`)
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts` (accept/reject/clear handlers)
- Modify: `backend/src/controllers/admin/wvImportMatchTransfer.ts` (`acceptWithTransfer`)
- Modify: `backend/src/controllers/worldView/regionCrud.ts` (member-moving paths)
- Modify: `backend/src/controllers/admin/wvImportUtils.ts` + `backend/src/controllers/admin/wvImportHierarchyController.ts` (undo snapshot columns)

- [ ] **Step 0a: Hoist the chokepoint above the early return** (Task 2 review finding)

Editor-created subregions under an imported country have NO
`region_import_state` row (`ensureSubregion` doesn't create one), so the
early return in `syncImportMatchStatus` skips the touch and member edits on
such regions never stale the owning unit. Move the
`await touchWorkUnitForRegion(regionId)` call to the TOP of
`syncImportMatchStatus` (before the `region_import_state` lookup). The walk
anchors on `regions`, so for plain world views it finds no unit and is a
~1ms no-op. Update the helpers.test.ts regression test that currently
asserts no-touch-on-early-return: it must now assert the touch fires even
when no `region_import_state` row exists (the early return still skips the
match-status logic). Temper the wired-in comment wording ("every member
mutation" → accurate description) while there.

- [ ] **Step 0b: Strengthen the nearest-unit test** (Task 2 review finding)

In `workUnits.test.ts`, the first test asserts `LIMIT 1` but not the
ordering; add `expect(sql).toMatch(/ORDER BY w\.depth/);` so dropping the
ORDER BY fails the suite.

- [ ] **Step 0c: Wire the chokepoint into the import tool's own member mutations** (Task 2 review finding)

The design doc's "every member-mutating endpoint calls
syncImportMatchStatus" is FALSE for the import review's own endpoints —
they update `region_members` + `match_status` inline:
`acceptMatch`, `rejectSuggestion`, `rejectRemaining`, `acceptBatchMatches`,
`clearMembers` in `backend/src/controllers/admin/wvImportMatchController.ts`
and `acceptWithTransfer` in
`backend/src/controllers/admin/wvImportMatchTransfer.ts`. Add an
`await touchWorkUnitForRegion(<mutated regionId>)` after each handler's
successful mutation (for batch accept: touch each distinct regionId once —
dedupe with a `Set`). Do NOT refactor their inline status logic in this
task (consolidation into syncImportMatchStatus is a separate concern —
leave a one-line `// TODO` only if the file already uses that convention,
otherwise nothing).

Also in `backend/src/controllers/worldView/regionCrud.ts`, the member-moving
paths (`moveDivisionMembershipsForParentChange`, the `deleteRegion`
member-reparenting branch) bypass `syncImportMatchStatus`; add direct
`touchWorkUnitForRegion` calls there (touch BOTH the old and new parent
region ids for moves).

- [ ] **Step 1: Identify the mutating tree-op handlers**

Run: `rg -n "export async function" backend/src/controllers/admin/wvImportTreeOpsController.ts`

Every handler that creates/deletes/renames/reparents regions or moves members (e.g. remove-region, rename-region, dismiss-children, handle-as-grouping, merge-child, prune-to-leaves, collapse-to-parent) must call `touchWorkUnitForRegion(<the mutated region's id, or its parent for deletions>)` after its transaction commits. `addChildRegion` in `wvImportFinalizeController.ts` likewise (touch `parentRegionId`).

- [ ] **Step 2: Add the import and calls**

In each file add:

```typescript
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';
```

In each mutating handler, after the success path (post-COMMIT, before `res.json`):

```typescript
  await touchWorkUnitForRegion(regionId); // or parentRegionId for create/delete ops
```

For deletions, capture the parent id BEFORE deleting and touch that. Member-moving handlers that already call `syncImportMatchStatus` for every affected region need no extra call (the chokepoint runs inside it) — only add the direct call where no sync happens (pure rename/reparent/create/delete).

- [ ] **Step 3: Extend the undo snapshot/restore to carry the new columns**

(Review finding from Task 1.) The destructive-op undo machinery snapshots and
restores `region_import_state` rows with an explicit column list that predates
this plan: `ImportStateSnapshot` in
`backend/src/controllers/admin/wvImportUtils.ts:14` and the restore helpers in
`backend/src/controllers/admin/wvImportHierarchyController.ts:44-77`. Without
extending them, undoing a dismiss-children / handle-as-grouping resurrects
rows with `is_work_unit`/`hierarchy_confirmed`/`signoff_status`/
`signed_off_at`/`assignment_waived`/`reference_division_ids` reset to
defaults — silently dropping curation state the spec says even Re-match All
preserves. Add all six columns to the snapshot SELECT, the snapshot type, and
the restore INSERT column list (read the existing code first and mirror its
style). Add a test in the same style as the existing undo tests (or a
source-contract test asserting the column lists include the six names) to
pin this.

- [ ] **Step 4: Type-check and run the full backend suite**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean compile, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/worldView/helpers.ts backend/src/controllers/worldView/helpers.test.ts backend/src/services/worldViewImport/workUnits.test.ts backend/src/controllers/admin/wvImportTreeOpsController.ts backend/src/controllers/admin/wvImportFinalizeController.ts backend/src/controllers/admin/wvImportMatchController.ts backend/src/controllers/admin/wvImportMatchTransfer.ts backend/src/controllers/worldView/regionCrud.ts backend/src/controllers/admin/wvImportUtils.ts backend/src/controllers/admin/wvImportHierarchyController.ts
git commit -s -m "back: Invalidate work-unit sign-off on tree operations.

Rename/reparent/create/delete and restructure operations now touch
the owning work unit, so signed-off countries revert to in_progress
when their subtree shape changes. Member-moving ops were already
covered via syncImportMatchStatus. The destructive-op undo snapshot
now carries the workflow columns so undo cannot reset curation state.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Verification service — `verifyWorkUnit`

**Files:**
- Create: `backend/src/services/worldViewImport/verifyWorkUnit.ts`
- Test: `backend/src/services/worldViewImport/verifyWorkUnit.test.ts`

The scoped coverage query adapts `COVERAGE_GAPS_SQL` from `wvImportCoverageController.ts:108`: `assigned` becomes the **strict descendants'** members (the unit's own members are the reference, not tiling), gap roots become the reference divisions instead of GADM roots, and everything is restricted to the reference closure. Overlap reuses the existing `checkDivisionOverlap` core idea but scoped: divisions (or their GADM ancestors/descendants) claimed by two different direct-child subtrees.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/services/worldViewImport/verifyWorkUnit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { resolveReference, verifyWorkUnit } from './verifyWorkUnit.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('resolveReference', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('prefers own region_members', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ division_id: 10 }, { division_id: 11 }] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [10, 11], source: 'members' });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('falls back to reference_division_ids — never to name matching', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ reference_division_ids: [99] }] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [99], source: 'reference' });
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /name_normalized/.test(s))).toBe(false);
  });

  it('returns null source when neither exists', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ reference_division_ids: null }] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [], source: null });
  });
});

describe('verifyWorkUnit', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('reports a no-reference blocker without running checks', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })                                  // own members
      .mockResolvedValueOnce({ rows: [{ reference_division_ids: null }] }); // reference col
    const result = await verifyWorkUnit(1, 5);
    expect(result.blockers).toContain('no_reference_territory');
    expect(result.coverageGaps).toEqual([]);
  });

  it('scopes coverage to strict descendants and the reference closure', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] })              // own members → reference
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })                   // has child regions
      .mockResolvedValueOnce({ rows: [] })                                  // unassigned leaves
      .mockResolvedValue({ rows: [] });                                     // coverage + overlap
    await verifyWorkUnit(1, 5);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    const coverageSql = sqls.find(s => /reference_closure/.test(s));
    expect(coverageSql).toBeDefined();
    expect(coverageSql).toMatch(/rm\.region_id <> \$1/);     // own members excluded from tiling
    expect(coverageSql).toMatch(/unnest\(\$2::integer\[\]\)/); // reference roots parameterized
  });

  it('skips the coverage check for leaf units (own assignment IS the coverage)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] }) // own members
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })      // no child regions
      .mockResolvedValueOnce({ rows: [] });                    // unassigned leaves
    const result = await verifyWorkUnit(1, 5);
    expect(result.coverageGaps).toEqual([]);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /reference_closure/.test(s))).toBe(false);
  });

  it('flags unassigned leaves excluding waived ones', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ region_id: 8, name: 'Normandy' }] })
      .mockResolvedValue({ rows: [] });
    const result = await verifyWorkUnit(1, 5);
    expect(result.unassignedLeaves).toEqual([{ regionId: 8, name: 'Normandy' }]);
    expect(result.blockers).toContain('unassigned_leaves');
    const leafSql = mockedQuery.mock.calls[2][0] as string;
    expect(leafSql).toMatch(/assignment_waived = FALSE|NOT.*assignment_waived/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/worldViewImport/verifyWorkUnit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// backend/src/services/worldViewImport/verifyWorkUnit.ts
/**
 * Strict tiling verification for a work unit (import-review redesign).
 *
 * Reference territory resolution: own region_members, else
 * reference_division_ids. Deliberately NO name-match fallback — an
 * unresolvable reference is itself a sign-off blocker
 * (spec: docs/tech/planning/import-review-workflow-redesign.md).
 */
import { pool } from '../../db/index.js';

export interface ReferenceResolution {
  divisionIds: number[];
  source: 'members' | 'reference' | null;
}

export interface VerifyResult {
  referenceDivisionIds: number[];
  referenceSource: 'members' | 'reference' | null;
  unassignedLeaves: Array<{ regionId: number; name: string }>;
  coverageGaps: Array<{ divisionId: number; name: string; parentName: string | null }>;
  overlaps: Array<{ divisionId: number; name: string; regionIds: number[] }>;
  blockers: string[];
  verifiedAt: string;
}

export async function resolveReference(regionId: number): Promise<ReferenceResolution> {
  const members = await pool.query(
    'SELECT division_id FROM region_members WHERE region_id = $1',
    [regionId],
  );
  if (members.rows.length > 0) {
    return { divisionIds: members.rows.map(r => r.division_id as number), source: 'members' };
  }
  const ref = await pool.query(
    'SELECT reference_division_ids FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  const ids = (ref.rows[0]?.reference_division_ids as number[] | null) ?? [];
  return ids.length > 0 ? { divisionIds: ids, source: 'reference' } : { divisionIds: [], source: null };
}

// Scoped variant of COVERAGE_GAPS_SQL (wvImportCoverageController.ts):
// assigned = strict descendants' members only ($1 = unit region id);
// gap roots = the reference divisions ($2) instead of GADM roots;
// candidates restricted to the reference closure.
const SCOPED_COVERAGE_SQL = `
  WITH RECURSIVE subtree_regions AS (
    SELECT id FROM regions WHERE id = $1
    UNION ALL
    SELECT r.id FROM regions r JOIN subtree_regions s ON r.parent_region_id = s.id
  ),
  assigned AS (
    SELECT DISTINCT rm.division_id AS id
    FROM region_members rm
    WHERE rm.region_id IN (SELECT id FROM subtree_regions)
      AND rm.region_id <> $1
  ),
  reference_closure AS (
    SELECT unnest($2::integer[]) AS id
    UNION ALL
    SELECT child.id
    FROM reference_closure rc
    JOIN administrative_divisions child ON child.parent_id = rc.id
  ),
  ancestors AS (
    SELECT a.id AS current_id FROM assigned a
    UNION ALL
    SELECT ad.parent_id
    FROM ancestors anc
    JOIN administrative_divisions ad ON ad.id = anc.current_id
    WHERE ad.parent_id IS NOT NULL
  ),
  has_coverage_below AS (SELECT DISTINCT current_id AS id FROM ancestors),
  covered_descendants AS (
    SELECT a.id AS current_id FROM assigned a
    UNION ALL
    SELECT child.id
    FROM covered_descendants cd
    JOIN administrative_divisions child ON child.parent_id = cd.current_id
  ),
  fully_covered AS (SELECT DISTINCT current_id AS id FROM covered_descendants)
  SELECT d.id, d.name, p.name AS parent_name
  FROM administrative_divisions d
  LEFT JOIN administrative_divisions p ON p.id = d.parent_id
  WHERE d.id IN (SELECT id FROM reference_closure)
    AND d.id NOT IN (SELECT id FROM fully_covered)
    AND d.id NOT IN (SELECT id FROM has_coverage_below)
    AND (d.id = ANY($2) OR d.parent_id IN (SELECT id FROM has_coverage_below))
  ORDER BY p.name NULLS FIRST, d.name
`;

// A division overlaps when it (or a GADM ancestor of it) is claimed by two
// different direct-child subtrees of the unit. child_of maps every subtree
// member row to the direct child it belongs to.
const OVERLAP_SQL = `
  WITH RECURSIVE child_of AS (
    SELECT r.id AS region_id, r.id AS root_child_id
    FROM regions r WHERE r.parent_region_id = $1
    UNION ALL
    SELECT r.id, c.root_child_id
    FROM regions r JOIN child_of c ON r.parent_region_id = c.region_id
  ),
  claims AS (
    SELECT rm.division_id, c.root_child_id
    FROM region_members rm JOIN child_of c ON c.region_id = rm.region_id
  ),
  expanded AS (
    -- expand every claim to its GADM self+descendants so parent/child
    -- double-claims collide on the same division id
    SELECT cl.division_id AS claimed_id, cl.division_id AS leaf_id, cl.root_child_id
    FROM claims cl
    UNION ALL
    SELECT e.claimed_id, ad.id, e.root_child_id
    FROM expanded e JOIN administrative_divisions ad ON ad.parent_id = e.leaf_id
  )
  SELECT e.leaf_id AS division_id, ad.name,
         array_agg(DISTINCT e.root_child_id) AS root_child_ids
  FROM expanded e
  JOIN administrative_divisions ad ON ad.id = e.leaf_id
  GROUP BY e.leaf_id, ad.name
  HAVING COUNT(DISTINCT e.root_child_id) > 1
  ORDER BY ad.name
`;

export async function verifyWorkUnit(worldViewId: number, regionId: number): Promise<VerifyResult> {
  const reference = await resolveReference(regionId);
  const blockers: string[] = [];

  if (reference.source === null) {
    return {
      referenceDivisionIds: [],
      referenceSource: null,
      unassignedLeaves: [],
      coverageGaps: [],
      overlaps: [],
      blockers: ['no_reference_territory'],
      verifiedAt: new Date().toISOString(),
    };
  }

  const childCount = await pool.query(
    'SELECT COUNT(*) AS count FROM regions WHERE parent_region_id = $1',
    [regionId],
  );
  const hasChildren = parseInt(childCount.rows[0].count as string) > 0;

  const leaves = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM regions WHERE id = $1
       UNION ALL
       SELECT r.id FROM regions r JOIN subtree s ON r.parent_region_id = s.id
     )
     SELECT r.id AS region_id, r.name
     FROM regions r
     JOIN region_import_state ris ON ris.region_id = r.id
     WHERE r.id IN (SELECT id FROM subtree)
       AND r.is_leaf = TRUE
       AND ris.assignment_waived = FALSE
       AND NOT EXISTS (SELECT 1 FROM region_members rm WHERE rm.region_id = r.id)
     ORDER BY r.name`,
    [regionId],
  );
  const unassignedLeaves = leaves.rows.map(r => ({
    regionId: r.region_id as number,
    name: r.name as string,
  }));
  if (unassignedLeaves.length > 0) blockers.push('unassigned_leaves');

  let coverageGaps: VerifyResult['coverageGaps'] = [];
  if (hasChildren) {
    const gaps = await pool.query(SCOPED_COVERAGE_SQL, [regionId, reference.divisionIds]);
    coverageGaps = gaps.rows.map(r => ({
      divisionId: r.id as number,
      name: r.name as string,
      parentName: (r.parent_name as string) ?? null,
    }));
    if (coverageGaps.length > 0) blockers.push('coverage_gaps');
  }

  const overlapRows = hasChildren ? await pool.query(OVERLAP_SQL, [regionId]) : { rows: [] };
  const overlaps = overlapRows.rows.map(r => ({
    divisionId: r.division_id as number,
    name: r.name as string,
    regionIds: r.root_child_ids as number[],
  }));
  if (overlaps.length > 0) blockers.push('overlaps');

  return {
    referenceDivisionIds: reference.divisionIds,
    referenceSource: reference.source,
    unassignedLeaves,
    coverageGaps,
    overlaps,
    blockers,
    verifiedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/worldViewImport/verifyWorkUnit.test.ts`
Expected: 7 passed. (If the leaf-unit test fails on query counting, check mock ordering matches the implementation's query order: members → reference → child count → leaves → coverage → overlap.)

- [ ] **Step 5: Sanity-check the scoped SQL against the dev DB**

Pick a matched country id from the dev DB and run the coverage SQL manually:

Run: `docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "SELECT id FROM regions WHERE world_view_id = (SELECT id FROM world_views WHERE source_type LIKE 'wikivoyage%' LIMIT 1) AND name = 'Germany' LIMIT 1"`

Then substitute into a hand-run of the scoped query (replace `$1`/`$2`). Expected: it returns plausible gap rows (or none) in under ~5s, no SQL errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/worldViewImport/verifyWorkUnit.ts backend/src/services/worldViewImport/verifyWorkUnit.test.ts
git commit -s -m "back: Add strict tiling verification for work units.

verifyWorkUnit composes reference resolution (own members, else
reference_division_ids, never name matching), unassigned-leaf
detection (waivers excluded), a reference-scoped variant of the
coverage gap CTE, and a sibling-overlap check expanded across GADM
descendants. Returns a structured blocker list shared by the checks
UI and the sign-off gate.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Workflow endpoints + Zod schemas + routes

**Files:**
- Create: `backend/src/controllers/admin/wvImportWorkflowController.ts`
- Test: `backend/src/controllers/admin/wvImportWorkflowController.test.ts`
- Modify: `backend/src/types/index.ts` (~line 560, after `wvImportSmartSimplifyApplySchema`)
- Modify: `backend/src/routes/adminRoutes.ts` (~line 558, after the coverage routes)
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (re-export the new handlers, mirroring line 20)

- [ ] **Step 1: Add Zod schemas**

In `backend/src/types/index.ts`:

```typescript
export const wvImportRegionIdBodySchema = z.object({
  regionId: z.coerce.number().int().positive(),
});

export const wvImportWorkUnitSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  isWorkUnit: z.boolean(),
});

export const wvImportConfirmHierarchySchema = z.object({
  regionId: z.coerce.number().int().positive(),
  confirmed: z.boolean(),
});

export const wvImportConfirmSkeletonSchema = z.object({
  confirmed: z.boolean(),
});

export const wvImportSetReferenceSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  divisionIds: z.array(z.number().int().positive()).min(1).max(50),
});
```

- [ ] **Step 2: Write the failing controller tests**

```typescript
// backend/src/controllers/admin/wvImportWorkflowController.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../../services/worldViewImport/verifyWorkUnit.js', () => ({
  verifyWorkUnit: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { verifyWorkUnit } from '../../services/worldViewImport/verifyWorkUnit.js';
import { signOffWorkUnit } from './wvImportWorkflowController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyWorkUnit as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function req(worldViewId: number, body: Record<string, unknown>): AuthenticatedRequest {
  return { params: { worldViewId: String(worldViewId) }, body } as unknown as AuthenticatedRequest;
}

const CLEAN_VERIFY = {
  referenceDivisionIds: [10], referenceSource: 'members',
  unassignedLeaves: [], coverageGaps: [], overlaps: [],
  blockers: [], verifiedAt: '2026-06-11T00:00:00.000Z',
};

describe('signOffWorkUnit', () => {
  beforeEach(() => { mockedQuery.mockReset(); mockedVerify.mockReset(); });

  it('404s when the region is not a work unit of this world view (IDOR guard)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // unit lookup
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('409s with blockers when hierarchy is not confirmed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: false }] });
    mockedVerify.mockResolvedValueOnce(CLEAN_VERIFY);
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.blockers).toContain('hierarchy_not_confirmed');
  });

  it('409s with verify blockers (gate cannot drift from verify)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] });
    mockedVerify.mockResolvedValueOnce({ ...CLEAN_VERIFY, blockers: ['coverage_gaps'] });
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.blockers).toContain('coverage_gaps');
  });

  it('signs off when hierarchy confirmed and verify is clean', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] })
      .mockResolvedValue({ rows: [] }); // the UPDATE
    mockedVerify.mockResolvedValueOnce(CLEAN_VERIFY);
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    const updateSql = mockedQuery.mock.calls
      .map(c => c[0] as string)
      .find(s => /SET signoff_status = 'signed_off'/.test(s));
    expect(updateSql).toBeDefined();
    expect(updateSql).toMatch(/signed_off_at = NOW\(\)/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportWorkflowController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the controller**

```typescript
// backend/src/controllers/admin/wvImportWorkflowController.ts
/**
 * WorldView Import Workflow Controller (import-review redesign).
 *
 * Work-unit lifecycle endpoints: verify, sign-off, reopen, flag toggles,
 * reference territory, skeleton confirmation.
 * Spec: docs/tech/planning/import-review-workflow-redesign.md
 */
import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { verifyWorkUnit } from '../../services/worldViewImport/verifyWorkUnit.js';

/** Load a work-unit row scoped to the world view; null = not found (IDOR guard). */
async function loadWorkUnit(worldViewId: number, regionId: number): Promise<{ hierarchy_confirmed: boolean } | null> {
  const result = await pool.query(
    `SELECT ris.hierarchy_confirmed
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2 AND ris.is_work_unit = TRUE`,
    [regionId, worldViewId],
  );
  return result.rows[0] ?? null;
}

/** GET /wv-import/matches/:worldViewId/verify/:regionId */
export async function getWorkUnitVerification(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.params.regionId));
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  const result = await verifyWorkUnit(worldViewId, regionId);
  res.json(result);
}

/** POST /wv-import/matches/:worldViewId/sign-off  { regionId } */
export async function signOffWorkUnit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = req.body.regionId as number;
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }

  const verify = await verifyWorkUnit(worldViewId, regionId);
  const blockers = [...verify.blockers];
  if (!unit.hierarchy_confirmed) blockers.unshift('hierarchy_not_confirmed');
  if (blockers.length > 0) {
    res.status(409).json({ blockers, verify });
    return;
  }

  await pool.query(
    `UPDATE region_import_state
     SET signoff_status = 'signed_off', signed_off_at = NOW()
     WHERE region_id = $1`,
    [regionId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/reopen  { regionId } */
export async function reopenWorkUnit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = req.body.regionId as number;
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  await pool.query(
    `UPDATE region_import_state
     SET signoff_status = 'in_progress', signed_off_at = NULL
     WHERE region_id = $1`,
    [regionId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/work-unit  { regionId, isWorkUnit } */
export async function setWorkUnitFlag(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, isWorkUnit } = req.body as { regionId: number; isWorkUnit: boolean };
  const owned = await pool.query(
    `SELECT 1 FROM regions r JOIN region_import_state ris ON ris.region_id = r.id
     WHERE r.id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  if (owned.rows.length === 0) { res.status(404).json({ error: 'Region not found in this world view' }); return; }
  // Demotion resets the sign-off lifecycle: stale signoff fields on
  // non-units would leak into dashboards if the node is later re-promoted.
  await pool.query(
    isWorkUnit
      ? 'UPDATE region_import_state SET is_work_unit = TRUE WHERE region_id = $1'
      : `UPDATE region_import_state
         SET is_work_unit = FALSE, signoff_status = 'not_started', signed_off_at = NULL
         WHERE region_id = $1`,
    [regionId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/confirm-hierarchy  { regionId, confirmed } */
export async function confirmHierarchy(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, confirmed } = req.body as { regionId: number; confirmed: boolean };
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  await pool.query(
    'UPDATE region_import_state SET hierarchy_confirmed = $1 WHERE region_id = $2',
    [confirmed, regionId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/confirm-skeleton  { confirmed } */
export async function confirmSkeleton(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { confirmed } = req.body as { confirmed: boolean };
  await pool.query(
    'UPDATE world_views SET skeleton_confirmed = $1 WHERE id = $2',
    [confirmed, worldViewId],
  );
  res.json({ success: true });
}

/** POST /wv-import/matches/:worldViewId/set-reference  { regionId, divisionIds } */
export async function setReferenceTerritory(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionIds } = req.body as { regionId: number; divisionIds: number[] };
  const unit = await loadWorkUnit(worldViewId, regionId);
  if (!unit) { res.status(404).json({ error: 'Work unit not found in this world view' }); return; }
  await pool.query(
    'UPDATE region_import_state SET reference_division_ids = $1 WHERE region_id = $2',
    [divisionIds, regionId],
  );
  res.json({ success: true });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportWorkflowController.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Register routes**

In `backend/src/routes/adminRoutes.ts`, import the schemas (extend the existing `types/index.js` import near line 64) and the handlers (extend the existing `worldViewImportController.js` import after re-exporting — add to `worldViewImportController.ts` line 20 area):

```typescript
export {
  getWorkUnitVerification, signOffWorkUnit, reopenWorkUnit,
  setWorkUnitFlag, confirmHierarchy, confirmSkeleton, setReferenceTerritory,
} from './wvImportWorkflowController.js';
```

Then after the coverage routes (~line 558):

```typescript
router.get('/wv-import/matches/:worldViewId/verify/:regionId', validate(worldViewRegionIdParamSchema, 'params'), getWorkUnitVerification);
router.post('/wv-import/matches/:worldViewId/sign-off', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdBodySchema), signOffWorkUnit);
router.post('/wv-import/matches/:worldViewId/reopen', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdBodySchema), reopenWorkUnit);
router.post('/wv-import/matches/:worldViewId/work-unit', validate(worldViewIdParamSchema, 'params'), validate(wvImportWorkUnitSchema), setWorkUnitFlag);
router.post('/wv-import/matches/:worldViewId/confirm-hierarchy', validate(worldViewIdParamSchema, 'params'), validate(wvImportConfirmHierarchySchema), confirmHierarchy);
router.post('/wv-import/matches/:worldViewId/confirm-skeleton', validate(worldViewIdParamSchema, 'params'), validate(wvImportConfirmSkeletonSchema), confirmSkeleton);
router.post('/wv-import/matches/:worldViewId/set-reference', validate(worldViewIdParamSchema, 'params'), validate(wvImportSetReferenceSchema), setReferenceTerritory);
```

- [ ] **Step 7: Type-check + full suite**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/admin/wvImportWorkflowController.ts backend/src/controllers/admin/wvImportWorkflowController.test.ts backend/src/controllers/admin/worldViewImportController.ts backend/src/types/index.ts backend/src/routes/adminRoutes.ts
git commit -s -m "back: Add work-unit workflow endpoints for import review.

verify, sign-off (409 + structured blockers; same verify routine as
the checks UI so the gate cannot drift), reopen, work-unit flag
toggle, hierarchy/skeleton confirmation, and reference-territory
set. All admin-auth + Zod + world-view ownership guards.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Matcher writes work-unit flags; rematch reset rules

**Files:**
- Modify: `backend/src/services/worldViewImport/matcher.ts` (updates array type ~line 371; country branches ~lines 402–460 and the two other `recordSingleCountry`/`recordAmbiguousCountry` sites; batch write ~lines 569–591)
- Modify: `backend/src/controllers/admin/wvImportRematchController.ts` (reset block ~line 95)
- Test: extend `backend/src/services/worldViewImport/workUnits.test.ts` is NOT right — create `backend/src/services/worldViewImport/matcher.workUnits.test.ts`

- [ ] **Step 1: Extend the matcher's update entry type**

At ~line 371 the inline type of `updates` gains two optional fields:

```typescript
  const updates: Array<{
    id: number;
    matchStatus: string;
    suggestions: MatchSuggestion[];
    divisionId?: number;
    isWorkUnit?: boolean;              // NEW: node identified as a country
    referenceDivisionIds?: number[];   // NEW: GADM country division(s)
  }> = [];
```

(If the array element type is the named `MatchUpdate` used at lines 832/972, add the two optional fields to that interface instead — single source.)

- [ ] **Step 2: Set the flags in every country branch**

In the country-assignment function (three branches around lines 399–459):

- "no subdivisions → assign at country level" (~line 402): add `isWorkUnit: true, referenceDivisionIds: [gadmCountryId]` to the pushed update.
- "ALL children matched → children_matched" (~line 430): add `isWorkUnit: true, referenceDivisionIds: [gadmCountryId]` to the country's update (children keep no flags).
- "not all children match → assign at country level" (~line 452): same as the first branch.

In `recordAmbiguousCountry` (multi-division countries, `needs_review`): add `isWorkUnit: true, referenceDivisionIds: countryIds` (all candidate GADM ids).

- [ ] **Step 3: Persist the flags in the batch write**

In the batch write loop (~line 569), replace the single status UPDATE with:

```typescript
      await client.query(
        `UPDATE region_import_state
         SET match_status = $1,
             is_work_unit = COALESCE($3, is_work_unit),
             reference_division_ids = COALESCE($4, reference_division_ids)
         WHERE region_id = $2`,
        [update.matchStatus, update.id, update.isWorkUnit ?? null, update.referenceDivisionIds ?? null],
      );
```

(`COALESCE` keeps the existing values for non-country updates — additive, never clears admin curation.)

- [ ] **Step 4: Rematch reset rules**

In `wvImportRematchController.ts`, the reset block currently runs `UPDATE region_import_state SET match_status = 'no_candidates' WHERE region_id IN (...)` (~line 95). Extend that same UPDATE:

```typescript
    // Reset match status AND sign-off lifecycle (assignments are gone), but
    // KEEP hierarchy_confirmed / is_work_unit / reference_division_ids —
    // re-match does not touch tree shape or unit curation.
    await client.query(`
      UPDATE region_import_state
      SET match_status = 'no_candidates',
          signoff_status = 'not_started',
          signed_off_at = NULL
      WHERE region_id IN (SELECT id FROM regions WHERE world_view_id = $1)
    `, [worldViewId]);
```

- [ ] **Step 5: Write tests for the reset rules**

```typescript
// backend/src/services/worldViewImport/matcher.workUnits.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The matcher and rematch controller are heavily integration-shaped; assert
// the contract at the SQL-source level (same pattern as SQL-shape tests, but
// static): the batch write persists work-unit flags additively, and the
// rematch reset clears sign-off lifecycle without touching curation flags.
describe('work-unit persistence contracts', () => {
  it('matcher batch write persists is_work_unit and reference_division_ids with COALESCE', () => {
    const src = readFileSync(new URL('./matcher.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/is_work_unit = COALESCE\(\$3, is_work_unit\)/);
    expect(src).toMatch(/reference_division_ids = COALESCE\(\$4, reference_division_ids\)/);
  });

  it('rematch resets signoff_status/signed_off_at but not hierarchy_confirmed/is_work_unit', () => {
    const src = readFileSync(
      new URL('../../controllers/admin/wvImportRematchController.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/signoff_status = 'not_started'/);
    expect(src).toMatch(/signed_off_at = NULL/);
    expect(src).not.toMatch(/hierarchy_confirmed = /);
    expect(src).not.toMatch(/is_work_unit = FALSE/);
  });
});
```

- [ ] **Step 6: Run tests + full suite**

Run: `cd backend && npx vitest run src/services/worldViewImport/matcher.workUnits.test.ts && npx tsc --noEmit && npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/worldViewImport/matcher.ts backend/src/controllers/admin/wvImportRematchController.ts backend/src/services/worldViewImport/matcher.workUnits.test.ts
git commit -s -m "back: Matcher maintains work-unit flags; rematch keeps curation.

matchCountryLevel marks identified countries with is_work_unit and
stores the GADM country division(s) as reference_division_ids
(additively, via COALESCE). Re-match All resets the sign-off
lifecycle but preserves hierarchy_confirmed, is_work_unit, and
references, per the redesign spec's re-match interaction rules.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Backfill script for the in-flight import

**Files:**
- Create: `backend/src/scripts/backfillWorkUnits.ts`

- [ ] **Step 1: Implement the script** (model CLI shape on `backend/src/scripts/createAdmin.ts`)

```typescript
// backend/src/scripts/backfillWorkUnits.ts
/**
 * One-off backfill for the import-review workflow redesign
 * (docs/tech/planning/import-review-workflow-redesign.md).
 *
 * Sets is_work_unit + reference_division_ids for an existing imported
 * world view:
 *  1. Regions whose own assigned division is GADM level 0 (parent_id IS NULL).
 *  2. children_matched regions whose name matches a level-0 GADM division
 *     (level restriction avoids e.g. Georgia-the-state shadowing the country).
 * Unresolved children_matched regions keep reference NULL and surface in the
 * skeleton worklist.
 *
 * Usage: cd backend && npx tsx src/scripts/backfillWorkUnits.ts <worldViewId>
 */
import { pool } from '../db/index.js';

async function main(): Promise<void> {
  const worldViewId = parseInt(process.argv[2] ?? '');
  if (!Number.isInteger(worldViewId)) {
    console.error('Usage: npx tsx src/scripts/backfillWorkUnits.ts <worldViewId>');
    process.exit(1);
  }

  // 1. Directly matched countries: own member at GADM level 0.
  const direct = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE,
        reference_division_ids = sub.div_ids
    FROM (
      SELECT rm.region_id, array_agg(rm.division_id) AS div_ids
      FROM region_members rm
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $1
      JOIN administrative_divisions ad ON ad.id = rm.division_id
      WHERE ad.parent_id IS NULL
      GROUP BY rm.region_id
    ) sub
    WHERE ris.region_id = sub.region_id
    RETURNING ris.region_id
  `, [worldViewId]);

  // 2. children_matched countries: level-0-restricted name match.
  const drilled = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE,
        reference_division_ids = ARRAY[sub.division_id]
    FROM (
      SELECT r.id AS region_id, ad.id AS division_id
      FROM regions r
      JOIN region_import_state s ON s.region_id = r.id
      JOIN administrative_divisions ad
        ON ad.parent_id IS NULL
       AND ad.name_normalized = lower(immutable_unaccent(r.name))
      WHERE r.world_view_id = $1 AND s.match_status = 'children_matched'
    ) sub
    WHERE ris.region_id = sub.region_id
      AND ris.reference_division_ids IS NULL
    RETURNING ris.region_id
  `, [worldViewId]);

  // 3. Remaining children_matched without reference: flag as units anyway so
  //    they appear on the dashboard with a "no reference" blocker.
  const flagged = await pool.query(`
    UPDATE region_import_state ris
    SET is_work_unit = TRUE
    FROM regions r
    WHERE r.id = ris.region_id AND r.world_view_id = $1
      AND ris.match_status = 'children_matched'
      AND ris.is_work_unit = FALSE
    RETURNING ris.region_id
  `, [worldViewId]);

  console.log(`Backfill complete: ${direct.rows.length} direct, ${drilled.rows.length} drilled (name-matched), ${flagged.rows.length} flagged without reference.`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run against the dev DB and eyeball the result**

Run: `cd backend && npx tsx src/scripts/backfillWorkUnits.ts <the wikivoyage world view id>`
Expected: a summary line; then verify count plausibility (~200 units):

Run: `docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "SELECT COUNT(*) FILTER (WHERE is_work_unit), COUNT(*) FILTER (WHERE is_work_unit AND reference_division_ids IS NULL) FROM region_import_state"`
Expected: first count in the low hundreds; second count small (the skeleton worklist).

- [ ] **Step 3: Commit**

```bash
git add backend/src/scripts/backfillWorkUnits.ts
git commit -s -m "back: Add work-unit backfill script for in-flight imports.

Marks existing imported countries as work units: directly-matched
regions get references from their level-0 members; children_matched
regions get a level-0-restricted name match (avoiding the
Georgia-state collision the unrestricted fallback has); the rest are
flagged unit-without-reference for the skeleton worklist.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Dashboard aggregate endpoint + tree response fields

**Files:**
- Modify: `backend/src/controllers/admin/wvImportWorkflowController.ts` (add `getWorkflowDashboard`)
- Modify: `backend/src/controllers/admin/wvImportWorkflowController.test.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts` (tree SELECT ~line 465 and row-mapping ~line 551; stats query ~line 102)
- Modify: `backend/src/routes/adminRoutes.ts`, `backend/src/controllers/admin/worldViewImportController.ts` (route + re-export)

- [ ] **Step 1: Write the failing test**

Append to `wvImportWorkflowController.test.ts`:

```typescript
import { getWorkflowDashboard } from './wvImportWorkflowController.js';

describe('getWorkflowDashboard', () => {
  beforeEach(() => { mockedQuery.mockReset(); mockedQuery.mockResolvedValue({ rows: [] }); });

  it('aggregates per-unit progress in a single query (no full-tree fetch)', async () => {
    const res = mockRes();
    await getWorkflowDashboard(
      { params: { worldViewId: '1' } } as unknown as AuthenticatedRequest, res);
    expect(mockedQuery).toHaveBeenCalledTimes(2); // skeleton_confirmed + units
    const unitSql = mockedQuery.mock.calls[1][0] as string;
    expect(unitSql).toMatch(/is_work_unit = TRUE/);
    expect(unitSql).toMatch(/WITH RECURSIVE/);
    expect(unitSql).toMatch(/assignment_waived/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportWorkflowController.test.ts`
Expected: FAIL — `getWorkflowDashboard` not exported.

- [ ] **Step 3: Implement**

Append to `wvImportWorkflowController.ts`:

```typescript
/** GET /wv-import/matches/:worldViewId/dashboard */
export async function getWorkflowDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const wv = await pool.query(
    'SELECT skeleton_confirmed FROM world_views WHERE id = $1',
    [worldViewId],
  );

  const units = await pool.query(`
    WITH RECURSIVE units AS (
      SELECT r.id, r.name, r.parent_region_id
      FROM regions r
      JOIN region_import_state ris ON ris.region_id = r.id
      WHERE r.world_view_id = $1 AND ris.is_work_unit = TRUE
    ),
    subtree AS (
      SELECT u.id AS unit_id, u.id AS region_id FROM units u
      UNION ALL
      SELECT s.unit_id, r.id
      FROM subtree s JOIN regions r ON r.parent_region_id = s.region_id
    ),
    root_walk AS (
      SELECT u.id AS unit_id, u.id AS current_id, u.parent_region_id, u.name AS root_name
      FROM units u
      UNION ALL
      SELECT w.unit_id, r.id, r.parent_region_id, r.name
      FROM root_walk w JOIN regions r ON r.id = w.parent_region_id
    ),
    roots AS (
      SELECT DISTINCT ON (unit_id) unit_id, root_name AS continent
      FROM root_walk WHERE parent_region_id IS NULL
      ORDER BY unit_id
    )
    SELECT u.id, u.name,
           ris.signoff_status, ris.signed_off_at, ris.hierarchy_confirmed,
           ris.reference_division_ids,
           ris.source_url,
           roots.continent,
           COUNT(*) FILTER (WHERE r.is_leaf) AS leaf_total,
           COUNT(*) FILTER (
             WHERE r.is_leaf AND (sris.assignment_waived
               OR EXISTS (SELECT 1 FROM region_members rm WHERE rm.region_id = r.id))
           ) AS leaf_resolved,
           COUNT(*) FILTER (
             WHERE array_length(sris.hierarchy_warnings, 1) > 0
               AND sris.hierarchy_reviewed = FALSE
           ) AS warning_count
    FROM units u
    JOIN region_import_state ris ON ris.region_id = u.id
    LEFT JOIN roots ON roots.unit_id = u.id
    JOIN subtree s ON s.unit_id = u.id
    JOIN regions r ON r.id = s.region_id
    LEFT JOIN region_import_state sris ON sris.region_id = r.id
    GROUP BY u.id, u.name, ris.signoff_status, ris.signed_off_at,
             ris.hierarchy_confirmed, ris.reference_division_ids,
             ris.source_url, roots.continent
    ORDER BY roots.continent NULLS LAST, u.name
  `, [worldViewId]);

  res.json({
    skeletonConfirmed: wv.rows[0]?.skeleton_confirmed === true,
    units: units.rows.map(r => ({
      regionId: r.id as number,
      name: r.name as string,
      continent: (r.continent as string) ?? null,
      signoffStatus: r.signoff_status as string,
      signedOffAt: (r.signed_off_at as string) ?? null,
      hierarchyConfirmed: r.hierarchy_confirmed === true,
      hasReference: ((r.reference_division_ids as number[] | null) ?? []).length > 0,
      sourceUrl: (r.source_url as string) ?? null,
      leafTotal: parseInt(String(r.leaf_total)),
      leafResolved: parseInt(String(r.leaf_resolved)),
      warningCount: parseInt(String(r.warning_count)),
    })),
  });
}
```

Re-export it in `worldViewImportController.ts` and register the route:

```typescript
router.get('/wv-import/matches/:worldViewId/dashboard', validate(worldViewIdParamSchema, 'params'), getWorkflowDashboard);
```

- [ ] **Step 4: Add the new fields to the tree response**

In `wvImportMatchController.ts`, the tree SELECT (~line 465) gains
`ris.is_work_unit, ris.hierarchy_confirmed, ris.signoff_status, ris.assignment_waived,` and the row-mapping (~line 551) gains:

```typescript
      isWorkUnit: row.is_work_unit === true,
      hierarchyConfirmed: row.hierarchy_confirmed === true,
      signoffStatus: (row.signoff_status as string) ?? 'not_started',
      assignmentWaived: row.assignment_waived === true,
```

Extend the row interface at ~line 525 with:

```typescript
    is_work_unit: boolean;
    hierarchy_confirmed: boolean;
    signoff_status: string;
    assignment_waived: boolean;
```

- [ ] **Step 5: Run the suite + manual smoke**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

Run (with dev stack up): `curl -s http://localhost:3001/api/admin/wv-import/matches/<id>/dashboard -H "Authorization: Bearer <admin token>" | head -c 400`
Expected: JSON with `skeletonConfirmed` and a `units` array.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin/wvImportWorkflowController.ts backend/src/controllers/admin/wvImportWorkflowController.test.ts backend/src/controllers/admin/wvImportMatchController.ts backend/src/controllers/admin/worldViewImportController.ts backend/src/routes/adminRoutes.ts
git commit -s -m "back: Add workflow dashboard aggregate; expose flags in tree.

GET /dashboard returns all work units with continent, sign-off
state, leaf totals/resolved (waived counts as resolved), and
unreviewed-warning counts in one recursive query, so the dashboard
UI never fetches the 5,800-node tree. The match tree response now
carries isWorkUnit/hierarchyConfirmed/signoffStatus/assignmentWaived
for plans 2-3.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Waive endpoint + finalize gate

**Files:**
- Modify: `backend/src/controllers/admin/wvImportWorkflowController.ts` (add `setAssignmentWaived`)
- Modify: `backend/src/types/index.ts` (schema), `backend/src/routes/adminRoutes.ts`, `worldViewImportController.ts` (re-export)
- Modify: `backend/src/controllers/admin/wvImportFinalizeController.ts:18` (`finalizeReview`)
- Test: extend `wvImportWorkflowController.test.ts`

- [ ] **Step 1: Schema + endpoint**

```typescript
// types/index.ts
export const wvImportWaiveSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  waived: z.boolean(),
});
```

```typescript
// wvImportWorkflowController.ts
/** POST /wv-import/matches/:worldViewId/waive  { regionId, waived } */
export async function setAssignmentWaived(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, waived } = req.body as { regionId: number; waived: boolean };
  const owned = await pool.query(
    `SELECT 1 FROM regions r JOIN region_import_state ris ON ris.region_id = r.id
     WHERE r.id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  if (owned.rows.length === 0) { res.status(404).json({ error: 'Region not found in this world view' }); return; }
  await pool.query(
    'UPDATE region_import_state SET assignment_waived = $1 WHERE region_id = $2',
    [waived, regionId],
  );
  res.json({ success: true });
}
```

Route: `router.post('/wv-import/matches/:worldViewId/waive', validate(worldViewIdParamSchema, 'params'), validate(wvImportWaiveSchema), setAssignmentWaived);`

- [ ] **Step 2: Extend `finalizeReview` with the new gate**

In `wvImportFinalizeController.ts`, after the existing unmatched check (line ~75) add:

```typescript
  // Workflow gate (import-review redesign): skeleton confirmed + every work
  // unit signed off. Global-gap zero-count remains validated client-side via
  // the coverage check, same as before.
  const gate = await pool.query(`
    SELECT
      (SELECT skeleton_confirmed FROM world_views WHERE id = $1) AS skeleton_confirmed,
      COUNT(*) FILTER (WHERE ris.is_work_unit AND ris.signoff_status <> 'signed_off') AS unsigned_units
    FROM region_import_state ris
    JOIN regions r ON r.id = ris.region_id
    WHERE r.world_view_id = $1
  `, [worldViewId]);
  const skeletonConfirmed = gate.rows[0].skeleton_confirmed === true;
  const unsignedUnits = parseInt(gate.rows[0].unsigned_units as string);
  if (!skeletonConfirmed || unsignedUnits > 0) {
    res.status(400).json({
      error: 'Workflow incomplete',
      skeletonConfirmed,
      unsignedUnits,
    });
    return;
  }
```

- [ ] **Step 3: Tests**

Append to `wvImportWorkflowController.test.ts`:

```typescript
import { setAssignmentWaived } from './wvImportWorkflowController.js';

describe('setAssignmentWaived', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('404s for regions outside the world view (IDOR guard)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await setAssignmentWaived(req(1, { regionId: 9, waived: true }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updates assignment_waived for owned regions', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await setAssignmentWaived(req(1, { regionId: 9, waived: true }), res);
    const [sql, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/SET assignment_waived = \$1/);
    expect(params).toEqual([true, 9]);
  });
});
```

Create `backend/src/controllers/admin/wvImportFinalizeController.gate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { finalizeReview } from './wvImportFinalizeController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

const REQ = { params: { worldViewId: '1' } } as unknown as AuthenticatedRequest;
const NO_UNMATCHED = { rows: [{ needs_review: '0', no_candidates: '0' }] };

describe('finalizeReview — workflow gate', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('400s when work units are not all signed off', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '3' }] });
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.unsignedUnits).toBe(3);
  });

  it('400s when the skeleton is not confirmed', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: false, unsigned_units: '0' }] });
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('proceeds to the source_type update when the gate passes', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '0' }] })
      .mockResolvedValue({ rows: [{ source_type: 'wikivoyage_done' }] });
    const res = mockRes();
    await finalizeReview(REQ, res);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /source_type/.test(s) && /UPDATE world_views/.test(s))).toBe(true);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});
```

Note for the implementer: the third test depends on how `finalizeReview` performs the `source_type` update after the gate (read the existing tail of the function, lines ~76+, and adjust the trailing mocks to its exact query sequence — the assertion itself stays).

- [ ] **Step 4: Run + commit**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

```bash
git add backend/src/controllers/admin/wvImportWorkflowController.ts backend/src/controllers/admin/wvImportWorkflowController.test.ts backend/src/controllers/admin/wvImportFinalizeController.ts backend/src/controllers/admin/wvImportFinalizeController.gate.test.ts backend/src/types/index.ts backend/src/routes/adminRoutes.ts backend/src/controllers/admin/worldViewImportController.ts
git commit -s -m "back: Add assignment waiver; gate finalize on workflow state.

Leaves can be explicitly waived (render nothing on purpose; their
territory must still tile via siblings). finalizeReview now also
requires skeleton_confirmed and every work unit signed off, on top
of the existing unmatched-regions check.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Full gates

- [ ] **Step 1: Run the comprehensive gate**

Run: `npm run check` (repo root)
Expected: clean. Note: the Python portions need Docker on this machine (no local python3.12/.venv) — if `check:py` fails on environment, run the Python gates in a `python:3.12` container mirroring CI, per project practice.

- [ ] **Step 2: Run both test suites**

Run: `TEST_REPORT_LOCAL=1 npm test` and `npm run test:py` (Docker fallback as above; cv-python untouched by this plan, suite must simply still pass).
Expected: all pass.

- [ ] **Step 3: Security pass**

Run `/security-check` (Claude Code slash command) on the changed files. All new endpoints must show: admin auth (router-level), Zod validation, world-view ownership guards (IDOR), no string-concatenated SQL (all parameterized).

- [ ] **Step 4: Update docs index entry**

No docs/tech rewrite yet (plan 4/4 owns it), but add one line to `docs/tech/world-view-import.md`'s API table for the 9 new endpoints with a pointer to the spec, so the doc doesn't silently lag the code.

Also rewrite `db/migrations/README.md` (review finding from Task 1): it still claims the directory is empty pending a first production release, while six migrations exist. Describe the actual workflow — numbered idempotent migrations applied manually via psql, always mirrored into `db/init/01-schema.sql`.

```bash
git add docs/tech/world-view-import.md
git commit -s -m "Document work-unit workflow endpoints in import doc.

Adds the nine new /wv-import/matches endpoints (verify, sign-off,
reopen, work-unit, confirm-hierarchy, confirm-skeleton,
set-reference, waive, dashboard) to the API table, pointing to the
redesign spec for semantics. Full doc rewrite lands with plan 4/4.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Spec coverage map (Plan 1 scope)

| Spec section | Task |
|--------------|------|
| Data Model (6 + 1 columns, CHECK) | 1 |
| Status transitions & staleness (chokepoint, editor paths, tree ops) | 2, 3 |
| Verification (reference order, no name fallback, leaf-unit case, waivers, overlap-between-children) | 4 |
| API: verify / sign-off / reopen / work-unit / confirm-hierarchy / confirm-skeleton / set-reference | 5 |
| Source of truth for "what is a country" + Re-match interaction | 6 |
| Migration backfill (level-0-restricted) | 7 |
| API: dashboard; tree response fields for plans 2–3 | 8 |
| Waiver endpoint; Finalize gate | 9 |
| Testing requirements (fixtures via mocked-pool shapes, staleness, re-match survival, dashboard query) | 2–9 |
| UI sections, shadow-insertion removal, Raw-tree view, ADR + doc rewrite | Plans 2–4 (not this plan) |
