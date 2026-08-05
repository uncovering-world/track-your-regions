# Base Layer World View + Visibility — Implementation Plan (Branch 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give experiences a region-backed world view to live in — a hidden mirror of the administrative base layer, built through the existing import pipeline — and make world view visibility an explicit, server-enforced setting.

**Architecture:** Two slices in one branch. S1 adds `world_views.is_public`, moves visibility filtering from the browser to the server, and guards the region read surface with one middleware. S3 adds a `baseLayerImporter` that generates its tree straight from `administrative_divisions` — names and hierarchy only — and hands it to the existing `startImport`, so the ordinary matcher resolves it and geometry is computed the ordinary way. Tile access (S2) is a separate branch and is out of scope here.

> **Revised 2026-07-27.** An earlier draft of this paragraph described the design that was rejected mid-branch: pre-resolved divisions, geometry copied instead of unioned, experience assignment chained into the import. None of that shipped. See the revision note above Task 6.

**Tech Stack:** Express + TypeScript (ESM, `.js` import suffixes), PostgreSQL/PostGIS via `pg` `pool`, Vitest, React + MUI + TanStack Query, Zod for request validation.

**Spec:** `docs/tech/planning/base-layer-world-view-and-visibility.md`

## Global Constraints

- **Never hardcode the provider name.** The concept is "base layer"; GADM is only today's provider and may become OpenBoundaries. Code says `base_layer`; the provider name lives in data (`world_views.source`, set from a request parameter). Do not add "GADM" to any new type, function, column, route or UI label.
- **ESM imports carry the `.js` suffix** even for `.ts` files (`import { pool } from '../../db/index.js'`).
- **Tests are Vitest, colocated** as `src/**/*.test.ts`. The house style mocks the database rather than hitting it: `vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }))`, then assert on the SQL text and parameters. See `backend/src/controllers/worldView/helpers.test.ts` for the idiom.
- **Zod schemas live in `backend/src/types/index.ts`** and are applied by the `validate()` middleware in the route definition.
- **`/api/admin/*` is already guarded** by `requireAuth` + `requireAdmin` at mount time (`backend/src/routes/index.ts:37`). Do not re-add those to individual admin routes.
- **Commit format** is `<Type>: <Topic>.` where `<Type>` is `back`, `front`, `deploy`, or omitted — never Conventional Commits. Title imperative, max 72 chars, ends with a period. Body wrapped at 72 explaining what and why. Always `git commit -s`. AI-assisted commits add:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- **Keep files under ~500 lines.** `frontend/src/components/admin/WorldViewImportPanel.tsx` is already 907 — new UI goes in its own file, never inlined there.
- **Pre-commit gate:** `npm run check` and `TEST_REPORT_LOCAL=1 npm test` before every commit; `/security-check` on changed files. An intermediate commit in this plan may be red (a schema before its consumer), but the branch must be green before it leaves the machine. Before pushing: `npm run security:all` and `npm run test:e2e:smoke`.
- **Docs land with the code**, not as a follow-up. Task 13 is the documentation task and closes the branch.

---

### Task 1: `is_public` column on world views

**Files:**
- Modify: `db/init/01-schema.sql` (after the `idx_world_views_single_default` index, around line 134)
- Create: `db/migrations/007-world-view-visibility.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `world_views.is_public BOOLEAN NOT NULL DEFAULT false` — every later task reads or writes it.

- [ ] **Step 1: Add the column to the canonical schema**

In `db/init/01-schema.sql`, immediately after the `CREATE UNIQUE INDEX ... idx_world_views_single_default` statement and before the `INSERT INTO world_views` seed, add:

```sql
-- Visibility: a world view is admin-only until an admin publishes it. New
-- imports and the seeded base-layer default start hidden, which is why the
-- column defaults to false. Enforced server-side in getWorldViews and the
-- requireVisibleWorldView middleware, not in the browser.
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN world_views.is_public IS 'False = admin-only. True = listed and readable for everyone.';
```

`ALTER ... IF NOT EXISTS` rather than a column inside `CREATE TABLE`: re-applying `01-schema.sql` to a live database is how new columns arrive (`db/migrations/README.md`), so the file must stay idempotent.

- [ ] **Step 2: Write the backfill migration**

Create `db/migrations/007-world-view-visibility.sql`:

```sql
-- 007: Backfill world view visibility.
--
-- Run AFTER re-applying db/init/01-schema.sql (which adds the column).
--
-- The column defaults to false, so without this every existing world view would
-- vanish for non-admins the moment the server-side filter lands. Today's rule is
-- "the default world view is admin-only, everything else is visible to all" —
-- implemented until now as a client-side filter in HierarchySwitcher. This
-- reproduces exactly that state, so the change is behaviour-preserving.
--
-- One-shot: re-running is harmless but will re-publish world views an admin has
-- since hidden, so do not fold it into 01-schema.sql.

\set ON_ERROR_STOP on

BEGIN;

UPDATE world_views
SET is_public = true
WHERE is_default = false
  AND is_public = false;

COMMIT;
```

- [ ] **Step 3: Apply both to the dev database and verify**

```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/init/01-schema.sql
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/007-world-view-visibility.sql
docker exec -i tyr-ng-db psql -U postgres -d track_regions \
  -c "SELECT id, name, is_default, is_public FROM world_views ORDER BY id;"
```

Expected: world view 1 (`GADM`, `is_default = t`) has `is_public = f`; world view 2 (`Wikivoyage Regions`) has `is_public = t`.

Nikolay's canon world view is published by this backfill because that is its state today. Once Task 4 ships the toggle, hide it from the UI if that is what he wants — that is a data decision, not a code one.

- [ ] **Step 4: Run the schema guard test**

```bash
cd backend && npx vitest run src/db/schemaSeeds.test.ts
```

Expected: PASS. This test guards the "every seed INSERT names a real unique arbiter" rule; adding a column must not disturb it.

- [ ] **Step 5: Commit**

```bash
git add db/init/01-schema.sql db/migrations/007-world-view-visibility.sql
git commit -s -m "$(cat <<'EOF'
Add a visibility flag to world views.

World view visibility was implicit: the default world view was hidden
from non-admins by a filter in the browser, and every other world view
was visible to everyone with no way to change that. Add is_public so
visibility becomes an explicit per-world-view setting, defaulting to
hidden so newly imported world views are not published by accident.

Migration 007 backfills is_public = NOT is_default, reproducing the
current behaviour exactly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Server-side visibility in the world view list and update

**Files:**
- Modify: `backend/src/controllers/worldView/worldViewCrud.ts:12-22` (`getWorldViews`), `:40-60` (`updateWorldView`)
- Modify: `backend/src/types/index.ts:657` (`updateWorldViewBodySchema`)
- Test: `backend/src/controllers/worldView/worldViewCrud.test.ts` (create)

**Interfaces:**
- Consumes: `world_views.is_public` (Task 1)
- Produces: `GET /api/world-views` returns `isPublic` and hides non-public rows from non-admins; `PUT /api/world-views/:worldViewId` accepts `isPublic?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/worldView/worldViewCrud.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { getWorldViews, updateWorldView } from './worldViewCrud.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('getWorldViews visibility', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('hides non-public world views from anonymous callers', async () => {
    const res = makeRes();
    await getWorldViews({} as never, res as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    // Pin the WHERE fragment, not just the string "is_public" — that appears in
    // the SELECT list too, so a looser assertion stays green even if the filter
    // is deleted outright, which is the exact bug this task exists to prevent.
    expect(sql).toMatch(/AND\s*\(\$1::boolean OR is_public\)/);
    expect(params).toEqual([false]);
  });

  it('shows every active world view to admins', async () => {
    const res = makeRes();
    await getWorldViews({ user: { role: 'admin' } } as never, res as never);

    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([true]);
  });

  it('returns isPublic to the client', async () => {
    const res = makeRes();
    await getWorldViews({} as never, res as never);

    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/is_public as "isPublic"/);
  });
});

describe('updateWorldView visibility', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [{ id: 5 }] });
  });

  it('passes isPublic: false through instead of collapsing it to null', async () => {
    // Regression guard: `isPublic || null` would make hiding a world view
    // impossible, since false and null both mean "leave unchanged" to COALESCE.
    const res = makeRes();
    await updateWorldView(
      { params: { worldViewId: '5' }, body: { isPublic: false } } as never,
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(false);
  });

  it('leaves visibility untouched when isPublic is absent', async () => {
    const res = makeRes();
    await updateWorldView(
      { params: { worldViewId: '5' }, body: { name: 'Renamed' } } as never,
      res as never,
    );

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/is_public = COALESCE\(\$4, is_public\)/);
    expect(params[3]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx vitest run src/controllers/worldView/worldViewCrud.test.ts
```

Expected: FAIL — the current SQL selects no `is_public` and passes no parameters.

- [ ] **Step 3: Implement**

In `backend/src/controllers/worldView/worldViewCrud.ts`, replace `getWorldViews`:

```ts
/**
 * Get all World Views visible to the caller.
 *
 * Non-admins see only published (`is_public`) world views. The filter lives here
 * rather than in the client so a hidden world view is not merely absent from a
 * dropdown — it is absent from the response.
 */
export async function getWorldViews(req: AuthenticatedRequest, res: Response): Promise<void> {
  const isAdmin = req.user?.role === 'admin';
  const result = await pool.query(`
    SELECT id, name, description, source, is_default as "isDefault",
           is_public as "isPublic",
           COALESCE(tile_version, 0) as "tileVersion"
    FROM world_views
    WHERE is_active = true
      AND ($1::boolean OR is_public)
    ORDER BY is_default DESC, name
  `, [isAdmin]);

  res.json(result.rows);
}
```

Add the import at the top of the file:

```ts
import type { AuthenticatedRequest } from '../../middleware/auth.js';
```

Replace the body of `updateWorldView`'s query:

```ts
export async function updateWorldView(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { name, description, source, isPublic } = req.body;

  const result = await pool.query(
    `UPDATE world_views
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         source = COALESCE($3, source),
         is_public = COALESCE($4, is_public),
         updated_at = NOW()
     WHERE id = $5
     RETURNING id, name, description, source, is_default as "isDefault",
               is_public as "isPublic"`,
    // `?? null`, not `|| null`: false is a meaningful value here.
    [name || null, description || null, source || null, isPublic ?? null, worldViewId]
  );
```

In `backend/src/types/index.ts`, extend `updateWorldViewBodySchema`:

```ts
export const updateWorldViewBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  source: z.string().max(1000).optional(),
  isPublic: z.boolean().optional(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx vitest run src/controllers/worldView/worldViewCrud.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify by hand against the running stack**

```bash
curl -s http://localhost:3001/api/world-views | head -20
```

Expected: only the Wikivoyage world view; no `GADM` entry (it is `is_public = false` and the request is anonymous).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/worldView/worldViewCrud.ts backend/src/types/index.ts backend/src/controllers/worldView/worldViewCrud.test.ts
git commit -s -m "$(cat <<'EOF'
back: Filter world views by visibility on the server.

getWorldViews returned every active world view to every caller and the
default one was hidden only by a filter in HierarchySwitcher, so any
client could read a world view it was not meant to see. Filter by
is_public for non-admins, return the flag so the UI can show it, and
let PUT /api/world-views/:id set it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `requireVisibleWorldView` middleware on the region read surface

**Files:**
- Create: `backend/src/middleware/worldViewVisibility.ts`
- Test: `backend/src/middleware/worldViewVisibility.test.ts` (create)
- Modify: `backend/src/routes/worldViewRoutes.ts`, `backend/src/routes/experienceRoutes.ts`

**Interfaces:**
- Consumes: `world_views.is_public` (Task 1)
- Produces: `requireVisibleWorldView(source: VisibilitySource)` returning an Express middleware, where `type VisibilitySource = 'worldViewIdParam' | 'worldViewIdQuery' | 'regionIdParam'`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/middleware/worldViewVisibility.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db/index.js';
import { requireVisibleWorldView } from './worldViewVisibility.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('requireVisibleWorldView', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('lets admins through without querying', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { user: { role: 'admin' }, params: { worldViewId: '1' } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('lets anonymous callers through for a published world view', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: { worldViewId: '2' } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 404 for a hidden world view, not 403', async () => {
    // 403 would confirm the world view exists. 404 says nothing.
    mockedQuery.mockResolvedValue({ rows: [{ is_public: false }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: { worldViewId: '1' } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 404 when the id does not resolve at all', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: { worldViewId: '999' } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves a region id through its world view', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('regionIdParam')(
      { params: { regionId: '42' } } as never,
      res as never,
      next,
    );

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM regions r/);
    expect(sql).toMatch(/JOIN world_views wv ON wv\.id = r\.world_view_id/);
    expect(params).toEqual([42]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reads the world view id from the query string when told to', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdQuery')(
      { query: { worldViewId: '7' } } as never,
      res as never,
      next,
    );

    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the id is missing or unparseable', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdQuery')(
      { query: {} } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx vitest run src/middleware/worldViewVisibility.test.ts
```

Expected: FAIL with a module resolution error — `worldViewVisibility.js` does not exist.

- [ ] **Step 3: Implement the middleware**

Create `backend/src/middleware/worldViewVisibility.ts`:

```ts
/**
 * World view visibility guard.
 *
 * A world view with `is_public = false` is admin-only. This middleware enforces
 * that on the read surface, so hiding one is a real access decision rather than a
 * missing dropdown entry.
 *
 * Tile access is a separate boundary and is NOT covered here: Martin publishes
 * its tile functions on a public port, so a hidden world view's geometry remains
 * fetchable by tile id until that is closed.
 */

import type { Response, NextFunction } from 'express';
import { pool } from '../db/index.js';
import type { AuthenticatedRequest } from './auth.js';

/** Where in the request the identifier lives. */
export type VisibilitySource = 'worldViewIdParam' | 'worldViewIdQuery' | 'regionIdParam';

const BY_WORLD_VIEW = `
  SELECT is_public
  FROM world_views
  WHERE id = $1 AND is_active = true
`;

const BY_REGION = `
  SELECT wv.is_public
  FROM regions r
  JOIN world_views wv ON wv.id = r.world_view_id
  WHERE r.id = $1 AND wv.is_active = true
`;

function readId(req: AuthenticatedRequest, source: VisibilitySource): number | null {
  const raw = source === 'worldViewIdQuery'
    ? req.query?.worldViewId
    : source === 'regionIdParam'
      ? req.params?.regionId
      : req.params?.worldViewId;
  const id = parseInt(String(raw ?? ''), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function requireVisibleWorldView(source: VisibilitySource) {
  return async function visibilityGuard(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (req.user?.role === 'admin') {
      next();
      return;
    }

    const id = readId(req, source);
    if (id === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const sql = source === 'regionIdParam' ? BY_REGION : BY_WORLD_VIEW;
    const result = await pool.query(sql, [id]);

    // A missing row and a hidden world view get the same answer on purpose:
    // 404 leaks nothing about which world views exist.
    if (result.rows.length === 0 || result.rows[0].is_public !== true) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    next();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx vitest run src/middleware/worldViewVisibility.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it onto every public read route**

In `backend/src/routes/worldViewRoutes.ts`, add the import:

```ts
import { requireVisibleWorldView } from '../middleware/worldViewVisibility.js';
```

Insert `requireVisibleWorldView(...)` immediately after `optionalAuth` on each of these routes (the guard needs `req.user`, so it must come after `optionalAuth`):

| Route | Source argument |
|---|---|
| `GET /:worldViewId/regions` | `'worldViewIdParam'` |
| `GET /:worldViewId/regions/root` | `'worldViewIdParam'` |
| `GET /:worldViewId/regions/search` | `'worldViewIdParam'` |
| `GET /:worldViewId/regions/leaf` | `'worldViewIdParam'` |
| `GET /:worldViewId/regions/root/geometries` | `'worldViewIdParam'` |
| `GET /:worldViewId/compute-geometries/status` | `'worldViewIdParam'` |
| `POST /:worldViewId/division-usage` | `'worldViewIdParam'` |
| `GET /:worldViewId/display-geometry-status` | `'worldViewIdParam'` |
| `GET /regions/:regionId/ancestors` | `'regionIdParam'` |
| `GET /regions/:regionId/subregions` | `'regionIdParam'` |
| `GET /regions/:regionId/members` | `'regionIdParam'` |
| `GET /regions/:regionId/members/geometries` | `'regionIdParam'` |
| `GET /regions/:regionId/members/descendant-geometries` | `'regionIdParam'` |
| `GET /regions/:regionId/geometry` | `'regionIdParam'` |
| `GET /regions/:regionId/subregions/geometries` | `'regionIdParam'` |
| `GET /regions/:regionId/hull/params` | `'regionIdParam'` |

Example of the resulting line:

```ts
router.get('/:worldViewId/regions/root', publicReadLimiter, validate(worldViewIdParamSchema, 'params'), optionalAuth, requireVisibleWorldView('worldViewIdParam'), getRootRegions);
```

Admin-only routes (`requireAuth` + `requireAdmin`) need no guard — `requireAdmin` is strictly stronger.

In `backend/src/routes/experienceRoutes.ts`, add the same import and guard three routes — these are the complete replacement lines:

```ts
router.get('/region-counts', publicReadLimiter, validate(experienceRegionCountsQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('worldViewIdQuery'), getExperienceRegionCounts);
router.get('/by-region/:regionId', publicReadLimiter, validate(regionIdParamSchema, 'params'), validate(experiencesByRegionQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('regionIdParam'), getExperiencesByRegion);
router.get('/by-region/:regionId/locations', publicReadLimiter, validate(regionIdParamSchema, 'params'), validate(regionLocationsQuerySchema, 'query'), optionalAuth, requireVisibleWorldView('regionIdParam'), getRegionExperienceLocations);
```

Two of these gain `optionalAuth`, which they do not have today: `/region-counts` and `/by-region/:regionId/locations`. Without it the guard sees no `req.user` and treats an admin as anonymous, so a hidden world view would 404 for its own owner.

- [ ] **Step 6: Verify the whole surface by hand**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/world-views/1/regions/root
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/world-views/2/regions/root
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3001/api/experiences/region-counts?worldViewId=1"
```

Expected: `404`, `200`, `404`.

- [ ] **Step 7: Run the full backend suite**

```bash
TEST_REPORT_LOCAL=1 npm test
```

Expected: PASS. A failure here most likely means a test asserted on an unguarded route — fix the test to authenticate, not the guard.

- [ ] **Step 8: Commit**

```bash
git add backend/src/middleware/worldViewVisibility.ts backend/src/middleware/worldViewVisibility.test.ts backend/src/routes/worldViewRoutes.ts backend/src/routes/experienceRoutes.ts
git commit -s -m "$(cat <<'EOF'
back: Guard region reads by world view visibility.

Listing world views by visibility is not enough: every region read
endpoint took an id and answered, so a hidden world view stayed fully
readable by anyone who knew a region id. Add one middleware that
resolves the world view from either the route or a region and answers
404 — never 403, which would confirm existence — and apply it to the
public read surface of both routers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Visibility in the UI

**Files:**
- Modify: `frontend/src/types/index.ts:35-42` (`WorldView`)
- Modify: `frontend/src/api/worldViews.ts:19-24` (`updateWorldView`)
- Modify: `frontend/src/components/HierarchySwitcher.tsx` (filter removal + settings dialog toggle)

**Interfaces:**
- Consumes: `isPublic` from `GET /api/world-views`, `isPublic` accepted by `PUT /api/world-views/:id` (Task 2)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Extend the type and the API client**

`frontend/src/types/index.ts`:

```ts
export interface WorldView {
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  isDefault: boolean;
  /** False = admin-only. Absent for non-admins, who only ever receive public ones. */
  isPublic?: boolean;
  tileVersion?: number;
}
```

`frontend/src/api/worldViews.ts`:

```ts
export async function updateWorldView(
  worldViewId: number,
  data: { name?: string; description?: string; source?: string; isPublic?: boolean },
): Promise<WorldView> {
  return authFetchJson<WorldView>(`${API_URL}/api/world-views/${worldViewId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
```

- [ ] **Step 2: Drop the client-side filter**

In `frontend/src/components/HierarchySwitcher.tsx`, replace the block at lines 118–121:

```ts
  // Filter world views - non-admin users can't see GADM (default) world view
  const visibleWorldViews = isAdmin
    ? worldViews
    : worldViews.filter(w => !w.isDefault);
```

with:

```ts
  // The server already filters by visibility (requireVisibleWorldView /
  // getWorldViews); whatever arrived here is what this user may see.
  const visibleWorldViews = worldViews;
```

Keep the `useEffect` below it — it re-selects a valid world view when the current one disappears, which now also covers an admin hiding the world view a visitor is looking at — but drop `isAdmin` from its dependency array (line 133). It is no longer an input to that effect, and leaving it there re-runs the effect on every auth change for nothing.

`isAdmin` itself stays: line 169 still gates admin-only controls with it.

- [ ] **Step 3: Add the toggle to the settings dialog**

The settings dialog already edits name and description via `editName` / `editDescription` state and `handleUpdateWorldView`. Add alongside them:

```tsx
const [editIsPublic, setEditIsPublic] = useState(false);
```

In `handleOpenSettings`, seed it:

```ts
setEditIsPublic(selectedWorldView.isPublic ?? false);
```

In `handleUpdateWorldView`, send it:

```ts
      updateMutation.mutate({
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        isPublic: editIsPublic,
      });
```

In the dialog body, after the description field:

```tsx
<FormControlLabel
  control={
    <Switch
      checked={editIsPublic}
      onChange={(e) => setEditIsPublic(e.target.checked)}
    />
  }
  label="Visible to everyone"
/>
<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.5 }}>
  Off: only admins can see or read this world view.
</Typography>
```

Add `FormControlLabel` and `Switch` to the existing `@mui/material` import.

- [ ] **Step 4: Mark hidden world views in the picker**

In the `MenuItem` rendering of each world view (around line 162, where `worldView.isDefault && ' (Default)'` is rendered), add after that expression:

```tsx
{worldView.isPublic === false && (
  <Chip label="Hidden" size="small" sx={{ ml: 1 }} />
)}
```

Add `Chip` to the `@mui/material` import if it is not already there.

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

As an admin, open the world view picker: `GADM` shows a `Hidden` chip. Open its settings, flip "Visible to everyone" on, save. Log out (or open a private window) and confirm it now appears; flip it back off and confirm it disappears again.

- [ ] **Step 6: Run the checks and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
git add frontend/src/types/index.ts frontend/src/api/worldViews.ts frontend/src/components/HierarchySwitcher.tsx
git commit -s -m "$(cat <<'EOF'
front: Let admins publish or hide a world view.

The picker decided visibility itself by filtering out the default world
view. Now that the server filters by is_public, drop that rule and give
admins the switch instead: a toggle in the world view settings dialog
and a Hidden chip in the picker.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Name the import source types instead of repeating them

**Files:**
- Create: `backend/src/services/worldViewImport/sourceTypes.ts`
- Test: `backend/src/services/worldViewImport/sourceTypes.test.ts` (create)
- Modify: `backend/src/controllers/admin/wvImportLifecycleController.ts:142`, `wvImportFinalizeController.ts:82-85`, `wvImportRematchController.ts:35`, `wikivoyageExtractController.ts:55-60`

**Interfaces:**
- Consumes: nothing
- Produces: `IMPORT_SOURCE_TYPES`, `IMPORT_SOURCE_TYPES_ALL`, `WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL`, `finalizedSourceType(sourceType: string): string`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/worldViewImport/sourceTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  IMPORT_SOURCE_TYPES,
  IMPORT_SOURCE_TYPES_ALL,
  WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL,
  finalizedSourceType,
} from './sourceTypes.js';

describe('import source types', () => {
  it('includes the base layer source', () => {
    expect(IMPORT_SOURCE_TYPES).toContain('base_layer');
  });

  it('pairs every source type with its finalized form', () => {
    expect(IMPORT_SOURCE_TYPES_ALL).toEqual([
      'wikivoyage', 'wikivoyage_done',
      'imported', 'imported_done',
      'base_layer', 'base_layer_done',
    ]);
  });

  it('keeps the Wikivoyage-eligible set free of base-layer world views', () => {
    // A base-layer mirror must never be offered as a target for Wikivoyage
    // extraction. This set reproduces exactly what that endpoint listed before.
    expect(WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL).toEqual([
      'wikivoyage', 'wikivoyage_done', 'imported', 'imported_done',
    ]);
  });

  it('derives the finalized name by suffix', () => {
    expect(finalizedSourceType('base_layer')).toBe('base_layer_done');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx vitest run src/services/worldViewImport/sourceTypes.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `backend/src/services/worldViewImport/sourceTypes.ts`:

```ts
/**
 * World view source types produced by the import pipeline.
 *
 * These lived as four copies of the same inline SQL allowlist, which is why a new
 * source type was invisible to the review, finalize and rematch endpoints until
 * all four were found. Add a source type here and the pipeline picks it up.
 *
 * A source type gains a `_done` suffix once its match review is finalized
 * (wvImportFinalizeController).
 */

/** Source types whose review is still open. */
export const IMPORT_SOURCE_TYPES = ['wikivoyage', 'imported', 'base_layer'] as const;

export type ImportSourceType = typeof IMPORT_SOURCE_TYPES[number];

/** The finalized name for a source type. */
export function finalizedSourceType(sourceType: string): string {
  return `${sourceType}_done`;
}

/** Both states — open and finalized — for each of `types`, in order. */
function withFinalized(types: readonly string[]): string[] {
  return types.flatMap((t) => [t, finalizedSourceType(t)]);
}

/** Every source type the import pipeline owns, in both states. */
export const IMPORT_SOURCE_TYPES_ALL: string[] = withFinalized(IMPORT_SOURCE_TYPES);

/**
 * World views that may be targeted by Wikivoyage extraction. Deliberately
 * excludes `base_layer`: a mirror of the administrative base layer is generated,
 * never extracted from an article.
 */
export const WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL: string[] =
  withFinalized(['wikivoyage', 'imported']);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx vitest run src/services/worldViewImport/sourceTypes.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Replace the four inline allowlists**

`wvImportLifecycleController.ts` (around line 140) — replace the inline `IN (...)` with a parameter:

```ts
  const result = await pool.query(`
    SELECT id, name, source_type FROM world_views
    WHERE source_type = ANY($1)
    ORDER BY id DESC
  `, [IMPORT_SOURCE_TYPES_ALL]);
```

`wvImportRematchController.ts` (around line 35):

```ts
  const check = await pool.query(
    `SELECT id FROM world_views WHERE id = $1 AND source_type = ANY($2)`,
    [worldViewId, IMPORT_SOURCE_TYPES_ALL],
  );
```

`wvImportFinalizeController.ts` (around line 82) — this one uses the *open* set, not both states, because finalizing an already-finalized world view is a no-op:

```ts
  const result = await pool.query(
    `UPDATE world_views SET source_type = source_type || '_done'
     WHERE id = $1 AND source_type = ANY($2)
     RETURNING id, source_type`,
    [worldViewId, [...IMPORT_SOURCE_TYPES]],
  );
```

Keep the existing `|| '_done'` SQL as it is — `finalizedSourceType` documents the same rule for TypeScript callers; do not rewrite working SQL to use it.

`wikivoyageExtractController.ts` (around line 55):

```ts
  const wvResult = await pool.query(`
    SELECT wv.id, wv.name, wv.source_type
    FROM world_views wv
    WHERE wv.source_type = ANY($1)
    ORDER BY wv.id DESC
  `, [WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL]);
```

Add the corresponding import to each of the four files, e.g.:

```ts
import { IMPORT_SOURCE_TYPES_ALL } from '../../services/worldViewImport/sourceTypes.js';
```

- [ ] **Step 6: Verify nothing changed behaviourally**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
curl -s http://localhost:3001/api/admin/wv-import/import/status | head -5
```

The last call needs an admin token; if you do not have one to hand, load the admin dashboard's import panel in the browser instead and confirm the world view list is unchanged.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/worldViewImport/sourceTypes.ts backend/src/services/worldViewImport/sourceTypes.test.ts backend/src/controllers/admin/wvImportLifecycleController.ts backend/src/controllers/admin/wvImportFinalizeController.ts backend/src/controllers/admin/wvImportRematchController.ts backend/src/controllers/admin/wikivoyageExtractController.ts
git commit -s -m "$(cat <<'EOF'
back: Name the import source types in one place.

The same allowlist of world view source types was written out inline in
four controllers, so a new import source would have been invisible to
the review, finalize and rematch endpoints until every copy was found.
Move it to one module and register base_layer there.

The Wikivoyage extraction list keeps its own narrower set, which now
says so by name: a base-layer mirror is generated, never extracted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

> **Revised 2026-07-27, after Tasks 1-5 had landed.** The original Tasks 6-13
> had the importer emit a `divisionId` on every node, so matching was skipped and
> geometry was copied straight from the division. That exploited the 1:1 mapping
> instead of resolving it. The importer now emits names and hierarchy only, and
> `matchCountryLevel` resolves them like any other source — which is the whole
> reason for building the mirror through the import pipeline. Two tasks
> disappeared entirely (pre-resolved divisions; direct geometry copy) and the
> orchestration task collapsed into delegation, so what were Tasks 6-13 are now
> Tasks 6-10.

### Task 6: Generate the base layer import tree

**Files:**
- Create: `backend/src/services/worldViewImport/baseLayerImporter.ts`
- Test: `backend/src/services/worldViewImport/baseLayerImporter.test.ts` (create)

**Interfaces:**
- Consumes: `ImportTreeNode` from `./types.js` — unchanged, `{ name, children }` plus optional source metadata none of which applies here
- Produces: `buildBaseLayerTree(options: { maxDepth: number }): Promise<ImportTreeNode>` — a synthetic root named `World` whose children are the depth-0 divisions. `importTree` skips that root and promotes its children to root regions.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/worldViewImport/baseLayerImporter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('buildBaseLayerTree', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('builds a hierarchy from parent_id', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        { id: 1, name: 'Europe', parent_id: null, depth: 0 },
        { id: 2, name: 'Germany', parent_id: 1, depth: 1 },
        { id: 3, name: 'Bavaria', parent_id: 2, depth: 2 },
      ],
    });

    const tree = await buildBaseLayerTree({ maxDepth: 2 });

    expect(tree.name).toBe('World');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe('Europe');
    expect(tree.children[0].children[0].name).toBe('Germany');
    expect(tree.children[0].children[0].children[0].name).toBe('Bavaria');
  });

  it('emits nothing but names and children, so the matcher has to do the work', async () => {
    // The tree is generated FROM the divisions, so it would be trivial to tag
    // each node with the division it came from. That is exactly what must not
    // happen: resolving a name to a division is the matcher's job, and a tree
    // that carried the answer would skip the stage this import exists to test.
    mockedQuery.mockResolvedValue({
      rows: [
        { id: 1, name: 'Europe', parent_id: null, depth: 0 },
        { id: 2, name: 'Germany', parent_id: 1, depth: 1 },
      ],
    });

    const tree = await buildBaseLayerTree({ maxDepth: 1 });

    expect(Object.keys(tree.children[0]).sort()).toEqual(['children', 'name']);
    expect(Object.keys(tree.children[0].children[0]).sort()).toEqual(['children', 'name']);
    expect(JSON.stringify(tree)).not.toMatch(/divisionId|externalId|sourceId/i);
  });

  it('passes the depth limit to the recursive query', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });

    await buildBaseLayerTree({ maxDepth: 2 });

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WITH RECURSIVE/);
    expect(sql).toMatch(/administrative_divisions/);
    expect(sql).toMatch(/t\.depth < \$1/);
    expect(params).toEqual([2]);
  });

  it('refuses to silently drop a node whose parent is missing', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ id: 9, name: 'Orphan', parent_id: 404, depth: 1 }],
    });

    await expect(buildBaseLayerTree({ maxDepth: 2 })).rejects.toThrow(/parent 404/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx vitest run src/services/worldViewImport/baseLayerImporter.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `backend/src/services/worldViewImport/baseLayerImporter.ts`:

```ts
/**
 * Base Layer Importer
 *
 * Reads the administrative base layer (`administrative_divisions`) down to a
 * chosen depth and shapes it as an import tree — one node per division.
 *
 * The base layer is whatever provider currently populates that table. Nothing
 * here names one: the shape comes from `parent_id`, and the provider label is
 * passed in by the caller and stored as data.
 *
 * The tree carries names and hierarchy and nothing else. Tagging each node with
 * the division it was read from would let the importer assert the mapping the
 * matcher is supposed to resolve, and resolving it honestly is the point: this
 * import is how the generic pipeline gets exercised by a second source.
 */

import { pool } from '../../db/index.js';
import type { ImportTreeNode } from './types.js';

export interface BaseLayerTreeOptions {
  /** Deepest division level to include. 0 = the roots alone. */
  maxDepth: number;
}

interface DivisionRow {
  id: number;
  name: string;
  parent_id: number | null;
  depth: number;
}

/**
 * Read the base layer down to `maxDepth` and shape it as an import tree under a
 * synthetic `World` root (importTree skips the root and promotes its children).
 */
export async function buildBaseLayerTree(options: BaseLayerTreeOptions): Promise<ImportTreeNode> {
  const result = await pool.query<DivisionRow>(`
    WITH RECURSIVE tree AS (
      SELECT id, name, parent_id, 0 AS depth
      FROM administrative_divisions
      WHERE parent_id IS NULL
      UNION ALL
      SELECT d.id, d.name, d.parent_id, t.depth + 1
      FROM administrative_divisions d
      JOIN tree t ON d.parent_id = t.id
      WHERE t.depth < $1
    )
    SELECT id, name, parent_id, depth FROM tree ORDER BY depth, name
  `, [options.maxDepth]);

  const root: ImportTreeNode = { name: 'World', children: [] };
  // Keyed by division id only to reassemble the hierarchy here; the id is a
  // local detail and never reaches the emitted nodes.
  const nodes = new Map<number, ImportTreeNode>();

  for (const row of result.rows) {
    nodes.set(row.id, { name: row.name, children: [] });
  }

  // Rows are depth-ordered, so a parent is always in the map before its children.
  for (const row of result.rows) {
    const node = nodes.get(row.id)!;
    if (row.parent_id === null) {
      root.children.push(node);
      continue;
    }
    const parent = nodes.get(row.parent_id);
    if (!parent) {
      throw new Error(`Base layer division ${row.id} references parent ${row.parent_id}, which is not in the tree`);
    }
    parent.children.push(node);
  }

  console.log(`[Base Layer Import] Built tree: ${result.rows.length} divisions, depth <= ${options.maxDepth}`);
  return root;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx vitest run src/services/worldViewImport/baseLayerImporter.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/worldViewImport/baseLayerImporter.ts backend/src/services/worldViewImport/baseLayerImporter.test.ts
git commit -s -m "$(cat <<'EOF'
back: Shape the administrative base layer as an import tree.

Read administrative_divisions down to a chosen depth and emit it in the
import format, one node per division. Names and hierarchy only: the tree
is generated from the divisions, so it could trivially carry the answer,
but resolving a name to a division belongs to the matcher and skipping
that stage would defeat the reason for importing the base layer at all.

The provider is never named — the shape comes from parent_id, so
replacing the base layer means reloading the table, not editing code.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Single-member fast path in geometry computation

**Files:**
- Modify: `backend/src/controllers/worldView/geometryComputeSingle.ts:570-640` (`computeRegionGeometryCore`)
- Test: `backend/src/controllers/worldView/geometryComputeSingle.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: no signature change — `computeRegionGeometryCore` returns `{ computed, points }` as before, just sooner for regions that are exactly one division.

This lands before the import runs, because the mirror's leaves are computed by the normal path and there are 3586 of them.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/worldView/geometryComputeSingle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `release` is required: computeRegionGeometryCore releases the client in its
// finally block, and without the stub every test dies on "client.release is not
// a function" before reaching the assertion it was written for.
const client = { query: vi.fn(), release: vi.fn() };

vi.mock('../../db/index.js', () => ({
  pool: { connect: vi.fn(async () => client) },
}));

import { computeRegionGeometryCore } from './geometryComputeSingle.js';

function respond(sql: string) {
  if (sql.includes('SELECT is_custom_boundary')) {
    return { rows: [{ is_custom_boundary: false, name: 'Bavaria', has_geom: false }] };
  }
  if (sql.includes('member_points')) {
    return { rows: [{ member_points: '5000', child_points: '0', child_count: '0', member_count: '1' }] };
  }
  if (sql.includes('UPDATE regions')) {
    return { rows: [{ points: 5000 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

describe('computeRegionGeometryCore fast path', () => {
  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respond(String(sql)));
  });

  it('copies the member geometry for a region that is exactly one division', async () => {
    const result = await computeRegionGeometryCore(42);

    expect(result).toMatchObject({ computed: true, points: 5000 });

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(true);
    // The union machinery must not run at all.
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(false);
  });

  it('falls through to the union path when the region has children', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '900', child_count: '3', member_count: '1' }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(true);
  });

  it('falls through to the union path when the region has several members', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '0', child_count: '0', member_count: '2' }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(true);
  });

  it('leaves a hand-drawn boundary alone', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SELECT is_custom_boundary')) {
        return { rows: [{ is_custom_boundary: true, name: 'Drawn', has_geom: true }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx vitest run src/controllers/worldView/geometryComputeSingle.test.ts
```

Expected: FAIL on the first case — `ST_Collect` runs today regardless of member count.

- [ ] **Step 3: Implement**

In `backend/src/controllers/worldView/geometryComputeSingle.ts`, inside `computeRegionGeometryCore`, immediately after the `shouldSimplify` line and before `// Step 1: Collect all geometries`:

```ts
    // Fast path: a region that is exactly one division, with no children and no
    // hand-drawn boundary, already has its answer. Collecting, validating,
    // unioning and snapping a single polygon reproduces it at real cost — and
    // this is the shape of every matched leaf in a base-layer mirror as well as
    // a large share of any 1:1 import match.
    if (memberCount === 1 && childCount === 0 && regionCheck.rows[0].is_custom_boundary !== true) {
      const copied = await client.query(`
        UPDATE regions r
        SET geom = CASE
              WHEN ST_IsValid(COALESCE(rm.custom_geom, ad.geom)) THEN COALESCE(rm.custom_geom, ad.geom)
              ELSE validate_multipolygon(COALESCE(rm.custom_geom, ad.geom))
            END
        FROM region_members rm
        JOIN administrative_divisions ad ON ad.id = rm.division_id
        WHERE rm.region_id = r.id
          AND r.id = $1
          AND COALESCE(rm.custom_geom, ad.geom) IS NOT NULL
        RETURNING ST_NPoints(r.geom) AS points
      `, [regionId]);

      if (copied.rowCount) {
        await client.query('RESET statement_timeout');
        const points = Number(copied.rows[0].points);
        log(`Single-member fast path: copied ${points} points`);
        return { computed: true, points };
      }
      // Nothing copied (member geometry is NULL) — fall through to the normal path.
    }
```

`ST_IsValid` before `validate_multipolygon` avoids running `ST_MakeValid` over geometry that is already valid, which is the common case and the expensive one.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx vitest run src/controllers/worldView/geometryComputeSingle.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Verify against a real region**

Pick any region in an existing world view that has exactly one member and no children, recompute it through the existing admin endpoint or by calling the core directly, and confirm its geometry equals its member division's:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "
  SELECT r.id, r.name
  FROM regions r
  JOIN region_members rm ON rm.region_id = r.id
  WHERE r.is_leaf AND r.geom IS NOT NULL
  GROUP BY r.id, r.name
  HAVING count(rm.id) = 1
  LIMIT 3;"
```

If the dev database has no such region yet, say so in the report — the mirror import will create 3586 of them, and Task 8's run is where this path gets its real exercise.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
git add backend/src/controllers/worldView/geometryComputeSingle.ts backend/src/controllers/worldView/geometryComputeSingle.test.ts
git commit -s -m "$(cat <<'EOF'
back: Skip the union for regions that are one division.

Collecting, validating, unioning and snapping a single polygon returns
that polygon at full cost. Copy it instead when a region has exactly one
member, no children and no hand-drawn boundary — the shape of many
matched regions in any import, and of every matched leaf in a mirror of
the administrative base layer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Start a base layer import through the existing pipeline

**Files:**
- Modify: `backend/src/services/worldViewImport/index.ts` (add `startBaseLayerImport`)
- Create: `backend/src/controllers/admin/baseLayerImportController.ts`
- Test: `backend/src/controllers/admin/baseLayerImportController.test.ts` (create), `backend/src/services/worldViewImport/index.test.ts` (create)
- Modify: `backend/src/types/index.ts` (add `baseLayerImportBodySchema`), `backend/src/routes/adminRoutes.ts` (register the route near line 235)

**Interfaces:**
- Consumes: `buildBaseLayerTree` (Task 6); the existing `startImport(tree, name, options)` and `getLatestImportStatus()` from `services/worldViewImport/index.js`
- Produces: `startBaseLayerImport(options: BaseLayerImportOptions): Promise<string>` where `BaseLayerImportOptions = { name: string; providerLabel: string; maxDepth: number }`, and `POST /api/admin/wv-import/base-layer` returning `{ started: true, operationId }` or 409.

There is no new phase machine. The whole point of this task is that a base-layer import is an ordinary import: build the tree, hand it to `startImport`, and let `runImport` do `importTree` then `matchCountryLevel` exactly as it does for a file upload.

- [ ] **Step 1: Write the failing service test**

Create `backend/src/services/worldViewImport/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./baseLayerImporter.js', () => ({
  buildBaseLayerTree: vi.fn().mockResolvedValue({
    name: 'World',
    children: [{ name: 'Europe', children: [] }],
  }),
}));
vi.mock('./importer.js', () => ({
  importTree: vi.fn().mockResolvedValue(77),
}));
vi.mock('./matcher.js', () => ({
  matchCountryLevel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { startBaseLayerImport } from './index.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';
import { importTree } from './importer.js';
import { matchCountryLevel } from './matcher.js';

const mockedBuild = buildBaseLayerTree as unknown as ReturnType<typeof vi.fn>;
const mockedImport = importTree as unknown as ReturnType<typeof vi.fn>;
const mockedMatch = matchCountryLevel as unknown as ReturnType<typeof vi.fn>;

describe('startBaseLayerImport', () => {
  beforeEach(() => {
    mockedBuild.mockClear();
    mockedImport.mockClear();
    mockedMatch.mockClear();
  });

  it('builds the tree at the requested depth', async () => {
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });

    expect(mockedBuild).toHaveBeenCalledWith({ maxDepth: 2 });
  });

  it('imports it as a base_layer source carrying the provider label', async () => {
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });
    // startImport runs the pipeline in the background; let it reach importTree.
    await vi.waitFor(() => expect(mockedImport).toHaveBeenCalled());

    const [, name, , options] = mockedImport.mock.calls[0];
    expect(name).toBe('Administrative');
    expect(options).toMatchObject({ sourceType: 'base_layer', source: 'Dataset 1.0' });
  });

  it('runs the normal matcher rather than resolving divisions itself', async () => {
    await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });
    await vi.waitFor(() => expect(mockedMatch).toHaveBeenCalledWith(77, expect.anything()));
  });

  it('returns an operation id the existing status endpoint can poll', async () => {
    const opId = await startBaseLayerImport({ name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 });

    expect(opId).toMatch(/^wv-import-\d+$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && npx vitest run src/services/worldViewImport/index.test.ts
```

Expected: FAIL — `startBaseLayerImport` is not exported.

- [ ] **Step 3: Implement the service function**

In `backend/src/services/worldViewImport/index.ts`, add the import at the top:

```ts
import { buildBaseLayerTree } from './baseLayerImporter.js';
```

and, directly after `startImport`:

```ts
/** Options for starting a base layer import */
export interface BaseLayerImportOptions {
  /** World view name. */
  name: string;
  /** Provider label stored as world_views.source, e.g. the dataset and version. */
  providerLabel: string;
  /** Deepest division level to mirror. */
  maxDepth: number;
}

/**
 * Start an import that mirrors the administrative base layer.
 *
 * Deliberately thin: the tree is built from the base layer, then handed to the
 * ordinary import pipeline, which imports it and runs the matcher over it. The
 * base layer gets no privileged path — that is what makes this import a test of
 * the generic one.
 */
export async function startBaseLayerImport(options: BaseLayerImportOptions): Promise<string> {
  const tree = await buildBaseLayerTree({ maxDepth: options.maxDepth });

  return startImport(tree, options.name, {
    matchingPolicy: 'country-based',
    sourceType: 'base_layer',
    source: options.providerLabel,
    description: `Mirror of the administrative base layer (${options.providerLabel}), depth ${options.maxDepth}`,
  });
}
```

- [ ] **Step 4: Run the service test to verify it passes**

```bash
cd backend && npx vitest run src/services/worldViewImport/index.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing controller test**

Create `backend/src/controllers/admin/baseLayerImportController.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/worldViewImport/index.js', () => ({
  startBaseLayerImport: vi.fn().mockResolvedValue('wv-import-9'),
  getLatestImportStatus: vi.fn().mockReturnValue(null),
}));

import { startBaseLayerImport, getLatestImportStatus } from '../../services/worldViewImport/index.js';
import { startBaseLayerImportEndpoint } from './baseLayerImportController.js';

const mockedStart = startBaseLayerImport as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = getLatestImportStatus as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('startBaseLayerImportEndpoint', () => {
  beforeEach(() => {
    mockedStart.mockClear();
    mockedStatus.mockReturnValue(null);
  });

  it('starts an import and returns its operation id', async () => {
    const res = makeRes();
    await startBaseLayerImportEndpoint(
      { body: { name: 'Administrative', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(mockedStart).toHaveBeenCalledWith({
      name: 'Administrative',
      providerLabel: 'Dataset 1.0',
      maxDepth: 2,
    });
    expect(res.json).toHaveBeenCalledWith({ started: true, operationId: 'wv-import-9' });
  });

  it('refuses to start a second import while one is importing', async () => {
    mockedStatus.mockReturnValue({ opId: 'wv-import-8', progress: { status: 'importing' } });
    const res = makeRes();

    await startBaseLayerImportEndpoint(
      { body: { name: 'X', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('refuses to start a second import while one is matching', async () => {
    mockedStatus.mockReturnValue({ opId: 'wv-import-8', progress: { status: 'matching' } });
    const res = makeRes();

    await startBaseLayerImportEndpoint(
      { body: { name: 'X', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('starts when the previous import has finished', async () => {
    mockedStatus.mockReturnValue({ opId: 'wv-import-8', progress: { status: 'complete' } });
    const res = makeRes();

    await startBaseLayerImportEndpoint(
      { body: { name: 'X', providerLabel: 'Dataset 1.0', maxDepth: 2 } } as never,
      res as never,
    );

    expect(mockedStart).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd backend && npx vitest run src/controllers/admin/baseLayerImportController.test.ts
```

Expected: FAIL — the controller does not exist.

- [ ] **Step 7: Implement the controller, schema and route**

Create `backend/src/controllers/admin/baseLayerImportController.ts`:

```ts
/**
 * Base Layer Import controller
 *
 * Starts an import that mirrors the administrative base layer. Everything after
 * the start — progress, cancellation, match review, finalize — is the shared
 * import machinery (GET/POST /api/admin/wv-import/import/status|cancel and the
 * review endpoints).
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { startBaseLayerImport, getLatestImportStatus } from '../../services/worldViewImport/index.js';

/**
 * Start a base layer import.
 * POST /api/admin/wv-import/base-layer
 */
export async function startBaseLayerImportEndpoint(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const { name, providerLabel, maxDepth } = req.body;

  const existing = getLatestImportStatus();
  if (existing && (existing.progress.status === 'importing' || existing.progress.status === 'matching')) {
    res.status(409).json({ error: 'An import is already running' });
    return;
  }

  const operationId = await startBaseLayerImport({ name, providerLabel, maxDepth });
  console.log(`[Base Layer Import] POST /base-layer — started opId=${operationId}`);
  res.json({ started: true, operationId });
}
```

In `backend/src/types/index.ts`, beside `wvImportBodySchema` (around line 413):

```ts
export const baseLayerImportBodySchema = z.object({
  name: z.string().min(1).max(255),
  providerLabel: z.string().min(1).max(1000),
  // Depth 2 mirrors roots + countries + first-level subdivisions (~3800 regions).
  // 3 is allowed but adds tens of thousands; deeper is refused outright, since
  // the base layer has 392k divisions.
  maxDepth: z.number().int().min(1).max(3),
});
```

In `backend/src/routes/adminRoutes.ts`, beside the other `wv-import` routes (around line 235):

```ts
// Start a base layer mirror import (progress via /wv-import/import/status)
router.post('/wv-import/base-layer', validate(baseLayerImportBodySchema), startBaseLayerImportEndpoint);
```

with the matching import:

```ts
import { startBaseLayerImportEndpoint } from '../controllers/admin/baseLayerImportController.js';
```

and `baseLayerImportBodySchema` added to the existing `../types/index.js` import list.

- [ ] **Step 8: Run both test files to verify they pass**

```bash
cd backend && npx vitest run src/controllers/admin/baseLayerImportController.test.ts src/services/worldViewImport/index.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 9: Run the full suite and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
git add backend/src/services/worldViewImport/index.ts backend/src/services/worldViewImport/index.test.ts backend/src/controllers/admin/baseLayerImportController.ts backend/src/controllers/admin/baseLayerImportController.test.ts backend/src/types/index.ts backend/src/routes/adminRoutes.ts
git commit -s -m "$(cat <<'EOF'
back: Add the base layer import endpoint.

One admin call builds the tree from the administrative base layer and
hands it to the ordinary import pipeline: name, provider label and depth
in, operation id out, progress on the shared import status endpoint.

No privileged path for the base layer — it is imported and matched like
a file upload, which is what makes it a test of the generic pipeline.
Depth is capped at 3; the base layer has 392k divisions and mirroring
all of them would double the largest table in the database.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Admin UI for the base layer import

**Files:**
- Create: `frontend/src/components/admin/BaseLayerImportPanel.tsx`
- Modify: `frontend/src/api/admin/worldViewImport.ts` (add `startBaseLayerImport`)
- Modify: `frontend/src/components/admin/WorldViewImportPanel.tsx` (render the new panel)

**Interfaces:**
- Consumes: `POST /api/admin/wv-import/base-layer` and the existing `ImportStatus` polling (Task 8)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add the API client function**

In `frontend/src/api/admin/worldViewImport.ts`, beside the other import starters:

```ts
export interface BaseLayerImportRequest {
  name: string;
  providerLabel: string;
  maxDepth: number;
}

/**
 * Start an import mirroring the administrative base layer.
 * Progress, review and finalize all run through the shared import endpoints.
 */
export async function startBaseLayerImport(
  request: BaseLayerImportRequest,
): Promise<{ started: boolean; operationId: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/base-layer`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
```

- [ ] **Step 2: Build the panel**

Create `frontend/src/components/admin/BaseLayerImportPanel.tsx`:

```tsx
/**
 * Base Layer Import panel
 *
 * Imports the administrative divisions currently loaded as a world view, one
 * region per division. The import runs through the normal pipeline and lands in
 * the normal match review — it is not pre-matched.
 *
 * Deliberately provider-neutral: the provider label is typed in and stored as
 * data, so switching the base layer means reloading it and re-importing.
 */

import { useState } from 'react';
import {
  Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography, Alert,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { startBaseLayerImport } from '../../api/admin/worldViewImport';

const DEPTH_OPTIONS = [
  { value: 1, label: 'Roots + countries (~245 regions)' },
  { value: 2, label: 'Roots + countries + subdivisions (~3 800 regions)' },
  { value: 3, label: 'One level deeper (~46 000 regions — slow)' },
];

export function BaseLayerImportPanel() {
  // No provider name is prefilled: which dataset is loaded is the admin's to
  // state, and baking today's into the UI is exactly the hardcoding this
  // feature avoids everywhere else.
  const [name, setName] = useState('Administrative');
  const [providerLabel, setProviderLabel] = useState('');
  const [maxDepth, setMaxDepth] = useState(2);

  const mutation = useMutation({
    mutationFn: () => startBaseLayerImport({ name, providerLabel, maxDepth }),
  });

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Import base layer</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Creates a world view from the administrative divisions currently
          loaded, one region per division, then matches it like any other
          import. Review the matches when it finishes. The world view starts
          hidden.
        </Typography>

        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label="World view name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Provider label"
            placeholder="Dataset and version"
            helperText="Stored as the world view's source — name the dataset currently loaded"
            value={providerLabel}
            onChange={(e) => setProviderLabel(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            select
            label="Depth"
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            size="small"
            fullWidth
          >
            {DEPTH_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <Box>
            <Button
              variant="contained"
              disabled={mutation.isPending || !name.trim() || !providerLabel.trim()}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Starting…' : 'Import base layer'}
            </Button>
          </Box>

          {mutation.isSuccess && (
            <Alert severity="info">
              Import started. Follow it in the import progress above, then review
              the matches and compute geometries.
            </Alert>
          )}
          {mutation.isError && (
            <Alert severity="error">
              {mutation.error instanceof Error ? mutation.error.message : 'Import failed to start'}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render it from the import panel**

In `frontend/src/components/admin/WorldViewImportPanel.tsx`, import the new component:

```tsx
import { BaseLayerImportPanel } from './BaseLayerImportPanel';
```

and render `<BaseLayerImportPanel />` beside the existing import entry points — the block around lines 137–165 that holds the file-upload and "Fetch from Wikivoyage" buttons. Do not inline the form: that file is already 907 lines, past the point where the guide asks for a split.

- [ ] **Step 4: Run the checks and commit**

Browser verification belongs to the controller, who runs the real import afterwards. Verify with the static gates:

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
git add frontend/src/components/admin/BaseLayerImportPanel.tsx frontend/src/api/admin/worldViewImport.ts frontend/src/components/admin/WorldViewImportPanel.tsx
git commit -s -m "$(cat <<'EOF'
front: Add the base layer import panel.

Name, provider label and depth, one button. Its own component rather
than more lines in WorldViewImportPanel, which is already past the size
the guide allows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Teach the Drizzle model and the E2E fixture about visibility

**Files:**
- Modify: `backend/src/db/schema.ts:44-54` (`worldViews` table definition)
- Modify: `backend/src/db/seed/e2eFixture.ts:74-80` (fixture world view insert)

**Interfaces:**
- Consumes: `world_views.is_public` (Task 1)
- Produces: nothing consumed by later tasks

Found by the controller while Tasks 6-9 were in flight, not by the original plan. Two loose ends from Task 1:

- The Drizzle model of `world_views` has no `isPublic` column, so the model now describes a table that does not match the database. Nothing breaks today because the visibility code uses raw `pool.query`, but any Drizzle insert or select is blind to the column — which is exactly how the second half of this task became a bug.
- `e2eFixture.ts` inserts its world view through Drizzle without setting visibility, so it takes the `false` default and the fixture world view is hidden. The smoke specs (`frontend/tests/e2e/smoke/`) never authenticate — they contain no login step at all — so every anonymous read of that world view now 404s.

- [ ] **Step 1: Reproduce the fixture failure**

```bash
npm run test:e2e:smoke
```

Expected: FAIL. Capture which specs fail and how — this is the RED evidence for this task. If they pass, stop and report that: it would mean the specs do not read the fixture world view the way this task assumes, and the second half of the task needs rethinking rather than implementing.

- [ ] **Step 2: Add the column to the Drizzle model**

In `backend/src/db/schema.ts`, inside the `worldViews` table definition, after `isActive`:

```ts
  isPublic: boolean('is_public').notNull().default(false),
```

Match the neighbouring style — the existing columns use `boolean('is_default').default(false)` — but keep `.notNull()` here, because the database column is `NOT NULL` and the model should say so.

- [ ] **Step 3: Make the fixture world view public**

In `backend/src/db/seed/e2eFixture.ts`, in the `worldViews` insert:

```ts
    await tx.insert(worldViews).values({
      id: E2E_WORLD_VIEW_ID,
      name: 'E2E Fixture',
      description: 'Synthetic data for the smoke lane',
      isDefault: false,
      isActive: true,
      // The smoke specs browse anonymously; a hidden world view is invisible
      // to them and every region read under it answers 404.
      isPublic: true,
    });
```

- [ ] **Step 4: Verify the smoke lane is green again**

```bash
npm run test:e2e:smoke
```

Expected: PASS. This is the GREEN evidence.

- [ ] **Step 5: Run the unit suites and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
git add backend/src/db/schema.ts backend/src/db/seed/e2eFixture.ts
git commit -s -m "$(cat <<'EOF'
back: Teach the model and the E2E fixture about visibility.

The Drizzle model of world_views never learned about is_public, so it
described a table the database no longer had — and the E2E fixture,
which inserts through that model, took the hidden default. The smoke
specs browse anonymously, so every read under the fixture world view
started answering 404.

Add the column to the model and make the fixture world view public,
which is what a fixture exercising public flows has to be.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: One import panel, many sources

**Files:**
- Create: `frontend/src/components/admin/importSources/types.ts`
- Create: `frontend/src/components/admin/importSources/index.ts`
- Create: `frontend/src/components/admin/importSources/WikivoyageSource.tsx`
- Create: `frontend/src/components/admin/importSources/FileSource.tsx`
- Create: `frontend/src/components/admin/importSources/BaseLayerSource.tsx`
- Create: `frontend/src/components/admin/ImportSourcePanel.tsx`
- Delete: `frontend/src/components/admin/BaseLayerImportPanel.tsx`
- Modify: `frontend/src/components/admin/WorldViewImportPanel.tsx` (replace the three entry-point blocks with one)

**Interfaces:**
- Consumes: the existing start endpoints for each source, unchanged
- Produces: `ImportSource` — the descriptor every future source implements

Task 9 added a third bespoke entry point next to two that already existed. That is the wrong shape: a source is data, not a panel. This task replaces all three with one panel that takes a source selection, and makes adding the next source a matter of writing one module and adding it to a list.

**Fold this into Task 9's commit before opening a PR** (`/pr-changes-amend`) — the repo forbids a commit that exists only to correct an earlier commit on the same branch.

- [ ] **Step 1: Define the source descriptor**

Create `frontend/src/components/admin/importSources/types.ts`:

```ts
/**
 * An import source is data, not a panel.
 *
 * Every source starts a world view import; they differ only in the parameters
 * they need and the endpoint they call. A source contributes a label and a form
 * component; the shared panel owns the card, the source selector and the world
 * view name, which all sources need.
 */

export interface ImportSourceFormProps {
  /** World view name, owned by the shared panel because every source needs it. */
  worldViewName: string;
}

export interface ImportSource {
  /** Stable id used as the select value. */
  id: string;
  /** Shown in the source selector. */
  label: string;
  /** Owns this source's own inputs, mutation, error surface and start button. */
  Form: React.ComponentType<ImportSourceFormProps>;
}
```

- [ ] **Step 2: Move the base layer source into the registry shape**

Create `frontend/src/components/admin/importSources/BaseLayerSource.tsx` by moving the body of `BaseLayerImportPanel.tsx` into it, with three changes: it takes `worldViewName` from props instead of owning a name field, it drops its own `Card`/`CardContent` wrapper (the shared panel provides those), and it keeps everything else — the provider label field, the depth select, the button, the alerts, and every comment.

```tsx
/**
 * Base layer import source.
 *
 * Imports the administrative divisions currently loaded as a world view, one
 * region per division. The import runs through the normal pipeline and lands in
 * the normal match review — it is not pre-matched.
 *
 * Deliberately provider-neutral: the provider label is typed in and stored as
 * data, so switching the base layer means reloading it and re-importing.
 */

import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { startBaseLayerImport } from '../../../api/admin/worldViewImport';
import type { ImportSourceFormProps } from './types';

const DEPTH_OPTIONS = [
  { value: 1, label: 'Roots + countries (~245 regions)' },
  { value: 2, label: 'Roots + countries + subdivisions (~3 800 regions)' },
  { value: 3, label: 'One level deeper (~46 000 regions — slow)' },
];

export function BaseLayerForm({ worldViewName }: ImportSourceFormProps) {
  // No provider name is prefilled: which dataset is loaded is the admin's to
  // state, and baking today's into the UI is exactly the hardcoding this
  // feature avoids everywhere else.
  const [providerLabel, setProviderLabel] = useState('');
  const [maxDepth, setMaxDepth] = useState(2);

  const mutation = useMutation({
    mutationFn: () => startBaseLayerImport({ name: worldViewName, providerLabel, maxDepth }),
  });

  return (
    <Stack spacing={2}>
      <TextField
        label="Provider label"
        placeholder="Dataset and version"
        helperText="Stored as the world view's source — name the dataset currently loaded"
        value={providerLabel}
        onChange={(e) => setProviderLabel(e.target.value)}
        size="small"
        fullWidth
      />
      <TextField
        select
        label="Depth"
        value={maxDepth}
        onChange={(e) => setMaxDepth(Number(e.target.value))}
        size="small"
        fullWidth
      >
        {DEPTH_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>

      <Box>
        <Button
          variant="contained"
          disabled={mutation.isPending || !worldViewName.trim() || !providerLabel.trim()}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Starting…' : 'Import base layer'}
        </Button>
      </Box>

      <Typography variant="caption" color="text.secondary">
        Creates a world view from the administrative divisions currently loaded,
        one region per division, then matches it like any other import. Review
        the matches when it finishes. The world view starts hidden.
      </Typography>

      {mutation.isSuccess && (
        <Alert severity="info">
          Import started. Follow it in the import progress above, then review the
          matches and compute geometries.
        </Alert>
      )}
      {mutation.isError && (
        <Alert severity="error">
          {mutation.error instanceof Error ? mutation.error.message : 'Import failed to start'}
        </Alert>
      )}
    </Stack>
  );
}
```

Then delete `frontend/src/components/admin/BaseLayerImportPanel.tsx`.

- [ ] **Step 3: Move the Wikivoyage source**

Create `frontend/src/components/admin/importSources/WikivoyageSource.tsx` holding a `WikivoyageForm` component. Move into it, unchanged in behaviour, everything that currently serves the Wikivoyage card in `WorldViewImportPanel.tsx`:

- the `extractMutation`, the caches query and the `deleteCacheMutation`, together with the `selectedCache` state
- the JSX at `WorldViewImportPanel.tsx:594-673` — the error alert, the "Fetch from Wikivoyage" button, the API-cache `FormControl` with its per-item delete button, and the caption

Take `worldViewName` from props and delete the `WorldView Name` `TextField` at lines 595-601 — the shared panel owns it now. The button's disabled condition becomes `!worldViewName.trim() || extractMutation.isPending`.

- [ ] **Step 4: Move the file-upload source**

Create `frontend/src/components/admin/importSources/FileSource.tsx` holding a `FileForm` component. Move into it: `handleFileUpload`, the `treeData`, `fileName` and `fileError` state, the `matchingPolicy` state, the `importMutation`, `handleStartImport`, and the JSX at `WorldViewImportPanel.tsx:687-733`. Take `worldViewName` from props; the start button's disabled condition becomes `!treeData || !worldViewName.trim() || importMutation.isPending`.

Drop the `Accordion` wrapper — the source selector replaces the "Or upload from file" affordance.

- [ ] **Step 5: Register the sources**

Create `frontend/src/components/admin/importSources/index.ts`:

```ts
import type { ImportSource } from './types';
import { WikivoyageForm } from './WikivoyageSource';
import { FileForm } from './FileSource';
import { BaseLayerForm } from './BaseLayerSource';

/**
 * Every import source, in the order they are offered. Adding a source means
 * adding a module and one entry here — nothing in the panel changes.
 */
export const IMPORT_SOURCES: ImportSource[] = [
  { id: 'wikivoyage', label: 'Wikivoyage', Form: WikivoyageForm },
  { id: 'file', label: 'JSON file', Form: FileForm },
  { id: 'base-layer', label: 'Administrative base layer', Form: BaseLayerForm },
];

export type { ImportSource, ImportSourceFormProps } from './types';
```

- [ ] **Step 6: Build the shared panel**

Create `frontend/src/components/admin/ImportSourcePanel.tsx`:

```tsx
/**
 * The one place a world view import is started.
 *
 * Sources differ in their parameters, not in their shape, so they live in a
 * registry and this panel renders whichever one is selected. Only the selected
 * source's form is mounted, so switching sources clears inputs that no longer
 * apply.
 */

import { useState } from 'react';
import { Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { IMPORT_SOURCES } from './importSources';

interface ImportSourcePanelProps {
  worldViewName: string;
  onWorldViewNameChange: (name: string) => void;
}

export function ImportSourcePanel({ worldViewName, onWorldViewNameChange }: ImportSourcePanelProps) {
  const [sourceId, setSourceId] = useState(IMPORT_SOURCES[0].id);
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId) ?? IMPORT_SOURCES[0];
  const SourceForm = source.Form;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Start an import</Typography>
        <Stack spacing={2}>
          <TextField
            select
            label="Source"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            size="small"
            fullWidth
          >
            {IMPORT_SOURCES.map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="WorldView Name"
            value={worldViewName}
            onChange={(e) => onWorldViewNameChange(e.target.value)}
            size="small"
            fullWidth
          />

          <SourceForm worldViewName={worldViewName} />
        </Stack>
      </CardContent>
    </Card>
  );
}
```

Rendering only the selected source's form keeps hook order stable — never call a source's hooks through a varying reference or inside a callback.

- [ ] **Step 7: Replace the three entry points with one**

In `WorldViewImportPanel.tsx`, delete the Wikivoyage card block, the file-upload accordion block and the `BaseLayerImportPanel` line, and put in their place:

```tsx
      {!isRunning && (
        <ImportSourcePanel worldViewName={name} onWorldViewNameChange={setName} />
      )}
```

Keep the `name` state where it is — the panel is controlled. Then remove everything the moved code left behind: imports that are now unused (`LanguageIcon`, `UploadIcon`, `ExpandMoreIcon`, `Accordion*`, `Select`, `InputLabel`, `FormControl`, `DeleteIcon`, `Tooltip` and any others), the state and mutations that moved out, and the now-dead handlers. `npm run check` runs `knip` and `lint`, which will name what is left.

- [ ] **Step 8: Verify**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
```

Expected: PASS, and `WorldViewImportPanel.tsx` should be several hundred lines shorter than the 907 it starts at. Report its new line count.

There are no component tests for any of this, here or in the sibling panels, so state plainly in your report what you could not verify: that each of the three sources still starts correctly against a live backend. Browser verification belongs to the controller.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/admin/
git commit -s -m "$(cat <<'EOF'
front: Start every import from one panel.

Each import source had grown its own entry point — a Wikivoyage card, a
file-upload accordion, and most recently a base layer panel — so adding
a source meant adding UI rather than data. Move the sources into a
registry behind one panel with a source selector: a source now
contributes a label and a form, and the panel owns the card, the
selector and the world view name every source needs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Documentation and ADR

**Files:**
- Create: `docs/decisions/0018-base-layer-mirror-world-view.md`
- Modify: `docs/tech/world-views.md`, `docs/tech/experiences.md`, `docs/vision/vision.md:20,109`, `docs/security/SECURITY.md`, `docs/security/asvs-checklist.yaml`, `docs/decisions/README.md` (index row)

**Interfaces:**
- Consumes: everything above
- Produces: the committed record of what now exists

Write this task **after** the controller has run the real import and measured the match outcome, so the ADR can state what actually happened rather than what was expected.

- [ ] **Step 1: Write ADR-0018**

Create `docs/decisions/0018-base-layer-mirror-world-view.md`, following `docs/decisions/adr-template.md` for the exact section order. Content:

**Title:** Experiences reach the administrative base layer through a mirror world view

**Status:** Accepted

**Context.** Experiences attach to regions only — `experience_regions` and `experience_location_regions` both reference `regions(id)`. The administrative base layer lives in `administrative_divisions`, a separate tree of 392 112 rows, and the default world view that represents it held no regions at all. Every experience surface (Discover counts, region browsing, markers, curation, rejection filtering) is therefore region-scoped, and none of them could be exercised: 1247 UNESCO sites, 200 monuments, 100 museums and 6520 locations sat with zero region assignments. A canonical world view is being built separately and is not ready.

**Decision.** Keep experiences attached to regions. Reach the base layer by importing it as a world view — one region per division, down to depth 2 — through the existing import pipeline, and let the existing matcher resolve each region to its division. The importer emits names and hierarchy only; it does not carry the division a node was read from, even though generating the tree from the divisions makes that trivially available. Geometry comes from the normal compute path. The world view is created hidden and can be published per world view.

**Alternatives rejected.**
- *An experience↔division relation.* Would duplicate assignment, ancestor propagation, counts, tiles, rejection filtering and the curation surface along a second axis, permanently.
- *A bespoke seeder script.* Cheaper to write, but it would have left the import pipeline untested for any second source. Building the mirror through the pipeline is what surfaced the four copies of the source-type allowlist that made a new source invisible to the review, finalize and rematch endpoints.
- *Pre-resolving each node to its division in the importer.* The first draft did this — the tree was generated from the divisions, so every node could simply carry its id, skipping matching and letting geometry be copied. Rejected: it would have exercised the import half of the pipeline while bypassing the matching half, which is the half most likely to be source-specific. Resolving names honestly is what makes this a test rather than a demonstration.

**Measured outcome — record these numbers, they are the point of the exercise.** A depth-2 import of 3831 regions (8 + 237 + 3586, matching the division counts exactly) run through the `country-based` policy resolved 2372 regions (62%):

| `match_status` | Regions |
|---|---|
| `auto_matched` | 2372 |
| `no_candidates` | 1251 |
| `children_matched` | 157 |
| `needs_review` | 51 |

Of the 2372 matched regions, 2371 have a member division whose name equals the region's exactly; the single exception matched "Osh (city)" to the division "Osh" — a variant match, and the clearest evidence that the matcher resolved these rather than being handed the answer.

The 1251 unmatched regions decompose into four causes — three matcher gaps and one expected outcome — none of them a lack of information. They sum visibly: 572 + 507 + 166 + 6 = 1251.

1. **Children of country-level nodes that themselves went unmatched (572 regions).** Australia's six states account for 547 of them: the base layer places Australia at root level beside the continents, but `matchCountryLevel` assumes continent → country → subdivision, so Australia's states land where countries are expected and fail — New South Wales 153 unmatched children, Western Australia 140, Victoria 80, Queensland 73, South Australia 71, Tasmania 30. The remaining 25 belong to other country-level nodes affected the same way.
2. **Ambiguous country matches (51 countries, 507 regions).** These countries matched *too many* candidates rather than none — United Kingdom 30, France 20, United States 9, all at score 700 — so they land in `needs_review`, and drill-down never runs for their children. They carry 143 suggestions between them and are resolvable by hand in the review UI.
3. **All-or-nothing drill-down (9 countries, 166 regions).** `trySubdivisionDrillDown` abandons a country's entire subdivision level when even one child fails to match. Vietnam is the clearest case: the country matched cleanly, and 63 subdivisions got nothing.

The 1251 `no_candidates` regions carry **zero** suggestions, so unlike the 51 they cannot be resolved by review clicks — they need a matching pass.

State plainly that this is a finding about the pipeline, not about the mirror: the information needed to resolve those subdivisions is already present in the tree (a node's name plus its parent's resolved division), and `findBestAmongChildren` already implements the lookup. The matcher simply stops after one level and gives up as a unit. A matching policy that walks the hierarchy recursively is the identified fix, tracked as follow-up work with its own ADR, and the base-layer import is what makes it measurable: 3831 nodes with a known-correct answer that was deliberately withheld from the importer, so any matcher change can be scored against it. No other source can provide that, because for Wikivoyage nobody knows the right answer.

Record one more thing found while investigating: the name-matching core is duplicated between `matcher.ts` (private copies) and `matcherUtils.ts` (exported, imported only by `matcherGrouping.ts`), and the two have diverged — `getNameVariants` strips suffixes by regex in one and by a last-word set lookup in the other. Consolidating them is a prerequisite for any matcher work, since today a fix lands in only one of two live implementations.
- *Mirroring the full division tree.* 392 112 regions with duplicated geometry would roughly double the largest table in the database. Depth is capped at 3 and defaults to 2.
- *Making the default world view region-backed instead.* Rejected for the same depth reason: the mirror must be capped, so the default world view's division navigation is still needed for anything deeper.

**Consequences.**
- Region-scoped curation done in the mirror (rejections, manual assignments, the region-scoped curation log) does not carry over to the canonical world view. Experience-level work — curated fields, images, treasures, `is_iconic`, Curator Picks, new categories — does.
- The division-based navigation of the default world view stays: the mirror is depth-capped, so drilling deeper still needs it.
- The provider is never named in code. `source_type = 'base_layer'`; the provider label is a request parameter stored in `world_views.source`. Swapping the dataset means reloading `administrative_divisions` and re-importing.
- Matching a tree derived from the base layer against that same base layer is circular: it proves the pipeline is source-agnostic, not that matching is good at hard names.
- Pre-existing GADM-named surfaces are left alone and remain debt: the tile functions `tile_gadm_root_divisions` and `tile_gadm_subdivisions`, the route `POST /api/world-views/regions/:regionId/geometry/reset` behind `resetRegionToGADM`, and the column `administrative_divisions.gadm_uid`.
- Hiding a world view bounds the API, not the tiles. Martin publishes every table and function on a public port, so a hidden world view's geometry stays fetchable by tile id. Closing that is a follow-up branch with its own ADR; do not cite an ADR number for it here, since it does not exist yet.

Add the index row to `docs/decisions/README.md` in the same style as the existing entries.

- [ ] **Step 2: Update the technical docs**

`docs/tech/world-views.md` — two additions:
- A **Visibility** section: `world_views.is_public` gates both the listing (`getWorldViews`) and the region read surface (`requireVisibleWorldView`), non-admins get 404 rather than 403, the flag defaults to false so imports start hidden, and admins toggle it in the world view settings dialog. State plainly that this is not a tile boundary — Martin serves tiles without authentication today, so a hidden world view's geometry is still reachable by tile id.
- A **Base layer import** section: what `source_type = 'base_layer'` is, how to create one, what depth 2 produces (8 + 237 + 3586 regions), that it goes through the ordinary matcher and lands in the ordinary review, and that geometry is computed by the normal path. Record the measured match outcome from the real run — the table and the three causes above, not a summary of them.
- An **Import sources** section: every import now starts from one panel over the `IMPORT_SOURCES` registry (`frontend/src/components/admin/importSources/`), a source contributes a label, an optional suggested world view name and a form, and adding a source is one module plus one registry entry. Name the three sources that exist.

`docs/tech/experiences.md` — in the assignment section, record that experiences reach the administrative base layer through a mirror world view, not directly, and link to ADR-0018.

- [ ] **Step 3: Update the vision doc**

`docs/vision/vision.md`:
- Line 109 currently reads `- **Default world view** — mirrors the GADM hierarchy directly`. That has never been true of the data: the default world view holds no regions at all. Replace it with:

  ```markdown
  - **Default world view** — browses the administrative divisions themselves, rather than regions grouped on top of them
  - **Base layer mirror** — an optional world view imported one region per administrative division, which is what lets experiences attach to plain administrative geography
  ```

- Add the visibility setting to the admin capabilities list (around line 78): admins publish or hide any world view; a hidden one is invisible and unreadable to everyone else, and newly imported world views start hidden.
- Rewrite the **Import WorldView** capability: it describes two import paths as separate entry points, which is no longer how the UI works. There is now one panel with a source selector offering Wikivoyage, a JSON file, and the administrative base layer. Keep the existing detail about what each path does; change the framing from "two import paths" to one panel over a list of sources, and add the base layer as the third.
- Check the import panel's own intro paragraph in `WorldViewImportPanel.tsx` while you are there: it still describes only fetching from Wikivoyage or uploading a JSON file. Update it to match the source selector, and keep it provider-neutral.

- [ ] **Step 4: Update the security docs**

`docs/security/SECURITY.md` — record that world view visibility is enforced server-side on both the listing and the region read surface, and record the known gap plainly: Martin publishes every table and function on a public port, so tile-level access is not bounded yet and a hidden world view's geometry remains fetchable by tile id. Note that the fix is the pattern already documented for cv-python in the same file — no `ports:` mapping, reachable only on the compose network — plus an authorizing proxy in the backend, and that it is deferred to the tile-boundary branch.

`docs/security/asvs-checklist.yaml` — update the notes on two existing rows under `V8_authorization`, keeping their format and their `status: pass`:
- `V8.2.1` ("Authorization enforced server-side") — add that world view visibility is checked server-side by `requireVisibleWorldView` on the region read surface and by `getWorldViews` on the listing, replacing a client-side filter.
- `V8.3.1` ("Users can only access their own data (IDOR protection)") — add that region and experience-by-region reads no longer answer for a world view the caller may not see, and that the response is 404 rather than 403 so existence is not confirmed.

Do not add new rows or fields, and do not touch `meta.last_audit` — this is not an audit run.

- [ ] **Step 5: Verify the docs build and the gate is clean**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -s -m "$(cat <<'EOF'
Document the base layer import and world view visibility.

Record what now exists: ADR-0018 for reaching the base layer through an
imported mirror world view rather than an experience-to-division
relation, the visibility setting in the world view and vision docs, and
the tile gap that the follow-up branch closes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Two defects found in the running app

**Files:**
- Modify: `frontend/src/hooks/useAuth.tsx` (refresh-success listener)
- Modify: `backend/src/services/worldViewImport/importer.ts` (`hierarchyWarningsFor`, `importTree`, `insertRegion`)
- Test: `backend/src/services/worldViewImport/importer.test.ts` (extend)

**Interfaces:**
- Consumes: everything already built
- Produces: no new API

Both were found by driving the running app as an admin, after every task had passed its review. Neither is reachable from unit tests as this codebase is set up, which is why they survived to here.

- [ ] **Part A — an admin never sees a hidden world view, because the list is fetched before the session is restored**

`useNavigation.tsx:79` fetches `['worldViews']` with `staleTime: Infinity` as soon as it mounts. `useAuth` restores the session asynchronously through `refreshSession()`. When the list request wins that race it carries no `Authorization` header, the server correctly answers with public world views only, and the result is cached for the rest of the session. Verified in the running app: the picker offered only `Wikivoyage Regions` to a logged-in admin, while the same query run directly against the database for an admin returns three.

Before this branch the race was invisible — the list was identical for everyone. Now it hides exactly what the feature exists to show.

The seam already exists. `fetchUtils.ts` exports `setRefreshSuccessListener`, and `useAuth.tsx:155-163` already registers one to update the token and user; it simply invalidates nothing. Add the invalidation there:

```ts
  useEffect(() => {
    setRefreshSuccessListener((data) => {
      accessToken = data.accessToken as string;
      const payload = parseToken(data.accessToken as string);
      if (payload) tokenExpiresAt = payload.exp * 1000;
      if (data.user) setUser(data.user as User);
      // Who is asking changes what this returns, and useNavigation fetches it
      // with staleTime: Infinity the moment it mounts — which can be before the
      // session is restored from the refresh cookie. Without this an admin keeps
      // the anonymous list for the whole session.
      queryClient.invalidateQueries({ queryKey: ['worldViews'] });
    });
    return () => setRefreshSuccessListener(null);
  }, [queryClient]);
```

`useQueryClient` is already imported in that file. Check whether `queryClient` is already in scope in this component before adding it.

- [ ] **Part B — a source with no pages is warned about missing pages**

`hierarchyWarningsFor` (`importer.ts`) attaches `'Grouping: no source page (parsed from item list)'` to every node that has children and no `sourceUrl`. That is a sound heuristic for a source built from articles and meaningless for one that has no articles at all. The base-layer import tripped it on **all 237** of its parent nodes, and the review screen now tells the admin that "237 regions have parsing ambiguities — some sub-regions may have been dropped during extraction", which never happened.

Fix it from the data rather than by adding a flag a future source could forget to set: decide once per import whether the tree carries source pages at all, and skip the grouping warning when it does not.

- In `importTree`, before walking the tree, compute whether any node in it has a `sourceUrl`.
- Pass that down to `insertRegion` and on to `hierarchyWarningsFor`, which skips the grouping warning when the tree has no source pages. Node-supplied `warnings` are unaffected — those come from the extractor and are always meaningful.
- `insertRegion` is exported and covered by `importer.test.ts`; updating its signature means updating those tests.

- [ ] **Part C — tests**

Extend `backend/src/services/worldViewImport/importer.test.ts`:

```ts
  it('does not warn about missing source pages when the tree has none', async () => {
    const { client, calls } = collectingClient();
    const tree: ImportTreeNode = {
      name: 'Europe',
      children: [{ name: 'Germany', children: [] }],
    };

    await insertRegion(client, tree, 1, null, 99, makeProgress(), false);

    const state = calls.find((c) => c.sql.includes('INSERT INTO region_import_state'));
    expect(state!.params.some((p) => Array.isArray(p) && p.length > 0)).toBe(false);
  });

  it('still warns about a grouping node when the tree does carry source pages', async () => {
    const { client, calls } = collectingClient();
    const tree: ImportTreeNode = {
      name: 'Europe',
      children: [{ name: 'Germany', sourceUrl: 'https://example.org/Germany', children: [] }],
    };

    await insertRegion(client, tree, 1, null, 99, makeProgress(), true);

    const state = calls.find((c) => c.sql.includes('INSERT INTO region_import_state'));
    expect(state!.params.some((p) => Array.isArray(p) && p.some((w: string) => w.includes('Grouping')))).toBe(true);
  });
```

Adjust the argument shape to whatever signature you chose; the assertions are what matter.

- [ ] **Part D — clear the false warnings already stored**

One-off against the dev database, not a migration — the rows exist only because the import ran before this fix:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "
  UPDATE region_import_state ris SET hierarchy_warnings = NULL
  FROM regions r
  WHERE r.id = ris.region_id
    AND r.world_view_id IN (SELECT id FROM world_views WHERE source_type LIKE 'base_layer%')
    AND ris.hierarchy_warnings = ARRAY['Grouping: no source page (parsed from item list)'];"
```

Report how many rows it touched. Expected: 237.

- [ ] **Part E — verify and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
```

Browser verification belongs to the controller, who found both defects there and will confirm both fixes the same way.

Two commits, since the parts are in different layers:

```bash
git add frontend/src/hooks/useAuth.tsx
git commit -s -m "$(cat <<'EOF'
front: Refetch the world view list once the session is restored.

useNavigation asks for the world view list the moment it mounts, with
staleTime Infinity, while the session is still being restored from the
refresh cookie. When the list wins that race it goes out unauthenticated,
the server answers with public world views only, and an admin keeps that
answer for the rest of the session — never seeing a hidden world view.

Invalidate the list when a refresh succeeds, where the token and user are
already being updated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"

git add backend/src/services/worldViewImport/importer.ts backend/src/services/worldViewImport/importer.test.ts
git commit -s -m "$(cat <<'EOF'
back: Only flag missing source pages for sources that have pages.

A node with children and no source URL means an extractor parsed it out
of a list, which is worth an admin's attention — but only when the source
has pages at all. A base layer import has none by construction, so every
one of its 237 parent nodes was flagged and the review screen reported
parsing ambiguities and dropped sub-regions that never existed.

Decide once per import whether the tree carries source pages, from the
tree itself, so no source has to remember to declare it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Bring the import format doc in line with what exists

**Files:**
- Modify: `docs/tech/world-view-import.md`

Flagged twice by reviewers during this branch and deliberately left out of scope both times, because it was not in Task 12's file list. It now contradicts the documentation that *was* updated: it describes exactly two import paths, knows nothing about the `base_layer` source type, and predates the source selector that replaced the separate entry points.

- [ ] **Step 1: Read what the branch actually built**

`docs/tech/world-views.md` and `docs/decisions/0018-base-layer-mirror-world-view.md` were updated by Task 12 and are correct. Read them first — this task aligns the import-format doc with them and must not restate anything differently.

- [ ] **Step 2: Correct the import paths**

The doc's framing of "two import paths" is stale. There is one panel with a source selector, and three sources: Wikivoyage, a JSON file, and the administrative base layer. Registered in `frontend/src/components/admin/importSources/index.ts`; adding a source is one module plus one registry entry.

- [ ] **Step 3: Record the base layer source**

`source_type = 'base_layer'` reaches the same review, finalize and rematch endpoints as any other source, because those endpoints resolve source types through `backend/src/services/worldViewImport/sourceTypes.ts` rather than an inline list. The base layer importer emits names and hierarchy only — it does not carry the division a node came from, so the matcher resolves them like any other source.

- [ ] **Step 4: Leave the format itself alone**

`ImportTreeNode` did not change in this branch. If the doc's field table is still accurate, say so by not touching it — do not invent fields.

- [ ] **Step 5: Verify and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
```

```bash
git add docs/tech/world-view-import.md
git commit -s -m "$(cat <<'EOF'
Bring the import format doc in line with the source registry.

It still described two import paths and knew nothing about the base
layer source, which made it contradict the world view and decision docs
updated alongside the code.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Correct how the format doc says to add a source

**Files:**
- Modify: `docs/tech/world-view-import-format.md` (the sections from "How to Add a New Import Source" onward)

The third stale doc, found while fixing the second. It is the one a person actually reads when adding a source, and it describes a workflow this branch replaced.

- [ ] **Step 1: Leave the format specification alone**

Lines 1-92 — the JSON example, the field table, Field Behavior, Match Status Lifecycle, Database Storage — describe `ImportTreeNode` and `region_import_state`, neither of which this branch changed. Verify that claim as you go, then do not touch them.

- [ ] **Step 2: Rewrite "How to Add a New Import Source"**

It currently opens with "Write an extraction script that produces a JSON file in the format above" and describes uploading that file. That is now one of three ways in, not the way. A source is a registry entry:

- a module under `frontend/src/components/admin/importSources/` contributing a label, an optional suggested world view name and a form
- one line in `IMPORT_SOURCES` (`frontend/src/components/admin/importSources/index.ts`)
- a backend path that produces an `ImportTreeNode` tree and hands it to `startImport` with its own `sourceType`
- that `sourceType` registered in `backend/src/services/worldViewImport/sourceTypes.ts`, which is what makes the review, finalize and rematch endpoints recognise it

Uploading a JSON file remains valid — it is the `imported` source and needs none of the above. Say which path suits which case: a one-off tree from an external process uploads a file; a source the app can generate or fetch itself becomes a registry entry.

- [ ] **Step 3: Fix the Existing Sources table**

It lists `scripts/wikivoyage-regions.py`, which no longer exists in the repository — verify with `ls scripts/`. Replace the table with the three sources that exist today and where each gets its tree from. The base layer reads `administrative_divisions` and emits names and hierarchy only; do not describe it as carrying division ids.

- [ ] **Step 4: Verify and commit**

```bash
npm run check && TEST_REPORT_LOCAL=1 npm test
```

```bash
git add docs/tech/world-view-import-format.md
git commit -s -m "$(cat <<'EOF'
Correct how the format doc says to add an import source.

It told the reader to write an extraction script and upload JSON, and
pointed at a script that no longer exists. Adding a source is now a
registry entry; uploading a file is one of three ways in rather than
the way.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Controller-run step, between Task 11 and Task 12

Not a subagent task: the real import takes tens of minutes and its output is a
measurement, not a code change.

1. Start the import from the admin UI (depth 2), watch
   `docker logs -f tyr-ng-backend | grep -E 'WV Import|WV Matcher'`.
2. Measure the match outcome — this is the point of the whole exercise:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "
  SELECT ris.match_status, count(*)
  FROM region_import_state ris
  JOIN regions r ON r.id = ris.region_id
  WHERE r.world_view_id = (SELECT max(id) FROM world_views)
  GROUP BY ris.match_status ORDER BY 2 DESC;" -c "
  SELECT r.name, ris.match_status
  FROM region_import_state ris
  JOIN regions r ON r.id = ris.region_id
  WHERE r.world_view_id = (SELECT max(id) FROM world_views)
    AND ris.match_status NOT IN ('auto_matched','children_matched')
  ORDER BY r.name LIMIT 50;"
```

3. Confirm the matcher, not the importer, created the members, and that each
   member is the division of the same name:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "
  SELECT count(*) FILTER (WHERE r.name = d.name) AS same_name,
         count(*) AS members
  FROM regions r
  JOIN region_members rm ON rm.region_id = r.id
  JOIN administrative_divisions d ON d.id = rm.division_id
  WHERE r.world_view_id = (SELECT max(id) FROM world_views);"
```

4. Close the review in the admin UI, confirm `source_type` becomes
   `base_layer_done`.
5. Run the geometry compute for the new world view, then the existing
   experience assignment action, and check the region counts per depth,
   `geom IS NULL` count, and `experience_regions` totals.

If step 2 shows a large unmatched set, stop and reconsider the matching policy
before writing Task 10's docs — that outcome is a finding about the pipeline, and
the ADR must record what happened rather than what was hoped.

## Before the branch leaves the machine

- [ ] `npm run check`
- [ ] `TEST_REPORT_LOCAL=1 npm test` and `npm run test:py`
- [ ] `/security-check` on the changed files — the visibility middleware and the new admin endpoint are the parts that want a look
- [ ] `npm run security:all`
- [ ] `npm run test:e2e:smoke` — the E2E fixture seeds `experience_regions` (`backend/src/db/seed/e2eFixture.ts`); if its world view is not public, the smoke specs will now 404 where they used to read. Set `is_public = true` on the fixture's world view in the seed if so.
- [ ] Branch history check: no commit exists only to fix an earlier commit of the same branch (`/pr-changes-amend` if one does)
- [ ] **Manual UI check, admin session required** (Task 4 Step 5, not done during implementation — no browser was available): as an admin, confirm the `Hidden` chip appears on a hidden world view, flip "Visible to everyone" on and off in the world view settings dialog, and confirm a logged-out window sees the change. While there, glance at what a logged-out visitor lands on: `useNavigation` picks `worldViews[0]` for non-admins, so publishing the base layer mirror could make it the first thing a stranger sees.

## Deferred to branch 2 (S2)

Tile access. `martin/config.yaml` publishes every table and function on a public port, so a hidden world view's geometry is still fetchable by anyone who knows its id. The design is in the spec: Martin becomes an internal service, the backend proxies `/api/tiles/:source/:z/:x/:y` against a strict source allowlist with per-source authorization, and MapLibre gets a `transformRequest` that attaches the access token. That branch writes its own ADR for the boundary — take the next free number then, rather than reserving one now.
