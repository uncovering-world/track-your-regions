# WorldView Import Format

Source-agnostic JSON format for importing region hierarchies into a WorldView.

## Format Specification

The import accepts a JSON tree where each node represents a region:

```json
{
  "name": "World",
  "children": [
    {
      "name": "Europe",
      "sourceUrl": "https://en.wikivoyage.org/wiki/Europe",
      "wikidataId": "Q46",
      "children": [
        {
          "name": "Germany",
          "sourceUrl": "https://en.wikivoyage.org/wiki/Germany",
          "wikidataId": "Q183",
          "regionMapUrl": "https://commons.wikimedia.org/wiki/Special:FilePath/Germany_regions.png",
          "mapImageCandidates": [
            "https://commons.wikimedia.org/wiki/Special:FilePath/Germany_regions.png",
            "https://commons.wikimedia.org/wiki/Special:FilePath/Germany_map.png"
          ],
          "children": [
            {
              "name": "Bavaria",
              "sourceUrl": "https://en.wikivoyage.org/wiki/Bavaria",
              "wikidataId": "Q980"
            }
          ]
        }
      ]
    }
  ]
}
```

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Region display name |
| `children` | array | No | Child region nodes (same structure, recursive) |
| `sourceUrl` | string | No | URL to the original source page (e.g., Wikivoyage article) |
| `wikidataId` | string | No | Wikidata entity ID (e.g., `"Q980"`). Used for geoshape fallback in preview |
| `regionMapUrl` | string | No | URL to a map image showing this region's subdivisions |
| `mapImageCandidates` | string[] | No | Alternative map image URLs for admin review (picker dialog) |

### Field Behavior

- **`name`** — becomes `regions.name` in the database. The only required field.
- **`children`** — if present, creates child regions under this node. Leaf nodes (no children) are the primary targets for GADM matching.
- **`sourceUrl`** — stored in `region_import_state.source_url`. Displayed as a link in the match review tree. Used to identify duplicate instances of the same region across the tree (for the "Sync to other instances" feature).
- **`wikidataId`** — stored in `region_import_state.source_external_id`. Used by the Division Preview Dialog to fetch a Wikidata geoshape overlay for visual comparison with GADM boundaries.
- **`regionMapUrl`** — stored in `region_import_state.region_map_url`. Shown as a reference image alongside GADM boundaries in the preview dialog. Also available as an overlay in the Custom Subregions dialog's Map View.
- **`mapImageCandidates`** — stored in `region_map_images` table (1:N). When more than one candidate exists, the admin picks the correct map image via a picker dialog before previewing divisions.

## Match Status Lifecycle

After import, each region gets a `region_import_state` row tracking its match progress:

```
no_candidates → (matcher finds candidates) → needs_review / auto_matched / suggested
needs_review  → (admin accepts)            → manual_matched
suggested     → (admin accepts)            → manual_matched
*             → (children all matched)     → children_matched
*             → (admin resets)             → no_candidates
```

| Status | Meaning |
|--------|---------|
| `no_candidates` | No matching GADM divisions found |
| `needs_review` | Candidates found but confidence too low for auto-assignment |
| `auto_matched` | High-confidence match, auto-assigned to a GADM division |
| `suggested` | Candidate found for a non-leaf region (never auto-assigned) |
| `manual_matched` | Manually accepted by admin |
| `children_matched` | Region's children were matched independently |

## Database Storage

Import data is stored in four relational tables (not JSONB):

- **`import_runs`** — one row per import operation, links to world_view
- **`region_import_state`** — one row per imported region (PK = region_id)
- **`region_match_suggestions`** — one row per candidate match (with rejected flag)
- **`region_map_images`** — one row per map image candidate

See `db/init/01-schema.sql` for full table definitions.

## How to Add a New Import Source

1. **Write an extraction script** that produces a JSON file in the format above. Only `name` and `children` are required; all other fields are optional enhancements.

2. **Upload via Admin Panel** → Import WorldView → upload JSON file + enter a name.

3. **The review system handles the rest**: automatic GADM matching, manual review UI, coverage checking, and finalization are all source-agnostic.

### Existing Sources

| Source | Script | Output |
|--------|--------|--------|
| English Wikivoyage | `scripts/wikivoyage-regions.py` | ~2,750 regions with sourceUrl, wikidataId, regionMapUrl, mapImageCandidates |

### Tips for New Sources

- The matcher works best when leaf nodes correspond to countries or first-level subdivisions
- `sourceUrl` enables the "Sync to other instances" feature (important for sources with multi-parent regions)
- `wikidataId` enables geoshape preview — worth including if available from your source
- `regionMapUrl` + `mapImageCandidates` are only useful if your source has map images
- The tree can be arbitrarily deep; the matcher processes it recursively
