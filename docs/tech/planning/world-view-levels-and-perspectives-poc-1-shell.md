# POC Slice 1 — Level-Aware Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new admin route `/admin/wv-poc/:worldViewId` that renders a level-aware shell whose header **LevelSwitcher** (L1 supra-national / L2 country / L3 sub-national) doubles as a soft staged-build tracker (per-level ○ / ◐ / ⬤ progress), reusing the existing import-review country-workspace as the L3 drill-in.

**Architecture:** Frontend-only POC slice. Reuses the existing `getWorkflowDashboard(worldViewId)` API (returns `DashboardUnit[]` — countries with `continent` / `ancestorPath`, `signoffStatus`, `leafTotal`/`leafResolved`), so no backend change is needed to demo. A pure function derives per-level progress from the units; the `LevelSwitcher` (modeled on the existing `StageSwitcher`) shows it; the `WvPocPage` shell renders an L1 continents view, an L2 country list, and drills into a country via the existing `/admin/import/:worldViewId/region/:regionId` workspace for L3.

**Tech Stack:** React, TypeScript, MUI, TanStack Query, react-router, Vitest.

---

## Scope

This is **POC slice 1 of 3** for the core-experience POC of
[world-view-levels-and-perspectives.md](world-view-levels-and-perspectives.md)
(scope = "core experience end-to-end").

- **This slice:** the level-aware shell + LevelSwitcher (staged tracker), reusing the country-workspace as L3.
- **Slice 2 (separate plan):** L1 supra-national grouping editor + transcontinental partial-membership display.
- **Slice 3 (separate plan):** mini POV axis (`perspectives` + `disputed_features` + `perspective_rulings` + resolver) + L2 country-canon / POV editor.

**Base:** a fresh branch stacked on `feat/import-review-dashboard-ui` (reuses its dashboard API + country-workspace). **POC fidelity:** functional; tests cover the pure progress logic; UI verified by typecheck + a manual screenshot (no RTL render tests in this slice).

**Relation to `plan-1a-node-role.md`:** that plan adds a backend `level` field to `GET /regions` — the *production* source of node level. This POC slice derives level/progress **client-side from the dashboard units** to stay self-contained; plan-1a can be wired in later when the shell moves off the import-dashboard API.

## Conventions

- Tests: Vitest. Run one file from `frontend/`: `npm run test -- src/components/admin/wvPoc/wvPocLevels.test.ts`.
- Typecheck the frontend: `cd frontend && npx tsc --noEmit`.
- Pre-commit (project rule): before the **final** commit run `npm run check` + `TEST_REPORT_LOCAL=1 npm test` and `/security-check`. Per-task commits run the task's own test first.
- Commit style: `front:` prefix; DCO sign-off (`git commit -s`, author `Nikolay Martyanov <ohmspectator@gmail.com>`) + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/components/admin/wvPoc/wvPocLevels.ts` | Pure: `DashboardUnit[]` → per-level progress | **Create** |
| `frontend/src/components/admin/wvPoc/wvPocLevels.test.ts` | Unit tests for the pure function | **Create** |
| `frontend/src/components/admin/wvPoc/LevelSwitcher.tsx` | The L1/L2/L3 switcher = staged tracker | **Create** |
| `frontend/src/components/admin/wvPoc/WvPocPage.tsx` | Shell page (route component) | **Create** |
| `frontend/src/App.tsx` | Register `/admin/wv-poc/:worldViewId` | **Modify** (`:128-136`) |

---

### Task 1: Pure level-progress derivation

**Files:**
- Create: `frontend/src/components/admin/wvPoc/wvPocLevels.ts`
- Test: `frontend/src/components/admin/wvPoc/wvPocLevels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/admin/wvPoc/wvPocLevels.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeLevelProgress } from './wvPocLevels';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';

function unit(over: Partial<DashboardUnit>): DashboardUnit {
  return {
    regionId: 1, name: 'X', continent: 'Europe', ancestorPath: ['Europe'],
    signoffStatus: 'not_started', signedOffAt: null, hierarchyConfirmed: false,
    hasReference: true, referenceDivisionIds: [1], sourceUrl: null,
    leafTotal: 0, leafResolved: 0, warningCount: 0,
    ...over,
  };
}

describe('computeLevelProgress', () => {
  it('reports empty levels for no units', () => {
    const p = computeLevelProgress([]);
    expect(p.l1.status).toBe('empty');
    expect(p.l2.status).toBe('empty');
    expect(p.l3.status).toBe('empty');
  });

  it('counts countries and signed-off at L2', () => {
    const p = computeLevelProgress([
      unit({ regionId: 1, signoffStatus: 'signed_off' }),
      unit({ regionId: 2, signoffStatus: 'in_progress' }),
    ]);
    expect(p.l2.total).toBe(2);
    expect(p.l2.signedOff).toBe(1);
    expect(p.l2.status).toBe('in_progress');
  });

  it('marks L2 done when all signed off', () => {
    const p = computeLevelProgress([unit({ signoffStatus: 'signed_off' })]);
    expect(p.l2.status).toBe('done');
  });

  it('counts distinct continents at L1 and is done when all grouped', () => {
    const p = computeLevelProgress([
      unit({ regionId: 1, continent: 'Europe' }),
      unit({ regionId: 2, continent: 'Asia' }),
    ]);
    expect(p.l1.continents).toBe(2);
    expect(p.l1.countries).toBe(2);
    expect(p.l1.status).toBe('done');
  });

  it('marks L1 in_progress when a country has no continent', () => {
    const p = computeLevelProgress([unit({ continent: null, ancestorPath: [] })]);
    expect(p.l1.status).toBe('in_progress');
  });

  it('aggregates leaf resolution at L3', () => {
    const p = computeLevelProgress([
      unit({ leafTotal: 4, leafResolved: 4 }),
      unit({ leafTotal: 6, leafResolved: 3 }),
    ]);
    expect(p.l3.leafTotal).toBe(10);
    expect(p.l3.leafResolved).toBe(7);
    expect(p.l3.status).toBe('in_progress');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm run test -- src/components/admin/wvPoc/wvPocLevels.test.ts`
Expected: FAIL — cannot resolve `./wvPocLevels`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/admin/wvPoc/wvPocLevels.ts`:

```typescript
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';

export type LevelStatus = 'empty' | 'in_progress' | 'done';
export type LevelId = 'l1' | 'l2' | 'l3';

export interface LevelProgress {
  l1: { continents: number; countries: number; status: LevelStatus };
  l2: { signedOff: number; total: number; status: LevelStatus };
  l3: { leafResolved: number; leafTotal: number; status: LevelStatus };
}

function tri(done: boolean, any: boolean): LevelStatus {
  if (done) return 'done';
  return any ? 'in_progress' : 'empty';
}

/**
 * Per-level progress for the POC staged tracker, derived from the import
 * dashboard's work units (countries). L1 = how grouped into continents,
 * L2 = country sign-off, L3 = aggregate sub-national leaf resolution.
 */
export function computeLevelProgress(units: DashboardUnit[]): LevelProgress {
  const total = units.length;

  const continentOf = (u: DashboardUnit): string | null =>
    u.continent ?? (u.ancestorPath.length > 0 ? u.ancestorPath[0] : null);
  const continents = new Set(units.map(continentOf).filter((c): c is string => c != null));
  const allGrouped = total > 0 && units.every((u) => continentOf(u) != null);

  const signedOff = units.filter((u) => u.signoffStatus === 'signed_off').length;

  const leafTotal = units.reduce((s, u) => s + u.leafTotal, 0);
  const leafResolved = units.reduce((s, u) => s + u.leafResolved, 0);

  return {
    l1: { continents: continents.size, countries: total, status: total === 0 ? 'empty' : tri(allGrouped, true) },
    l2: { signedOff, total, status: total === 0 ? 'empty' : tri(signedOff === total, signedOff > 0 || units.some((u) => u.signoffStatus === 'in_progress')) },
    l3: { leafResolved, leafTotal, status: leafTotal === 0 ? 'empty' : tri(leafResolved === leafTotal, leafResolved > 0) },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/components/admin/wvPoc/wvPocLevels.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/wvPoc/wvPocLevels.ts frontend/src/components/admin/wvPoc/wvPocLevels.test.ts
git commit -s -m "front: add POC per-level progress derivation"
```

---

### Task 2: LevelSwitcher component

**Files:**
- Create: `frontend/src/components/admin/wvPoc/LevelSwitcher.tsx`

Modeled on `frontend/src/components/admin/importWorkspace/StageSwitcher.tsx` (a MUI `ToggleButtonGroup` of labelled buttons with badges).

- [ ] **Step 1: Implement the component**

Create `frontend/src/components/admin/wvPoc/LevelSwitcher.tsx`:

```typescript
import { ToggleButton, ToggleButtonGroup, Tooltip, Box } from '@mui/material';
import type { LevelId, LevelProgress, LevelStatus } from './wvPocLevels';

const GLYPH: Record<LevelStatus, string> = { empty: '○', in_progress: '◐', done: '⬤' };

interface LevelSwitcherProps {
  value: LevelId;
  onChange: (level: LevelId) => void;
  progress: LevelProgress;
}

export function LevelSwitcher({ value, onChange, progress }: LevelSwitcherProps) {
  const levels: Array<{ id: LevelId; label: string; status: LevelStatus; badge: string; tip: string }> = [
    { id: 'l1', label: '① Supra-national', status: progress.l1.status, badge: `${progress.l1.continents} groups`, tip: `${progress.l1.countries} countries in ${progress.l1.continents} continents` },
    { id: 'l2', label: '② Countries', status: progress.l2.status, badge: `${progress.l2.signedOff}/${progress.l2.total}`, tip: `${progress.l2.signedOff} of ${progress.l2.total} countries signed off` },
    { id: 'l3', label: '③ Sub-national', status: progress.l3.status, badge: `${progress.l3.leafResolved}/${progress.l3.leafTotal}`, tip: `${progress.l3.leafResolved} of ${progress.l3.leafTotal} leaves resolved` },
  ];

  const recommendedNext = levels.find((l) => l.status !== 'done')?.id;

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, next: LevelId | null) => { if (next !== null) onChange(next); }}
      aria-label="World-view build level"
    >
      {levels.map(({ id, label, status, badge, tip }) => (
        <Tooltip key={id} title={tip}>
          <ToggleButton value={id} aria-label={label} sx={{ textTransform: 'none', gap: 0.75 }}>
            <span>{GLYPH[status]}</span>
            <span>{label}</span>
            <Box component="span" sx={{ opacity: 0.7, fontSize: '0.8em' }}>{badge}</Box>
            {id === recommendedNext && id !== value && (
              <Box component="span" sx={{ ml: 0.5, fontSize: '0.7em', opacity: 0.6 }}>next →</Box>
            )}
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/wvPoc/LevelSwitcher.tsx
git commit -s -m "front: add POC LevelSwitcher (staged tracker)"
```

---

### Task 3: WvPocPage shell

**Files:**
- Create: `frontend/src/components/admin/wvPoc/WvPocPage.tsx`

Reuses `getWorkflowDashboard` (from `frontend/src/api/admin/wvImportWorkflow.ts`) and the existing country-workspace route for L3 drill-in. Guards admin like `CountryWorkspacePage` (`useAuth().isAdmin`).

- [ ] **Step 1: Implement the page**

Create `frontend/src/components/admin/wvPoc/WvPocPage.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Typography, List, ListItemButton, ListItemText, Chip, Alert, CircularProgress } from '@mui/material';
import { useAuth } from '../../../hooks/useAuth';
import { getWorkflowDashboard, type DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import { computeLevelProgress, type LevelId } from './wvPocLevels';
import { LevelSwitcher } from './LevelSwitcher';

export function WvPocPage() {
  const { worldViewId: wvParam } = useParams<{ worldViewId?: string }>();
  const worldViewId = parseInt(wvParam ?? '');
  const navigate = useNavigate();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [level, setLevel] = useState<LevelId>('l2');

  const { data, isLoading } = useQuery({
    queryKey: ['wvPocDashboard', worldViewId],
    queryFn: () => getWorkflowDashboard(worldViewId),
    enabled: Number.isFinite(worldViewId) && isAdmin,
  });

  const units: DashboardUnit[] = data?.units ?? [];
  const progress = useMemo(() => computeLevelProgress(units), [units]);

  const byContinent = useMemo(() => {
    const m = new Map<string, DashboardUnit[]>();
    for (const u of units) {
      const c = u.continent ?? (u.ancestorPath[0] ?? 'Ungrouped');
      (m.get(c) ?? m.set(c, []).get(c)!).push(u);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [units]);

  if (authLoading || isLoading) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;
  if (!isAdmin) return <Box sx={{ p: 4 }}><Alert severity="error">Admin only.</Alert></Box>;
  if (!Number.isFinite(worldViewId)) return <Box sx={{ p: 4 }}><Alert severity="error">Bad world view id.</Alert></Box>;

  const openCountry = (regionId: number) => navigate(`/admin/import/${worldViewId}/region/${regionId}`);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h6">World View {worldViewId} — build (POC)</Typography>
        <LevelSwitcher value={level} onChange={setLevel} progress={progress} />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {level === 'l1' && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>Supra-national — countries grouped by continent (view-only in this POC slice)</Typography>
            {byContinent.map(([continent, list]) => (
              <Box key={continent} sx={{ mb: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{continent} · {list.length}</Typography>
                <Typography variant="caption" color="text.secondary">{list.map((u) => u.name).join(', ')}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {level === 'l2' && (
          <List dense>
            {units.map((u) => (
              <ListItemButton key={u.regionId} onClick={() => openCountry(u.regionId)}>
                <ListItemText primary={u.name} secondary={u.continent ?? u.ancestorPath.join(' › ')} />
                <Chip size="small" label={u.signoffStatus} />
              </ListItemButton>
            ))}
          </List>
        )}

        {level === 'l3' && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>Pick a country to open its sub-national workspace (the existing country workspace).</Alert>
            <List dense>
              {units.map((u) => (
                <ListItemButton key={u.regionId} onClick={() => openCountry(u.regionId)}>
                  <ListItemText primary={u.name} secondary={`${u.leafResolved}/${u.leafTotal} leaves`} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify the dashboard shape**

Open `frontend/src/api/admin/wvImportWorkflow.ts` and confirm `getWorkflowDashboard` returns an object with a `units: DashboardUnit[]` field and that `DashboardUnit` has `name`, `regionId`, `continent`, `ancestorPath`, `signoffStatus`, `leafTotal`, `leafResolved`. If the wrapper field is named differently (e.g. the array is returned directly), adjust `data?.units ?? []` accordingly. Do not invent fields.

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: PASS. (Fix any field-name mismatches surfaced against the real `DashboardUnit` / dashboard return type.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/wvPoc/WvPocPage.tsx
git commit -s -m "front: add POC world-view build shell (level views + L3 drill-in)"
```

---

### Task 4: Register the route

**Files:**
- Modify: `frontend/src/App.tsx:128-136`

- [ ] **Step 1: Add the import**

Near the other admin page imports (around `frontend/src/App.tsx:12-13`), add:

```typescript
import { WvPocPage } from './components/admin/wvPoc/WvPocPage';
```

- [ ] **Step 2: Add the route**

In the `<Routes>` block, insert immediately before the `<Route path="/admin/*" ...>` catch-all:

```typescript
<Route path="/admin/wv-poc/:worldViewId" element={<WvPocPage />} />
```

- [ ] **Step 3: Typecheck + commit**

Run (from `frontend/`): `npx tsc --noEmit` — Expected: PASS.

```bash
git add frontend/src/App.tsx
git commit -s -m "front: route /admin/wv-poc/:worldViewId to the POC shell"
```

---

### Task 5: Manual smoke + gate

- [ ] **Step 1: Run the project gate**

From repo root: `npm run check` — Expected: PASS (lint + typecheck + knip; the new files must be imported/reachable or knip flags them — the route in Task 4 makes `WvPocPage` reachable, which reaches the rest).

- [ ] **Step 2: Unit suite**

From repo root: `TEST_REPORT_LOCAL=1 npm test` — Expected: PASS incl. `wvPocLevels.test.ts`.

- [ ] **Step 3: Manual screenshot**

Start the dev frontend, open `/admin/wv-poc/2` (world view 2 has 192 work units on the dev DB), switch L1/L2/L3, confirm the LevelSwitcher shows progress and clicking a country opens the existing workspace. Capture a screenshot for the iterate-on-screenshots loop.

---

## Self-Review (by plan author)

- **Spec coverage:** delivers the "level-aware editing shell + level switcher doubling as the soft staged-build tracker" (design §"Editing interface") for the POC, reusing the L3 country-workspace (design §"Relationship to import-review"). L1 grouping editing, transcontinental, and the POV axis are explicitly later slices (Scope).
- **Placeholder scan:** none — code is concrete. Task 3 Step 2 is a verification guard against the real `DashboardUnit` shape (the field names come from the earlier code map; the guard catches drift), not a placeholder.
- **Type consistency:** `LevelId` / `LevelStatus` / `LevelProgress` / `computeLevelProgress` are defined in Task 1 and consumed unchanged in Tasks 2-3; `DashboardUnit` is imported from the existing API module.
