# Track Your Regions — Project Vision

## The Idea

Track Your Regions is a travel memory and discovery platform. It turns the question "where have you been?" into a rich, interactive experience — not just pins on a map, but a living record of your relationship with places around the world.

The core insight: travel is not binary. You don't just "visit" a place — you might pass through it on a train, explore its back streets for a week, or know everything about it from books without ever setting foot there. The app models this spectrum of connection and gives users tools to explore, track, and deepen their engagement with the world.

---

## User Roles

### Visitor (Not Authenticated)

A visitor can:

- **Browse the map** — see the world divided into regions (countries, sub-regions, custom groupings) rendered as interactive vector tiles
- **Explore experiences** — browse UNESCO World Heritage Sites, top museums, public art & monuments organized by region through the Discover page
- **See what exists** — understand the breadth of experiences available in any region, with counts, categories, images, and descriptions
- **Switch world views** — see the world organized in different ways (standard GADM administrative boundaries, or custom regional groupings)

On a fresh installation (no custom world views yet), the main content
area shows a **Getting Started** card with setup steps: create a world
view and run experience syncs. This replaces the empty map and
disappears automatically once the first custom world view is created.

**First-run onboarding for contributors / self-hosters:** running
`npm run setup` (once) creates a pre-verified admin account directly
in the database — no manual SQL or email-verification step needed.
The admin can log in immediately after `npm run dev`. Ordinary
(non-admin) local sign-ups use the standard email-verification flow;
in development the verification link is printed to the backend Docker
logs, so no SMTP configuration is required.

The visitor experience is designed to inspire curiosity and make the case for signing up — "look at all the things you could track."

### Authenticated User

Everything a visitor can do, plus:

- **Mark regions as visited** — click a region on the map to toggle it as visited, building a personalized travel map
- **Track experiences** — mark individual UNESCO sites, museums, and landmarks as visited with a simple checkbox
- **See progress** — visual feedback on how much of a region you've explored (experience completion counts)
- **Manage world views** — create and edit custom regional hierarchies with drag-and-drop region building, custom subdivision drawing, and AI-assisted boundary creation
- **Personal travel map** — a world map colored by your visited regions, visible at a glance

The authenticated experience is about reflection and tracking — turning scattered travel memories into a coherent, browsable record.

#### How to Sign Up

Two paths to an account:

- **Email/password** — register with a display name, email, and password. The app sends a verification email with a one-time link. Clicking the link verifies the email and logs you in. Until verified, login is blocked. The verification link expires after 24 hours; users can request a fresh one via "Resend verification email"
- **OAuth** — sign in with Google (or Apple). No email verification needed — the provider has already verified the address. Instant access

The registration form shows a "Check your email" confirmation state after submission, with the option to resend the verification email without leaving the dialog.

### Curator

Everything an authenticated user can do, plus content quality controls scoped to their assigned regions or sources:

- **Reject experiences** — hide incorrectly assigned or low-quality experiences from a region, with an optional reason. Rejections are region-scoped (rejecting from "Europe" doesn't affect "France")
- **Unreject experiences** — reverse a previous rejection if it was a mistake or circumstances changed
- **Edit experiences** — fix names, descriptions, categories, image URLs, and link URLs for any experience in their scope. The link URL points to a reference page (typically Wikipedia) and is shown as a clickable button in the experience details (next to the visited/curate actions)
- **Add existing experiences** — search the global database and manually assign an experience to their region when automatic spatial assignment missed it. Available via the Search & Add tab in the add dialog
- **Create new experiences** — add landmarks, venues, or points of interest that don't exist in any synced source. Each source group header in the experience list has a "+" button that opens the Create New dialog pre-set to that source (e.g. clicking "+" on "Top Museums" pre-selects the museum source). The curator must choose which source to file the experience under — there is no generic "Curator Picks" category. As soon as the curator types a name (3+ characters), the system automatically looks up the place and fills in coordinates, a Wikidata image, a short description, and a Wikipedia link. The lookup uses the current region name as implicit search context for better geo-disambiguation (e.g. typing "Holocaust Memorial" in the Berlin region searches "Holocaust Memorial Berlin"). This lookup fires only once — after it runs, the curator can freely edit the display name without losing the filled-in metadata. A suggestion info box shows the matched Wikidata entity with a "Re-lookup" link to explicitly re-search if needed. All fields remain fully editable, and a "Suggest" button provides manual image lookup as fallback. Location can also be set manually via a multi-mode picker: click on a map, search by place name, paste coordinates in any format (decimal, DMS, Google Maps URL), or describe the place in natural language for AI geocoding. A thumbnail preview shows below the image URL field. After creation, the dialog closes automatically and the new experience appears immediately in the list and on the map
- **Remove from region** — permanently remove a rejected experience from the region entirely (deletes the assignment). Unlike rejection (which hides), removal cleans the experience out of the region's list. The rejection record is kept as a guard — if a future spatial recompute re-adds the experience, it will automatically be hidden again. Available as an icon button in the rejected list (Map mode) and as a button in the curation dialog (Discover mode)
- **See rejected items** — rejected experiences appear dimmed with strikethrough in their list, invisible to regular users
- **View curation history** — every action (edit, reject, unreject, create, assign, remove) is logged with who did what and when, viewable per experience

Curators are the quality layer. They're local experts or subject-matter specialists who keep the content accurate and relevant. The system trusts them — no approval queue, no drafts. Actions are logged for accountability, and curator edits are protected from being overwritten by automated syncs.

### Admin

Everything a curator can do (implicitly, without needing explicit curator assignments), plus infrastructure management:

- **Run syncs** — trigger and monitor data synchronization from external sources (UNESCO, Wikidata for museums, landmarks)
- **Manage world views** — full CRUD on regional hierarchies, assign divisions to regions, compute geometries. When splitting GADM divisions into children, existing child regions (e.g., from a WorldView import) appear as assignment targets — admins manually assign which GADM geometry goes to which existing region via dropdowns. The "Create Custom Subregions" dialog also pre-populates target groups from existing child regions, letting admins drag divisions into imported regions. The Map View tab highlights the image overlay button when a region map is available — one click loads the map from Wikimedia Commons as a reference image, viewable either as a map overlay or side-by-side with the division map for precise geometry alignment. The dialog can be opened for any region — when a region has child regions but no direct divisions, descendant geometries are shown as a read-only context layer (color-coded by group) while only direct members remain interactive. A "Move to parent" tool lets admins click individual divisions to push them up to the parent region, and an "All to parent" batch action moves all unassigned divisions at once. **Manual Cluster Paint Editor** — when the CV auto-match pipeline produces incorrect cluster boundaries, admins can switch to a vector-border paint editor with paint bucket (flood fill), border eraser, and polyline drawing tools to manually correct cluster assignments. Borders are extracted from the cluster output as SVG vector paths (via OpenCV findContours) and rendered as a scalable overlay with smooth curves; the eraser splits paths at the cursor, and the line tool draws new polylines with automatic endpoint snapping. Flood fill rasterizes the SVG on demand and stops at the vector borders. The editor overlays a transparent color canvas on the map and submits the result to replace automated pixel labels before ICP alignment proceeds
- **Import WorldView** — two import paths: (1) click "Fetch from Wikivoyage" to automatically extract the full Wikivoyage region hierarchy (~4,500 regions), enrich with Wikidata IDs, create a WorldView, and match countries to GADM divisions — all from a single button click with live multi-phase progress (extraction → enrichment → import → matching, 20-40 min); (2) upload a pre-generated JSON file for non-Wikivoyage sources. Online imports use a persistent cache — admins pick a named cache snapshot from a dropdown (showing size + age per snapshot), choose "None" to force a clean fetch, or delete unwanted snapshots. Each successful run saves a timestamped snapshot for future re-use. Each import path gets a distinct source type (`wikivoyage` vs `imported`) shown in the existing world views list. Admins choose a matching policy per import: "Country-based" (auto-match countries to GADM, the default) or "None" (skip auto-matching, all regions start unmatched for manual assignment). Review/accept matches through a dedicated admin interface with a hierarchical tree view. The tree view uses role-based rendering: containers show "X/Y matched" summaries, countries show status chips with GADM names, and `children_matched` countries expand to show subdivision assignments. Sub-continental groupings (Melanesia, Polynesia, etc.) can be handled via a "Handle as sub-continental" button that clears the parent's match and re-runs country-level matching on each child independently. Division assignments made via the WorldView Editor are automatically reflected back in the match review interface (bidirectional sync). A "Re-match All" button (with policy selector) resets and re-runs the matcher after improvements. "Close Review" finalizes the import (disabled until all regions are matched). **Simplify Hierarchy** — collapse fully-covered subtrees (where every GADM child of a parent is already a member) up into the parent region with one click, useful when GADM has more granularity than the world view needs. **Smart Simplify** — detects when a GADM parent's children are split across multiple sibling regions and proposes consolidating them into one, showing a side-by-side map view of current vs proposed assignments so the admin can apply or skip each move. Spatial anomalies (exclaves and disconnected fragments) are highlighted in the same dialog with Accept/Skip actions. **Geoshape Match** — fetches the Wikidata geoshape for the Wikivoyage region and uses IoU scoring to find the best-covering set of GADM divisions; if no geoshape exists, automatically builds a composite from child entities (via Wikidata SPARQL + Wikivoyage regionlist). **Point Match** — for regions without any geoshape, extracts Wikivoyage marker coordinates and finds GADM divisions that contain those points; marker locations are stored for preview in the Division Preview Dialog as orange circle markers on the left map panel. The Division Preview Dialog adds a fourth mode: when a region has marker points but no geoshape or region map image, it shows those points as orange dots on the left-side map so the admin can visually verify the match before accepting. **Scope Fallback** — when Geoshape or Point Match returns no candidates (e.g. island groups whose centroid falls outside GADM polygons), a "Try wider: `<scope>`" link appears inline; clicking it retries the search at the next ancestor level (country → continent → world) without auto-triggering. **Conflict Detection and Accept-With-Transfer** — when a matched GADM division is already assigned to a sibling region, a warning chip ("from Mexico (split Baja California Sur)") marks the suggestion as a conflict. Clicking the map icon or Accept opens a Transfer Preview Dialog showing a three-layer map: the donor region's full geometry in red, the divisions that would move in orange, and the target region outline in dashed blue. The admin clicks "Accept Transfer" to atomically move the divisions and recompute both regions' geometries. **AI Extraction Interview** — during Wikivoyage extraction, when the AI is uncertain (e.g. should a region be split into subregions?), it pauses and asks the admin one structured question with a recommended option; the admin's answer is final for that page (the page is not re-asked) and, when it generalizes, produces a soft rule that informs future extractions. **AI Review Children** — on any region whose Wikivoyage source URL is set, an AI Review button (sparkle icon) audits the region's current child set against its Wikivoyage article. The AI reads the live Wikivoyage wikitext, compares it to existing child regions, and produces a grouped action list: regions to **Add** (missing children from the article), regions to **Remove** (children that no longer appear), and regions to **Rename** (children whose names differ). Each action shows the reasoning and, for Add/Rename actions, a verified Wikivoyage URL. Add and Rename actions are pre-selected by default; Remove actions (destructive) are opt-in. The admin reviews the grouped dialog, checks or unchecks individual items, then clicks Apply to execute all selected actions at once. After all actions complete, the tree refreshes automatically.
- **Import review dashboard** — per-country import review progress is tracked on a dedicated dashboard (`/admin/import/:worldViewId`) with sign-off lifecycle and verification checks (unassigned leaves, coverage gaps, overlaps), replacing the earlier flat match list as the primary review entry point. Admins work each country in a focused **country workspace** (`/admin/import/:worldViewId/region/:regionId`) with a scoped tree, stage-grouped action panel, persistent map with child-colored fills, reference-outline and overlap map overlays, and a checks bar that gates sign-off — clicking any country row in the dashboard opens its workspace directly. The workspace surfaces coverage % chips on container rows and supports a full preview-comparison suite: single-division preview (with vision-match and split-deeper), union preview of all suggestions against the region map or Wikidata geoshape, transfer preview (three-layer donor/moving/target dialog), and view-map comparison of assigned divisions against the reference map. A **Skeleton tab** on the dashboard lets admins curate the sub-continental groupings (continents, regions like "West Africa", "Melanesia") before country-level review begins — they can create, rename, move, and remove container nodes, promote unidentified regions to work units, and confirm the work-unit list when the skeleton is settled.
- **CV Settings** — a dedicated admin panel to switch the CV color-match pipeline between JavaScript (OpenCV.js WASM) and Python (FastAPI microservice using OpenCV + scikit-image). The setting persists to the database; the Python path is preferred when the service is healthy, with automatic fallback to JavaScript if the service is unreachable.
- **Manage curators** — promote users to curator role, assign scopes (region, source, or global), revoke assignments
- **Region assignment** — run the spatial assignment algorithm that maps experiences to regions based on their coordinates
- **Monitor system health** — sync logs, error tracking, database status

---

## The Experience System

Experiences are the atomic units of travel engagement — anything a user can discover, learn about, or do in connection with a region. Three experience categories are live: UNESCO World Heritage Sites (~1,250), Museums (~100 top art museums), and Public Art & Monuments (~200). Plans to expand into books, films, food, festivals, wildlife, and many more categories.

Users browse experiences in two views: **Map mode** (select a region, see grouped experiences below) and **Discover mode** (tree-based navigation with map + card list). Multi-location experiences (e.g. serial UNESCO nominations) show in-region locations first, with out-of-region locations collapsed behind a "Show N more" toggle and labeled with their region path (common prefix stripped for brevity). Curators maintain content quality through rejection, editing, and manual creation with AI-assisted lookup.

For the complete experience vision — categories, classification, user interaction, quiz system, context layers, gamification, and implementation phases — see [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md). For implementation details, see [`experiences.md`](../tech/experiences.md)

---

## The Region System

Regions are the geographic building blocks. The system supports multiple ways of dividing the world.

### Administrative Divisions (GADM)

The base layer: official country and sub-country boundaries from the GADM database. Pre-simplified at 3 levels of detail for performant map rendering. Forms a strict hierarchy (country → state → district → ...).

### World Views

Custom hierarchical groupings layered on top of GADM divisions. A world view might group countries into continents, cultural regions, or travel-focused zones.

- **Default world view** — mirrors the GADM hierarchy directly
- **Custom world views** — user-created groupings. A region can contain whole divisions, specific sub-divisions, or custom-drawn boundaries
- **Computed geometry** — region boundaries are automatically computed from their member divisions, with hull algorithms for scattered geography display

### Map Rendering

Vector tiles served by Martin (PostGIS-native tile server). The frontend uses MapLibre GL with react-map-gl for:

- Choropleth coloring of regions (visited/unvisited) with clear visual hierarchy — selected, hovered, visited, and default states each have distinct fill and outline intensities
- Drill-down navigation (click a region to see sub-regions)
- Ancestor context layers — when drilling into a region hierarchy, all ancestor levels remain faintly visible as dimmed background layers (root siblings, parent siblings, grandparent siblings, etc.), providing full spatial orientation and clickable navigation back to any level
- Experience markers with clustering (GeoJSON source with circle + symbol layers)
- Region outline persists during exploration mode as a subtle geographic border, giving spatial context alongside experience markers
- Antimeridian-aware camera positioning for regions that cross the date line

---

## Future Vision

The experience system will grow along several axes. See [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md) for the complete vision with implementation phases.

### Connection States (Planned)

Replace binary visited/not-visited with a spectrum of connection depth. First phase: visit-based states (Stranger, Passed Through, Explored, Deep Connection) derived from experience tracking, checklist input, and visit history. Second phase: add the Aware state (knowledgeable but never visited) once the quiz system can detect theoretical knowledge. See [`CONNECTION-LEVEL-CHECKLIST.md`](CONNECTION-LEVEL-CHECKLIST.md).

### Quiz-Based Onboarding (Planned)

Reconstruct travel history through play — rounds of cards testing factual, sensory, spatial, and emotional knowledge. See [`QUIZ-SYSTEM.md`](QUIZ-SYSTEM.md).

### Expanded Categories (Planned)

Books, films, food, festivals, notable people, wildlife, intangible heritage, and 15+ more categories. See [`PROPOSED-EXPERIENCE-CATEGORIES.md`](PROPOSED-EXPERIENCE-CATEGORIES.md).

### Context Layers (Planned)

- **Regional Profiles** — key facts, climate, economy, "changes since your visit." See [`REGIONAL-PROFILE.md`](REGIONAL-PROFILE.md)
- **Locals' Perspective** — user-generated local knowledge. See [`LOCALS-PERSPECTIVE.md`](LOCALS-PERSPECTIVE.md)
- **Cultural Context** — historical and social background woven into experience descriptions, rooted in cultural relativism

### Social Features (Planned)

Follow users, journey planning, privacy controls, notifications.

### Mobile Apps (Planned)

Native iOS/Android sharing the same API. See `mobile-planning.md` (in tech/planning).

---

## Design Principles

1. **Reflection over logging** — we help people remember and appreciate where they've been, not passively track their location
2. **Play over data entry** — quizzes, visual maps, and badges make tracking fun rather than tedious
3. **Depth over breadth** — connection levels reward deep engagement with a few places over superficial visits to many
4. **Local expertise** — curators bring regional knowledge; future locals' perspective features amplify authentic voices
5. **Cultural respect** — no ranking cultures or experiences. Cultural relativism guides how we present context
6. **Open data** — built on UNESCO, Wikidata, GADM, and other open sources. Users can export their data
