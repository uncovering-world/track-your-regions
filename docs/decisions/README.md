# Architecture Decision Records

This directory contains all architectural decisions for the Track Your Regions project.

ADRs are **immutable**. Only `Status` can change. To revise a decision, create a new ADR
and mark the old one as `Superseded by ADR-XXXX`.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-use-maplibre-over-mapbox.md) | Use MapLibre over Mapbox | Accepted | 2024-11-01 |
| [0002](0002-use-gadm-for-administrative-boundaries.md) | Use GADM for administrative boundaries | Accepted | 2024-11-01 |
| [0003](0003-barrel-exports-for-controllers.md) | Use barrel exports for controllers | Accepted | 2025-01-01 |
| [0004](0004-drizzle-orm-plus-raw-pool-for-postgis.md) | Drizzle ORM + raw pool for PostGIS | Accepted | 2025-01-01 |
| [0005](0005-source-agnostic-world-view-import.md) | Source-agnostic world view import pipeline | Accepted | 2025-01-01 |
| [0006](0006-martin-for-vector-tiles.md) | Martin for vector tile serving | Accepted | 2025-01-01 |
| [0007](0007-jwt-with-httponly-refresh-tokens.md) | JWT with httpOnly refresh tokens | Accepted | 2025-02-01 |
| [0008](0008-tanstack-query-for-server-state.md) | TanStack Query for server state | Accepted | 2025-01-01 |
| [0009](0009-import-controller-domain-split.md) | Split worldViewImportController by domain | Accepted | 2026-04-25 |
| [0010](0010-spatial-anomaly-detection.md) | Spatial anomaly detection algorithm (BFS adjacency) | Accepted | 2026-04-26 |
| [0011](0011-icp-adaptive-alignment.md) | ICP adaptive alignment for CV-GADM division matching | Accepted | 2026-04-26 |
| [0012](0012-scope-fallback-and-accept-with-transfer.md) | Scope fallback and accept-with-transfer for geoshape/point matching | Accepted | 2026-04-25 |
| [0013](0013-manual-paint-editor.md) | Manual cluster-paint editor for CV match recovery | Accepted | 2026-04-26 |
| [adr-template](adr-template.md) | — Template — | — | — |

## When to create an ADR

See `CLAUDE.md` § Architecture Decision Records.
