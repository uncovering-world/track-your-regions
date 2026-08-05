# POC Slice 2 — L1 Supra-National Grouping Editor + Transcontinental

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — TDD the
> pure module, then build the editor, then wire it in. Steps use `- [ ]`.

**Goal:** Turn the L1 level of `WvPocPage` (view-only in slice 1) into a **client-side grouping
editor**: create custom supra-national groups, assign countries with **overlapping** membership
(a country stays in its continent *and* any custom group), and showcase a **transcontinental**
country (Russia — one pivot, territory split Europe + Asia, Ural FD → Asia).

**Architecture:** Frontend-only POC, **local state, no backend/persistence** (matches slice 1).
Reuses the dashboard `units` already loaded in `WvPocPage`. A pure grouping module holds the
state transitions + the transcontinental showcase; an `L1GroupEditor` renders it; `WvPocPage`'s
L1 branch swaps from the read-only list to `<L1GroupEditor units={units} />`.

**Tech Stack:** React, TypeScript, MUI, Vitest. No new deps.

## Global Constraints
- POC fidelity: functional; pure grouping logic unit-tested; UI verified by typecheck + the
  existing gate (no RTL render tests). No backend, no API, no schema change.
- Theme: inherits Meridian (warm paper / teal / clay) automatically via MUI.
- Commit only on explicit user OK; DCO sign-off + Co-Authored-By trailer.
- Any `frontend/src` file must pass `npm run check` Node gates (typecheck, eslint, knip, madge).

## File Structure
| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/components/admin/wvPoc/wvPocGroups.ts` | Pure grouping state + transcontinental showcase | **Create** |
| `frontend/src/components/admin/wvPoc/wvPocGroups.test.ts` | Unit tests | **Create** |
| `frontend/src/components/admin/wvPoc/L1GroupEditor.tsx` | The L1 editor component | **Create** |
| `frontend/src/components/admin/wvPoc/WvPocPage.tsx` | Swap L1 branch → `<L1GroupEditor />` | **Modify** |

---

### Task 1: Pure grouping module (TDD)

**Types:** `GroupKind = 'continent' | 'custom'`; `SupraGroup { id; name; kind }`;
`GroupingState { groups: SupraGroup[]; membership: Record<number, string[]> }` (regionId →
overlapping groupIds); `TranscontinentalPart { groupId; label; note? }`;
`Transcontinental { regionId; name; parts }`; `GroupMemberView { regionId; name;
transcontinental; note?; overlapping }`.

**Functions (all pure):**
- `buildInitialGroups(units): GroupingState` — one `continent` group per distinct continent,
  each country a member of its own continent.
- `createCustomGroup(state, name): GroupingState` — append a `custom` group (idempotent by slug).
- `assignToGroup(state, regionId, groupId)` / `removeFromGroup(...)` — add/remove a membership
  (overlapping: assign never removes from other groups).
- `groupMemberIds(state, groupId): number[]`.
- `overlappingRegionIds(state): number[]` — members of >1 group.
- `transcontinentalSplits(units, state): Transcontinental[]` — from a hard-coded
  `TRANSCONTINENTAL_DEFS` (Russia → Europe "European Russia" + Asia "Asian Russia"
  note "Ural FD → Asia"); attaches each part to the matching continent group when present.
- `groupMembersView(units, state, groupId): GroupMemberView[]` — members of a group as display
  rows, substituting the transcontinental part label + note when applicable.

**Tests** (`wvPocGroups.test.ts`) — cover: continents seeded as groups + self-membership;
custom group add (and idempotency); `assignToGroup` produces overlap (country in continent +
custom); `removeFromGroup`; `overlappingRegionIds`; `transcontinentalSplits` yields Russia with
2 parts (Europe/Asia, the Asia part carrying the note); `groupMembersView` shows the part label
for Russia inside the Europe and Asia groups.

Steps: write failing test → `npx vitest run …wvPocGroups.test.ts` (FAIL) → implement → PASS.

### Task 2: L1GroupEditor component

`L1GroupEditor({ units }: { units: DashboardUnit[] })`:
- `const [state, setState] = useState(() => buildInitialGroups(units))`; re-seed when `units`
  identity changes (guard so edits aren't clobbered — seed once per unit set via a `useEffect`
  keyed on a stable signature, or `useMemo` initial + manual reset button; POC: re-seed on
  `units` change is fine since units load once).
- **New group:** a `TextField` + "Add group" button → `createCustomGroup`.
- **Group cards:** one MUI `Paper`/`Card` per group (continent + custom), header = name + a
  `kind` `Chip`; body = member rows from `groupMembersView` as `Chip`s (deletable →
  `removeFromGroup`); transcontinental rows show the part label + a "transcontinental" `Chip`
  (color secondary/clay) + the note as caption; overlapping members get a subtle "also in N"
  badge. Footer = an `Autocomplete` of countries not yet in the group → `assignToGroup`.
- **Transcontinental callout:** a short banner listing `transcontinentalSplits` ("Russia — one
  country, shown in Europe & Asia · Ural FD → Asia") so the concept is explicit.
- Pure rendering off `state` + the `wvPocGroups` helpers; no API/router/auth.

Typecheck after.

### Task 3: Wire into WvPocPage

Replace the `level === 'l1'` branch body (the read-only continent list) with
`<L1GroupEditor units={units} />`. Keep the L2/L3 branches unchanged. Remove the now-unused
`byContinent` memo if nothing else uses it (refactoring hygiene). Typecheck.

### Task 4: Gate + screenshot

- `npx vitest run` (full frontend suite — incl. the new test) → PASS.
- `npm run lint` (eslint) + `npm run knip` (root) + `npm run lint:circular` → clean.
- Manual screenshot of `/admin/wv-poc/2` at L1 (needs dev stack) — **deferred** like slice 1's
  app screenshot; note it as a follow-up.

## Self-Review (author)
- Delivers design §"L1 supra-national" (arrange countries into groups, overlapping membership)
  and §"Transcontinental" (one pivot, territory split, Ural FD → Asia, annotated edge) at POC
  fidelity, client-side, per the approved scope (click-assign, no backend).
- Out of scope (later/backend phase): persistence, real `groupings`/`grouping_members` tables,
  drag-and-drop, real federal-district geometry, perspective-switchable edges, map rendering.
- Types `GroupingState`/`SupraGroup`/`Transcontinental`/`GroupMemberView` are defined in Task 1
  and consumed unchanged in Tasks 2–3.
