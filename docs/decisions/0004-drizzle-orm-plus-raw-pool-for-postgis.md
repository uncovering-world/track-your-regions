# ADR-0004: Use Drizzle ORM + Raw Pool for PostGIS

**Date:** 2025-01-01
**Status:** Accepted

---

## Context

The backend needs both standard CRUD queries (users, regions, experiences) and complex
PostGIS spatial operations (geometry computation, area calculation, spatial joins).
A single query approach cannot serve both needs well.

## Decision

Use a dual approach:
- **Drizzle ORM** (`db`) for type-safe CRUD on non-geometry columns
- **Raw `pool.query()`** with parameterized SQL for PostGIS spatial functions and complex CTEs

Both are exported from `backend/src/db/index.ts`:
```typescript
export const db = drizzle(pool, { schema });
export { pool };
```

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Drizzle-only | Drizzle 0.34 lacks first-class PostGIS support; spatial functions (`ST_Area`, `ST_GeomFromGeoJSON`, `ST_CoverageSimplify`) require raw SQL |
| Raw pool-only | CRUD becomes verbose and loses type safety; more room for SQL injection mistakes |
| TypeORM / Prisma | Heavier ORMs with worse PostGIS support; Prisma has no raw spatial function types |

## Consequences

**Positive:**
- Type-safe CRUD for standard tables via Drizzle schema
- Full PostGIS expressiveness for geometry operations
- Parameterized queries in both paths prevent SQL injection

**Negative / Trade-offs:**
- Two query patterns to learn; developers must know when to use which
- `pool.query()` uses random connections — must use `pool.connect()` when SET/RESET
  must apply to the same connection as the query
- Drizzle schema (`db/schema.ts`) must stay in sync with SQL schema (`db/init/01-schema.sql`)

## References

- Related docs: `docs/tech/development-guide.md` § Database Queries
- Schema: `backend/src/db/schema.ts`, `db/init/01-schema.sql`
