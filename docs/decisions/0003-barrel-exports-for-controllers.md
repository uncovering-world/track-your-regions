# ADR-0003: Use Barrel Exports for Controllers

**Date:** 2025-01-01
**Status:** Accepted

---

## Context

As the backend grew, controller files became large (500–1000+ lines). The team (AI agent)
needed a consistent pattern for splitting controllers by concern while keeping route files
simple and stable — routes should not need to change when controllers are refactored internally.

## Decision

Every controller domain directory has an `index.ts` barrel that re-exports all public functions.
Routes import exclusively from the barrel, never from individual files.

Two barrel styles are permitted:
- `export *` — when there are no naming conflicts (simpler)
- Named re-exports — when the API surface should be explicit

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Routes import directly from controller files | Routes break on every controller refactor |
| Single large controller file per domain | Files grow past 800 lines; violates single-responsibility |
| Auto-generated index files | Adds tooling complexity for little gain |

## Consequences

**Positive:**
- Route files are stable across controller refactors
- Controller internals can be freely split/merged without touching consumers
- Clear public API surface per domain

**Negative / Trade-offs:**
- Every new exported function must be added to `index.ts` (if using named re-exports)
- Slightly more files to maintain

## References

- Related docs: `docs/tech/development-guide.md` § Controllers
