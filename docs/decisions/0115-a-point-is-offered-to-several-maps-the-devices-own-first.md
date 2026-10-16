# ADR-0115: A point is offered to several maps, the device's own first

**Date:** 2026-10-16
**Status:** Accepted

---

## Context

A card on the map offers to open a place in a maps app (#1194). Every place holds coordinates, and for a place with no street address — a village chapel, an excavation, a monument on a hill — a maps app is the only way to get there. No single address opens the maps app a visitor uses:

- RFC 5870's `geo:` URI is resolved by Android to the maps app the visitor chose. iOS Safari ignores it, and a desktop browser has no handler for it.
- `maps.apple.com` is a universal link that opens Apple Maps on iOS, iPadOS and macOS.
- Google Maps' Maps URLs (`api=1`) open its app on a phone that has it and its web map elsewhere. Many visitors expect it on a desktop.
- OpenStreetMap is open, keeps no account, and is where the catalogue's basemap and outlines come from (ADR-0059).

The product review asked that the visitor choose. A setting comes later (#1604). Until then, several maps are shown side by side, at least OpenStreetMap and Google Maps. The links must send nothing about the visitor to any provider before they press one.

## Decision

A point is offered to several maps (`mapsTargets`, `frontend/src/utils/mapsLink.ts`), in this order:
1. **The device's own app, where there is one.** That is `geo:lat,lng?q=lat,lng(name)` on Android and `https://maps.apple.com/?ll=lat,lng&q=name` on an Apple device.
2. **OpenStreetMap**, with a marker: `https://www.openstreetmap.org/?mlat=…&mlon=…#map=17/…`.
3. **Google Maps**: `https://www.google.com/maps/search/?api=1&query=lat,lng`.

Coordinates are written to six decimals, and the name is URI-encoded, brackets included. On a card's line of links the targets stand side by side, each with its icon and name. On a place's row, one map icon opens a menu holding the same targets. Each target is a plain `href`, so nothing is fetched from a provider until the visitor presses it. Once #1604 lands, a visitor's chosen provider is offered as one link, with the others in a menu.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| One target per device (the device's app, else OpenStreetMap) | Chooses for the visitor; a desktop visitor who navigates with Google Maps has to retype the place |
| Google Maps everywhere | Overrides the maps app an Android visitor chose, and makes one company's map the only one offered |
| `geo:` everywhere | Does nothing on iOS and on desktop browsers |
| Every target as an icon on every place's row | Three icons on each of thirty rows; the row gets one icon and a menu instead |

## Consequences

**Positive:**
- On a phone, the visitor's own maps app is the first choice. On any device, OpenStreetMap and Google Maps are one press away.
- No provider learns anything until the visitor presses its link.

**Negative / Trade-offs:**
- A card's line carries two or three map links where one would do for a visitor with a settled habit. #1604 lets them say which.
- The device is read from `navigator.userAgentData.platform`, `navigator.platform` and the user agent. A browser that hides all three gets OpenStreetMap and Google Maps only.
- `geo:` is outside `safeHref`'s http(s) rule. It is spelled only in `mapsTargets`, from two range-checked numbers and an encoded name.

## References

- Related ADRs: ADR-0059 (OpenStreetMap outlines)
- Related docs: `docs/tech/experience-map-ui.md`, `docs/research/2026-10-16-how-a-card-lets-a-visitor-copy-and-share.md`
- PR / issue: #1194; the visitor's setting, #1604
