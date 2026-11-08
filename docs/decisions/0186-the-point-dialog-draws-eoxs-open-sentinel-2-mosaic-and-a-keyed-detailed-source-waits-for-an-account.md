# ADR-0186: The point dialog draws EOX's open Sentinel-2 mosaic, and a keyed detailed source waits for an account

**Date:** 2026-11-08
**Status:** Accepted

---

## Context

A curator answering a point question on the review page (#2186) asks what stands under a pin:
whether both pins of Kunya-Urgench's proposed move are in the modern town or among the ruins,
whether there is a dig under Larsa's, Salamis's, Himera's or Helike's pin, which part of the
Brâncuși ensemble at Târgu Jiu each pin marks, whether a pin is on the Church of the
Acheiropoietos in Thessaloniki. The point dialog (`PointPreviewDialog`) drew OpenStreetMap's
standard tiles only, and those show streets. An excavated field, a tell or a walled town that
no street crosses is an empty patch on them.

No basemap in `frontend/src/constants/mapStyles.ts` offered imagery, and none of the services
in `docs/tech/external-services.md` serves it. The maintainer's decision on #2204 set the order:
try an open mosaic that needs no key or account first, a detailed keyed source second only if
the first does not settle the cards, and keep a layer only where it helps.

Two families of source exist.

- **Open mosaics from Sentinel-2** (about 10 m a pixel). EOX IT Services publishes a yearly
  cloudless mosaic, *EOxCloudless*, as WMTS tiles at `tiles.maps.eox.at`, in the web Mercator
  grid, with no key. Its terms, read on 2026-11-08 at <https://cloudless.eox.at>:
  - the 2016 mosaic is CC BY 4.0; the 2018 to 2025 mosaics are CC BY-NC-SA 4.0;
  - the credit asked for is "EOxCloudless *year* by EOX IT Services GmbH (Contains modified
    Copernicus Sentinel data *year*)", with the licence;
  - the pricing page states "You are free to use EOxCloudless map layers and imagery as long as
    you follow the applicable license conditions" and "Feel free to use the provided service
    endpoints"; commercial use is a paid licence;
  - no rate limit is published, and `tiles.maps.eox.at/robots.txt` answers 400 (no file).
- **Detailed imagery** (under a metre a pixel). Esri World Imagery is the common one; its tiles
  are served through ArcGIS Location Platform with an API key tied to an ArcGIS account, under
  Esri's terms of use and attribution rules ("Powered by Esri" and the imagery's sources). A
  key and an account are the maintainer's to create; no session may create either.

The product is non-commercial (#769), which is the condition the NC licence sets. Showing
tiles is not an adaptation, so ShareAlike asks nothing of the page that draws them.

## Decision

1. **The point dialog offers EOX's 2025 mosaic as a satellite view**, behind a Map / Satellite
   switch over the map (`SATELLITE_MAP_STYLE` in `frontend/src/constants/mapStyles.ts`). It is a
   style of the dialog's one map, swapped in place, so the dialog still holds one WebGL context
   and no imagery tile is asked for until the switch is pressed. The map opens on the streets.
2. **The imagery's credit travels with its source**: `EOX_ATTRIBUTION` names EOX, the
   Copernicus Sentinel data and CC BY-NC-SA 4.0, linked, on the source, so MapLibre's
   attribution control shows it whenever the imagery is drawn.
3. **The tiles stop at zoom 14**, the mosaic's native resolution, and MapLibre draws them larger
   beyond it; no tile past what the mosaic holds is requested.
4. **A detailed keyed source is not adopted now.** EOX settles the cards whose question is a
   field of ruins, a tell or a town (Kunya-Urgench, Larsa); it does not settle a single building
   or a small excavation at 10 m (Himera, Helike, the Brâncuși ensemble, the Acheiropoietos).
   Those wait for a detailed source, and that waits for the maintainer to create the account and
   the key. When it is adopted it is recorded beside this one, with its terms, as a second
   layer of the same switch.
5. **The mosaic is not a product of the catalogue.** Nothing stores, caches or derives anything
   from EOX's tiles; they are drawn in a curator's browser and nowhere else.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Esri World Imagery first | Needs an account and a key no session may create; the maintainer's order puts the open mosaic first. Kept as the second layer (decision 4). |
| Esri's tiles without a key (`server.arcgisonline.com`) | Esri offers its basemaps through an ArcGIS account and its terms of use; an unkeyed endpoint is not drawn before those terms are read for it, which is the second layer's work (ADR-0148). |
| The 2016 mosaic, CC BY 4.0 | A licence without NC, but ten years older: a dig opened since, or a town grown since, is not on it. The product is non-commercial, so the 2025 mosaic's NC condition is met. |
| A satellite layer on every map | The question is a curator's, asked in the dialog; the other maps are a reader's and keep the street basemap. |
| A second map beside the street one | Two WebGL contexts per dialog, against the dialog's one-context rule. |

## Consequences

**Positive:**
- A curator reads a field of ruins, a tell or a modern town from the ground in the dialog,
  without leaving for another map.
- No key, no account, no cost.

**Negative / Trade-offs:**
- At 10 m a single building and a small dig are not resolved; those cards still need another
  map or a detailed source.
- The attribution control is built once with the map, so over the imagery the corner keeps
  OpenStreetMap's credit beside EOX's. OpenStreetMap's data is still drawn there, in the
  outlines and the rows, and over-crediting it breaches nothing.
- The NC licence binds the product to staying non-commercial; a commercial deployment would
  need EOX's paid licence or another source.

## References

- Related ADRs: ADR-0148 (a documented API is used under its operator's rules), ADR-0059 (an
  outline carries OpenStreetMap's credit)
- Related docs: `docs/tech/experience-map-ui.md`, `docs/tech/external-services.md`
- PR / issue: #2204, #2186, #769
