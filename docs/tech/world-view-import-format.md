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
| `regionMapUrl` | string | No | Absolute http(s) URL of a map image showing this region's subdivisions |
| `mapImageCandidates` | string[] | No | Alternative map image URLs for admin review (picker dialog); each an absolute http(s) URL |

### Field Behavior

- **`name`** — becomes `regions.name` in the database. The only required field.
- **`children`** — if present, creates child regions under this node. Leaf nodes (no children) are the primary targets for GADM matching.
- **`sourceUrl`** — stored in `region_import_state.source_url`. Displayed as a link in the match review tree. Used to identify duplicate instances of the same region across the tree (for the "Sync to other instances" feature).
- **`wikidataId`** — stored in `region_import_state.source_external_id`. Used by the Division Preview Dialog to fetch a Wikidata geoshape overlay for visual comparison with GADM boundaries.
- **`regionMapUrl`** — stored in `region_import_state.region_map_url`. Shown as a reference image alongside GADM boundaries in the preview dialog. Also available as an overlay in the Custom Subregions dialog's Map View. Refused at upload unless it is an absolute http(s) URL, and drawn only from a host the app trusts for pictures — Wikimedia Commons, which is where every map imported so far lives (`Special:FilePath/…` gets sized with `?width=`; another trusted host goes through the image proxy). A map hosted anywhere else is stored but never shown (#694).
- **`mapImageCandidates`** — stored in `region_map_images` table (1:N). When more than one candidate exists, the admin picks the correct map image via a picker dialog before previewing divisions. Held to the same rule as `regionMapUrl`, since the picker draws every candidate; one it cannot draw is not offered.

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

A source is a registry entry, not a script that produces a file. Adding one means:

1. **A frontend module** under `frontend/src/components/admin/importSources/` exporting a form component — it receives the shared world view name (`ImportSourceFormProps`) and owns its own inputs, mutation, error surface, and start button — plus one line in `IMPORT_SOURCES` (`frontend/src/components/admin/importSources/index.ts`) giving it a label and, optionally, a suggested world view name. See "Import Sources" in `docs/tech/world-views.md` for the registry shape.
2. **A backend path** that builds an `ImportTreeNode` tree (the format above) however the source needs to — crawl a site, read from the database, call an API — and gets it into the import pipeline with a `sourceType` of its own, normally by calling `startImport()` (`backend/src/services/worldViewImport/index.ts`) once the tree is ready. A source that has to do async work of its own before the tree exists reserves its own operation slot first instead, so a concurrent request's "is one already running" check can't land in the gap before that reservation exists — see `startBaseLayerImport()` in the same file for the pattern.
3. **That `sourceType` registered** in `IMPORT_SOURCE_TYPES` (`backend/src/services/worldViewImport/sourceTypes.ts`) — this is what makes the match review, finalize, and rematch endpoints recognise the world view. A `sourceType` missing from that file is invisible to all three.

Uploading a JSON file needs none of this: it is the existing `imported` source, already wired up. Which path fits depends on where the tree comes from — a one-off tree produced outside the app (a script run by hand, an export from another tool) is a file to upload; a source the app itself can generate or fetch on demand is worth a registry entry, so an admin can run it from the panel the way Wikivoyage and the administrative base layer already do.

### Existing Sources

| Source | Tree comes from |
|--------|------------------|
| Wikivoyage | The `wikivoyageExtract` service crawls the MediaWiki API and enriches with Wikidata IDs — see `docs/tech/world-view-import.md` |
| JSON file upload | Whatever the admin uploads, validated against the format above |
| Administrative base layer | `buildBaseLayerTree()` reads `administrative_divisions` down to a chosen depth and emits names and hierarchy only — see "Base Layer Import" in `docs/tech/world-views.md` |

### Tips for New Sources

- The matcher works best when leaf nodes correspond to countries or first-level subdivisions
- `sourceUrl` enables the "Sync to other instances" feature (important for sources with multi-parent regions)
- `wikidataId` enables geoshape preview — worth including if available from your source
- `regionMapUrl` + `mapImageCandidates` are only useful if your source has map images
- The tree can be arbitrarily deep; the matcher processes it recursively
