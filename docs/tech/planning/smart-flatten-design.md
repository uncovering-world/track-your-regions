# Smart Flatten — Design

## Problem

When importing hierarchies like Iran → Central Iran → [Isfahan, Fars, Yazd...], the admin often wants to keep the intermediate region (Central Iran) but NOT the individual provinces as separate regions. Today, "Dismiss subregions" deletes children but loses their GADM division info. The admin would have to manually look up what GADM divisions cover "Central Iran" — tedious work that the system already knows how to do.

## Solution

A single **"Smart Flatten"** operation that:

1. Auto-matches unmatched children against GADM (reusing existing matching logic)
2. Checks that ALL children are now resolved — blocks if any can't be matched
3. Absorbs all descendant divisions into the parent
4. Deletes all descendant regions
5. Supports undo

## Backend

### Endpoint

`POST /api/admin/world-views/:id/import/regions/:regionId/smart-flatten`

### Algorithm

1. Load region and all descendants (recursive)
2. For each descendant that lacks `region_members` assignments → run matching (same logic as `matchChildrenAsCountries`: name matching, trigram similarity against GADM)
3. Check: do ALL descendants now have at least one `region_members` assignment?
   - **No** → Return `400` with `{ unmatched: [{ id, name }] }` listing children that need manual attention
   - **Yes** → proceed
4. Snapshot parent + all descendants for undo (same pattern as `dismissChildren`)
5. In a single transaction:
   - Collect all `region_members` from all descendant regions
   - `INSERT INTO region_members (region_id, division_id)` for parent, `ON CONFLICT DO NOTHING`
   - Delete all descendant regions deepest-first (CASCADE handles import_state, suggestions, map_images)
   - Set parent's `match_status = 'manual_matched'`
6. Store undo entry in `undoEntries` Map
7. Return `{ absorbed: number, divisions: number, undoAvailable: true }`

### Matching Strategy for Unmatched Children

Reuse `matchSingleChildAsCountry` / trigram search from `matcher.ts`. For each unmatched child:
- Try exact GADM name match
- Fall back to trigram similarity search
- If match found → insert `region_members` + update status
- If no match → leave unmatched (will block flatten)

## Frontend

### Button

- **Location**: `TreeNodeActions.tsx`
- **Shown when**: Node has children AND status is `null`, `no_candidates`, or `children_matched` (container nodes)
- **Icon**: Existing flatten/compress icon (e.g. `CompressIcon` or `VerticalAlignCenter`)
- **Label**: "Smart Flatten"
- **Tooltip**: "Auto-match children to GADM divisions, then absorb into this region"

### Behavior (Two-Step with Preview)

1. **Click** → call `smart-flatten/preview` endpoint, show loading spinner on button
2. **Preview success** → open `SmartFlattenPreviewDialog` showing side-by-side: region map image (left) + unified GADM geometry on MapLibre map (right). Title shows region name, subtitle shows "Will absorb N descendants (M divisions)"
3. **Confirm** → call `smart-flatten` endpoint, tree refreshes, undo snackbar
4. **Cancel** → close dialog, no action (auto-matches from preview step remain harmlessly)
5. **Blocked** → snackbar warning: "Cannot flatten: N children have no GADM match: Name1, Name2, Name3"
6. **Error** → standard error handling

### Preview Endpoint

`POST /api/admin/world-views/:id/import/regions/:regionId/smart-flatten/preview`

Runs the same auto-match phase as the flatten endpoint, then returns:
- `geometry`: unified GeoJSON of all matched descendant divisions (`ST_Union` of `geom_simplified_medium`)
- `regionMapUrl`: parent region's map image for visual comparison
- `descendants`: count of descendant regions
- `divisions`: count of unique GADM divisions

### Undo

Same pattern as dismiss/grouping: snackbar with "Undo" button, calls `undoLastOperation`.

## Edge Cases

- **Grandchildren**: The operation collects divisions from ALL descendants, not just direct children. This handles multi-level hierarchies (Iran → Central Iran → [provinces] → [sub-provinces]).
- **Duplicate divisions**: `ON CONFLICT DO NOTHING` prevents duplicate `region_members` entries.
- **Already-matched children**: If some children are already matched, their divisions are absorbed without re-matching.
- **Empty children (no descendants have divisions)**: All children must be matched first. The auto-match step tries to resolve them; if it can't, the operation is blocked.
