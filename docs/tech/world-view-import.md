# WorldView Import

Import a source-agnostic region hierarchy into a WorldView with automatic GADM division matching.

## Overview

The WorldView import feature lets admins create a WorldView from an external region hierarchy. The primary import source is English Wikivoyage — the admin clicks "Fetch from Wikivoyage" in the admin panel, and a TypeScript backend service (`backend/src/services/wikivoyageExtract/`) crawls the MediaWiki API to build a region hierarchy (~4,500 regions). Alternatively, admins can upload a pre-generated JSON file. The system:

1. Creates a WorldView with all regions (hierarchical)
2. Matches countries to GADM administrative divisions (with optional subdivision drill-down)
3. Provides a match review interface for manual corrections

## Architecture

### Data Flow

```
Option A: "Fetch from Wikivoyage" button
  → wikivoyageExtract service (TypeScript)
    → Phase 1: Extract tree from Wikivoyage API (status='extracting')
    → Phase 2: Enrich with Wikidata IDs (status='enriching')
    → Phase 3: Import into WorldView (status='importing') — calls importTree() directly
    → Phase 4: Match countries to GADM (status='matching') — calls matchCountryLevel() directly
    → Complete → "Review Matches" button

Option B: JSON file upload (for non-Wikivoyage sources)
  → Admin Upload → worldViewImport service
    → import_runs + WorldView + Regions + region_import_state
    → Matcher → region_members (auto-assigned)
             → region_match_suggestions (for review)
```

### Database Tables

Import state is stored in dedicated relational tables (not JSONB):

- **`import_runs`** — tracks each import operation (world_view_id, source_type, status, data_path, stats, timestamps)
- **`region_import_state`** — 1:1 with region (region_id PK, import_run_id, source_url, source_external_id, match_status, needs_manual_fix, fix_note, region_map_url, map_image_reviewed)
- **`region_match_suggestions`** — 1:N per region (division_id, name, path, score, rejected flag)
- **`region_map_images`** — 1:N per region (image_url candidates)
- **`world_views.source_type`** (VARCHAR) — `'manual'` (default), `'wikivoyage'`/`'imported'` (import in review), or `'wikivoyage_done'`/`'imported_done'` (review finalized)
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
| `country-based` | Walks the tree looking for country names, matches to GADM, optionally drills into subdivisions | Wikivoyage imports, geographic hierarchies |
| `none` | Skips auto-matching entirely; all regions start as `no_candidates` | Non-geographic hierarchies, manual curation |

Wikivoyage extractions always use `country-based`. File uploads default to `country-based` but can be changed via a dropdown in the upload UI.

## JSON Tree Validation

Uploaded JSON trees are validated with a recursive Zod schema:

```typescript
{
  name: string,          // 1-500 chars
  regionMapUrl?: string, // valid URL, max 2000 chars
  mapImageCandidates?: string[], // max 20 URLs
  wikidataId?: string,   // Q-ID format (Q\d+)
  children: TreeNode[]   // recursive, default []
}
```

Additional limits enforced in the controller:
- **Max 50,000 nodes** — prevents memory exhaustion
- **Max 15 levels deep** — prevents stack overflow
- **50 MB body size limit** — prevents oversized payloads

## Persistent Cache

Wikivoyage API responses are cached to `data/cache/wikivoyage-cache.json` (persistent across server restarts). The UI shows a "Use cached data" checkbox with cache file info (size, last modified). Unchecking triggers a clean fetch that deletes the cache before starting.

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
   - If ALL children match with high confidence (score >= 650):
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

Each unmatched region (`no_candidates` or `needs_review`) has three action buttons:

1. **Geocode Match** (pin icon) — geocodes the region name via Nominatim (OpenStreetMap) to get coordinates, then uses `ST_Contains` on GADM geometries to find all divisions containing that point. Returns the full hierarchy (country → state → district) sorted deepest-first. Works even when names don't match at all — as long as Nominatim can locate the place, the spatial query finds the correct GADM division. Adds ancestor context to the search query for geo-disambiguation (e.g., "Kabardino-Balkaria, Russia"). Free, no API key needed, 1 request/second rate limit per Nominatim policy.

2. **DB Search** (magnifying glass icon) — searches GADM divisions using PostgreSQL `pg_trgm` trigram similarity. Returns up to 5 candidates sorted by similarity (threshold > 0.3). Catches name variations like "Ingushetia" ↔ "Ingush", "Kabardino-Balkaria" ↔ "Kabardin-Balkar". Results are added as suggestions for the admin to accept/reject. Fast and free — no external API calls.

3. **AI Match** (sparkle icon) — uses OpenAI (`gpt-4.1-mini`) for intelligent matching. Includes any existing suggestions (including DB search results) as context. The AI can identify correct GADM names even for disputed territories, name changes, and regions with completely different administrative names (e.g., "South Ossetia" → "Shida Kartli"). Supports **multi-division regions** via `additionalDivisions` — when a Wikivoyage region spans multiple GADM divisions (e.g., "Donbas" → Donetsk + Luhansk oblasts), each is returned as a separate suggestion the admin can accept independently (like Portugal's European + African parts). Name lookup strips geographic suffixes (Oblast, Province, Region, etc.) and apostrophes for matching, and prefers higher-level divisions when names are ambiguous. Includes low-confidence results for per-region matching (user reviews all). When OpenAI is not configured, the AI button is hidden.

All three buttons never auto-assign — all results become suggestions that the admin must accept or reject. Previously rejected suggestions (`region_match_suggestions` with `rejected = true`) are excluded from results.

### Additional Per-Region Actions

- **Reset Match** (restart icon) — clears all suggestions, rejections, and assigned region_members for a region, resetting it to `no_candidates`. Useful when cached suggestions from a previous search pollute results or when starting fresh after a bad match.

- **Reject Remaining** (red text button) — bulk-rejects all remaining suggestions when a region already has at least one accepted division. Saves clicking reject on each suggestion individually.

### Undo for Destructive Operations

Two tree operations are destructive and support undo:

- **Dismiss children** — deletes all descendant regions and their members, making the parent a leaf
- **Handle as grouping** — clears the parent's match and re-runs matching on children, overwriting their state

After either operation succeeds, a **Snackbar** appears at the bottom with an "Undo" button (15-second auto-dismiss, clickaway-resistant). Clicking Undo restores:

- **Dismiss undo**: re-inserts all deleted descendant regions (parent-first for FK ordering), restores their `region_import_state`, `region_match_suggestions`, and `region_members`
- **Grouping undo**: restores each child's original `region_import_state`, suggestions, and `region_members`, restores the parent's state and members

Implementation: **in-memory** undo store (`Map<worldViewId, UndoEntry>`), one entry per world view (last operation only). The snapshot captures all affected table rows before the destructive transaction. After a successful undo or a new destructive operation on the same world view, the previous undo entry is discarded.

### Division Preview Dialog

Clicking the map icon on any suggestion or assigned division opens a preview dialog showing the GADM division polygon on an interactive map. The dialog supports three modes depending on available data:

1. **Region map image** (`regionMapUrl` present) — widens to `md`, shows the Wikivoyage region map image on the left and the GADM polygon on the right. ~1,066 regions have static map images.

2. **Wikidata geoshape fallback** (`wikidataId` present, no `regionMapUrl`) — widens to `md`, shows two maps side-by-side:
   - **Left map**: Wikivoyage (Wikidata) geoshape — red fill + outline, labeled "Wikivoyage region", auto-fit bounds
   - **Right map**: GADM division polygon — blue fill + outline, labeled "GADM division"
   - Geoshape fetched via backend proxy (`GET /api/admin/wv-import/geoshape/:wikidataId`) on dialog open, with spinner while loading
   - ~4,000 regions have Wikidata geoshapes via `{{mapframe}}`/`{{mapshape}}` Kartographer maps
   - Backend proxy needed because `maps.wikimedia.org/geoshape` requires `User-Agent` + `Referer` headers

3. **GADM only** (neither available) — single map, `sm` width, no labels

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
4. **Matching** (`status='matching'`) — calls `matchCountryLevel()` directly from `worldViewImport/matcher.ts`

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
- **Picker dialog** shows a 3-column thumbnail grid; admin selects the correct map or marks "none are maps"
- Selection saves `region_import_state.region_map_url` and sets `map_image_reviewed = true`
- "None are maps" clears `regionMapUrl` and marks reviewed

API: `POST /api/admin/wv-import/matches/:worldViewId/select-map-image` with `{ regionId, imageUrl }` (imageUrl validated against candidates list).

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
| GET | `/import/status` | Poll progress |
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
| POST | `/matches/:worldViewId/db-search-one` | DB trigram search for a single region |
| POST | `/matches/:worldViewId/ai-match-one` | AI-match a single region (synchronous) |
| POST | `/matches/:worldViewId/handle-as-grouping` | Drill into children — match them independently against GADM |
| POST | `/matches/:worldViewId/dismiss-children` | Delete child regions, make parent a leaf |
| POST | `/matches/:worldViewId/undo` | Undo last dismiss-children or handle-as-grouping (in-memory, last only) |
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
| POST | `/matches/:worldViewId/finalize` | Close review — appends `'_done'` to current `source_type` |
| POST | `/matches/:worldViewId/rematch` | Reset all matches and re-run country-level matcher |
| GET | `/matches/:worldViewId/rematch/status` | Poll re-match progress |
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
├── types.ts      — Type definitions (ImportTreeNode, ImportProgress, RegionImportState, etc.)
├── importer.ts   — JSON tree → WorldView + regions
├── matcher.ts    — Leaf region → GADM division matching (optimized)
├── aiMatcher.ts  — AI-assisted re-matching via OpenAI
└── index.ts      — Exports, in-memory progress management

backend/src/controllers/admin/wikivoyageExtractController.ts — Extraction endpoints
backend/src/controllers/admin/worldViewImportController.ts   — Import + match review endpoints
```

## Frontend

Admin panel section "WorldView Import" (`WorldViewImportPanel.tsx`) with these views:

1. **Primary action** — "Fetch from Wikivoyage" button runs the full extraction → enrichment → import → matching pipeline. Multi-phase progress UI shows extraction counts, API requests/cache hits, import progress, and matching progress. A "Use cached data" checkbox (with cache size/age) lets admins skip re-fetching unchanged pages or force a clean fetch
2. **Secondary action** — file upload in a collapsed accordion ("Or upload from file") for non-Wikivoyage sources. Includes a matching policy dropdown (country-based or none)
3. **Existing WorldViews** — if imported world views exist in DB, shows source type badge (`wikivoyage` or `imported`), "Review Matches" button for active reviews, and a "Review complete" badge for finalized ones (persists across sessions/relogins)
3. **Match review** (`WorldViewImportReview.tsx`) — two view modes:
   - **Table view** — filterable/paginated table, accept/reject suggestions, map preview per suggestion
   - **Tree view** (`WikivoyageMatchTree.tsx`) — clean hierarchical tree with role-based rendering: containers (continents, sub-regions) show "X/Y matched" summary, countries show status chips with GADM names. Unmatched countries (`no_candidates`) have a per-region AI match button that sends the single region to OpenAI for identification. Matched countries with children have a **"Match children independently"** button (tree icon) that drills down — clears the parent's own match, marks it `children_matched`, and runs country-level matching on each child independently (works for subcontinents, large countries like USA, etc.). `children_matched` regions display as regular "matched" in the UI. Expand/collapse all controls for quick navigation. **"Show N Gaps to Review"** button appears in the toolbar when shadow insertions from the coverage dialog are pending — expands the tree directly to regions that have pending shadow entries and scrolls to the first one, so the admin can quickly find and approve/reject them without manually searching. **Shadow-applied state sync**: when the coverage dialog is closed and shadows are accepted or rejected in the match tree, the coverage dialog's grayed-out (applied) state automatically syncs — accepted gaps disappear from the list, rejected gaps reappear as active
   - **Re-match All** button — opens a confirmation dialog with a matching policy selector (default: country-based), warning that all match assignments, suggestions, and rejections will be lost. On confirm, clears all `region_match_suggestions`, resets `region_import_state.match_status`, deletes `region_members`, then re-runs the matcher with the selected policy. Useful after matcher improvements. Runs in background with progress polling
   - **Check Coverage** button — opens a dedicated `CoverageResolveDialog` (`maxWidth="lg"`, side-by-side layout) for resolving GADM coverage gaps. Runs a deep GADM coverage check using recursive walks both UP (ancestor chain) and DOWN (descendants of assigned divisions). Finds "gap boundaries" at every level — uncovered divisions whose parent has partial coverage. For example, if USA has most states assigned but Texas is missing, Texas appears as a gap under "United States." Available once all `needs_review` and blocking `no_candidates` are resolved. **Layout**: left panel (~55%) shows an interactive gap tree grouped by parent with expand/collapse; right panel (~45%) shows an inline map preview with gap geometry (red), suggestion geometry (blue), distance circles, and suggestion details. **Per-node actions**: every tree node — top-level gaps, intermediate GADM divisions, and leaf divisions — has individual action buttons: map preview (shows geometry in right panel), geo-suggest (find nearest assigned region by geographic proximity), and dismiss (top-level gaps only). Subtree nodes from the `subtree` field are rendered as expandable children with their own preview and geo-suggest buttons, so the admin can drill into abstract entries like "Antarctica → Australia" and suggest at the leaf level (e.g., "Heard Island → Add to Australia"). **Tree-based suggestions**: pre-computed using pure integer joins on the GADM `parent_id` tree — no geometry queries. Step 1 (sibling match): finds gaps whose GADM siblings are directly assigned to regions → suggests "add to existing region." Step 2 (ancestor walk): for remaining gaps without direct siblings, walks UP the GADM tree to find the nearest assigned cousin → suggests "create new region" under the cousin's parent region. Both steps complete in milliseconds. Suggestions appear as inline chips below each node. **Geo-suggest**: triggers a per-gap geographic lookup using boundary-based KNN search. The gap's centroid is compared against assigned divisions using `geom <->` (GiST bounding-box proximity), which correctly finds large regions whose boundary is close but centroid is far (e.g., Antarctica for Heard Island). Returns the nearest assigned region with distance (gap centroid to nearest polygon boundary edge). Also returns a **context tree** — a nested hierarchy from the root down to the suggested region, with the suggested region's children attached. This lets the admin pick not just an ancestor but also a more specific child (e.g., for "Heard Island → Antarctica," the tree shows World → Oceania → **Antarctica** → South Ocean Islands / Antarctic Peninsula). The right panel renders this as a compact mini-tree with indentation; clicking any node selects it as the target region. On first call, lazily populates `anchor_point` for assigned divisions (with triggers disabled to avoid expensive 3857 recomputation). Useful for isolated territories and overseas departments where tree-based suggestions are wrong (e.g., Clipperton Island, BIOT). Updates the suggestion in-place and shows the result on the inline map (gap + suggestion + distance circle). **Manual region search**: a "Choose region manually..." link always appears below the suggestion area in the right panel. Clicking it reveals an Autocomplete that searches all regions in the world view via `searchRegions()`. Selecting a region writes a manual override into `selectedTargets`, which takes highest priority in `getNodeSuggestion` — even when there's no geo-suggest result. The override appears as a "Manual: X" chip with a clear button. This is useful when the geo-suggest is wrong or when there are no suggestions at all. **Per-gap apply**: each gap row (both top-level gaps and subtree nodes) shows a green checkmark button when it has an effective suggestion (from tree-based, geo-suggest, or manual search). Clicking it immediately sends that single gap as a shadow insertion to the match tree — the row then grays out (opacity 0.45), hides its action buttons and suggestion chip, and collapses any subtree children. An undo button (↩) replaces the action buttons to restore the row. Applied gaps are excluded from the global "Apply N to tree" count and bulk action. The global button still works for unapplied gaps. **Shadow insertions**: clicking "Apply to tree" creates ghost entries in the match tree — each gap appears as a semi-transparent dashed-border row under the suggested region. `add_member` shadows appear below the region's assigned divisions; `create_region` shadows appear as synthetic child nodes. Each shadow has approve (green check) and reject (red X) buttons. Approving creates the region_member (or new region + member), auto-dismisses the gap, and removes all shadows for that gap. Dismissed gaps are stored in `world_views.dismissed_coverage_ids`, persist across sessions, and reset on re-match. A collapsible "N dismissed" section below the active gaps allows undismissing. Coverage passes when active gaps = 0 (dismissed don't count). Coverage data resets when match assignments change. **SSE streaming**: the coverage check uses Server-Sent Events to stream real-time progress through three phases — (1) finding coverage gaps via recursive CTE, (2) batch sibling match, and (3) ancestor walk for remaining gaps. The dialog shows step text, elapsed time, and a progress bar
   - **Close Review** button — finalizes the match review, appending `'_done'` to the current `source_type` (e.g., `'wikivoyage'` → `'wikivoyage_done'`, `'imported'` → `'imported_done'`). Requires both: (1) no blocking match issues and (2) a passing coverage check (0 active uncovered GADM divisions — dismissed don't count). Backend also validates — returns 400 if unmatched regions exist. The world view remains fully editable from the WorldView Editor but no longer appears in the active review list

## Usage

### Primary: Fetch from Wikivoyage

1. Open Admin Panel → WorldView Import
2. Enter a WorldView name (default: "Wikivoyage Regions")
3. Optionally toggle "Use cached data" (checked by default if a cache file exists; unchecking forces a clean fetch)
4. Click "Fetch from Wikivoyage" — the extraction pipeline runs automatically (20-40 min). Always uses country-based matching
5. After all phases complete, click "Review Matches"
6. Accept auto-matches in bulk, review suggestions individually
7. Open the WorldView in WorldViewEditor for geometry work

### Alternative: JSON File Upload

1. Open Admin Panel → WorldView Import → expand "Or upload from file"
2. Upload a JSON file with the expected tree format (validated against recursive Zod schema, max 50K nodes, 15 levels deep)
3. Select matching policy: "Country-based" (default) or "None" (skip auto-matching)
4. Click "Start Import"
5. Continue with match review as above

## Future Enhancements

- Auto-trigger geometry computation after matching
- Incremental updates (re-import without losing manual matches)
- Smarter matching via Wikidata IDs and spatial proximity
