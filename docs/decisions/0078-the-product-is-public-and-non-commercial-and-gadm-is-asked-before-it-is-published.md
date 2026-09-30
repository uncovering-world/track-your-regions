# ADR-0078: The product is public and non-commercial, and GADM is asked before it is published

**Date:** 2026-09-30
**Status:** Accepted

---

## Context

ADR-0002 chose GADM for administrative boundaries. One of its positive consequences reads
"widely used in academic and commercial contexts". GADM's own terms
(<https://gadm.org/license.html>, read 2026-09-30) say something narrower:

> The data are freely available for academic use and other non-commercial use.
> Redistribution or commercial use is not allowed without prior permission.

Two facts follow for this product:

- **Whether it is a business matters.** A commercial product may not use GADM without
  permission at all.
- **Even a non-commercial public site redistributes GADM.** The Martin tile server
  (`tile_gadm_root_divisions`, `tile_world_view_root_regions`, `tile_region_subregions`)
  serves GADM geometry, and derived geometry, to every visitor's browser. The geometry
  endpoints of the API do the same. That is redistribution, and it needs GADM's prior
  permission whether or not the product earns anything.

Other sources the product has read or planned carry their own terms:

- **CShapes 2.0**, the historical-borders dataset of #616, is CC BY-NC-SA 4.0.
- **geoBoundaries** (gbOpen, CGAZ) is CC BY 4.0, and **Natural Earth** is public domain.
  ADR-0002 rejected geoBoundaries for coverage and provenance, not for its licence.

ADR-0059 already noted that "the foundation the catalogue stands on is already not
commercial", and left "what GADM's terms allow" to "a decision for the product's public
release". #769 asked for that decision, and the maintainer took it on 2026-09-30.

## Decision

1. **The product is public and non-commercial.** Anyone may use it, and it is not operated
   for revenue:
   - no fee for using it;
   - no sale of its data or of access to it;
   - no advertising.

   Voluntary donations towards running it do not make it commercial.
2. **GADM stays the base layer, and its permission is asked before the product is
   published.** ADR-0002's decision stands. Its licence consequence is narrowed to GADM's
   actual terms: non-commercial use is allowed, and redistribution needs prior permission.
   Serving GADM geometry, or geometry derived from it, to the public through Martin tiles
   or the API is redistribution. The request to GADM is part of going public (#585). Until
   GADM has granted it, the product runs on developer machines and on no public host.
   The request is not sent earlier, because publication is not near and the request should
   describe the product as it will be published.
3. **Non-commercial sources are admissible under this posture.** CShapes (CC BY-NC-SA 4.0)
   may be used. ShareAlike binds the data derived from it (#616 records how). A source's
   non-commercial clause is no longer, on its own, a reason to reject it. Its other terms
   (attribution, ShareAlike, redistribution) still apply one by one.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Commercial product, with the base layer replaced by geoBoundaries (CC BY 4.0) and Natural Earth before launch | Not the maintainer's intent for the product. It would make the canon rework (#587) a precondition of any public release, for a revenue the product is not meant to have. |
| Non-commercial without asking GADM | Public tiles are redistribution, which GADM's terms forbid without permission whatever the purpose. |
| Ask GADM now | Publication is far off. A request should describe the product as it will be published, and an early answer could lapse or no longer fit by then. |

## Consequences

**Positive:**
- The base layer and everything built on it (the import tree, the mirror world view of
  ADR-0018, region assignment) keep their source. No substrate swap is owed for licence
  reasons.
- #616 (historical countries from CShapes) is unblocked on its licence question.
- When a kind is filled, a source's non-commercial clause is no longer a veto.
  `docs/tech/filling-a-kind.md` § 5 says so beside the other licence classes. The rest of
  the source's terms are still scored.
- Several admin screens and a world-view editor dialog draw CARTO's Positron basemap
  (`basemaps.cartocdn.com`). CARTO offers it free for non-commercial use only, so the
  posture keeps it within that tier. Its other conditions (attribution, an API key, a
  monthly request volume) are not answered here; they sit with the basemap question in #651.

**Negative / Trade-offs:**
- Going public depends on GADM's answer. A refusal turns the base layer into a precondition
  of publication again. The fallback is the one this ADR declined: geoBoundaries CC BY 4.0
  and Natural Earth, with #436 as the evaluation of the tools that would build it.
- A later wish to earn from the product needs a new ADR, and it reopens the base layer and
  every non-commercial source admitted under decision 3.
- The product is not operated commercially. The decision is about operating it, not about
  the code: the repository's code licence (Apache-2.0) is a separate question, #1164.

**Unaffected:**
- What the catalogue takes from OpenStreetMap is kept separable and offered under ODbL
  (ADR-0059).
- Pictures come from Wikimedia Commons under their own licences, with credits (ADR-0043).
- Map mode, Discover and most editor dialogs draw OpenStreetMap's public tile server, whose
  usage policy does not depend on whether a product is commercial (#651).

## References

- Related ADRs: ADR-0002 (GADM, whose licence consequence this narrows), ADR-0018 (the mirror
  world view), ADR-0043 (pictures), ADR-0059 (OpenStreetMap under ODbL)
- GADM licence: <https://gadm.org/license.html>
- Issues: #769 (the decision), #1158 (this record), #585 (deploy, which owns the request to
  GADM), #616 (CShapes), #436 (the fallback's tools), #651 (basemap tiles), #1164 (the code's
  licence and the data notices)
