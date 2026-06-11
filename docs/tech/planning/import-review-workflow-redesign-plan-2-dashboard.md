# Import Review Workflow Redesign — Plan 2/4: Dashboard UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working import dashboard at `/admin/import/:worldViewId` — Countries / Skeleton / Global-gaps tabs over the Plan-1 backend — making the whole sign-off loop manually drivable from the browser.

**Architecture:** New route + page under `frontend/src/components/admin/importDashboard/`; a thin API module for the nine workflow endpoints; pure derivation utils (status dots, grouping, skeleton candidates) with unit tests; React Query for all server state (`['admin','wvImport',...]` key convention). Assignment editing stays in the legacy Match Review until Plan 4 cutover; this plan adds per-row verify/confirm/sign-off/reopen actions so the loop is testable now (the row menu remains useful after the Plan-3 workspace lands).

**Tech Stack:** React 18 + MUI + TanStack Query + react-router v6; Vitest for utils tests; `authFetchJson` API convention.

**Declared descopes (land later):** workspace route (Plan 3); skeleton-tab restructure ops + inline match tools (Plan 3/4 — the tab links to the legacy tree for those); global-gaps assignment/geo-suggest flow + shadow-insertion removal (Plan 4 — this tab does run/dismiss/undismiss only); moving Compute Geometries / Re-match off the legacy screen (Plan 4).

**Conventions for every commit:** title `front: <Topic>.` (≤72 chars, imperative), body what+why wrapped at 72, `-s` sign-off, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Frontend gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`. NEVER stage `.claude/commands/commit.md` or `frontend/package-lock.json`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/api/admin/wvImportWorkflow.ts` | Create | Types + fetchers for the 9 workflow endpoints |
| `frontend/src/api/admin/worldViewImport.ts` | Modify | `MatchTreeNode` gains the 4 new flags |
| `frontend/src/components/admin/importDashboard/dashboardUtils.ts` | Create | Pure derivations: unit status, grouping, sorting, duplicates, skeleton candidates |
| `frontend/src/components/admin/importDashboard/dashboardUtils.test.ts` | Create | Unit tests for all derivations |
| `frontend/src/components/admin/importDashboard/ImportDashboardPage.tsx` | Create | Route component: admin guard, header (progress, Finalize), tabs |
| `frontend/src/components/admin/importDashboard/CountriesTab.tsx` | Create | Grouped unit list with filter/sort |
| `frontend/src/components/admin/importDashboard/CountryRow.tsx` | Create | One unit row: dot, progress, badges, action menu |
| `frontend/src/components/admin/importDashboard/VerifyDialog.tsx` | Create | Verify results + sign-off with blocker rendering |
| `frontend/src/components/admin/importDashboard/SkeletonTab.tsx` | Create | Work-unit toggles, unidentified worklist, confirm skeleton |
| `frontend/src/components/admin/importDashboard/GlobalGapsTab.tsx` | Create | Coverage check (SSE), gap list, dismiss/undismiss |
| `frontend/src/App.tsx` | Modify | Route `/admin/import/:worldViewId` |
| `frontend/src/components/admin/WorldViewImportPanel.tsx` | Modify | "Review Matches" → navigate to dashboard; `?wvReview=` deep-link opens legacy review |
| `frontend/src/components/admin/AdminDashboard.tsx` | Modify | Honor `?section=wvImport` query on mount |
| `docs/tech/world-view-import.md`, `docs/vision/vision.md` | Modify | Dashboard paragraph + admin-capability line |

---

### Task 1: Workflow API module + tree flags

**Files:** Create `frontend/src/api/admin/wvImportWorkflow.ts`; modify `frontend/src/api/admin/worldViewImport.ts`.

- [ ] **Step 1: Create the API module** (mirrors the `authFetchJson` + `API_URL` pattern of sibling modules):

```typescript
/**
 * Admin WorldView Import — workflow endpoints (per-country sign-off model).
 * Spec: docs/tech/planning/import-review-workflow-redesign.md
 */
import { authFetchJson } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const BASE = (worldViewId: number) => `${API_URL}/api/admin/wv-import/matches/${worldViewId}`;

export type SignoffStatus = 'not_started' | 'in_progress' | 'signed_off';

export interface DashboardUnit {
  regionId: number;
  name: string;
  continent: string | null;
  signoffStatus: SignoffStatus;
  signedOffAt: string | null;
  hierarchyConfirmed: boolean;
  hasReference: boolean;
  referenceDivisionIds: number[];
  sourceUrl: string | null;
  leafTotal: number;
  leafResolved: number;
  warningCount: number;
}

export interface WorkflowDashboard {
  skeletonConfirmed: boolean;
  units: DashboardUnit[];
}

export type VerifyBlocker =
  | 'no_reference_territory'
  | 'unassigned_leaves'
  | 'coverage_gaps'
  | 'overlaps';
export type SignOffBlocker = VerifyBlocker | 'hierarchy_not_confirmed';

export interface VerifyResult {
  referenceDivisionIds: number[];
  referenceSource: 'members' | 'reference' | null;
  unassignedLeaves: Array<{ regionId: number; name: string }>;
  coverageGaps: Array<{ divisionId: number; name: string; parentName: string | null }>;
  overlaps: Array<{ divisionId: number; name: string; regionIds: number[] }>;
  blockers: VerifyBlocker[];
  verifiedAt: string;
}

export async function getWorkflowDashboard(worldViewId: number): Promise<WorkflowDashboard> {
  return authFetchJson(`${BASE(worldViewId)}/dashboard`);
}

export async function getWorkUnitVerification(worldViewId: number, regionId: number): Promise<VerifyResult> {
  return authFetchJson(`${BASE(worldViewId)}/verify/${regionId}`);
}

/** Throws on 409; the caller catches and re-fetches verify for blocker display. */
export async function signOffWorkUnit(
  worldViewId: number,
  regionId: number,
): Promise<{ success: boolean; signedOffAt: string | null }> {
  return authFetchJson(`${BASE(worldViewId)}/sign-off`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId }),
  });
}

export async function reopenWorkUnit(worldViewId: number, regionId: number): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId }),
  });
}

export async function setWorkUnitFlag(
  worldViewId: number,
  regionId: number,
  isWorkUnit: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/work-unit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, isWorkUnit }),
  });
}

export async function confirmHierarchy(
  worldViewId: number,
  regionId: number,
  confirmed: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/confirm-hierarchy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, confirmed }),
  });
}

export async function confirmSkeleton(worldViewId: number, confirmed: boolean): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/confirm-skeleton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed }),
  });
}

export async function setReferenceTerritory(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/set-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, divisionIds }),
  });
}

export async function setAssignmentWaived(
  worldViewId: number,
  regionId: number,
  waived: boolean,
): Promise<{ success: boolean }> {
  return authFetchJson(`${BASE(worldViewId)}/waive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionId, waived }),
  });
}
```

First READ `frontend/src/api/fetchUtils.ts` to learn how `authFetchJson` surfaces non-2xx responses (the sign-off 409 carries `{blockers, verify}` — the VerifyDialog needs that payload; if `authFetchJson` throws an Error with the parsed body attached, note the access pattern; if it discards the body, add a small `authFetchJsonRaw`-style helper HERE (not in fetchUtils) that returns `{ok, status, body}` for the sign-off call only, and adjust `signOffWorkUnit` to return a discriminated union `{ok:true, signedOffAt} | {ok:false, blockers, verify}`. Pick whichever matches reality — document the choice in the commit body.)

- [ ] **Step 2: Tree flags.** In `worldViewImport.ts`, extend `MatchTreeNode` (after `hierarchyReviewed`):

```typescript
  /** Workflow (per-country sign-off) flags — see wvImportWorkflow.ts */
  isWorkUnit: boolean;
  hierarchyConfirmed: boolean;
  signoffStatus: 'not_started' | 'in_progress' | 'signed_off';
  assignmentWaived: boolean;
```

- [ ] **Step 3: Gates + commit**

Run: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`
Expected: clean (tree consumers don't destructure exhaustively, so added fields are compile-safe — verify).

```bash
git add frontend/src/api/admin/wvImportWorkflow.ts frontend/src/api/admin/worldViewImport.ts
git commit -s -m "front: Add workflow API client for import sign-off model.

Types and fetchers for the nine Plan-1 workflow endpoints (dashboard,
verify, sign-off with 409 blocker payload, reopen, work-unit toggle,
hierarchy/skeleton confirmation, reference territory, waiver), and
the four new MatchTreeNode flags the tree endpoint now returns.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Dashboard derivation utils (TDD)

**Files:** Create `frontend/src/components/admin/importDashboard/dashboardUtils.ts` + `dashboardUtils.test.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  deriveUnitStatus,
  groupUnitsByContinent,
  findDuplicateSourceUrls,
  collectSkeletonCandidates,
  type UnitStatus,
} from './dashboardUtils';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';

function unit(over: Partial<DashboardUnit>): DashboardUnit {
  return {
    regionId: 1, name: 'X', continent: 'Europe', signoffStatus: 'not_started',
    signedOffAt: null, hierarchyConfirmed: false, hasReference: true,
    referenceDivisionIds: [1], sourceUrl: null, leafTotal: 1, leafResolved: 0,
    warningCount: 0, ...over,
  };
}

describe('deriveUnitStatus', () => {
  it.each<[Partial<DashboardUnit>, UnitStatus]>([
    [{ signoffStatus: 'not_started' }, 'not_started'],
    [{ signoffStatus: 'in_progress' }, 'in_progress'],
    [{ signoffStatus: 'signed_off', signedOffAt: '2026-06-11T00:00:00Z' }, 'signed_off'],
    [{ signoffStatus: 'in_progress', signedOffAt: '2026-06-11T00:00:00Z' }, 'stale'],
  ])('%o → %s', (over, expected) => {
    expect(deriveUnitStatus(unit(over))).toBe(expected);
  });
});

describe('groupUnitsByContinent', () => {
  it('groups and sorts continents alphabetically, null last as "Ungrouped"', () => {
    const groups = groupUnitsByContinent([
      unit({ regionId: 1, continent: 'Europe', name: 'B' }),
      unit({ regionId: 2, continent: null, name: 'C' }),
      unit({ regionId: 3, continent: 'Africa', name: 'A' }),
    ]);
    expect(groups.map(g => g.continent)).toEqual(['Africa', 'Europe', 'Ungrouped']);
  });

  it('sorts units in a group by name', () => {
    const groups = groupUnitsByContinent([
      unit({ regionId: 1, name: 'Zambia', continent: 'Africa' }),
      unit({ regionId: 2, name: 'Algeria', continent: 'Africa' }),
    ]);
    expect(groups[0].units.map(u => u.name)).toEqual(['Algeria', 'Zambia']);
  });
});

describe('findDuplicateSourceUrls', () => {
  it('returns the set of sourceUrls appearing on 2+ units', () => {
    const dupes = findDuplicateSourceUrls([
      unit({ regionId: 1, sourceUrl: 'wv/Russia' }),
      unit({ regionId: 2, sourceUrl: 'wv/Russia' }),
      unit({ regionId: 3, sourceUrl: 'wv/France' }),
      unit({ regionId: 4, sourceUrl: null }),
    ]);
    expect(dupes.has('wv/Russia')).toBe(true);
    expect(dupes.has('wv/France')).toBe(false);
  });
});

describe('collectSkeletonCandidates', () => {
  const leaf = (id: number, name: string, matchStatus: string | null, isWorkUnit = false): MatchTreeNode =>
    ({ id, name, matchStatus, isWorkUnit, children: [] } as unknown as MatchTreeNode);

  it('returns unresolved non-unit nodes that are not inside any work unit', () => {
    const tree: MatchTreeNode[] = [
      {
        ...leaf(1, 'Europe', null),
        children: [
          { ...leaf(2, 'France', 'needs_review') },               // candidate
          { ...leaf(3, 'Germany', 'children_matched', true),      // unit: its subtree excluded
            children: [leaf(4, 'Bavaria', 'no_candidates')] },
        ],
      } as unknown as MatchTreeNode,
    ];
    const ids = collectSkeletonCandidates(tree).map(c => c.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(1); // container without unresolved status is not a candidate
  });
});
```

- [ ] **Step 2:** Run: `cd frontend && npx vitest run src/components/admin/importDashboard/dashboardUtils.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
/**
 * Pure derivations for the import workflow dashboard.
 * Status semantics: spec § "Status transitions & staleness" —
 * in_progress + non-null signedOffAt = "modified after sign-off" (stale).
 */
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';

export type UnitStatus = 'not_started' | 'in_progress' | 'signed_off' | 'stale';

export function deriveUnitStatus(u: DashboardUnit): UnitStatus {
  if (u.signoffStatus === 'signed_off') return 'signed_off';
  if (u.signoffStatus === 'in_progress' && u.signedOffAt != null) return 'stale';
  return u.signoffStatus;
}

export interface ContinentGroup {
  continent: string;
  units: DashboardUnit[];
}

export function groupUnitsByContinent(units: DashboardUnit[]): ContinentGroup[] {
  const byContinent = new Map<string, DashboardUnit[]>();
  for (const u of units) {
    const key = u.continent ?? 'Ungrouped';
    const list = byContinent.get(key) ?? [];
    list.push(u);
    byContinent.set(key, list);
  }
  return [...byContinent.entries()]
    .sort(([a], [b]) => (a === 'Ungrouped' ? 1 : b === 'Ungrouped' ? -1 : a.localeCompare(b)))
    .map(([continent, list]) => ({
      continent,
      units: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function findDuplicateSourceUrls(units: DashboardUnit[]): Set<string> {
  const counts = new Map<string, number>();
  for (const u of units) {
    if (u.sourceUrl) counts.set(u.sourceUrl, (counts.get(u.sourceUrl) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([url]) => url));
}

export interface SkeletonCandidate {
  id: number;
  name: string;
  matchStatus: string | null;
}

/**
 * Nodes the skeleton pass must resolve: unresolved (needs_review /
 * no_candidates) non-unit nodes OUTSIDE every work unit's subtree.
 * Work-unit subtrees are the country loop's responsibility.
 */
export function collectSkeletonCandidates(tree: MatchTreeNode[]): SkeletonCandidate[] {
  const out: SkeletonCandidate[] = [];
  const walk = (nodes: MatchTreeNode[]): void => {
    for (const n of nodes) {
      if (n.isWorkUnit) continue; // unit boundary — its subtree is country-loop scope
      if (n.matchStatus === 'needs_review' || n.matchStatus === 'no_candidates') {
        out.push({ id: n.id, name: n.name, matchStatus: n.matchStatus });
      }
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}
```

- [ ] **Step 4:** Run the test file — all pass. **Step 5: Commit** (`front: Add dashboard derivation utils for import workflow.` + body explaining the stale-badge rule and skeleton-candidate semantics + trailer).

---

### Task 3: Route + page shell + header

**Files:** Create `ImportDashboardPage.tsx`; modify `frontend/src/App.tsx`.

- [ ] **Step 1: Read `App.tsx`** (routing + import style) and `AdminDashboard.tsx`'s admin-guard idiom (useAuth → `Navigate to="/"`).

- [ ] **Step 2: Create `ImportDashboardPage.tsx`:**

```tsx
/**
 * Import workflow dashboard (Plan 2/4 of the import-review redesign).
 * Route: /admin/import/:worldViewId
 * Tabs: Countries (sign-off progress) · Skeleton · Global gaps.
 * Assignment editing stays in the legacy Match Review until Plan 4.
 */
import { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Container, LinearProgress, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { getWorkflowDashboard } from '../../../api/admin/wvImportWorkflow';
import { finalizeReview } from '../../../api/admin/wvImportCoverage';
import { CountriesTab } from './CountriesTab';
import { SkeletonTab } from './SkeletonTab';
import { GlobalGapsTab } from './GlobalGapsTab';

export function ImportDashboardPage() {
  const { worldViewId: wvParam } = useParams();
  const worldViewId = parseInt(wvParam ?? '');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<'countries' | 'skeleton' | 'gaps'>('countries');
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId],
    queryFn: () => getWorkflowDashboard(worldViewId),
    enabled: Number.isInteger(worldViewId),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeReview(worldViewId),
    onSuccess: () => {
      setFinalizeError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport'] });
    },
    onError: (err: unknown) => {
      setFinalizeError(err instanceof Error ? err.message : 'Finalize failed');
    },
  });

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />;
  if (!Number.isInteger(worldViewId)) return <Navigate to="/admin" replace />;

  const units = data?.units ?? [];
  const signedOff = units.filter(u => u.signoffStatus === 'signed_off').length;
  const allSignedOff = units.length > 0 && signedOff === units.length;
  const finalizeBlocked = !data?.skeletonConfirmed || !allSignedOff;
  const finalizeTooltip = finalizeBlocked
    ? [
        !data?.skeletonConfirmed ? 'skeleton not confirmed' : null,
        !allSignedOff ? `${units.length - signedOff} units not signed off` : null,
      ].filter(Boolean).join(', ')
    : '';

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/admin?section=wvImport')}>
          Admin
        </Button>
        <Typography variant="h4" sx={{ flex: 1 }}>Import Dashboard</Typography>
        <Button
          variant="outlined"
          onClick={() => navigate(`/admin?section=wvImport&wvReview=${worldViewId}`)}
        >
          Legacy match tree
        </Button>
        <Tooltip title={finalizeTooltip}>
          <span>
            <Button
              variant="outlined"
              color="success"
              disabled={finalizeBlocked || finalizeMutation.isPending}
              onClick={() => finalizeMutation.mutate()}
            >
              Finalize
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {units.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <LinearProgress
            variant="determinate"
            value={(signedOff / units.length) * 100}
            sx={{ flex: 1, height: 8, borderRadius: 1 }}
          />
          <Chip label={`${signedOff}/${units.length} signed off`} size="small" />
          <Chip
            label={data?.skeletonConfirmed ? 'Skeleton ✓' : 'Skeleton unconfirmed'}
            color={data?.skeletonConfirmed ? 'success' : 'default'}
            size="small"
          />
        </Stack>
      )}

      {finalizeError && (
        <Alert severity="error" onClose={() => setFinalizeError(null)} sx={{ mb: 2 }}>
          {finalizeError}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="countries" label={`Countries (${units.length})`} />
        <Tab value="skeleton" label="Skeleton" />
        <Tab value="gaps" label="Global gaps" />
      </Tabs>

      {isLoading && <LinearProgress />}
      {tab === 'countries' && <CountriesTab worldViewId={worldViewId} units={units} />}
      {tab === 'skeleton' && (
        <SkeletonTab worldViewId={worldViewId} skeletonConfirmed={data?.skeletonConfirmed ?? false} units={units} />
      )}
      {tab === 'gaps' && <GlobalGapsTab worldViewId={worldViewId} />}
    </Container>
  );
}
```

NOTE: `finalizeReview` lives in `wvImportCoverage.ts` (line ~178) — check its signature/throw behavior; the backend now 400s with `{error:'Workflow incomplete', skeletonConfirmed, unsignedUnits}` — surface that text in the Alert (adjust extraction to how authFetchJson exposes error bodies, consistent with the Task-1 decision).

- [ ] **Step 3: Route.** In `App.tsx`, add ABOVE the `/admin/*` route (follow the file's import style):

```tsx
<Route path="/admin/import/:worldViewId" element={<ImportDashboardPage />} />
```

- [ ] **Step 4:** Temporary stubs so it compiles: create the three tab components as minimal placeholders ONLY if you implement tasks strictly in order and need compilation — otherwise implement Tasks 4–6 before committing this task. Preferred: implement Tasks 3–6 as one coherent unit but commit separately per task with `git add` scoping. If stubs are unavoidable, they must be replaced within this plan (knip/lint must pass at every commit).

- [ ] **Step 5: Gates + commit** (`front: Add import dashboard route and page shell.` + body + trailer).

---

### Task 4: Countries tab + row actions + verify dialog

**Files:** Create `CountriesTab.tsx`, `CountryRow.tsx`, `VerifyDialog.tsx`.

- [ ] **Step 1: `CountriesTab.tsx`** — filter field + grouped list:

```tsx
import { useMemo, useState } from 'react';
import { Box, List, ListSubheader, TextField } from '@mui/material';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import { groupUnitsByContinent, findDuplicateSourceUrls } from './dashboardUtils';
import { CountryRow } from './CountryRow';

export function CountriesTab({ worldViewId, units }: { worldViewId: number; units: DashboardUnit[] }) {
  const [filter, setFilter] = useState('');
  const dupes = useMemo(() => findDuplicateSourceUrls(units), [units]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const visible = f ? units.filter(u => u.name.toLowerCase().includes(f)) : units;
    return groupUnitsByContinent(visible);
  }, [units, filter]);

  return (
    <Box>
      <TextField
        size="small"
        placeholder="Filter countries…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        sx={{ mb: 1, width: 280 }}
      />
      <List dense disablePadding>
        {groups.map(g => (
          <Box key={g.continent}>
            <ListSubheader disableSticky>{g.continent}</ListSubheader>
            {g.units.map(u => (
              <CountryRow
                key={u.regionId}
                worldViewId={worldViewId}
                unit={u}
                isDuplicate={!!u.sourceUrl && dupes.has(u.sourceUrl)}
              />
            ))}
          </Box>
        ))}
      </List>
    </Box>
  );
}
```

- [ ] **Step 2: `CountryRow.tsx`** — status dot, progress, badges, action menu:

```tsx
import { useState } from 'react';
import {
  Chip, CircularProgress, IconButton, ListItem, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography,
} from '@mui/material';
import { MoreVert as MenuIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  confirmHierarchy, reopenWorkUnit, type DashboardUnit,
} from '../../../api/admin/wvImportWorkflow';
import { deriveUnitStatus, type UnitStatus } from './dashboardUtils';
import { VerifyDialog } from './VerifyDialog';

const STATUS_DOT: Record<UnitStatus, { glyph: string; color: string; label: string }> = {
  not_started: { glyph: '○', color: 'text.disabled', label: 'not started' },
  in_progress: { glyph: '◐', color: 'info.main', label: 'in progress' },
  signed_off: { glyph: '⬤', color: 'success.main', label: 'signed off' },
  stale: { glyph: '⚠', color: 'warning.main', label: 'modified after sign-off' },
};

export function CountryRow({
  worldViewId, unit, isDuplicate,
}: { worldViewId: number; unit: DashboardUnit; isDuplicate: boolean }) {
  const queryClient = useQueryClient();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const status = deriveUnitStatus(unit);
  const dot = STATUS_DOT[status];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] });

  const confirmMutation = useMutation({
    mutationFn: () => confirmHierarchy(worldViewId, unit.regionId, !unit.hierarchyConfirmed),
    onSuccess: invalidate,
  });
  const reopenMutation = useMutation({
    mutationFn: () => reopenWorkUnit(worldViewId, unit.regionId),
    onSuccess: invalidate,
  });
  const busy = confirmMutation.isPending || reopenMutation.isPending;

  return (
    <ListItem
      dense
      secondaryAction={
        <IconButton edge="end" size="small" onClick={e => setMenuAnchor(e.currentTarget)}>
          {busy ? <CircularProgress size={16} /> : <MenuIcon fontSize="small" />}
        </IconButton>
      }
    >
      <Tooltip title={dot.label}>
        <Typography sx={{ width: 28, color: dot.color }}>{dot.glyph}</Typography>
      </Tooltip>
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center">
            <span>{unit.name}</span>
            {isDuplicate && <Chip label="×2" size="small" variant="outlined" />}
            {!unit.hasReference && <Chip label="no reference" size="small" color="error" variant="outlined" />}
            {unit.warningCount > 0 && (
              <Chip label={`${unit.warningCount} ⚠`} size="small" color="warning" variant="outlined" />
            )}
          </Stack>
        }
        secondary={`Hierarchy ${unit.hierarchyConfirmed ? '✓' : '✗'} · ${unit.leafResolved}/${unit.leafTotal} leaves`}
      />
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { setMenuAnchor(null); setVerifyOpen(true); }}>
          Checks & sign-off…
        </MenuItem>
        <MenuItem disabled={busy} onClick={() => { setMenuAnchor(null); confirmMutation.mutate(); }}>
          {unit.hierarchyConfirmed ? 'Unconfirm hierarchy' : 'Confirm hierarchy'}
        </MenuItem>
        {(status === 'signed_off' || status === 'stale') && (
          <MenuItem disabled={busy} onClick={() => { setMenuAnchor(null); reopenMutation.mutate(); }}>
            Reopen
          </MenuItem>
        )}
      </Menu>
      {verifyOpen && (
        <VerifyDialog
          worldViewId={worldViewId}
          unit={unit}
          onClose={() => { setVerifyOpen(false); invalidate(); }}
        />
      )}
    </ListItem>
  );
}
```

- [ ] **Step 3: `VerifyDialog.tsx`** — runs verify on open, renders blockers/details, offers sign-off:

```tsx
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getWorkUnitVerification, signOffWorkUnit, type DashboardUnit, type SignOffBlocker,
} from '../../../api/admin/wvImportWorkflow';

const BLOCKER_LABEL: Record<SignOffBlocker, string> = {
  hierarchy_not_confirmed: 'Hierarchy not confirmed',
  no_reference_territory: 'No reference territory',
  unassigned_leaves: 'Unassigned leaves',
  coverage_gaps: 'Coverage gaps',
  overlaps: 'Overlapping assignments',
};

export function VerifyDialog({
  worldViewId, unit, onClose,
}: { worldViewId: number; unit: DashboardUnit; onClose: () => void }) {
  const { data: verify, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'wvImport', 'verify', worldViewId, unit.regionId],
    queryFn: () => getWorkUnitVerification(worldViewId, unit.regionId),
    staleTime: 0,
  });

  const signOffMutation = useMutation({
    mutationFn: () => signOffWorkUnit(worldViewId, unit.regionId),
    onSuccess: () => onClose(),
    onError: () => { refetch(); },
  });

  const blockers: SignOffBlocker[] = [
    ...(!unit.hierarchyConfirmed ? (['hierarchy_not_confirmed'] as const) : []),
    ...(verify?.blockers ?? []),
  ];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{unit.name} — checks</DialogTitle>
      <DialogContent>
        {isFetching && <LinearProgress sx={{ mb: 2 }} />}
        {verify && blockers.length === 0 && (
          <Alert severity="success" sx={{ mb: 2 }}>All checks green — ready to sign off.</Alert>
        )}
        {blockers.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            {blockers.map(b => <Chip key={b} label={BLOCKER_LABEL[b]} color="warning" size="small" />)}
          </Stack>
        )}
        {verify && verify.unassignedLeaves.length > 0 && (
          <>
            <Typography variant="subtitle2">Unassigned leaves ({verify.unassignedLeaves.length})</Typography>
            <List dense>
              {verify.unassignedLeaves.slice(0, 20).map(l => (
                <ListItem key={l.regionId}><ListItemText primary={l.name} /></ListItem>
              ))}
            </List>
          </>
        )}
        {verify && verify.coverageGaps.length > 0 && (
          <>
            <Typography variant="subtitle2">Coverage gaps ({verify.coverageGaps.length})</Typography>
            <List dense>
              {verify.coverageGaps.slice(0, 20).map(g => (
                <ListItem key={g.divisionId}>
                  <ListItemText primary={g.name} secondary={g.parentName ?? undefined} />
                </ListItem>
              ))}
            </List>
          </>
        )}
        {verify && verify.overlaps.length > 0 && (
          <>
            <Typography variant="subtitle2">Overlaps ({verify.overlaps.length})</Typography>
            <List dense>
              {verify.overlaps.slice(0, 20).map(o => (
                <ListItem key={o.divisionId}>
                  <ListItemText primary={o.name} secondary={`claimed by regions ${o.regionIds.join(', ')}`} />
                </ListItem>
              ))}
            </List>
          </>
        )}
        <Typography variant="caption" color="text.secondary">
          Resolve assignments in the legacy match tree until the country workspace lands (Plan 3).
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => refetch()} disabled={isFetching}>Re-run checks</Button>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          color="success"
          disabled={isFetching || blockers.length > 0 || signOffMutation.isPending}
          onClick={() => signOffMutation.mutate()}
        >
          Sign off
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

(Cap long lists at 20 with a "+N more" line if trivial to add. If the Task-1 sign-off helper returns a discriminated union instead of throwing, adapt `onError`/`onSuccess` accordingly.)

- [ ] **Step 4: Gates + commit** (`front: Add countries tab with per-unit checks and sign-off.` + body + trailer).

---

### Task 5: Skeleton tab

**Files:** Create `SkeletonTab.tsx`.

- [ ] **Step 1:**

```tsx
import { Alert, Box, Button, Chip, List, ListItem, ListItemText, Switch, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMatchTree } from '../../../api/admin/worldViewImport';
import {
  confirmSkeleton, setWorkUnitFlag, type DashboardUnit,
} from '../../../api/admin/wvImportWorkflow';
import { collectSkeletonCandidates } from './dashboardUtils';

export function SkeletonTab({
  worldViewId, skeletonConfirmed, units,
}: { worldViewId: number; skeletonConfirmed: boolean; units: DashboardUnit[] }) {
  const queryClient = useQueryClient();
  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });
  const candidates = tree ? collectSkeletonCandidates(tree) : [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
  };
  const toggleMutation = useMutation({
    mutationFn: ({ regionId, isWorkUnit }: { regionId: number; isWorkUnit: boolean }) =>
      setWorkUnitFlag(worldViewId, regionId, isWorkUnit),
    onSuccess: invalidate,
  });
  const confirmMutation = useMutation({
    mutationFn: (confirmed: boolean) => confirmSkeleton(worldViewId, confirmed),
    onSuccess: invalidate,
  });

  return (
    <Box>
      <Alert severity={skeletonConfirmed ? 'success' : 'info'} sx={{ mb: 2 }}
        action={
          <Button color="inherit" size="small" disabled={confirmMutation.isPending}
            onClick={() => confirmMutation.mutate(!skeletonConfirmed)}>
            {skeletonConfirmed ? 'Unconfirm' : 'Confirm skeleton'}
          </Button>
        }>
        {skeletonConfirmed
          ? 'Skeleton confirmed — continents and the work-unit list are settled.'
          : 'Review the work-unit list and resolve unidentified countries, then confirm.'}
      </Alert>

      <Typography variant="h6" gutterBottom>Unidentified countries ({candidates.length})</Typography>
      {isLoading && <Typography color="text.secondary">Loading tree…</Typography>}
      {!isLoading && candidates.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>None — every unresolved node sits inside a work unit.</Typography>
      )}
      <List dense>
        {candidates.map(c => (
          <ListItem key={c.id}
            secondaryAction={
              <Tooltip title="Promote to work unit">
                <Switch size="small" checked={false} disabled={toggleMutation.isPending}
                  onChange={() => toggleMutation.mutate({ regionId: c.id, isWorkUnit: true })} />
              </Tooltip>
            }>
            <ListItemText primary={c.name} secondary={c.matchStatus ?? undefined} />
          </ListItem>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 3 }}>
        Resolve matches for these in the legacy match tree; promote ones that should be countries.
      </Typography>

      <Typography variant="h6" gutterBottom>Work units ({units.length})</Typography>
      <List dense>
        {units.map(u => (
          <ListItem key={u.regionId}
            secondaryAction={
              <Tooltip title="Demote (resets sign-off lifecycle)">
                <Switch size="small" checked disabled={toggleMutation.isPending}
                  onChange={() => toggleMutation.mutate({ regionId: u.regionId, isWorkUnit: false })} />
              </Tooltip>
            }>
            <ListItemText primary={u.name}
              secondary={u.continent ?? undefined} />
            {!u.hasReference && <Chip label="no reference" size="small" color="error" variant="outlined" />}
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
```

- [ ] **Step 2: Gates + commit** (`front: Add skeleton tab with work-unit curation.` + body + trailer).

---

### Task 6: Global gaps tab

**Files:** Create `GlobalGapsTab.tsx`.

- [ ] **Step 1:** Read `frontend/src/api/admin/wvImportCoverage.ts` exports used below (`getCoverageWithProgress`, `dismissCoverageGap`, `undismissCoverageGap`, `CoverageResult`). Implement:

```tsx
import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, IconButton,
  LinearProgress, List, ListItem, ListItemText, Tooltip, Typography,
} from '@mui/material';
import { ExpandMore as ExpandIcon, VisibilityOff as DismissIcon, Undo as UndismissIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCoverageWithProgress, dismissCoverageGap, undismissCoverageGap, type CoverageResult,
} from '../../../api/admin/wvImportCoverage';

export function GlobalGapsTab({ worldViewId }: { worldViewId: number }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ running: boolean; step?: string }>({ running: false });

  const { data: coverage } = useQuery({
    queryKey: ['admin', 'wvImport', 'coverage', worldViewId],
    queryFn: () => null as CoverageResult | null,
    enabled: false,
    gcTime: Infinity,
    staleTime: Infinity,
  });

  const runCheck = () => {
    setProgress({ running: true });
    getCoverageWithProgress(worldViewId, e => {
      if (e.type === 'progress') setProgress({ running: true, step: e.step });
    })
      .then(result => {
        queryClient.setQueryData(['admin', 'wvImport', 'coverage', worldViewId], result);
        setProgress({ running: false });
      })
      .catch(() => setProgress({ running: false }));
  };

  const patchCoverage = (fn: (c: CoverageResult) => CoverageResult) => {
    const cur = queryClient.getQueryData<CoverageResult>(['admin', 'wvImport', 'coverage', worldViewId]);
    if (cur) queryClient.setQueryData(['admin', 'wvImport', 'coverage', worldViewId], fn(cur));
  };

  const dismissMutation = useMutation({
    mutationFn: (divisionId: number) => dismissCoverageGap(worldViewId, divisionId),
    onSuccess: (_d, divisionId) =>
      patchCoverage(c => {
        const gap = c.gaps.find(g => g.id === divisionId);
        return {
          ...c,
          gaps: c.gaps.filter(g => g.id !== divisionId),
          dismissedCount: c.dismissedCount + 1,
          dismissedGaps: gap ? [...c.dismissedGaps, { id: gap.id, name: gap.name, parentName: gap.parentName }] : c.dismissedGaps,
        };
      }),
  });
  const undismissMutation = useMutation({
    mutationFn: (divisionId: number) => undismissCoverageGap(worldViewId, divisionId),
    onSuccess: () => runCheck(),
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
        <Button variant="outlined" onClick={runCheck} disabled={progress.running}>
          {progress.running ? 'Checking…' : coverage ? 'Re-check coverage' : 'Check coverage'}
        </Button>
        {progress.running && (
          <Typography variant="body2" color="text.secondary">{progress.step ?? 'Working…'}</Typography>
        )}
      </Box>
      {progress.running && <LinearProgress sx={{ mb: 2 }} />}

      {coverage && coverage.gaps.length === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>No active coverage gaps.</Alert>
      )}

      {coverage && coverage.gaps.length > 0 && (
        <>
          <Typography variant="h6" gutterBottom>Active gaps ({coverage.gaps.length})</Typography>
          <List dense>
            {coverage.gaps.map(g => (
              <ListItem key={g.id}
                secondaryAction={
                  <Tooltip title="Dismiss from coverage checks">
                    <IconButton edge="end" size="small" disabled={dismissMutation.isPending}
                      onClick={() => dismissMutation.mutate(g.id)}>
                      <DismissIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }>
                <ListItemText
                  primary={g.name}
                  secondary={[g.parentName, g.suggestion ? `suggested: ${g.suggestion.targetRegionName}` : null]
                    .filter(Boolean).join(' · ') || undefined}
                />
              </ListItem>
            ))}
          </List>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Assign gaps via the legacy match tree's coverage dialog until Plan 4 moves resolution here.
          </Typography>
        </>
      )}

      {coverage && coverage.dismissedGaps.length > 0 && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandIcon />}>
            <Typography>{coverage.dismissedGaps.length} dismissed</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <List dense>
              {coverage.dismissedGaps.map(g => (
                <ListItem key={g.id}
                  secondaryAction={
                    <IconButton edge="end" size="small" disabled={undismissMutation.isPending}
                      onClick={() => undismissMutation.mutate(g.id)}>
                      <UndismissIcon fontSize="small" />
                    </IconButton>
                  }>
                  <ListItemText primary={g.name} secondary={g.parentName ?? undefined} />
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Gates + commit** (`front: Add global gaps tab with dismiss management.` + body + trailer).

---

### Task 7: Entry wiring, gates, docs

**Files:** Modify `WorldViewImportPanel.tsx`, `AdminDashboard.tsx`, `docs/tech/world-view-import.md`, `docs/vision/vision.md`.

- [ ] **Step 1: Panel → dashboard.** In `WorldViewImportPanel.tsx`: both "Review Matches" buttons (~lines 563, 897) navigate to the dashboard instead of setting inline state: `useNavigate()` + `navigate(`/admin/import/${wv.id}`)`. The inline `WorldViewImportReview` rendering STAYS (legacy path); it now opens when the URL has `?wvReview=<id>`: read it via `useSearchParams` on mount, and when present set the existing reviewing-state to that id (then strip the param). Read the component's state shape first and adapt minimally.

- [ ] **Step 2: AdminDashboard `?section=` support.** In `AdminDashboard.tsx`, on mount read `new URLSearchParams(window.location.search).get('section')` and, if it's a valid `AdminSection`, use it as the initial `activeSection` (keep the `navigate-admin` event listener as is).

- [ ] **Step 3: Docs.**
  - `docs/tech/world-view-import.md` Frontend section: add a paragraph — Import Dashboard at `/admin/import/:worldViewId` (Countries/Skeleton/Global-gaps tabs, per-unit checks & sign-off), legacy Match Review still owns assignment editing until Plan 4; pointer to the spec.
  - `docs/vision/vision.md`: in the admin capabilities area, add one line: admins track per-country review progress on an import dashboard (sign-off lifecycle with verification checks) instead of a flat match list.

- [ ] **Step 4: Full frontend gates + root knip.** `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` and root `npm run knip`. Fix anything yours.

- [ ] **Step 5: Commit** (`front: Route import review entry through the dashboard.` + body noting the legacy deep-link param + docs updates + trailer).

---

## Self-review checklist (run after Task 7)

1. Spec coverage: dashboard tabs per spec § UI: Dashboard (with declared descopes); row actions cover verify/confirm/sign-off/reopen; finalize error now VISIBLE (fixes the silent-failure gap found in Plan-1 final review).
2. Every commit passes lint+tsc+tests in isolation; knip clean (new files all imported).
3. Type consistency: `DashboardUnit`/`VerifyResult` match the Plan-1 endpoint payloads EXACTLY (cross-check against `backend/src/controllers/admin/wvImportWorkflowController.ts` response mappings).
