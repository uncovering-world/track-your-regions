# ADR-0002: Use GADM for Administrative Boundaries

**Date:** 2024-11-01
**Status:** Accepted

---

## Context

The app needs authoritative polygon data for administrative regions worldwide — countries,
provinces, municipalities. This data must cover the entire world consistently, be available
for free use, and support hierarchical querying.

## Decision

Use GADM (Global Administrative Areas) as the primary source for administrative boundary polygons,
combined with Wikivoyage region hierarchy for travel-oriented groupings.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| OpenStreetMap / Overpass | Inconsistent quality across countries; boundaries frequently change; licensing complexity for derived data |
| Natural Earth | Too low resolution for sub-country levels |
| Custom dataset | Prohibitive maintenance cost |
| Geoboundaries | Less complete coverage; less established provenance |

## Consequences

**Positive:**
- Comprehensive worldwide coverage at multiple administrative levels (0–5)
- Stable versioned releases (currently GADM 4.1)
- Well-structured GeoJSON/GPKG downloads per country
- Widely used in academic and commercial contexts

**Negative / Trade-offs:**
- GADM reflects de facto administrative boundaries, not always internationally recognised ones
  → Handled via disputed territory metadata layer (see `docs/tech/region-hierarchy.md`)
- No real-time updates; boundary changes require manual dataset updates
- Large file sizes for detailed polygons require simplification for web rendering

## References

- Related ADRs: ADR-0005 (Wikivoyage hierarchy)
- Related docs: `docs/tech/gadm-mapping.md`, `docs/tech/world-views.md`
- GADM: https://gadm.org
