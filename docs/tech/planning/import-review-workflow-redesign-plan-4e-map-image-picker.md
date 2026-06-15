# Plan 4e: Map-Image Picker in the Workspace

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `…-plan-4-complete-new-ui.md`.

**Goal:** Let the admin pick a region's map image from candidates in the workspace (Plan 3 stubbed `mapPickerState` to a no-op). It's the prereq for CV color match and the region-map side-by-side preview, both of which already exist in the workspace.

**Architecture:** `useTreeMutations` already has `selectMapMutation` that reads `deps.mapPickerStateRef.current` and saves the choice (`select-map-image` endpoint), and `MapImagePickerDialog` already exists. The workspace currently passes an inert `mapPickerState` (always null) + a `() => {}` setter (`CountryWorkspacePage.tsx:366-375`). Un-stub that to real state, add a trigger for the selected node when it has `mapImageCandidates.length > 1`, and render the dialog. Legacy `WorldViewImportTree` untouched.

**Tech Stack:** React + MUI + TanStack Query. Gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` + root knip.

**Conventions:** `front:` commits, `-s`, Co-Authored-By trailer; never stage the two dirty files / `data/`. Do NOT modify `WorldViewImportTree.tsx`.

---

### Task 1: Real mapPickerState + trigger + dialog

**Files:** `frontend/src/components/admin/importWorkspace/CountryWorkspacePage.tsx`, `importWorkspace/ActionPanel.tsx` (AssignmentTools — the trigger, since it's a CV prereq), `importWorkspace/actionHelp.ts` (help entry). READ the legacy wiring `WorldViewImportTree.tsx:83,145-190` (state + ref + `setMapPickerState({ regionId, node, candidates: node.mapImageCandidates })` + the `<MapImagePickerDialog …>` render), the `MapImagePickerDialog` props (`MapImagePickerDialog.tsx`), `useTreeMutations.ts:614-622` (`selectMapMutation` reads `deps.mapPickerStateRef.current`, calls the select endpoint, then `deps.setMapPickerState(null)`), and the current no-op at `CountryWorkspacePage.tsx:366-375` + the `MapPickerState` type.

- [ ] **Step 1:** Replace the no-op block (`CountryWorkspacePage.tsx:366-375`) with real state: `const [mapPickerState, setMapPickerState] = useState<MapPickerState | null>(null); const mapPickerStateRef = useRef(mapPickerState); mapPickerStateRef.current = mapPickerState;` and pass the real `mapPickerStateRef` + `setMapPickerState` into the `useTreeMutations` deps (where the no-op currently goes).
- [ ] **Step 2:** Render `<MapImagePickerDialog …>` in `CountryWorkspacePage`, wired exactly as the legacy does (open when `mapPickerState != null`; on select → `mutations.selectMapMutation.mutate(...)` per the legacy call; on close → `setMapPickerState(null)`; pass the candidates/regionId from `mapPickerState`). Read the legacy render block for the precise props; replicate. On a successful select, the matchTree invalidation (selectMapMutation's onSuccess) refreshes; also call `handleMatchChange` if the selection should bump dashboard/verify (it changes `region_map_url`, not assignments — a tree invalidation is enough; confirm and keep minimal).
- [ ] **Step 3:** Add a **"Pick map image"** button to AssignmentTools (shown when the selected node has `mapImageCandidates.length > 1`), with an `actionHelp` entry ("Choose the correct region map from the Wikivoyage candidates; used by CV match and the region-map preview comparison; warning colour until reviewed."). Click → `setMapPickerState({ regionId: selectedRegionId, node: selectedNode, candidates: selectedNode.mapImageCandidates })` (match the `MapPickerState` shape exactly). Optionally tint it (warning) when `!node.mapImageReviewed` and (success) after — mirror the legacy if cheap; else plain.
- [ ] **Step 4:** Gates; commit `front: Add the map-image picker to the workspace.`

### Task 2: review + docs
Combined review: the picker opens for a node with >1 candidate; selecting saves via `selectMapMutation` (reads the now-real ref → correct regionId + imageUrl); the chosen map then drives CV match + region-map preview (the `regionMapUrl` on the node updates after the tree refetch); "none are maps" path works; close clears state; legacy untouched (`git diff WorldViewImportTree.tsx` empty); gates + runtime smoke. Fold fixes. Docs: one line in `docs/tech/world-view-import.md` (map-image picker now in the workspace).

**Self-review:** for a region with several `[[File:…]]` candidates, the admin picks the right map in the workspace, and CV color match / the preview comparison then use it.
