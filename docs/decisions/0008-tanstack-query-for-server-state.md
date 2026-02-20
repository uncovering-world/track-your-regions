# ADR-0008: Use TanStack Query for Server State

**Date:** 2025-01-01
**Status:** Accepted

---

## Context

The frontend needs to fetch, cache, and synchronize server data across many components.
Multiple components often need the same data (e.g. region metadata, experience lists),
and mutations must invalidate related caches to keep the UI consistent.

## Decision

Use TanStack Query (React Query v5) as the sole server state management layer.
No Redux or Zustand for server data. UI-only state uses React Context (`useNavigation`,
`useAuth`, `useExperienceContext`).

Default configuration:
```typescript
staleTime: 60_000,           // 1 minute before background refetch
retry: 1,                     // one retry on failure
refetchOnWindowFocus: false,   // no refetch on tab switch
```

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Redux + RTK Query | Heavier boilerplate; Redux store is overkill when all server state is cached queries |
| Zustand + manual fetch | No built-in request deduplication, caching, or background refetching |
| `useEffect` + `useState` | Race conditions, stale closures, duplicate requests, no cache sharing |
| SWR | Similar but smaller ecosystem; less powerful mutation/invalidation API |

## Consequences

**Positive:**
- Request deduplication: identical `useQuery` calls share one network request
- Stale-while-revalidate: show cached data immediately, refetch in background
- Declarative cache invalidation via `queryClient.invalidateQueries()` on mutation success
- No global store boilerplate — queries are co-located with components

**Negative / Trade-offs:**
- Query key discipline required — inconsistent keys cause cache misses or stale data
- `invalidateQueries` can over-invalidate if key prefixes are too broad
- No offline-first support out of the box (acceptable for this app)

## References

- Related docs: `docs/tech/STATE-MANAGEMENT.md`
- Setup: `frontend/src/App.tsx` (QueryClient config)
- Invalidation helpers: `frontend/src/utils/queryInvalidation.ts`
- Mutation pattern: `frontend/src/components/WorldViewEditor/hooks/useRegionMutations.ts`
