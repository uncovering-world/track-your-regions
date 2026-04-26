# ADR-0012 — Scope Fallback and Accept-With-Transfer for Geoshape/Point Matching

**Status**: Accepted
**Date**: 2026-04-25

## Context

Geoshape Match and Point Match search for GADM candidates within the "natural" scope of
a Wikivoyage region — the GADM parent that contains the region's Wikidata geoshape centroid
(or marker-point centroid for point matching). For sub-national regions this is the GADM
country-level division, which gives a tight, relevant candidate set and avoids noise from
unrelated divisions worldwide.

Two failure scenarios emerged during review:

1. **Scope miss**: the region's centroid falls slightly outside the containing GADM country
   polygon (common for island groups, border regions, and disputed territories). The search
   returns zero candidates even though the correct GADM division is nearby.

2. **Conflict**: the best-covering GADM division is already assigned to a *sibling* region
   in the same world view. Accepting it naively would leave the donor region with a gap.

## Decision

### Progressive Scope Widening (Scope Fallback)

When geoshape-match or point-match returns zero candidates within the current scope, the
backend returns `nextScope: { ancestorId, ancestorName }` — the next GADM ancestor level
(country → continent → world). The UI shows a "Try wider: `<ancestorName>`" link inline
with the geocode message. Clicking it retries the same matcher with `scopeAncestorId` set
to the ancestor, widening the search without triggering it automatically.

The scope chain is computed by walking up the GADM `parent_id` tree from the matched
anchor division. This is always at most 2–3 hops deep (division → country → continent →
world), so the link appears at most twice before the scope is global.

### Conflict Detection

When the covering set of GADM divisions includes a division already assigned to a
different region, geoshapeCache records the overlap in `region_match_suggestions`:

- `conflict_type` (`direct` | `split`): "direct" when the entire GADM division is
  assigned elsewhere; "split" when a GADM *parent* is assigned elsewhere (the new region
  would need only a portion of it).
- `donor_region_id`, `donor_region_name`, `donor_division_id`, `donor_division_name`:
  which region and which GADM row would need to give up the division.

These columns are populated in the DB schema and returned via the tree API. The frontend
shows a warning chip (e.g., "from Mexico (split Baja California Sur)") next to the
conflicting suggestion.

### Accept-With-Transfer

When the admin accepts a suggestion that has a conflict, the flow becomes two-stage:

1. **Preview**: clicking Accept (or the map icon) on a conflicting suggestion calls
   `POST /matches/:worldViewId/transfer-preview` with `{ donorDivisionId, movingDivisionIds,
   wikidataId }`. The backend returns a `GeoJSON.FeatureCollection` with role-tagged
   features:
   - `role: "donor"` — the full geometry of the donor region
   - `role: "moving"` — geometries of divisions that would transfer
   - `role: "target_outline"` — geometry of the Wikidata geoshape (target region outline)
   The Division Preview Dialog detects this FeatureCollection and renders a 3-layer map
   (red = donor, orange = moving, dashed blue = target outline).

2. **Accept**: the "Accept Transfer" button calls
   `POST /matches/:worldViewId/accept-with-transfer` with
   `{ regionId, divisionIds, donorRegionId, donorDivisionId, transferType }`.
   The backend runs an atomic transaction:
   - For `transferType = "direct"`: remove the division from the donor's `region_members`;
     the donor's geometry is recomputed by the DB trigger.
   - For `transferType = "split"`: the GADM parent stays in the donor; only `movingDivisionIds`
     are added to the target.
   - Add `divisionIds` to the target region's `region_members`.
   - Set target's `match_status = 'manual_matched'`.
   - Call `invalidateRegionGeometry` on both donor and target to trigger geometry recomputation.

### Why Not Auto-Widen

Auto-widening would make the search non-deterministic (same button, different results each
press) and potentially slow (wider scope scans more divisions). The explicit "Try wider"
link keeps intent visible and lets the admin decide when a wider search makes sense.

### Why Two-Stage Preview for Conflicts

Transferring a division from a sibling region is a destructive change that cannot be easily
undone (undo infrastructure is per-world-view, last-operation only). The preview step ensures
the admin can see both the donor and the moving divisions on a map before committing — reducing
accidental transfers that break a neighbouring region's carefully reviewed assignment.

## Consequences

- **New DB columns** on `region_match_suggestions`: `conflict_type`, `donor_region_id`,
  `donor_division_id`, `donor_region_name`, `donor_division_name`. All nullable; populated
  only when a conflict is detected.
- **Two new API endpoints**: `transfer-preview` (GET-like POST, no DB writes) and
  `accept-with-transfer` (atomic transaction).
- **Geoshape/point matchers** both accept `scopeAncestorId?: number` to override the
  auto-detected scope.
- **AI matcher** uses a recursive CTE to exclude assigned divisions *and their GADM descendants*
  from the candidate pool — prevents conflicts where an already-assigned parent would encompass
  the new region.
- **Frontend** `DivisionPreviewDialog` accepts `GeoJSON.FeatureCollection` (in addition to
  `GeoJSON.Geometry`) as its `geometry` prop for the transfer preview mode.
