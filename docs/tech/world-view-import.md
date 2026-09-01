# WorldView Import

Import a source-agnostic region hierarchy into a WorldView with automatic GADM division matching.

## Overview

The WorldView import feature lets admins create a WorldView from a region hierarchy. Every import starts from one panel with a source selector; see "Import Sources" in `docs/tech/world-views.md` for the three sources today (Wikivoyage, JSON file, administrative base layer), and "How to Add a New Import Source" in `docs/tech/world-view-import-format.md` for how a new one gets registered. This doc covers what every source shares once import starts — the matcher and the review UI. Whichever source is picked, the pipeline:

1. Creates a WorldView with all regions (hierarchical)
2. Matches regions to administrative divisions (with optional subdivision drill-down)
3. Provides a match review interface for manual corrections

Wikivoyage is the only source with an extraction step of its own: a TypeScript backend service (`backend/src/services/wikivoyageExtract/`) crawls the MediaWiki API to build the region hierarchy (~4,500 regions) before handing it to the same import pipeline.

## Architecture

### Data Flow

```text
Option A: Wikivoyage source ("Fetch from Wikivoyage" button)
  → wikivoyageExtract service (TypeScript)
    → Phase 1: Extract tree from Wikivoyage API (status='extracting')
    → Phase 2: Enrich with Wikidata IDs (status='enriching')
    → Phase 3: Import into WorldView (status='importing') — calls importTree() directly
    → Phase 4: Match to GADM (status='matching') — runMatchingPolicy(defaultMatchingPolicy('wikivoyage'), …)
    → Complete → "Review Matches" button

Option B: JSON file source (upload)
  → Admin Upload → worldViewImport service
    → import_runs + WorldView + Regions + region_import_state
    → Matcher → region_members (auto-assigned)
             → region_match_suggestions (for review)

Option C: Administrative base layer source
  → buildBaseLayerTree() reads administrative_divisions down to the chosen depth
    (backend/src/services/worldViewImport/baseLayerImporter.ts)
  → Shapes it as an import tree — names and hierarchy only, never the division
    a node was read from
  → Same worldViewImport service as Option B from here:
    → import_runs + WorldView + Regions + region_import_state
    → Matcher → region_members (auto-assigned)
             → region_match_suggestions (for review)
```

### Database Tables

Import state is stored in dedicated relational tables (not JSONB):

- **`import_runs`** — tracks each import operation (world_view_id, source_type, status, data_path, stats, timestamps)
- **`region_import_state`** — 1:1 with region (region_id PK, import_run_id, source_url, source_external_id, match_status, needs_manual_fix, fix_note, region_map_url, map_image_reviewed)
- **`region_match_suggestions`** — 1:N per region (division_id, name, path, score, geo_similarity, rejected flag, `conflict_type`, `donor_region_id`, `donor_division_id`, `donor_region_name`, `donor_division_name` — the last five are non-null when the suggestion conflicts with a sibling assignment, see ADR-0012)
- **`region_map_images`** — 1:N per region (image_url candidates)
- **`world_views.source_type`** (VARCHAR) — `'manual'` (default), or one of the import source types in `backend/src/services/worldViewImport/sourceTypes.ts` (`'wikivoyage'`, `'imported'`, `'base_layer'`) while its match review is open, with a `_done` suffix once finalized (e.g. `'wikivoyage_done'`, `'base_layer_done'`). The review-status listing, finalize, and rematch endpoints resolve which source types they own through that file instead of an inline allowlist, so a new source type is added in one place
- **`world_views.dismissed_coverage_ids`** (INTEGER[]) — GADM division IDs that the admin has explicitly dismissed from coverage checks (e.g., Caspian Sea). Reset on re-match
- **`administrative_divisions.name_normalized`** (TEXT, generated) — `lower(immutable_unaccent(name))`, indexed with GIN trigram for fast fuzzy matching
- **`immutable_unaccent()`** function — IMMUTABLE wrapper around `unaccent()` for use in generated columns and indexes

Match statuses (in `region_import_state.match_status`):
- `auto_matched` — country or subdivision matched to a GADM division with high confidence
- `children_matched` — region's children were ALL matched independently (region itself has no direct assignment, shown as "matched" in UI)
- `needs_review` — candidates found but confidence too low for auto-assignment
- `no_candidates` — no matching GADM divisions found
- `manual_matched` — manually accepted by admin
- `suggested` — candidate match found for a non-leaf region (never auto-assigned)

## Matching Policies

The matching policy determines how imported regions are auto-matched to GADM divisions. The policy is selected per-import:

| Policy | Behavior | Use case |
|--------|----------|----------|
| `country-based` (default) | Walks the tree looking for country names, matches to GADM, optionally drills into subdivisions | Wikivoyage imports, geographic hierarchies whose nodes may group several divisions |
| `hierarchical` | Descends the division hierarchy alongside the import tree, resolving each node among the divisions under its nearest resolved ancestor | Sources that mirror the hierarchy one-to-one — the administrative base layer |
| `none` | Skips auto-matching entirely; all regions start as `no_candidates` | Non-geographic hierarchies, manual curation |

The policy is not chosen at each call site: `defaultMatchingPolicy(sourceType)`
(`sourceTypes.ts`) decides it in one place, so the import path, the re-match path
and the Wikivoyage extraction path cannot drift apart. `base_layer` gets
`hierarchical`; Wikivoyage extractions and file uploads get `country-based`, and
the upload UI can override it per import. See
[ADR-0019](../decisions/0019-matching-policy-per-source-shape.md) for why this is
a policy choice rather than one algorithm, and `docs/tech/world-views.md`
§ "Matching policies" for what the descent's two properties buy.

## JSON Tree Validation

Uploaded JSON trees are validated with a recursive Zod schema:

```typescript
{
  name: string,          // 1-255 chars (the width of regions.name)
  regionMapUrl?: string, // absolute http(s) URL, max 2000 chars once normalised
  mapImageCandidates?: string[], // max 20, each an absolute http(s) URL
  wikidataId?: string,   // Q-ID format (Q\d+)
  children: TreeNode[]   // recursive, default []
}
```

`regionMapUrl` and every candidate are pictures a dialog draws, so they are
held to what a stored url may be — the rule declared once in
`backend/src/types/urlSafety.ts` and described in
[experiences.md](experiences.md) § "What a URL field may hold" — in its link
form: an absolute `http(s)` URL and nothing else, since no map is a path on our
own origin. The value is judged by the URL parser rather than by a pattern, and
stored in the form the parser read (`HTTPS://…` becomes `https://…`, a
non-ASCII file name is percent-encoded). The schema used to be
`z.string().url()`, which is `new URL()` in a try/catch and accepts
`javascript:` and `data:` as readily as `https:` (#694).

`sourceUrl` is the third url a node carries and the only one that becomes a
link, and it reads the same link form of the rule — as do the `sourceUrl` of
`POST /add-child-region` and `POST /rename-region`, which write the same
column during review (#703). What makes it a different class from the map:
a `javascript:` value in an `img src` draws nothing, but in an `href` it runs
on click, in the admin's session. So the page is offered on screen only
through `safeHref` (`frontend/src/utils/safeHref.ts`) — the glyph in the
review tree, the source-page button of the Custom Subregions map view, the
"View source page" button of the CV match review (which opens it with
`window.open`, the one sink React does not guard), an AI Review action's page
link and an extraction question's title — and a page the rule refuses is not
linked at all. An empty `sourceUrl` stays refused, as `z.string().url()`
refused it: the rename route writes what it is given, so `''` would land in
the column as a value rather than as NULL, and no reader means anything by
it — a page is either named or not sent.

Additional limits enforced in the controller:
- **Max 50,000 nodes** — prevents memory exhaustion
- **Max 15 levels deep** — prevents stack overflow
- **50 MB body size limit** — prevents oversized payloads

## Persistent Cache

Wikivoyage API responses are cached to `data/cache/wikivoyage-cache.json` (persistent across server restarts); each successful run also saves a timestamped snapshot (`wikivoyage-cache-<timestamp>.json`) so earlier fetches stay available for reuse. The UI (`WikivoyageSource.tsx`) offers an "API Cache" dropdown listing the active cache plus every snapshot with its date and size, a "Clean fetch (no cache)" entry that deletes the active cache file before starting, and a delete button per snapshot.

## Startup Cleanup

On server start, orphaned `import_runs` with status `running` or `matching` are marked as `failed` (same pattern as sync log cleanup).

## Matching Algorithm

### Country-Level Matching

The matcher identifies countries in the Wikivoyage tree by name-matching against GADM country names, then optionally drills down one level to subdivisions. This approach is simpler and more reliable than the previous leaf-based matching — countries are the natural unit of geographic assignment.

### How It Works

1. **Pre-load GADM data** into memory:
   - `gadmCountries`: Map of normalized country names → GADM division IDs
   - `childrenOf`: Map of parent division ID → child divisions (for subdivision drill-down)
   - Name variants generated for common alternate names (accents, suffixes)

2. **Walk the Wikivoyage tree** recursively. For each node:
   - Try to match the node name against `gadmCountries`
   - If matched and the node has **no Wikivoyage children**: mark as `auto_matched`, assign the GADM country
   - If matched and the node **has children**: try subdivision drill-down (see below)
   - If not matched: treat as a container (continent, sub-region), recurse into children

   **Root-level countries**: GADM stores most countries under continents, but some (e.g., Australia) appear at the root level alongside continents. The matcher detects these by checking whether a root entry's children are countries (making it a continent) or subdivisions (making it a country).

3. **Subdivision drill-down** (all-or-nothing):
   - Get the GADM country's direct children (level-1 subdivisions)
   - Try to match EACH Wikivoyage child to a GADM subdivision using in-memory name matching
   - If ALL children match with high confidence (score >= 700):
     - Mark the country as `children_matched` (no direct assignment)
     - Mark each matched child as `auto_matched` with its GADM subdivision
   - If any child fails to match:
     - Fall back to marking the country itself as `auto_matched` with the GADM country division
     - Children remain unmatched containers

4. **Multi-division countries**: Some countries span multiple continents in GADM (e.g., Spain has divisions under both Europe and Africa). When multiple GADM divisions match a single country name, all are suggested with `needs_review` status. The tree view lists each GADM division with its hierarchy path (e.g., "Europe > Spain" vs "Africa > Spain"), each with map preview, accept, and reject buttons. The admin can accept any combination — accepting one removes it from suggestions and adds it as an assigned division while keeping remaining suggestions visible. Rejecting dismisses a suggestion without assigning it

5. **Unmatched countries**: If a country name doesn't match any GADM country, it's marked as `needs_review` or `no_candidates`

### Scoring

In-memory name matching with normalization:
- **Exact match** (normalized): score 700
- **Variant-to-variant match**: score 650 (e.g., "Bayern" ↔ "Bavaria" via name variants)
- **Prefix match**: score 650 — catches cases where one name is a prefix of the other (e.g., "Ingushetia" ↔ "Ingush", "Kabardino-Balkaria" ↔ "Kabardin-Balkar"). Requires minimum 4 chars and 60% length ratio. For hyphenated names, checks each part independently
- **Subdivision drill-down threshold**: score >= 700 (all children must have exact normalized matches)

Name normalization strips accents, common geographic suffixes (Province, State, Prefecture, Oblast, etc.), and parenthetical annotations from Wikivoyage names.

### Performance

All matching happens in-memory after the initial GADM data load. The country-level approach processes ~200 countries instead of ~3,500 leaves, completing in seconds.

### Editor Integration

When splitting a GADM division into children via the WorldView Editor's "Add Children" dialog:

1. **Existing child regions shown as assignment targets**: If the parent region already has child regions (e.g., from Wikivoyage import), each GADM child row shows a dropdown to assign it to an existing region or create a new one. This lets GADM divisions provide geometry while Wikivoyage regions provide structure.

2. **Pre-assignment detection**: On dialog open, the system fetches members of all existing child regions in parallel. GADM children already belonging to an existing child region are pre-assigned in the dropdown.

3. **Explicit assignments**: The `assignments` parameter (`Array<{ gadmChildId, existingRegionId }>`) lets the backend skip name-matching and assign GADM children directly to specified regions (with world-view ownership verification).

4. **Name-match fallback**: For unassigned GADM children, the system falls back to **case/accent-insensitive matching** (`immutable_unaccent()`). This means GADM's "Bayern" will match an existing Wikivoyage region named "Bavaria" under the same parent.

5. **Custom Subregions dialog pre-populates groups**: When opening the "Create Custom Subregions" dialog (Group button), existing child regions appear as pre-populated target groups with an "existing" badge. Divisions can be dragged or assigned to these groups. On apply, members are moved to the existing region (no new region created). Groups without `existingRegionId` create new regions as before.

6. **Region map overlay**: The Map View tab's image overlay button is highlighted when a Wikivoyage region map URL is available (`regionMapUrl` in metadata). Clicking it opens the Image Overlay Dialog with a "Load Wikivoyage Map" button that fetches the region map from Wikimedia Commons and sets it as the reference image overlay — no manual upload needed. The overlay supports manual adjustment (position, rotation, scale, opacity) and 4-point calibration for precise alignment with GADM division boundaries. Once an image is loaded, a toggle appears next to the image button to switch between **overlay mode** (image rendered on the map behind divisions) and **side-by-side mode** (map on left, zoomable/pannable reference image on right).

7. **Descendant context layer**: The "Group" button (Custom Subregions dialog) is available for any region with direct division members OR child regions. When opened for a region that has children but few/no direct divisions, the map fetches descendant member geometries (recursive walk through all child and grandchild regions) and renders them as a read-only context layer (dashed outline, low-opacity fill). Descendants are color-coded by their root ancestor group — each descendant feature carries a `rootAncestorId` (the direct child region it falls under), which maps to the corresponding subdivision group's `existingRegionId`. Hovering a group chip highlights both its direct members and its descendant divisions on the map. Only direct division members of the selected region are interactive — descendants are visual context only, not assignable or splittable.

8. **Move to parent**: The Map View tab includes a "Move to parent" click tool (arrow-up icon) that moves clicked divisions from the current region to its parent region. An "All to parent" chip button appears next to the Unassigned chip when there are unassigned divisions, moving all of them to the parent in one action. This is useful after splitting and assigning — leftover divisions that don't belong to any subregion can be pushed up to the parent rather than staying unassigned.

### Bidirectional Sync: Editor ↔ Admin Panel

The match review interface (Admin Panel) and the WorldView Editor both modify `region_members`. To keep both interfaces consistent:

**Editor → Admin sync**: When the Editor's member-mutation endpoints (`addDivisionsToRegion`, `removeDivisionsFromRegion`, `moveMemberToRegion`, `addChildDivisionsAsSubregions`, `flattenSubregion`, `expandToSubregions`) modify members, they call `syncImportMatchStatus(regionId)`. This utility:

1. Checks if the region has a `region_import_state` row (no-op for non-imported regions)
2. Counts actual `region_members` for the region
3. Updates `region_import_state.match_status`:
   - Members > 0 → `manual_matched`
   - Members = 0 + has non-rejected suggestions → `needs_review`
   - Members = 0 + no suggestions → `no_candidates`

**Admin → Editor sync**: Already works — `acceptMatch` / `acceptBatchMatches` create `region_members` AND update `region_import_state`.

**Member count visibility**: Both the table view (`WorldViewImportReview`) and tree view (`WorldViewImportTree`) show a "N div" badge next to the status chip when a region has assigned divisions. The Match column shows actual assigned divisions (with map preview for each) instead of the original match suggestions. Expanding a row lists all assigned divisions with individual preview buttons, plus the original suggestions below for reference.

### Per-Region Matching (Two Buttons)

Each unmatched region (`no_candidates` or `needs_review`) has up to five action buttons:

1. **Geocode Match** (pin icon) — geocodes the region name via Nominatim (OpenStreetMap) to get coordinates, then uses `ST_Contains` on GADM geometries to find all divisions containing that point. Returns the full hierarchy (country → state → district) sorted deepest-first. Works even when names don't match at all — as long as Nominatim can locate the place, the spatial query finds the correct GADM division. Adds ancestor context to the search query for geo-disambiguation (e.g., "Kabardino-Balkaria, Russia"). Free, no API key needed, 1 request/second rate limit per Nominatim policy.

2. **DB Search** (magnifying glass icon) — searches GADM divisions using PostgreSQL `pg_trgm` trigram similarity. Returns up to 5 candidates sorted by similarity (threshold > 0.3). Catches name variations like "Ingushetia" ↔ "Ingush", "Kabardino-Balkaria" ↔ "Kabardin-Balkar". Results are added as suggestions for the admin to accept/reject. Fast and free — no external API calls.

3. **AI Match** (sparkle icon) — uses OpenAI (`gpt-4.1-mini`) for intelligent matching.

4. **Geoshape Match** (terrain icon) — fetches the Wikidata geoshape for the region, computes IoU (Intersection over Union) against GADM divisions, and returns the best-covering set of divisions as suggestions. Uses a precision drill-down: if the covering set has low precision (<0.5), each imprecise GADM division is replaced by its children and re-evaluated. GADM descendants of already-assigned divisions are excluded from candidates to avoid double-counting. Requires `wikidataId` on the node (button disabled otherwise). If no geoshape exists in Wikidata, the backend builds a **composite geoshape** from child entities:
   - Fetches P527 (has part) and P361 (part of) children via SPARQL
   - Fetches the Wikivoyage article's `{{regionlist}}` children (resolves article titles → Wikidata QIDs via `action=query&prop=pageprops`)
   - Unions all available child geoshapes into a composite polygon and caches it in `wikidata_geoshapes`
   The geoshape proxy endpoint (`GET /api/admin/wv-import/geoshape/:wikidataId`) checks the local `wikidata_geoshapes` cache (including composites) before calling `maps.wikimedia.org`. Suggestions are automatically accepted/rejected when IoU is high enough (configurable thresholds in `geoshapeCache.ts`).

   **Scope fallback** (ADR-0012): geoshape match searches within the GADM parent that contains the region's geoshape centroid (typically the country-level division). If the centroid falls outside all GADM polygons (island groups, disputed territories), the search returns zero candidates and the backend includes `nextScope: { ancestorId, ancestorName }` in the response. The UI then shows a **"Try wider: `<ancestorName>`"** link inline with the status message. Clicking the link retries the geoshape search with `scopeAncestorId` set to that ancestor (country → continent → world), widening the scope without auto-triggering. The link appears at most 2–3 times before the scope is global.

   **Conflict detection** (ADR-0012): if a covering GADM division is already assigned to a sibling region, the suggestion is annotated with a conflict chip — e.g. **"from Mexico (split Baja California Sur)"** — indicating that accepting this match requires a transfer from that donor region.

5. **Point Match** (scatter plot icon) — fetches Wikivoyage marker coordinates from the region's article (parsing `{{marker}}` and `{{geo}}` templates), then queries GADM using `ST_Contains` to find all divisions containing at least one marker point. Only active when `geoAvailable === false` (no geoshape available). Resolved marker points are stored in `region_import_state.marker_points` (JSONB) for later preview. GADM descendants of already-assigned divisions are excluded from candidates. Supports the same **scope fallback** and **conflict detection** as Geoshape Match.

Geocode Match, DB Search, AI Match, and Point Match never auto-assign — results become suggestions that the admin must accept or reject. Geoshape Match can auto-assign suggestions when the IoU score is high enough (configurable thresholds in `geoshapeCache.ts`). Previously rejected suggestions (`region_match_suggestions` with `rejected = true`) are excluded from results.

### Accept-With-Transfer (ADR-0012)

When a suggestion carries a conflict chip, accepting it is a two-stage flow:

1. **Preview**: clicking Accept (or the map icon) calls `POST /transfer-preview` and opens the Division Preview Dialog in **transfer preview mode** — a full-width three-layer map showing:
   - **Red** — the donor region's full geometry (the sibling that currently owns the division)
   - **Orange** — the moving divisions (what would be transferred)
   - **Dashed blue** — the target region outline (the Wikidata geoshape of the region being matched)

2. **Accept Transfer**: clicking "Accept Transfer" in the dialog calls `POST /accept-with-transfer`. This atomically:
   - `transferType = "direct"`: removes the division from the donor's `region_members`
   - `transferType = "split"`: leaves the GADM parent in the donor; only the listed child divisions move
   - Adds the divisions to the target's `region_members` and sets `match_status = 'manual_matched'`
   - Triggers geometry recomputation for both donor and target via `invalidateRegionGeometry`

If multiple suggestions all have conflicts (e.g. after a wide-scope geoshape match), the **"Accept all N"** button becomes **"Preview transfer (N)"** — opening the same preview dialog for the batch.

### Additional Per-Region Actions

- **Reset Match** (restart icon) — clears all suggestions, rejections, and assigned region_members for a region, resetting it to `no_candidates`. Useful when cached suggestions from a previous search pollute results or when starting fresh after a bad match.

- **Reject Remaining** (red text button) — bulk-rejects all remaining suggestions when a region already has at least one accepted division. Saves clicking reject on each suggestion individually.

### Undo for Destructive Operations

Six tree operations are destructive and support undo — one arm of `dispatchUndo`
(`wvImportHierarchyController.ts`) each:

- **Dismiss children** — deletes all descendant regions and their members, making the parent a leaf
- **Prune to leaves** — deletes every grandchild and deeper, making the direct children leaves
- **Smart flatten** — deletes all descendants and absorbs their divisions into the parent
- **Handle as grouping** — clears the parent's match and re-runs matching on children, overwriting their state
- **Collapse to parent** — clears every descendant's suggestions and members, keeping the regions, and re-searches at the parent
- **Auto-resolve children** — assigns divisions to the children in one pass, overwriting what they held

After any of them succeeds, a **Snackbar** appears at the bottom with an "Undo" button (15-second auto-dismiss, clickaway-resistant). Clicking Undo restores:

- **Operations that deleted regions** (dismiss, prune, smart flatten): re-inserts the deleted regions (parent-first for FK ordering) and restores their `region_import_state`, `region_match_suggestions` and `region_members`; smart flatten also restores the parent's members, which it had absorbed
- **Operations that only rewrote members** (grouping, collapse, auto-resolve): restores each child's original `region_import_state`, suggestions and `region_members`, and the parent's state and members

A restored region arrives with **no geometry**, which is what puts it and every
ancestor of it back into the next run's closure — see
`import-review-tree-ops.md` § *What a tree operation leaves stale* for why that
makes undo self-healing on the first three and not on the last three (#718).

Implementation: **in-memory** undo store (`Map<worldViewId, UndoEntry>`), one entry per world view (last operation only). The snapshot captures all affected table rows before the destructive transaction. After a successful undo or a new destructive operation on the same world view, the previous undo entry is discarded.

### Division Preview Dialog

Clicking the map icon on any suggestion or assigned division opens a preview dialog showing the GADM division polygon on an interactive map. The dialog supports four modes depending on available data:

1. **Region map image** (`regionMapUrl` present, and one `toThumbnailUrl` will draw) — widens to `md`, shows the Wikivoyage region map image on the left and the GADM polygon on the right. ~1,066 regions have static map images.

2. **Wikidata geoshape fallback** (`wikidataId` present, no `regionMapUrl`) — widens to `md`, shows two maps side-by-side:
   - **Left map**: Wikivoyage (Wikidata) geoshape — red fill + outline, labeled "Source region", auto-fit bounds
   - **Right map**: GADM division polygon — blue fill + outline, labeled "GADM division"
   - Geoshape fetched via backend proxy (`GET /api/admin/wv-import/geoshape/:wikidataId`) on dialog open, with spinner while loading
   - The proxy checks `wikidata_geoshapes` cache first (includes composite geoshapes built from child entities), then falls back to `maps.wikimedia.org`
   - ~4,000 regions have Wikidata geoshapes via `{{mapframe}}`/`{{mapshape}}` Kartographer maps
   - Backend proxy needed because `maps.wikimedia.org/geoshape` requires `User-Agent` + `Referer` headers

3. **Marker points fallback** (no `regionMapUrl`, no `wikidataId` or geoshape unavailable, `markerPoints` present) — widens to `md`, shows two maps side-by-side:
   - **Left map**: orange circle markers from Wikivoyage `{{marker}}`/`{{geo}}` templates, labeled "Marker points (N)", framed through `frameGeoJson` with `maxZoom: 8`, so a single marker still shows where it sits (#672)
   - **Right map**: GADM division polygon
   - `markerPoints` are stored in `region_import_state.marker_points` (JSONB) after a Point Match operation and returned with the tree API

4. **GADM only** (none of the above available) — single map, `sm` width, no labels

5. **Transfer preview** (ADR-0012) — triggered when a suggestion has a conflict chip. The dialog receives a `GeoJSON.FeatureCollection` with role-tagged features instead of a plain geometry. It shows a full-width single map with three layers:
   - **Red** (filled + outline) — `role: "donor"` — the donor region's full geometry
   - **Orange** (filled + outline) — `role: "moving"` — divisions that would be transferred
   - **Dashed blue** (line only) — `role: "target_outline"` — the Wikidata geoshape of the region being matched
   A colour legend is shown above the map. The Accept button becomes **"Accept Transfer"**; Reject and Accept-and-reject-rest are hidden in this mode.

This helps the operator visually verify whether a suggested GADM division matches the Wikivoyage region's expected boundaries.

### AI-Assisted Batch Re-matching

The bulk "AI Match" button triggers batch re-matching for all unresolved regions (`needs_review` + `no_candidates`). Sends batches of 25 to OpenAI with the same alternate-names support. For leaf regions, high-confidence AI matches are auto-assigned; medium-confidence get added as top suggestions. Non-leaf regions always get `suggested` status regardless of AI confidence.

Cost: ~$0.05-0.20 for all unresolved leaves in a typical import.

## Wikivoyage Extraction Service

`backend/src/services/wikivoyageExtract/` — TypeScript service that crawls Wikivoyage via MediaWiki API, enriches with Wikidata IDs, then imports and matches via the worldViewImport service.

### Service Architecture

```
backend/src/services/wikivoyageExtract/
├── types.ts              — ExtractionProgress, ExtractionConfig, TreeNode, PageData
├── cache.ts              — File-based JSON cache (atomic write via tmp + rename)
├── fetcher.ts            — WikivoyageFetcher: HTTP + rate limiting + retry + cache
├── parser.ts             — Pure wikitext parsing (Regionlist, map images, bullet links)
├── treeBuilder.ts        — Recursive tree builder using fetcher + parser
├── wikidataEnricher.ts   — Batch Wikidata ID fetch + tree enrichment
└── index.ts              — Service entry: start/status/cancel + full pipeline
```

### Pipeline Phases

1. **Extraction** (`status='extracting'`) — recursive tree build from `en.wikivoyage.org` API. Rate-limited (350ms between requests), cached to disk, retries with exponential backoff
2. **Enrichment** (`status='enriching'`) — batch Wikidata ID fetch (`action=query&prop=pageprops`) in groups of 50 titles, with redirect/normalization chain handling (5-hop). IDs stored as `wikidataId` on each node
3. **Import** (`status='importing'`) — calls `importTree()` directly from `worldViewImport/importer.ts`
4. **Matching** (`status='matching'`) — goes through `runMatchingPolicy(defaultMatchingPolicy('wikivoyage'), …)` from `worldViewImport/index.ts`, like every other path; it does not name a matcher of its own

Progress is forwarded from import/matching phases to the unified `ExtractionProgress` object.

### Wikitext Parsing

All parsing logic is in `parser.ts` as pure functions:

| Function | Purpose |
|----------|---------|
| `findRegionsSection(sections)` | Find "Regions" section index from section list |
| `extractAllWikilinks(text)` | Extract all `[[Target]]` links, skip namespace links |
| `parseRegionlist(wikitext)` | Parse `{{Regionlist}}` → mapImage + regions + extraLinks |
| `extractFileMapImage(wikitext)` | Three-pass map image detection (strong → weak → SVG fallback) |
| `extractImageCandidates(wikitext)` | Collect up to 15 plausible map candidates |
| `parseBulletLinks(wikitext)` | Extract links from `* [[Link]] — desc` format |
| `classifyMultiLink(links, rawText)` | Classify conjunction / possessive / parenthetical patterns |

### Region map extraction

Map URLs are extracted from two sources (in priority order):

1. **`regionmap=` inside `{{Regionlist}}`** — e.g. `|regionmap=Algeria regions map.png`. Converted to `Special:FilePath/` URL.
2. **`[[File:...]]` tags in the Regions section** (fallback) — many pages place the map image outside the template. The parser matches filenames containing `map`, `region`, `district`, or `province` keywords, while skipping flags, coats of arms, banners, locator maps, and logos.

### Map image candidates

Auto-detecting the correct map image from `[[File:...]]` tags is error-prone (false positives from photos, false negatives from missed maps). To solve this, the parser collects **all plausible image candidates** (up to 15 per region) alongside the best-guess `regionMapUrl`.

`extractImageCandidates()` applies only a minimal hard-skip list (`flag`, `coat`, `seal`, `emblem`, `logo`, `icon`, `banner`, `wikivoyage`) — much broader than the map detection algorithm. Candidates are collected from the Regions section first, then merged with full-page candidates (deduplicated).

The admin reviews candidates via a **picker dialog** in the match review tree:
- **Image button** (camera icon) appears on tree rows with more than one candidate
- **Warning color** when unreviewed, **success color** after admin confirmation
- **Preview interception** — clicking a division preview on an unreviewed region opens the picker first
- **Picker dialog** shows a 3-column thumbnail grid; admin selects the correct map or marks "none are maps". Each candidate is drawn through `toThumbnailUrl` (`frontend/src/utils/imageUrl.ts`), like every other stored picture, and a candidate it refuses is not offered at all: anything but an absolute http(s) url on a Commons host, a file on `upload.wikimedia.org` outside `/wikipedia/commons/`, a url that does not name a picture file — which the parser can produce, since `extractFileNames` keeps any format and a `[[File:Map of X.pdf]]` is built into a Commons url like any other — or the `/wiki/File:` page *about* a file, which ends the way a picture ends and answers HTML, and which is exactly what pasting from Commons' address bar into `regionMapUrl` or `mapImageCandidates` produces (the format doc's example uses the `Special:FilePath` form for that reason) (ADR-0043). A picture no `<img>` may draw is not a map to choose. The same function sizes the map in every dialog that shows it beside a division (`?width=500`, which is what those dialogs used to append by hand), and `extractImageUrl` judges it, unsized, for the editor's image overlay (#694)
- Selection saves `region_import_state.region_map_url` and sets `map_image_reviewed = true`
- "None are maps" clears `regionMapUrl` and marks reviewed

API: `POST /api/admin/wv-import/matches/:worldViewId/select-map-image` with `{ regionId, imageUrl }`. `imageUrl` is held to the absolute-http(s) rule and then compared, as sent, against the candidates list — judged but not rewritten, because a candidate stored before the rule may carry a non-ASCII file name that normalising would percent-encode, and a pick names a row in that row's own spelling.

### Link validation and missing pages

Wikivoyage `{{Regionlist}}` templates sometimes list sub-regions that don't have their own articles. This happens in three ways:

1. **Plain text names** (no `[[wikilink]]`) — the editor didn't create a link because no article exists. Example: `regionNname=Santa Luzia` (uninhabited island). These become **grouping nodes** if they have `regionNitems`, otherwise they're dropped.
2. **Multi-link names** (multiple `[[wikilinks]]`) — classified by pattern:
   - **Conjunctions** (`[[France]] and [[Monaco]]`, `[[A]], [[B]]`, `[[A]] / [[B]]`) — grouping nodes whose children are the linked pages
   - **Possessive** (`[[Russia]]'s [[North Caucasus]]`) — single link to the last page (qualifier is context only)
   - **Parenthetical** (`[[Falster]] ([[Gedser]], ...)`, `[[Apulia]] ([[Italian]]: Puglia)`) — single link to the first page (parenthetical links are context/cities, not sub-regions)
3. **Red links** (`[[wikilink]]` to a non-existent page) — the editor intended to create an article but hasn't yet. These are **individually skipped** at build time when `build_tree()` returns `"missing"`.

The script handles each type independently: grouping nodes are always processed (their children are the linked items), and red links are individually dropped without affecting valid siblings. This means a Regionlist with 10 entries where 2 are red links will produce 8 children, not 0.

After filtering, the tree contains ~5,800 regions (including duplicates from multi-parent regions like Caucasus, Egypt, Russia appearing under multiple continents). Countries with partial coverage (some subregions lacking Wikivoyage articles) can be simplified in the match review UI using the "Dismiss subregions" button.

### Multi-parent regions

Some regions belong to multiple continents on Wikivoyage (e.g. Caucasus under both Asia and Europe, Egypt under Africa and Middle East, Russia under Asia and Europe). The script uses **per-branch ancestor tracking** instead of a global visited set, so the same page can appear with its full subtree under multiple parents. Cycles are still prevented — if a page appears in its own ancestor chain, it's treated as a self-referencing leaf.

After import, each instance is a separate region in the database. Match decisions can be reviewed independently. A **"Sync to other instances"** button (sync icon) appears on matched regions that exist in multiple places. Clicking it copies the `region_import_state`, `region_match_suggestions`, and `region_members` from the source to all other instances sharing the same `source_url`. The button is **grayed out** (with tooltip "Already in sync") when all instances of a URL already share the same match_status and the same set of assigned division IDs.

### Self-referencing regions

Some Wikivoyage pages list themselves as sub-regions (e.g. Moldova lists "Moldova" + "Transnistria"). Others redirect to the parent (e.g. "Coastal Eritrea" → Eritrea). The script detects both patterns and includes these as leaf nodes representing "the rest of" the parent territory.

### AI Extraction Interview

When the extraction AI is uncertain about a page (e.g. ambiguous region/city distinction, low subregion page coverage), the page is queued for an admin interview. The interview AI (`backend/src/services/wikivoyageExtract/aiInterviewer.ts`) reads existing learned rules, formulates **one** structured question with 2–4 clickable options plus "Other", and surfaces a recommendation. Two outcomes per page:

1. **Generic rule (soft, global)** — `processAnswer` produces a sentence-long rule when the answer generalizes ("Cities should always be leaf nodes"). Rules dedupe against existing ones via the interview AI's prompt: contradicting answers supersede the older rule, aligned answers produce no new rule. Rules inform future recommendations but never bypass the admin.
2. **Page is final** — `applyAnswerResult` in `wikivoyageExtractController.ts` re-extracts the page once with the admin's answer injected as `adminFeedback`, then marks the question resolved unconditionally. Even if the re-extraction surfaces fresh uncertainties about the same page, the admin is **not** asked again. This prevents the "same question in different words on every retry" loop.

The endpoint is `POST /api/admin/wv-extract/answer` with `{ questionId, action: 'answer' | 'accept' | 'skip' | 'delete_rule', answer?, ruleId? }`. `delete_rule` (with `ruleId` required) re-formulates the current question after removing a rule the admin disagrees with.


## API Endpoints

### Wikivoyage Extraction (`/api/admin/wv-extract/`)

All require admin auth.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/start` | Start Wikivoyage extraction + import pipeline |
| GET | `/status` | Poll extraction progress (includes importedWorldViews) |
| POST | `/cancel` | Cancel running extraction |

### WorldView Import (`/api/admin/wv-import/`)

All require admin auth.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/import` | Start import from JSON body |
| POST | `/base-layer` | Start import from the administrative base layer (body: `{ name, providerLabel, maxDepth }`) |
| GET | `/import/status` | Poll progress (shared by every source, including base layer) |
| POST | `/import/cancel` | Cancel running import |
| GET | `/matches/:worldViewId/stats` | Match statistics |
| GET | `/matches/:worldViewId/tree` | Full hierarchical tree with match statuses |
| POST | `/matches/:worldViewId/accept` | Accept one suggestion (additive — keeps remaining) |
| POST | `/matches/:worldViewId/reject` | Dismiss one suggestion |
| POST | `/matches/:worldViewId/accept-batch` | Accept batch of matches |
| POST | `/matches/:worldViewId/ai-match` | Start AI-assisted re-matching (batch) |
| GET | `/matches/:worldViewId/ai-match/status` | AI matching progress |
| POST | `/matches/:worldViewId/ai-match/cancel` | Cancel AI matching |
| POST | `/matches/:worldViewId/geocode-match` | Geocode name via Nominatim, find containing GADM division |
| POST | `/matches/:worldViewId/geoshape-match` | Fetch Wikidata geoshape (or build composite), IoU-score GADM divisions |
| POST | `/matches/:worldViewId/point-match` | Parse Wikivoyage marker coords, find containing GADM divisions |
| POST | `/matches/:worldViewId/db-search-one` | DB trigram search for a single region |
| POST | `/matches/:worldViewId/ai-match-one` | AI-match a single region (synchronous) |
| POST | `/matches/:worldViewId/handle-as-grouping` | Drill into children — match them independently against GADM |
| POST | `/matches/:worldViewId/dismiss-children` | Delete child regions, make parent a leaf |
| POST | `/matches/:worldViewId/undo` | Undo the last undoable tree operation — one of the six in § Undo for Destructive Operations (in-memory, last only) |
| POST | `/matches/:worldViewId/sync-instances` | Copy match decisions to other instances of same region |
| POST | `/matches/:worldViewId/reject-remaining` | Bulk-reject all remaining suggestions for a region |
| POST | `/matches/:worldViewId/select-map-image` | Select map image from candidates for a region |
| POST | `/matches/:worldViewId/reset-match` | Clear all match data (suggestions, rejections, members) for a region |
| GET | `/matches/:worldViewId/coverage` | Check GADM coverage — find gap boundaries at every level, with region hints |
| GET | `/matches/:worldViewId/coverage-stream` | SSE streaming version — streams progress through gap finding, sibling match, and ancestor walk |
| POST | `/matches/:worldViewId/geo-suggest-gap` | Geographic suggestion — boundary KNN finds nearest assigned region, returns suggestion + nested context tree (ancestors + children of suggested region) for hierarchy selection (body: `{ divisionId }`) |
| POST | `/matches/:worldViewId/dismiss-gap` | Dismiss a GADM division from coverage checks (body: `{ divisionId }`) |
| POST | `/matches/:worldViewId/undismiss-gap` | Restore a dismissed GADM division to active gaps (body: `{ divisionId }`) |
| POST | `/matches/:worldViewId/approve-coverage` | Approve coverage suggestion — add member or create new region (body: `{ divisionId, regionId, action, gapName? }`) |
| POST | `/matches/:worldViewId/accept-with-transfer` | Atomically transfer conflicting division from donor to target, accept match (ADR-0012) |
| POST | `/matches/:worldViewId/transfer-preview` | Build 3-layer FeatureCollection (donor/moving/target_outline) for conflict preview (ADR-0012) |
| POST | `/matches/:worldViewId/finalize` | Close review — appends `'_done'` to current `source_type` |
| POST | `/matches/:worldViewId/rematch` | **Destructive**: delete every `region_members` row for the world view (manual matches included) and re-run the matcher under the world view's policy. Optional `matchingPolicy` in the body scores the same tree under another. Rate-limited (5/min) — it is long-running and each run destroys the previous one's output |
| GET | `/matches/:worldViewId/rematch/status` | Poll re-match progress |
| POST | `/matches/:worldViewId/add-child-region` | Create a new child region under a parent (sets `match_status = 'no_candidates'`) |
| POST | `/matches/:worldViewId/remove-region` | Delete a region from the import tree (with optional child/division reparenting) |
| POST | `/matches/:worldViewId/rename-region` | Rename a region and optionally update its source URL / external ID |
| POST | `/matches/:worldViewId/ai-suggest-children` | AI audit + enrichment + verification — returns `ReviewChildAction[]` |
| GET | `/geoshape/:wikidataId` | Proxy Wikidata geoshape GeoJSON (validated `Q\d+`) |

## Backend Structure

```
backend/src/services/wikivoyageExtract/
├── types.ts              — ExtractionProgress, ExtractionConfig, TreeNode, PageData
├── cache.ts              — File-based JSON cache (atomic write)
├── fetcher.ts            — WikivoyageFetcher: HTTP + rate limiting + retry + cache
├── parser.ts             — Pure wikitext parsing (Regionlist, map images, bullet links)
├── treeBuilder.ts        — Recursive tree builder using fetcher + parser
├── wikidataEnricher.ts   — Batch Wikidata ID fetch + tree enrichment
└── index.ts              — Service entry: start/status/cancel + full pipeline

backend/src/services/worldViewImport/
├── types.ts              — Type definitions (ImportTreeNode, ImportProgress, RegionImportState, etc.)
├── sourceTypes.ts        — Source type registry (open + `_done` finalized name per type); review, finalize and rematch endpoints resolve source types through here instead of an inline allowlist
├── importer.ts           — JSON tree → WorldView + regions
├── baseLayerImporter.ts  — administrative_divisions → import tree, names and hierarchy only, for the base layer source
├── matcher.ts            — Policy barrel naming the public matchers
├── matcherUtils.ts       — Shared core: name normalization, GADM load, scoring
├── matcherCountryPolicy.ts      — `country-based`: anchors on country names
├── matcherHierarchicalPolicy.ts — `hierarchical`: descends the division tree
├── matcherLeafPolicy.ts  — legacy leaf matcher, not reached from the pipeline
├── aiMatcher.ts          — AI-assisted re-matching via OpenAI
├── geoshapeCache.ts      — Wikidata geoshape fetch, cache, IoU scoring, covering-set matching with precision drill-down and composite fallback
├── pointMatcher.ts       — Wikivoyage marker coord extraction → GADM ST_Contains matching, stores marker_points in region_import_state
└── index.ts              — Exports, in-memory progress management

backend/src/services/wikivoyageExtract/
├── markerParser.ts   — Pure parser for {{marker}} and {{geo}} Wikivoyage wikitext templates

backend/src/controllers/admin/wikivoyageExtractController.ts — Extraction endpoints
backend/src/controllers/admin/worldViewImportController.ts   — Import + match review endpoints
backend/src/controllers/admin/baseLayerImportController.ts   — Base layer import start endpoint
```

## Frontend

Admin panel section "WorldView Import" (`WorldViewImportPanel.tsx`) with these views:

1. **Source selection** (`ImportSourcePanel.tsx`) — one source selector (Wikivoyage, JSON file, administrative base layer) plus a shared WorldView name field; only the selected source's form is mounted. See "Import Sources" in `docs/tech/world-views.md` for the source registry. The Wikivoyage form runs the full extraction → enrichment → import → matching pipeline, with multi-phase progress UI (extraction counts, API requests/cache hits, import progress, matching progress) and an "API Cache" dropdown (active cache plus snapshots with date/size, or a "Clean fetch (no cache)" entry) to reuse a previous fetch or force a clean one. The JSON file form has a matching policy dropdown (country-based or none). The base layer form has a provider label field and a depth selector (1-3, default 2); it matches under the `hierarchical` policy, which its source type selects
2. **Existing WorldViews** — if imported world views exist in DB, shows a source type badge (`wikivoyage`, `imported`, or `base_layer` — always the bare form: the chip strips any `_done` suffix via `.replace('_done', '')`, even after finalize, though the stored `world_views.source_type` column itself does gain that suffix, e.g. `wikivoyage_done`), a "Review Matches" button for active reviews, and a separate "Review complete" badge that carries the finalized signal instead (persists across sessions/relogins)
3. **Match review** (`WorldViewImportReview.tsx`) — two view modes:
   - **Table view** — filterable/paginated table, accept/reject suggestions, map preview per suggestion
   - **Tree view** (`WikivoyageMatchTree.tsx`) — clean hierarchical tree with role-based rendering: containers (continents, sub-regions) show "X/Y matched" summary, countries show status chips with GADM names. Unmatched countries (`no_candidates`) have a per-region AI match button that sends the single region to OpenAI for identification. Matched countries with children have a **"Match children independently"** button (tree icon) that drills down — clears the parent's own match, marks it `children_matched`, and runs country-level matching on each child independently (works for subcontinents, large countries like USA, etc.). `children_matched` regions display as regular "matched" in the UI. Expand/collapse all controls for quick navigation. **"Show N Gaps to Review"** button appears in the toolbar when shadow insertions from the coverage dialog are pending — expands the tree directly to regions that have pending shadow entries and scrolls to the first one, so the admin can quickly find and approve/reject them without manually searching. **Shadow-applied state sync**: when the coverage dialog is closed and shadows are accepted or rejected in the match tree, the coverage dialog's grayed-out (applied) state automatically syncs — accepted gaps disappear from the list, rejected gaps reappear as active
   - **Re-match All** button — opens a plain confirmation dialog warning that all match assignments, suggestions and rejections will be lost; it offers no policy choice. On confirm, clears all `region_match_suggestions`, resets `region_import_state.match_status`, deletes `region_members` (manual matches included), then re-runs the matcher under the policy the world view's source type implies. An explicit `matchingPolicy` in the request body overrides that, which is how one tree is scored under two policies — the UI does not send one. Useful after matcher improvements. Runs in background with progress polling, rate-limited to 5/min
   - **Check Coverage** button — opens a dedicated `CoverageResolveDialog` (`maxWidth="lg"`, side-by-side layout) for resolving GADM coverage gaps. Runs a deep GADM coverage check using recursive walks both UP (ancestor chain) and DOWN (descendants of assigned divisions). Finds "gap boundaries" at every level — uncovered divisions whose parent has partial coverage. For example, if USA has most states assigned but Texas is missing, Texas appears as a gap under "United States." Available once all `needs_review` and blocking `no_candidates` are resolved. **Layout**: left panel (~55%) shows an interactive gap tree grouped by parent with expand/collapse; right panel (~45%) shows an inline map preview with gap geometry (red), suggestion geometry (blue), distance circles, and suggestion details. **Per-node actions**: every tree node — top-level gaps, intermediate GADM divisions, and leaf divisions — has individual action buttons: map preview (shows geometry in right panel), geo-suggest (find nearest assigned region by geographic proximity), and dismiss (top-level gaps only). Subtree nodes from the `subtree` field are rendered as expandable children with their own preview and geo-suggest buttons, so the admin can drill into abstract entries like "Antarctica → Australia" and suggest at the leaf level (e.g., "Heard Island → Add to Australia"). **Tree-based suggestions**: pre-computed using pure integer joins on the GADM `parent_id` tree — no geometry queries. Step 1 (sibling match): finds gaps whose GADM siblings are directly assigned to regions → suggests "add to existing region." Step 2 (ancestor walk): for remaining gaps without direct siblings, walks UP the GADM tree to find the nearest assigned cousin → suggests "create new region" under the cousin's parent region. Both steps complete in milliseconds. Suggestions appear as inline chips below each node. **Geo-suggest**: triggers a per-gap geographic lookup using boundary-based KNN search. The gap's centroid is compared against assigned divisions using `geom <->` (GiST bounding-box proximity), which correctly finds large regions whose boundary is close but centroid is far (e.g., Antarctica for Heard Island). Returns the nearest assigned region with distance (gap centroid to nearest polygon boundary edge). Also returns a **context tree** — a nested hierarchy from the root down to the suggested region, with the suggested region's children attached. This lets the admin pick not just an ancestor but also a more specific child (e.g., for "Heard Island → Antarctica," the tree shows World → Oceania → **Antarctica** → South Ocean Islands / Antarctic Peninsula). The right panel renders this as a compact mini-tree with indentation; clicking any node selects it as the target region. Every division with geometry carries `anchor_point`, written by `update_division_focus_data()` from `geometry_focus()` (#674); the KNN `COALESCE`s to a centroid for anything without one. Useful for isolated territories and overseas departments where tree-based suggestions are wrong (e.g., Clipperton Island, BIOT). Updates the suggestion in-place and shows the result on the inline map (gap + suggestion + distance circle). **Manual region search**: a "Choose region manually..." link always appears below the suggestion area in the right panel. Clicking it reveals an Autocomplete that searches all regions in the world view via `searchRegions()`. Selecting a region writes a manual override into `selectedTargets`, which takes highest priority in `getNodeSuggestion` — even when there's no geo-suggest result. The override appears as a "Manual: X" chip with a clear button. This is useful when the geo-suggest is wrong or when there are no suggestions at all. **Per-gap apply**: each gap row (both top-level gaps and subtree nodes) shows a green checkmark button when it has an effective suggestion (from tree-based, geo-suggest, or manual search). Clicking it immediately sends that single gap as a shadow insertion to the match tree — the row then grays out (opacity 0.45), hides its action buttons and suggestion chip, and collapses any subtree children. An undo button (↩) replaces the action buttons to restore the row. Applied gaps are excluded from the global "Apply N to tree" count and bulk action. The global button still works for unapplied gaps. **Shadow insertions**: clicking "Apply to tree" creates ghost entries in the match tree — each gap appears as a semi-transparent dashed-border row under the suggested region. `add_member` shadows appear below the region's assigned divisions; `create_region` shadows appear as synthetic child nodes. Each shadow has approve (green check) and reject (red X) buttons. Approving creates the region_member (or new region + member), auto-dismisses the gap, and removes all shadows for that gap. Dismissed gaps are stored in `world_views.dismissed_coverage_ids`, persist across sessions, and reset on re-match. A collapsible "N dismissed" section below the active gaps allows undismissing. Coverage passes when active gaps = 0 (dismissed don't count). Coverage data resets when match assignments change. **SSE streaming**: the coverage check uses Server-Sent Events to stream real-time progress through three phases — (1) finding coverage gaps via recursive CTE, (2) batch sibling match, and (3) ancestor walk for remaining gaps. The dialog shows step text, elapsed time, and a progress bar
   - **Close Review** button — finalizes the match review, appending `'_done'` to the current `source_type` (e.g., `'wikivoyage'` → `'wikivoyage_done'`, `'imported'` → `'imported_done'`, `'base_layer'` → `'base_layer_done'`). Requires both: (1) no blocking match issues and (2) a passing coverage check (0 active uncovered GADM divisions — dismissed don't count). Backend also validates — returns 400 if unmatched regions exist. The world view remains fully editable from the WorldView Editor but no longer appears in the active review list

## Usage

### Wikivoyage

1. Open Admin Panel → WorldView Import — "Wikivoyage" is the default source
2. Confirm or edit the WorldView name (default: "Wikivoyage Regions")
3. Optionally choose a cache from the "API Cache" dropdown — defaults to the latest cache when one exists, or select "Clean fetch (no cache)" to force a fresh fetch
4. Click "Fetch from Wikivoyage" — the extraction pipeline runs automatically (20-40 min). Always uses country-based matching
5. After all phases complete, click "Review Matches"
6. Accept auto-matches in bulk, review suggestions individually
7. Open the WorldView in WorldViewEditor for geometry work

### JSON File Upload

1. Open Admin Panel → WorldView Import, select "JSON file" from the source selector
2. Enter a WorldView name and upload a JSON file with the expected tree format (validated against recursive Zod schema, max 50K nodes, 15 levels deep)
3. Select matching policy: "Country-based" (default) or "None" (skip auto-matching)
4. Click "Start Import"
5. Continue with match review as above

### Administrative Base Layer

1. Open Admin Panel → WorldView Import, select "Administrative base layer" from the source selector
2. Enter a WorldView name (default: "Administrative"), a provider label (names the dataset currently loaded), and a depth (1-3, default 2) — see "Base Layer Import" in `docs/tech/world-views.md` for what depth controls and the measured match outcome
3. Click "Import base layer" — matches under the `hierarchical` policy (ADR-0019), which resolved all 3831 regions of a depth-2 mirror
4. Continue with match review as above

## AI Review Children

The **AI Review Children** feature lets an admin audit the current child set of any region against its live Wikivoyage article. It is available on tree rows where `region_import_state.source_url` is set. A sparkle icon button triggers the flow; the button is disabled while another region is being reviewed.

### Three-Phase Pipeline

The backend handler `aiSuggestChildren` (`wvImportAIController.ts`) runs three sequential phases:

1. **AI Audit** — fetches the region's Wikivoyage article wikitext via `WikivoyageFetcher`, extracts the "Regions" section, and sends it to OpenAI together with the list of current child region names. The AI returns a JSON array of `AuditAction` objects:
   - `type: 'add'` — child present in Wikivoyage but missing from the tree
   - `type: 'remove'` — child in the tree that no longer appears in the article
   - `type: 'rename'` — child whose name in the article differs from the stored name

   The model is selected via `getModel()` with the `review_children` feature key.

2. **AI Enrichment** — for `add` and `rename` actions, a second AI call resolves each target into a canonical Wikivoyage page title and a Wikidata QID. The AI is given the article wikitext as context and asked to produce `{ name, wikivoyageTitle, wikidataId }` for each target.

3. **Programmatic Verification** — the enriched Wikivoyage titles are verified in parallel batches via the MediaWiki `action=query&prop=info` API. Each action is marked `verified: true` if the page exists and `verified: false` otherwise.

The response shape is:

```typescript
interface ReviewChildAction {
  type: 'add' | 'remove' | 'rename';
  name: string;        // current tree name (or add target name)
  newName?: string;    // only for 'rename'
  reason: string;      // AI-provided reasoning
  sourceUrl?: string | null;   // verified Wikivoyage URL (add/rename only)
  sourceExternalId?: string | null;  // Wikidata QID (add/rename only)
  verified: boolean;   // whether the Wikivoyage page was confirmed to exist
}

interface AIReviewChildrenResult {
  actions: ReviewChildAction[];
  tokensUsed: number;
}
```

### Frontend Dialog

`WorldViewImportTree.tsx` shows the results in a grouped dialog (`AIReviewChildrenDialog`):

- **Add** section — actions pre-selected by default. Each row shows the new region name, a reason chip, and (if verified) a source URL link with a check icon.
- **Remove** section — actions **not** pre-selected (destructive). Each row shows the existing region name and a reason chip. Unverified remove actions show a warning.
- **Rename** section — actions pre-selected by default. Each row shows "old name → new name", a reason chip, and an optional source URL link.

The admin checks/unchecks individual actions, then clicks **Apply**. The dialog calls the matching REST endpoints (`add-child-region`, `remove-region`, `rename-region`) using `Promise.allSettled` for all selected actions, then invalidates the tree query once for a single refresh.

### Supporting Endpoints

Three new endpoints support the dialog's apply phase:

| Endpoint | Body | Effect |
|----------|------|--------|
| `POST /add-child-region` | `{ parentRegionId, name, sourceUrl?, sourceExternalId? }` | Creates region + `region_import_state` (`no_candidates`) |
| `POST /remove-region` | `{ regionId, reparentChildren, reparentDivisions? }` | Deletes region; optionally reparents children/members to grandparent |
| `POST /rename-region` | `{ regionId, name, sourceUrl?, sourceExternalId? }` | Updates region name and import state metadata |

All three are validated with Zod schemas (`wvImportAddChildSchema`, `wvImportRemoveRegionSchema`, `wvImportRenameRegionSchema`) and require admin auth.

## Manual Cluster Paint Editor

When CV auto-clustering produces incorrect division assignments, admins can switch to a
vector-border paint editor to manually reassign pixels to clusters (ADR-0013, ADR-0014).

### Entry Modes

From the cluster review step in the CV pipeline (wired in Chain D):
- **Fix mode** ("Edit manually") — loads the CV-detected cluster overlay as a starting point.
- **Scratch mode** ("Draw from scratch") — blank canvas over the source map image.

### Architecture

Three-layer stack:
- **Background image** (Layer 1): source or original map image (non-editable). Toggle
  between "processed" (quantized/mean-shift) and "original" with the Background control.
- **SVG border overlay** (Layer 2): vector paths extracted from the cluster label map via
  OpenCV `findContours` (backend), rendered as smooth `<path>` elements (Catmull-Rom →
  cubic Bezier). The eraser tool splits these paths; the line tool draws new polylines.
  Internal borders render blue; external (cluster-to-background) render red. Open endpoints
  are shown as orange circles for snapping.
- **Color canvas** (Layer 3): holds cluster color fills only. Flood fill rasterizes the
  SVG paths on demand to an off-screen canvas, then runs boundary-aware flood fill.

Border opacity slider (0–100%) controls SVG layer visibility.

### Tools

| Tool | Key | Behaviour |
|------|-----|-----------|
| Paint bucket | F | Rasterizes SVG borders, then flood fills from that boundary image |
| Eraser | E | Drag over SVG paths to split them at the hit segment |
| Line | L | Click vertices to draw polyline; snaps to open endpoints; Enter = open polyline, click near start = closed polygon |

### Data Flow on Submit

1. Frontend reads the color canvas as PNG data URL.
2. Sends `{ type: 'manual_clusters', overlayPng, palette }` to `POST /api/admin/wv-import/cluster-review/:reviewId`.
3. Backend (`wvImportMatchReview.ts`) passes to the pipeline via `resolveClusterReview()`.
4. Pipeline decodes the PNG with sharp, maps pixel colors to cluster labels using
   nearest-color matching, replaces `pixelLabels` and `colorCentroids`.
5. Pipeline resumes at ICP alignment + division assignment — completely transparent to
   downstream code.

### Key Files

| File | Role |
|------|------|
| `ClusterPaintEditor.tsx` | SVG border overlay + color canvas; fill/eraser/line tools, undo/redo, zoom/pan |
| `clusterPaintUtils.ts` | Flood fill (border-aware), overlay↔pixelLabels conversion, color helpers |
| `svgBorderUtils.ts` | Catmull-Rom path smoothing, endpoint detection, rasterization for fill, eraser hit detection |
| `wvImportMatchBorderTrace.ts` | OpenCV findContours border extraction, Douglas-Peucker simplification |
| `wvImportMatchReview.ts` | `ManualClusterDecision` type, `ClusterReviewResponse` union, overlay image store |
| `adminWorldViewImport.ts` (frontend API) | `BorderPath`, `ManualClusterResponse`, `ClusterReviewCluster`, `clusterOverlayUrl()` |

Zod validation schemas: `wvImportClusterReviewBodySchema`, `wvImportClusterHighlightParamSchema` in `backend/src/types/index.ts`.

## Future Enhancements

- Auto-trigger geometry computation after matching
- Incremental updates (re-import without losing manual matches)
- Smarter matching via Wikidata IDs and spatial proximity
