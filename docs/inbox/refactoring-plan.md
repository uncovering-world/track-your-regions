# Refactoring Plan — Remaining Items

Status of the original refactoring analysis (session b5a2af41).

## Completed

1. **PR #258** — Dead code removal (backend + frontend)
   - Removed unused functions, components, exports across both codebases
2. **PR #260** — Shared utility extraction
   - Backend: `syncUtils.ts` (upsert, sync log, cleanup), `wikidataUtils.ts` (SPARQL, QID parsing)
   - Frontend: `categoryColors.ts`, `dateFormat.ts` (`formatRelativeTime`), `imageUrl.ts` (`toThumbnailUrl`, `extractImageUrl`)
3. **PR #261** — Sync orchestrator extraction
   - Generic `orchestrateSync<T>()` with `SyncServiceConfig<T>`, eliminated ~284 lines of boilerplate
   - Registry dispatch in controller, generic `getSyncStatus`/`cancelSync`

## Remaining: Frontend Shared Components

### 1. Collapsible Section Pattern
**9 files** with identical expand/collapse structure:
- `ExperienceList.tsx`, `ExperienceDetailPanel.tsx`, `CurationDialog.tsx`, `CuratorPanel.tsx`, multiple WorldViewEditor dialogs

Pattern:
```tsx
const [expanded, setExpanded] = useState(false);
<Box onClick={() => setExpanded(!expanded)}>
  <Typography>Title</Typography>
  {expanded ? <ExpandLess /> : <ExpandMore />}
</Box>
<Collapse in={expanded}>{children}</Collapse>
```

**Action:** Create `frontend/src/components/shared/CollapsibleSection.tsx` with props: `title`, `defaultExpanded?`, `children`, `rightContent?`.

### 2. Loading Spinner Pattern
**10+ files** with identical structure:
- `SyncPanel.tsx`, `SyncHistoryPanel.tsx`, `CuratorPanel.tsx`, `AssignmentPanel.tsx`, and many others

Pattern:
```tsx
<Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
  <CircularProgress />
</Box>
```

**Action:** Create `frontend/src/components/shared/LoadingSpinner.tsx` with props: `size?`, `padding?`.

### 3. Empty State Pattern
**10+ components** with identical "no items" display:
- `ExperienceList.tsx`, `SyncHistoryPanel.tsx`, `AddExperienceDialog.tsx`, etc.

Pattern:
```tsx
<Box sx={{ p: 2, textAlign: 'center' }}>
  <Typography variant="body2" color="text.secondary">No items found.</Typography>
</Box>
```

**Action:** Create `frontend/src/components/shared/EmptyState.tsx` with props: `message`, `icon?`.

### 4. Query Invalidation Helpers
Duplicated across **10+ mutation `onSuccess` handlers**:
- `useVisitedExperiences.ts` (21 occurrences), `ExperienceList.tsx`, `CurationDialog.tsx`, `AddExperienceDialog.tsx`, etc.

Common patterns:
```tsx
// Experience invalidations
queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', regionId] });
queryClient.invalidateQueries({ queryKey: ['discover-experiences'] });
queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });

// Visited status invalidations
queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
```

**Action:** Create `frontend/src/utils/queryInvalidation.ts` with `invalidateExperiences()`, `invalidateVisitedStatus()`, `invalidateSyncStatus()`.

### 5. Visited Status Checkbox
Repeated in **3+ files** with hardcoded green `#22c55e`:
- `ExperienceList.tsx`, `ExperienceDetailPanel.tsx`, `DiscoverExperienceView.tsx`

Pattern:
```tsx
<Checkbox
  checked={isVisited}
  size="small"
  onClick={(e) => { e.stopPropagation(); onVisitedToggle?.(e); }}
  sx={{ '&.Mui-checked': { color: '#22c55e' } }}
/>
```

**Action:** Create `frontend/src/components/shared/VisitedCheckbox.tsx` or extract the green color to a constant.

### 6. Date/Time Formatting (remaining)
`formatRelativeTime` was extracted in PR #260, but these remain inline:
- `formatDate` — `SyncPanel.tsx`, `SyncHistoryPanel.tsx` (different null handling)
- `formatDuration` — `SyncHistoryPanel.tsx`

**Action:** Add `formatDate()` and `formatDuration()` to `frontend/src/utils/dateFormat.ts`.

### 7. Scroll-to-Element Logic
Duplicated scroll calculations in:
- `ExperienceList.tsx` (2 implementations)
- `DiscoverExperienceView.tsx`
- `ExperienceDetailPanel.tsx`

Pattern: calculate element position relative to container, center in viewport.

**Action:** Create `frontend/src/utils/scrollUtils.ts` with `scrollToCenter(container, element)`.

## Completed: Large File Splits

4. **experienceController.ts** (1,380 → 4 files) — `experienceQueryController.ts`, `experienceVisitController.ts`, `experienceLocationController.ts`, `experienceTreasureController.ts` + barrel re-exports
5. **regionMembers.ts** (824 → 3 files) — `regionMemberQueries.ts`, `regionMemberMutations.ts`, `regionMemberOperations.ts` + named re-exports
6. **RegionMapVT.tsx** (1,244 → main + 5 hooks) — `layerStyles.ts`, `useRegionMetadata.ts`, `useTileUrls.ts`, `useMapFeatureState.ts`, `useMapInteractions.ts`
7. **AIAssistTab.tsx** (1,422 → main + 4 files) — `aiAssistTypes.ts`, `useAIModelManager.ts`, `useAIUsageTracking.ts`, `AIUsagePopover.tsx`

### Skipped
| File | Lines | Reason |
|------|-------|--------|
| `ExperienceList.tsx` | ~1,301 | Already well-structured with clear internal sub-components. Revisit if it grows beyond ~1,500 lines. |

## Implementation Notes

- Each shared component extraction should be **one PR** (or group closely related items)
- Verify all callsites are updated — search for the old inline pattern after extraction
- Run `npm run check` after each extraction
- Update `docs/tech/` if architectural patterns change
