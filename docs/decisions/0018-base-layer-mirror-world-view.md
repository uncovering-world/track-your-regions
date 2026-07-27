# ADR-0018: Experiences reach the administrative base layer through a mirror world view

**Date:** 2026-07-27
**Status:** Accepted

---

## Context

Experiences attach to regions only — `experience_regions` and
`experience_location_regions` both reference `regions(id)`. The administrative
base layer lives in `administrative_divisions`, a separate tree of 392,112
rows, and the default world view that represents it held no regions at all.
Every experience surface (Discover counts, region browsing, markers,
curation, rejection filtering) is therefore region-scoped, and none of them
could be exercised: 1247 UNESCO sites, 200 monuments, 100 museums and 6520
locations sat with zero region assignments. A canonical world view is being
built separately and is not ready.

## Decision

Keep experiences attached to regions. Reach the base layer by importing it
as a world view — one region per division, down to depth 2 — through the
existing import pipeline, and let the existing matcher resolve each region
to its division. The importer emits names and hierarchy only; it does not
carry the division a node was read from, even though generating the tree
from the divisions makes that trivially available. Geometry comes from the
normal compute path. The world view is created hidden and can be published
per world view.

### Measured outcome

The measured numbers are the point of the exercise: a depth-2 import of
3831 regions (8 + 237 + 3586, matching the division counts exactly) run
through the `country-based` policy resolved 2372 regions (62%):

| `match_status` | Regions |
|---|---|
| `auto_matched` | 2372 |
| `no_candidates` | 1251 |
| `children_matched` | 157 |
| `needs_review` | 51 |

Of the 2372 matched regions, 2371 have a member division whose name equals
the region's exactly; the single exception matched "Osh (city)" to the
division "Osh" — a variant match, and the clearest evidence that the matcher
resolved these rather than being handed the answer.

The 1251 `no_candidates` regions carry **zero** suggestions, so unlike the
51 they cannot be resolved by review clicks. They decompose into four
distinct causes — three of them matcher gaps, one of them expected
behavior:

1. **Children of country-level nodes that themselves went unmatched (572
   regions).** The base layer places Australia at root level beside the
   continents, but `matchCountryLevel` assumes continent → country →
   subdivision, so a country-level node the algorithm never recognizes as
   a country has its children skipped along with it. Australia's six
   states account for 547 of the 572: New South Wales 153 unmatched
   children, Western Australia 140, Victoria 80, Queensland 73, South
   Australia 71, Tasmania 30. The remaining 25 belong to other
   country-level nodes affected the same way.
2. **Ambiguous country matches (51 countries, 507 regions).** These
   countries matched *too many* candidates rather than none — United
   Kingdom 30, France 20, United States 9, all at score 700 — so they land
   in `needs_review`, and drill-down never runs for their children. They
   carry 143 suggestions between them and are resolvable by hand in the
   review UI.
3. **All-or-nothing drill-down (9 countries, 166 regions).**
   `trySubdivisionDrillDown` abandons a country's entire subdivision level
   when even one child fails to match. Vietnam is the clearest case: the
   country matched cleanly, and 63 subdivisions got nothing.
4. **The continent nodes themselves (6 regions).** These are container
   nodes with no division of their own to match, so a `no_candidates`
   status here is the expected, correct outcome — not a failure, and not
   part of the gap the first three causes describe.

572 + 507 + 166 + 6 = 1251.

This is a finding about the pipeline, not about the mirror: the
information needed to resolve those subdivisions is already present in
the tree (a node's name plus its parent's resolved division), and
`findBestAmongChildren` already implements the lookup. The matcher
simply stops after one level and gives up as a unit. A matching policy
that walks the hierarchy recursively is the identified fix, tracked as
follow-up work with its own ADR, and the base-layer import is what makes
it measurable: 3831 nodes with a known-correct answer that was
deliberately withheld from the importer, so any matcher change can be
scored against it. No other source can provide that, because for
Wikivoyage nobody knows the right answer.

One more thing surfaced while investigating: the name-matching core is
duplicated between `matcher.ts` (private copies) and `matcherUtils.ts`
(exported, imported only by `matcherGrouping.ts`), and the two have
diverged — `getNameVariants` strips suffixes by regex in one and by a
last-word set lookup in the other. Consolidating them is a prerequisite
for any matcher work, since today a fix lands in only one of two live
implementations.

## Alternatives Considered

- **An experience↔division relation.** Would duplicate assignment,
  ancestor propagation, counts, tiles, rejection filtering and the
  curation surface along a second axis, permanently.
- **A bespoke seeder script.** Cheaper to write, but it would have left
  the import pipeline untested for any second source. Building the mirror
  through the pipeline is what surfaced the four copies of the
  source-type allowlist that made a new source invisible to the review,
  finalize and rematch endpoints.
- **Pre-resolving each node to its division in the importer.** The first
  draft did this — the tree was generated from the divisions, so every
  node could simply carry its id, skipping matching and letting geometry
  be copied. Rejected: it would have exercised the import half of the
  pipeline while bypassing the matching half, which is the half most
  likely to be source-specific. Resolving names honestly is what makes
  this a test rather than a demonstration.
- **Mirroring the full division tree.** 392,112 regions with duplicated
  geometry would roughly double the largest table in the database. Depth
  is capped at 3 and defaults to 2.
- **Making the default world view region-backed instead.** Rejected for
  the same depth reason: the mirror must be capped, so the default world
  view's division navigation is still needed for anything deeper.

## Consequences

- Region-scoped curation done in the mirror (rejections, manual
  assignments, the region-scoped curation log) does not carry over to the
  canonical world view. Experience-level work — curated fields, images,
  treasures, `is_iconic`, Curator Picks, new categories — does.
- The division-based navigation of the default world view stays: the
  mirror is depth-capped, so drilling deeper still needs it.
- The provider is never named in code. `source_type = 'base_layer'`; the
  provider label is a request parameter stored in `world_views.source`.
  Swapping the dataset means reloading `administrative_divisions` and
  re-importing.
- Matching a tree derived from the base layer against that same base
  layer is circular: it proves the pipeline is source-agnostic, not that
  matching is good at hard names.
- Pre-existing GADM-named surfaces are left alone and remain debt: the
  tile functions `tile_gadm_root_divisions` and `tile_gadm_subdivisions`,
  the route `POST /api/world-views/regions/:regionId/geometry/reset`
  behind `resetRegionToGADM`, and the column
  `administrative_divisions.gadm_uid`.
- Hiding a world view bounds the API, not the tiles. Martin publishes
  every table and function on a public port, so a hidden world view's
  geometry stays fetchable by tile id. Closing that is a follow-up branch
  with its own ADR — it does not exist yet, so no number is cited here.

## References

- Related ADRs: ADR-0002 (GADM as the dataset currently loaded into
  `administrative_divisions`), ADR-0005 (source-agnostic import pipeline
  this decision runs through)
- Related docs: `docs/tech/world-views.md` (Visibility, Base Layer
  Import, Import Sources sections), `docs/tech/experiences.md`
  (assignment model), `docs/tech/world-view-import.md` (matcher and
  review-UI internals)
- Key files: `backend/src/services/worldViewImport/baseLayerImporter.ts`,
  `backend/src/services/worldViewImport/sourceTypes.ts`,
  `backend/src/services/worldViewImport/matcher.ts`,
  `backend/src/services/worldViewImport/matcherUtils.ts`,
  `backend/src/middleware/worldViewVisibility.ts`,
  `frontend/src/components/admin/importSources/`
