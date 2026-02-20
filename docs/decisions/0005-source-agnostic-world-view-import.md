# ADR-0005: Source-Agnostic World View Import Pipeline

**Date:** 2025-01-01
**Status:** Accepted

---

## Context

The app needs travel-oriented region hierarchies beyond what GADM's administrative
divisions provide — groupings like "Southeast Asia", "Greek Islands", "Patagonia".
Building these manually is prohibitive. Multiple potential sources exist (Wikivoyage,
UN geoscheme, custom JSON files), so the import system must not be tied to any single one.

## Decision

Build a source-agnostic import pipeline that accepts any region hierarchy as a JSON tree.
The pipeline handles matching imported regions to GADM divisions, admin review, and
finalization — regardless of where the data came from.

Wikivoyage is the first automated source (~2,750 English regions) because its
MediaWiki API + Wikidata SPARQL enrichment make semi-automated extraction feasible.
But the same importer handles manual JSON uploads identically.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Wikivoyage-specific importer | Locks the system to one source; prevents custom hierarchies |
| Manual region creation only | Prohibitive effort for worldwide coverage |
| UN geoscheme / ISO 3166-2 | Too coarse; no sub-country travel regions |
| Hardcoded world view | Can't adapt to different user perspectives (e.g. continental vs thematic groupings) |

## Consequences

**Positive:**
- Any JSON tree can become a world view — Wikivoyage, manual, future sources
- Matching + review workflow ensures quality regardless of source
- Multiple world views can coexist (GADM default, Wikivoyage, custom)

**Negative / Trade-offs:**
- Generic pipeline is more complex than a single-source extractor
- Matching quality depends on GADM coverage at the right administrative level
- Admin review step required before a world view is usable

## References

- Related ADRs: ADR-0002 (GADM boundaries)
- Related docs: `docs/tech/world-view-import.md`, `docs/tech/world-view-import-format.md`
- Import pipeline: `backend/src/services/worldViewImport/`
- Extraction (Wikivoyage): `backend/src/services/wikivoyageExtract/`
