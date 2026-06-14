# Plan 4a: Write-Side Suggestion Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Sub-plan of `import-review-workflow-redesign-plan-4-complete-new-ui.md`.

**Goal:** Stop `region_match_suggestions` from accumulating duplicate rows for the same `(region_id, division_id)` and stop on-demand finders from re-suggesting an already-assigned division — at the write side, via a partial unique index + a shared `upsertSuggestion` helper used by all insert sites, plus a migration that cleans existing dups.

**Architecture:** A partial unique index `(region_id, division_id) WHERE rejected = false` makes one active suggestion per division enforceable. A single `upsertSuggestion(client, s)` helper runs an `ON CONFLICT … DO UPDATE` (keep best score) and, for finders, skips divisions already in `region_members`. All ~10 inline INSERTs route through it. The Plan-3g read-side dedup stays as defense-in-depth.

**Tech Stack:** Express + `pg`/PostGIS; Vitest mocked-pool SQL-shape tests; migration applied via `docker exec … psql`.

**Why ordering matters:** an `ON CONFLICT (cols) WHERE pred` clause REQUIRES a matching unique index to exist, and once the index exists a plain (non-`ON CONFLICT`) insert THROWS on a dup. So: write ALL code first (helper + every call-site wired), write the migration file, and only THEN apply the migration to the dev DB (by which point the running code already uses `ON CONFLICT`). Tasks below follow that order.

**Conventions:** `back:` commits, `-s`, Co-Authored-By: Claude Fable 5 trailer. Backend gates: `cd backend && npx tsc --noEmit && npx vitest run`. Never stage `.claude/commands/commit.md` / `frontend/package-lock.json` / `data/`. Dev DB: world view 2; region 54 (Chad) has the live dup (2 rows for division 48896, scores 700+996; 48896 is a member).

---

## The 10 insert sites (verified)

| Site | Columns | Role | `skipIfMember` |
|------|---------|------|----------------|
| `services/worldViewImport/matcher.ts:566` | 5 (id,div,name,path,score) | initial matcher | **false** (member inserted separately right after) |
| `services/worldViewImport/matcherGrouping.ts:473` | 5 | grouping matcher | **false** |
| `services/worldViewImport/aiMatcherApply.ts:270` | 5 | AI finder | **true** |
| `services/worldViewImport/geocodeMatcher.ts:259` | 5 | geocode finder | **true** |
| `services/worldViewImport/dbSearchMatcher.ts:156` | 5 | DB finder | **true** |
| `services/worldViewImport/pointMatcher.ts:479` | 10 (+conflict/donor) | point finder | **true** |
| `controllers/admin/wvImportHierarchyController.ts:603` | 6 (+geo_similarity) | **geoshape** finder (score=similarity×1000) | **true** |
| `controllers/admin/wvImportHierarchyController.ts:98` | 7 (+rejected,geo) | undo RESTORE | **false** |
| `controllers/admin/wvImportHierarchyController.ts:112` | 7 | undo RESTORE | **false** |
| `controllers/admin/wvImportFlattenController.ts:580` | 7 | undo RESTORE | **false** |

Restore paths keep `skipIfMember=false` and pass their explicit `rejected` (may be `true`); a `rejected=true` insert simply doesn't match the partial-index arbiter, so it's a plain insert (multiple rejected rows are allowed — they're history). Only `rejected=false` rows are deduped.

---

### Task 1: Write migration 007 + mirror in schema (do NOT apply yet)

**Files:** Create `db/migrations/007-suggestion-dedup.sql`; Modify `db/init/01-schema.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 007: Deduplicate active region_match_suggestions and enforce one
-- active suggestion per (region_id, division_id).
--
-- ~10 finder/matcher insert sites accumulated duplicate suggestion rows for the
-- same division (e.g. matcher score 700 + geoshape score 996 for the same
-- country). This cleans existing active dups (keeping the highest score, then
-- the lowest id) and adds a partial unique index so future inserts dedup via
-- ON CONFLICT. Rejected rows are history and not constrained.
--
-- Idempotent: the DELETE is a no-op once unique; CREATE INDEX IF NOT EXISTS.

DELETE FROM region_match_suggestions a
USING region_match_suggestions b
WHERE a.rejected = false AND b.rejected = false
  AND a.region_id = b.region_id
  AND a.division_id = b.division_id
  AND (a.score < b.score OR (a.score = b.score AND a.id > b.id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_match_suggestions_active_unique
  ON region_match_suggestions (region_id, division_id)
  WHERE rejected = false;
```

- [ ] **Step 2: Mirror in `db/init/01-schema.sql`** — add the same `CREATE UNIQUE INDEX … WHERE rejected = false` next to the other `region_match_suggestions` indexes (find them; match formatting). The DELETE is migration-only (fresh DBs have no dups).

- [ ] **Step 3: Commit** (`back: Add migration to dedup active suggestions.` + body + trailer). Do NOT apply to the dev DB yet (Task 4 applies it after the code is wired).

---

### Task 2: `upsertSuggestion` helper (TDD)

**Files:** Create `backend/src/services/worldViewImport/suggestionUpsert.ts`; Test `…/suggestionUpsert.test.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
import type { Pool } from 'pg';
import { upsertSuggestion } from './suggestionUpsert.js';

function mockClient() { return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool; }

describe('upsertSuggestion', () => {
  it('upserts with ON CONFLICT on the active partial index, keeping the best score', async () => {
    const c = mockClient();
    await upsertSuggestion(c, { regionId: 1, divisionId: 2, name: 'X', path: 'a>X', score: 700 });
    const [sql, params] = (c.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(region_id, division_id\) WHERE rejected = false/);
    expect(sql).toMatch(/score = GREATEST\(region_match_suggestions\.score, EXCLUDED\.score\)/);
    expect(sql).not.toMatch(/NOT EXISTS/); // default skipIfMember=false
    expect(params.slice(0, 5)).toEqual([1, 2, 'X', 'a>X', 700]);
  });

  it('skips divisions already assigned when skipIfMember=true (INSERT … SELECT … WHERE NOT EXISTS)', async () => {
    const c = mockClient();
    await upsertSuggestion(c, { regionId: 1, divisionId: 2, name: 'X', path: 'p', score: 996, geoSimilarity: 0.99, skipIfMember: true });
    const [sql] = (c.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM region_members rm WHERE rm\.region_id = \$1 AND rm\.division_id = \$2/);
    expect(sql).toMatch(/ON CONFLICT \(region_id, division_id\) WHERE rejected = false/);
  });

  it('carries conflict/donor + rejected fields when provided', async () => {
    const c = mockClient();
    await upsertSuggestion(c, { regionId: 1, divisionId: 2, name: 'X', path: 'p', score: 5, rejected: true, conflictType: 'split', donorRegionId: 9, donorDivisionId: 8, donorRegionName: 'D', donorDivisionName: 'd' });
    const [, params] = (c.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toContain('split'); expect(params).toContain(true);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`cd backend && npx vitest run src/services/worldViewImport/suggestionUpsert.test.ts`).

- [ ] **Step 3: Implement**

```typescript
/**
 * Shared upsert for region_match_suggestions (Plan 4a).
 * Dedups one active suggestion per (region_id, division_id) via the partial
 * unique index (migration 007); finders pass skipIfMember to avoid suggesting
 * an already-assigned division. Restore paths pass their explicit `rejected`.
 */
import type { Pool, PoolClient } from 'pg';

export interface SuggestionUpsert {
  regionId: number; divisionId: number; name: string; path: string; score: number;
  rejected?: boolean; geoSimilarity?: number | null;
  conflictType?: string | null; donorRegionId?: number | null; donorDivisionId?: number | null;
  donorRegionName?: string | null; donorDivisionName?: string | null;
  /** Finder calls: skip if the division is already a member of the region. */
  skipIfMember?: boolean;
}

const COLS = `(region_id, division_id, name, path, score, rejected, geo_similarity,
  conflict_type, donor_region_id, donor_division_id, donor_region_name, donor_division_name)`;

const CONFLICT = `
  ON CONFLICT (region_id, division_id) WHERE rejected = false
  DO UPDATE SET
    score = GREATEST(region_match_suggestions.score, EXCLUDED.score),
    geo_similarity = COALESCE(EXCLUDED.geo_similarity, region_match_suggestions.geo_similarity),
    name = EXCLUDED.name,
    path = EXCLUDED.path,
    conflict_type = COALESCE(EXCLUDED.conflict_type, region_match_suggestions.conflict_type),
    donor_region_id = COALESCE(EXCLUDED.donor_region_id, region_match_suggestions.donor_region_id),
    donor_division_id = COALESCE(EXCLUDED.donor_division_id, region_match_suggestions.donor_division_id),
    donor_region_name = COALESCE(EXCLUDED.donor_region_name, region_match_suggestions.donor_region_name),
    donor_division_name = COALESCE(EXCLUDED.donor_division_name, region_match_suggestions.donor_division_name)`;

export async function upsertSuggestion(client: Pool | PoolClient, s: SuggestionUpsert): Promise<void> {
  const params = [
    s.regionId, s.divisionId, s.name, s.path, s.score, s.rejected ?? false, s.geoSimilarity ?? null,
    s.conflictType ?? null, s.donorRegionId ?? null, s.donorDivisionId ?? null,
    s.donorRegionName ?? null, s.donorDivisionName ?? null,
  ];
  const values = `VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
  const fromSelect = `SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    WHERE NOT EXISTS (SELECT 1 FROM region_members rm WHERE rm.region_id = $1 AND rm.division_id = $2)`;
  const body = s.skipIfMember ? fromSelect : values;
  await client.query(`INSERT INTO region_match_suggestions ${COLS}\n${body}\n${CONFLICT}`, params);
}
```

- [ ] **Step 4: Run → PASS** (3 tests). **Step 5: Commit** (`back: Add upsertSuggestion dedup helper.` + body + trailer).

---

### Task 3: Route all 10 sites through the helper

**Files:** the 8 files in the table. For EACH inline `INSERT INTO region_match_suggestions … VALUES …`, replace with `await upsertSuggestion(<the same client/pool it used>, { … })`, mapping its columns and setting `skipIfMember` per the table. Import `upsertSuggestion` from `'../suggestionUpsert.js'` (services) or `'../../services/worldViewImport/suggestionUpsert.js'` (controllers).

- [ ] **Step 1: 5-col matcher/finder sites** — matcher.ts:566 (`skipIfMember:false`), matcherGrouping.ts:473 (`false`), aiMatcherApply.ts:270 (`true`), geocodeMatcher.ts:259 (`true`), dbSearchMatcher.ts:156 (`true`). Map `{ regionId, divisionId, name, path, score, skipIfMember }`. Keep the same client variable (these run inside their existing pool/transaction — preserve it).

- [ ] **Step 2: pointMatcher.ts:479** (10-col, finder) — pass conflict/donor fields + `skipIfMember:true`.

- [ ] **Step 3: wvImportHierarchyController.ts:603** (geoshape, 6-col) — `{ regionId, divisionId, name, path, score, geoSimilarity, skipIfMember:true }`.

- [ ] **Step 4: Restore paths** — wvImportHierarchyController.ts:98 & :112, wvImportFlattenController.ts:580 (7-col) — pass `{ …, rejected: sugg.rejected, geoSimilarity: sugg.geo_similarity ?? null }`, `skipIfMember` omitted (false). These re-insert snapshots faithfully; the upsert collapses any pre-existing active dup in the snapshot (desirable).

- [ ] **Step 5: tsc + suite** (`cd backend && npx tsc --noEmit && npx vitest run`). Fix any type mismatch (e.g., a site using a `PoolClient` vs `Pool` — the helper accepts both). 

- [ ] **Step 6: Commit** (`back: Route all suggestion inserts through upsertSuggestion.` + body listing the sites + which skip-if-member + trailer).

---

### Task 4: Apply migration + live verify + gates

- [ ] **Step 1: Apply migration to dev DB** (code is now wired, so the index + ON CONFLICT are consistent):
`docker exec -i tyr-ng-db psql -U postgres -d track_regions < db/migrations/007-suggestion-dedup.sql`
Expected: `DELETE 1` (Chad's dup) + `CREATE INDEX`. Re-run → `DELETE 0`, index already exists (idempotent).

- [ ] **Step 2: Verify Chad cleaned** — `docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "SELECT id, division_id, score, rejected FROM region_match_suggestions WHERE region_id=54 ORDER BY score DESC"` → ONE active row (the 996) remains; no two active rows for 48896.

- [ ] **Step 3: Live re-suggest test** — with the dev backend reloaded (tsx watch), run a geoshape match on a country that's already a member (e.g. Chad region 54) via the UI or curl, then re-query: NO new active row for 48896 (skipIfMember skipped it). Run a DB-search on a region with an existing suggestion for division D, twice: still one active row for D (ON CONFLICT collapsed). Report both.

- [ ] **Step 4: Full gates** — `cd backend && npx tsc --noEmit && npx vitest run` (all pass) + root `npm run knip`. Confirm no other code path inserts into `region_match_suggestions` without the helper (`rg "INSERT INTO region_match_suggestions" backend/src` → only the helper).

- [ ] **Step 5: Commit any test/fixup** if needed; otherwise Task 3's commit + the migration commit stand.

---

## Self-review checklist
1. Every one of the 10 sites routes through `upsertSuggestion`; `rg "INSERT INTO region_match_suggestions" backend/src` returns only `suggestionUpsert.ts`.
2. Restore paths preserve `rejected` semantics (rejected=true rows still insertable, not deduped against active rows).
3. Migration is idempotent and applied AFTER the code is wired (no index-without-ON-CONFLICT window in dev).
4. Read-side dedup (Plan 3g) untouched — still defends display.
5. `skipIfMember` only on the on-demand finders (not the initial matcher, which inserts the member separately, nor restores).
