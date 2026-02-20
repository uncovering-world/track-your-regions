# ADR-0001: Use MapLibre over Mapbox

**Date:** 2024-11-01
**Status:** Accepted

---

## Context

The app requires an interactive map with polygon rendering, custom tile layers (via Martin),
and WebGL-based visualization of visited regions. Two main options exist: Mapbox GL JS
and MapLibre GL JS (the open-source fork of Mapbox).

## Decision

Use MapLibre GL JS as the primary map rendering library.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Mapbox GL JS | Requires paid API key for production use; licence changed in 2021 making it non-free; vendor lock-in risk |
| Leaflet | No WebGL support; cannot render large GeoJSON polygon sets with acceptable performance |
| Deck.gl | Overkill for current needs; steeper learning curve; harder to integrate with Martin tile server |

## Consequences

**Positive:**
- No usage-based billing for map tile rendering
- Full control over tile infrastructure via Martin
- Active open-source community; API stays compatible with Mapbox GL JS ecosystem
- Works with standard PMTiles and vector tile formats

**Negative / Trade-offs:**
- Some Mapbox-specific features (e.g. Mapbox Studio styles) require adaptation
- Documentation sometimes lags behind Mapbox GL JS

## References

- Related docs: `docs/tech/maplibre-patterns.md`, `docs/tech/experience-map-ui.md`
- Martin tile server config: `martin/config.yaml`
