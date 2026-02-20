# Shared Frontend Patterns — Reference

Quick-reference for reusable components and utilities. Use these instead of writing inline equivalents.

## Shared Components (`frontend/src/components/shared/`)

| Component | Purpose | Example |
|-----------|---------|---------|
| `LoadingSpinner` | Centered `CircularProgress`. Props: `size?`, `padding?` | `<LoadingSpinner />` |
| `EmptyState` | "No items" message. Props: `message`, `padding?` | `<EmptyState message="No results." />` |
| `CurationDialog` | Edit + reject/unreject experience | Used in Map and Discover modes |
| `AddExperienceDialog` | Search+assign or create new experience | Used in Map and Discover modes |
| `LocationPicker` | Interactive location selector on a map | Used in experience editing |

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
| Scroll element to top | `scrollToTop(container, el)` | Manual scroll math |
| Format duration | `formatDuration(start, end)` | Inline ms-to-seconds/minutes conversion |

## Maintaining This Doc

After extracting a new shared component or utility, add it here:
1. Add a row to the appropriate table above
2. Add a "use this / instead of" row to the pattern table
3. Link from the dev guide if a new concept is involved
