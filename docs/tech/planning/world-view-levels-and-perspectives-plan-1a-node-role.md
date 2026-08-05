# Country Node-Role Foundation (Phase 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose an explicit three-level node role (`supra` | `country` | `sub`) for regions, derived from the existing country-pivot flag (`region_import_state.is_work_unit`), so later phases can drive a level-aware editing shell off it.

**Architecture:** A pure backend function derives each region's level from the world view's full region set + the `is_work_unit` pivot flag (country = pivot; sub = below a pivot; supra = above/outside any pivot). It is wired into the `GET /regions` endpoint, which now returns a `level` field. Nothing is stored — the level is computed per request, so this is fully forward-compatible with the in-flight import-review work (it does not move or rename `is_work_unit`).

**Tech Stack:** TypeScript, Express, PostgreSQL (`pg` raw pool), Vitest.

---

## Scope

This is **plan 1a of Phase 1** of
[world-view-levels-and-perspectives.md](world-view-levels-and-perspectives.md).
Phase 1 has three independent sub-plans; this one is the foundation the
others build on:

- **1a (this plan)** — node-level derivation + API exposure (backend).
- **1b** — level-aware editing shell + level switcher (frontend; consumes
  `level`; generalizes `StageSwitcher`).
- **1c** — L1 cross-cutting groupings (per
  [groupings.md](groupings.md)).

**In scope:** a tested pure function; wiring it into `getRegions`; the
frontend `Region` type field; docs.

**Not in scope (deferred, noted so it is not mistaken for an omission):**
- `getRootRegions` / `getLeafRegions` annotation — `getLeafRegions`
  returns a subset without ancestors, so the naive derivation is wrong
  there; add per-endpoint when 1b needs it.
- Storing/materializing the level (a column) — derive-only for now.
- A general "mark region as country" affordance for non-imported world
  views — until then, world views with no `is_work_unit` rows derive to
  all-`supra`, which is correct and harmless. 1b/later adds the affordance.

## Conventions for this plan

- **Tests:** Vitest. Run a single backend test file with
  `cd backend && npx vitest run <path>`. Full suites:
  `TEST_REPORT_LOCAL=1 npm test` (from repo root).
- **Pre-commit (project rule, CLAUDE.md):** before the **final** commit of
  this plan run `npm run check` (lint + typecheck + fast security + knip)
  and `TEST_REPORT_LOCAL=1 npm test`, and run `/security-check`. Per-task
  commits below run the task's own test first.
- **Commit style:** match the repo (`back:` / `front:` / `docs:` prefixes).
- **No new dependencies.**

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/src/controllers/worldView/regionLevels.ts` | Pure derivation of `RegionLevel` from `{id, parentRegionId, isWorkUnit}[]` | **Create** |
| `backend/src/controllers/worldView/regionLevels.test.ts` | Unit tests for the pure function | **Create** |
| `backend/src/controllers/worldView/regionCrud.ts` | `getRegions` selects `is_work_unit`, attaches `level`, drops `isWorkUnit` | **Modify** (`:14-46`) |
| `backend/src/controllers/worldView/regionCrud.test.ts` | Controller test: `getRegions` level annotation | **Create** |
| `frontend/src/types/index.ts` | Add `level?` to `Region` | **Modify** (`:52-70`) |
| `docs/tech/world-views.md` | Document the three node levels | **Modify** |

---

### Task 1: Pure node-level derivation

**Files:**
- Create: `backend/src/controllers/worldView/regionLevels.ts`
- Test: `backend/src/controllers/worldView/regionLevels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/worldView/regionLevels.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeRegionLevels } from './regionLevels.js';

describe('computeRegionLevels', () => {
  it('derives supra / country / sub from the pivot in a continent>country>province chain', () => {
    const levels = computeRegionLevels([
      { id: 1, parentRegionId: null, isWorkUnit: false }, // Europe
      { id: 2, parentRegionId: 1, isWorkUnit: true },     // France (pivot)
      { id: 3, parentRegionId: 2, isWorkUnit: false },    // Normandy
    ]);
    expect(levels.get(1)).toBe('supra');
    expect(levels.get(2)).toBe('country');
    expect(levels.get(3)).toBe('sub');
  });

  it('marks everything supra when there are no work units', () => {
    const levels = computeRegionLevels([
      { id: 1, parentRegionId: null, isWorkUnit: false },
      { id: 2, parentRegionId: 1, isWorkUnit: false },
    ]);
    expect(levels.get(1)).toBe('supra');
    expect(levels.get(2)).toBe('supra');
  });

  it('treats a root work unit as country and its child as sub', () => {
    const levels = computeRegionLevels([
      { id: 10, parentRegionId: null, isWorkUnit: true },
      { id: 11, parentRegionId: 10, isWorkUnit: false },
    ]);
    expect(levels.get(10)).toBe('country');
    expect(levels.get(11)).toBe('sub');
  });

  it('keeps a nested work unit as country and a node below it as sub', () => {
    const levels = computeRegionLevels([
      { id: 1, parentRegionId: null, isWorkUnit: true }, // outer country
      { id: 2, parentRegionId: 1, isWorkUnit: true },    // inner country
      { id: 3, parentRegionId: 2, isWorkUnit: false },   // below inner
    ]);
    expect(levels.get(1)).toBe('country');
    expect(levels.get(2)).toBe('country');
    expect(levels.get(3)).toBe('sub');
  });

  it('treats a node with a missing parent as supra (no pivot ancestor reachable)', () => {
    const levels = computeRegionLevels([
      { id: 5, parentRegionId: 999, isWorkUnit: false },
    ]);
    expect(levels.get(5)).toBe('supra');
  });

  it('does not infinite-loop on a parent cycle', () => {
    const levels = computeRegionLevels([
      { id: 1, parentRegionId: 2, isWorkUnit: false },
      { id: 2, parentRegionId: 1, isWorkUnit: false },
    ]);
    expect(levels.get(1)).toBe('supra');
    expect(levels.get(2)).toBe('supra');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/controllers/worldView/regionLevels.test.ts`
Expected: FAIL — `Failed to resolve import './regionLevels.js'` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `backend/src/controllers/worldView/regionLevels.ts`:

```typescript
/**
 * Three-level node role for the world-view editing experience
 * (design: docs/tech/planning/world-view-levels-and-perspectives.md).
 *
 * Derived from the country pivot (region_import_state.is_work_unit), not
 * stored — forward-compatible with the import-review workflow.
 */
export type RegionLevel = 'supra' | 'country' | 'sub';

export interface RegionLevelNode {
  id: number;
  parentRegionId: number | null;
  isWorkUnit: boolean;
}

/**
 * Derive each region's level:
 *   - 'country' if the region itself is a work-unit pivot,
 *   - 'sub'     if it has a work-unit ancestor (below a pivot),
 *   - 'supra'   otherwise (above/outside any pivot).
 *
 * `regions` must be the FULL region set of one world view; ancestor
 * lookups walk parentRegionId within the set.
 */
export function computeRegionLevels(
  regions: RegionLevelNode[],
): Map<number, RegionLevel> {
  const byId = new Map<number, RegionLevelNode>();
  for (const r of regions) byId.set(r.id, r);

  const levels = new Map<number, RegionLevel>();
  for (const r of regions) {
    if (r.isWorkUnit) {
      levels.set(r.id, 'country');
      continue;
    }
    let hasPivotAncestor = false;
    const seen = new Set<number>([r.id]); // guards against parent cycles
    let cur = r.parentRegionId;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const parent = byId.get(cur);
      if (!parent) break;
      if (parent.isWorkUnit) {
        hasPivotAncestor = true;
        break;
      }
      cur = parent.parentRegionId;
    }
    levels.set(r.id, hasPivotAncestor ? 'sub' : 'supra');
  }
  return levels;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/controllers/worldView/regionLevels.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/worldView/regionLevels.ts \
        backend/src/controllers/worldView/regionLevels.test.ts
git commit -m "back: add computeRegionLevels (supra/country/sub node levels)"
```

---

### Task 2: Annotate `getRegions` with the derived level

**Files:**
- Modify: `backend/src/controllers/worldView/regionCrud.ts:14-46`
- Test: `backend/src/controllers/worldView/regionCrud.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/worldView/regionCrud.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { getRegions } from './regionCrud.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function mockRes() {
  const res = {} as { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

describe('getRegions level annotation', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('annotates each region with its derived level and hides isWorkUnit', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, parentRegionId: null, isWorkUnit: false, name: 'Europe' },
        { id: 2, parentRegionId: 1, isWorkUnit: true, name: 'France' },
        { id: 3, parentRegionId: 2, isWorkUnit: false, name: 'Normandy' },
      ],
    });
    const req = { params: { worldViewId: '1' } } as unknown as Parameters<typeof getRegions>[0];
    const res = mockRes();

    await getRegions(req, res as unknown as Parameters<typeof getRegions>[1]);

    const payload = res.json.mock.calls[0][0] as Array<{ id: number; level: string }>;
    expect(payload.map((r) => [r.id, r.level])).toEqual([
      [1, 'supra'],
      [2, 'country'],
      [3, 'sub'],
    ]);
    expect(payload.every((r) => !('isWorkUnit' in r))).toBe(true);
  });

  it('selects is_work_unit from region_import_state', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const req = { params: { worldViewId: '1' } } as unknown as Parameters<typeof getRegions>[0];
    await getRegions(req, mockRes() as unknown as Parameters<typeof getRegions>[1]);
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/is_work_unit/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/controllers/worldView/regionCrud.test.ts`
Expected: FAIL — payload rows have no `level` (and `isWorkUnit` is still present / not selected).

- [ ] **Step 3: Implement the change**

In `backend/src/controllers/worldView/regionCrud.ts`:

(a) Add the import near the top (after the existing imports, around line 9):

```typescript
import { computeRegionLevels } from './regionLevels.js';
```

(b) In `getRegions`, add `is_work_unit` to the SELECT — replace the two
trailing select lines (`:37-38`):

```typescript
      ris.source_url as "sourceUrl",
      ris.region_map_url as "regionMapUrl",
      ris.is_work_unit as "isWorkUnit"
```

(c) Replace the final `res.json(result.rows);` (`:45`) with level
derivation that also strips the internal `isWorkUnit`:

```typescript
  const levels = computeRegionLevels(
    result.rows.map((r) => ({
      id: r.id,
      parentRegionId: r.parentRegionId,
      isWorkUnit: r.isWorkUnit === true,
    })),
  );
  const rows = result.rows.map(({ isWorkUnit: _isWorkUnit, ...r }) => ({
    ...r,
    level: levels.get(r.id) ?? 'supra',
  }));

  res.json(rows);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/controllers/worldView/regionCrud.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/worldView/regionCrud.ts \
        backend/src/controllers/worldView/regionCrud.test.ts
git commit -m "back: annotate getRegions with derived node level"
```

---

### Task 3: Expose `level` on the frontend `Region` type

**Files:**
- Modify: `frontend/src/types/index.ts:52-70`

- [ ] **Step 1: Add the field**

In `frontend/src/types/index.ts`, inside the `Region` interface, add after
the `regionMapUrl?` line (`:69`):

```typescript
  // Working level derived from the country pivot: above (supra), the
  // country pivot itself, or below it (sub). Set by GET /regions.
  level?: 'supra' | 'country' | 'sub';
```

- [ ] **Step 2: Typecheck (this is a pure type addition — no runtime test)**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors). The field is optional, so existing call
sites keep compiling.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "front: add level field to Region type"
```

---

### Task 4: Document the node levels

**Files:**
- Modify: `docs/tech/world-views.md`

- [ ] **Step 1: Add a "Node levels" subsection**

In `docs/tech/world-views.md`, under the **Core Concepts** section (after
the `### Region` subsection), add:

```markdown
### Node levels (supra / country / sub)

Every region carries a derived **level** that classifies its altitude in
the hierarchy, returned by `GET /api/world-views/:id/regions` as `level`:

- **`country`** — the country pivot (a region flagged
  `region_import_state.is_work_unit`).
- **`sub`** — a region below a country pivot (a country subdivision).
- **`supra`** — a region above or outside any pivot (continents,
  cross-country groupings).

The level is **derived per request** from the pivot flag and the tree
shape, not stored (see
`backend/src/controllers/worldView/regionLevels.ts`). A world view with no
work units derives to all-`supra`. This is the foundation for the
level-aware editing shell — see
[planning/world-view-levels-and-perspectives.md](planning/world-view-levels-and-perspectives.md).
```

- [ ] **Step 2: Commit**

```bash
git add docs/tech/world-views.md
git commit -m "docs: document world-view node levels"
```

---

### Task 5: Final gate

- [ ] **Step 1: Run the project gate**

Run (from repo root): `npm run check`
Expected: PASS (lint + typecheck + fast security + knip). If knip flags
`computeRegionLevels`/`RegionLevel` as unused, that means Task 2 wiring is
missing — fix before proceeding (they must be imported by `regionCrud.ts`).

- [ ] **Step 2: Run the unit suites**

Run (from repo root): `TEST_REPORT_LOCAL=1 npm test`
Expected: PASS, including the two new test files.

- [ ] **Step 3: Security check**

Run `/security-check` on the changed files. Expected: clean (no new input
surface — `getRegions` already existed; this only adds a derived field).

---

## Self-Review (completed by plan author)

- **Spec coverage:** Implements the "formalize the country node role"
  item of Phase 1 in the umbrella spec. The other Phase 1 items (shell +
  level switcher; L1 groupings) are explicitly separate plans (1b, 1c) per
  the Scope section — not omissions.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `RegionLevel` / `RegionLevelNode` /
  `computeRegionLevels` names match across the function, its test, and the
  controller wiring; the frontend literal union `'supra' | 'country' |
  'sub'` matches the backend `RegionLevel`.
```
