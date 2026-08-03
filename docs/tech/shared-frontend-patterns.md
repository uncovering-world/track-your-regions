# Shared Frontend Patterns — Reference

Quick-reference for reusable components and utilities. Use these instead of writing inline equivalents.

## Shared Components (`frontend/src/components/shared/`)

| Component | Purpose | Example |
|-----------|---------|---------|
| `LoadingSpinner` | Centered `CircularProgress`. Props: `size?`, `padding?` | `<LoadingSpinner />` |
| `EmptyState` | "No items" message. Props: `message`, `padding?` | `<EmptyState message="No results." />` |
| `CurationDialog` | Edit + reject/unreject an experience, and take a lifecycle verdict back (`former` / `lost`) — the review queue lists only open questions, so an answered one has left it and this is where it stays reachable | Used in Map and Discover modes |
| `AddExperienceDialog` | Search+assign or create new experience | Used in Map and Discover modes |
| `LocationPicker` | Interactive location selector on a map | Used in experience editing |
| `MapUnavailable` | Explains that this browser cannot draw maps. Props: `detail?`, `compact?` | `<MapUnavailable detail="The list still works." />` |
| `LifecycleChip` | Labels a `former` or `lost` experience, nothing for an ordinary one. Props: `state` (`source_membership` / `existence`). Also exports `lifecycleLabel()` and `verdictOf()`, which share the precedence rule: existence answers first | `<LifecycleChip state={experience} />` |
| `GuardedMap` | `react-map-gl`'s `<Map>` with the WebGL check built in. Extra props: `unavailableDetail?`, `unavailableCompact?` | `import { GuardedMap as MapGL } from '…/GuardedMap'` — alias it to the local name and nothing else changes |

## Utility Modules (`frontend/src/utils/`)

| Module | Key exports |
|--------|-------------|
| `categoryColors.ts` | Category color mapping, `VISITED_GREEN` (`#22c55e`), `PARTIAL_AMBER` (`#F59E0B`) |
| `dateFormat.ts` | `formatRelativeTime()`, `formatDuration(start, end)` |
| `imageUrl.ts` | `toThumbnailUrl()`, `extractImageUrl()` |
| `queryInvalidation.ts` | `invalidateExperiences(queryClient, opts?)`, `invalidateVisitedStatus(queryClient)` |
| `scrollUtils.ts` | `scrollToCenter(container, el)`, `scrollToTop(container, el)` |
| `coordinateParser.ts` | Coordinate string parsing |
| `mapUtils.ts` | Map helper functions |
| `webgl.ts` | `isWebGLAvailable()` — ask before constructing any map; see `maplibre-patterns.md` |
| `fetchUtils.ts` | `ensureFreshToken()` — proactive JWT refresh before SSE connections |

## Pattern Table: Use This, Not That

| Need | Use this | Instead of |
|------|----------|------------|
| Loading spinner | `<LoadingSpinner />` | Inline `<Box sx={{display:'flex', justifyContent:'center'}}><CircularProgress /></Box>` |
| Empty state message | `<EmptyState message="..." />` | Inline `<Typography color="text.secondary">No items.</Typography>` |
| Visited green color | `VISITED_GREEN` constant | Hardcoded `'#22c55e'` or `'#10B981'` |
| Partial/amber color | `PARTIAL_AMBER` constant | Hardcoded `'#F59E0B'` |
| Invalidate experience caches | `invalidateExperiences(qc, opts)` | Manual chain of `queryClient.invalidateQueries(...)` |
| Invalidate visited caches | `invalidateVisitedStatus(qc)` | Manual invalidation of 3+ query keys |
| Scroll element to center | `scrollToCenter(container, el)` | Manual `getBoundingClientRect()` + `scrollTo()` |
| Label a `former` / `lost` experience | `<LifecycleChip state={experience} />` | Reading `existence` / `source_membership` inline, which drops the precedence rule — a row that is both must read `Lost`, since that is what hides it |
| Decide which verdict a row carries | `verdictOf(experience)` | Re-deriving it beside a lifecycle write, which is how the precedence rule ends up stated twice and drifting
| Scroll element to top | `scrollToTop(container, el)` | Manual scroll math |
| Format duration | `formatDuration(start, end)` | Inline ms-to-seconds/minutes conversion |
| Rendering any map | `GuardedMap` (aliased to your local name), or an early return on `isWebGLAvailable()` where overlays sit over the map | Importing `Map` straight from `react-map-gl/maplibre`, or a bare `new maplibregl.Map` — both throw without WebGL, and there is no error boundary to catch it |

## Maintaining This Doc

After extracting a new shared component or utility, add it here:
1. Add a row to the appropriate table above
2. Add a "use this / instead of" row to the pattern table
3. Link from the dev guide if a new concept is involved
