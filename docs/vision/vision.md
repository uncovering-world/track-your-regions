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
- **See what exists** — understand the breadth of experiences available in any region, with counts, categories, images, and descriptions. A region is shown whole rather than as a first page of it: the list and the map markers both cover everything assigned there, so a category is never represented only by its alphabetically-early members
- **Switch world views** — see the world organized in different ways: any custom regional grouping an admin has published. Administrative geography is reachable this way only if an admin publishes a world view built from it (see the base layer import below); the built-in administrative hierarchy itself stays admin-only. The address bar follows the choice and the choice follows the address bar: a link carrying a world view opens on it, and pasting or editing one in a tab that is already open switches to it
- **What just arrived** — a **New** mark on things that came in with the latest update of their source, not on things that happen to be recent rows in a database. It stays for a while — how long depends on the source, since some publish monthly and some rarely. It goes when the next update replaces the batch, not on a timer
- **Places that changed** — some sites leave the official lists without going anywhere. Those stay exactly where they were, on the map and in the lists, with a small **Former** mark and the reason: no longer listed, still there to visit. Places that genuinely no longer exist are a different matter — offering somewhere demolished as somewhere to go would be a lie, so they leave the lists, the map and the counts. On the map, a region that holds any says so at the end of its list, and one click brings them back for anyone curious what used to be there; Discover filters them the same way but has no way back yet

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
- **Track experiences** — mark individual UNESCO sites, museums, and landmarks as visited with a simple checkbox. What you mark is yours to keep: no data refresh deletes it, whether the source renames what it calls a place or stops listing it altogether. A place the source stops offering leaves the lists, while your record of having been there is kept intact. One case is honest to name: when the source **replaces** a point rather than editing it — corrects its coordinates, or files it under a new reference — that arrives as a new place, so a site you had finished shows as in progress again until you tick the new one. Nothing is lost; the tick simply stays on the spot you actually visited
- **See progress** — visual feedback on how much of a region you've explored (experience completion counts). A place that no longer exists drops out of what a region counts as there to see, but never out of what you have seen: your visit to it stays, because you did go
- **Manage world views** — create and edit custom regional hierarchies with drag-and-drop region building, custom subdivision drawing, and AI-assisted boundary creation
- **Personal travel map** — a world map colored by your visited regions, visible at a glance
- **A New mark that waits for you** — the **New** window is the same for everyone, but signed in it is a floor rather than a deadline: arrive at the tail of it and the mark stays a week longer, counted from the first time it was actually shown to *you*. A batch is not something you can miss by visiting on the wrong day. It still goes when the next update replaces the batch

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
- **Edit experiences** — fix names, descriptions, categories, image URLs, and link URLs for any experience in their scope. An experience that sits in several regions counts as in scope when *any* of those regions is one the curator covers — the edit is on the experience, not on its place in one region. For a region-scoped curator the history entry is recorded under a region they cover, so it stays visible in their own view of that history; for a global or category curator, under no region at all, since their authority came from none in particular. The link URL points to a reference page (typically Wikipedia) and is shown as a clickable button in the experience details (next to the visited/curate actions)
- **Add existing experiences** — search the global database and manually assign an experience to their region when automatic spatial assignment missed it. Available via the Search & Add tab in the add dialog
- **Create new experiences** — add landmarks, venues, or points of interest that don't exist in any synced source. Each source group header in the experience list has a "+" button that opens the Create New dialog pre-set to that source (e.g. clicking "+" on "Top Art Museums" pre-selects the museum source). The curator must choose which source to file the experience under — there is no generic "Curator Picks" category. As soon as the curator types a name (3+ characters), the system automatically looks up the place and fills in coordinates, a Wikidata image, a short description, and a Wikipedia link. The lookup uses the current region name as implicit search context for better geo-disambiguation (e.g. typing "Holocaust Memorial" in the Berlin region searches "Holocaust Memorial Berlin"). This lookup fires only once — after it runs, the curator can freely edit the display name without losing the filled-in metadata. A suggestion info box shows the matched Wikidata entity with a "Re-lookup" link to explicitly re-search if needed. All fields remain fully editable, and a "Suggest" button provides manual image lookup as fallback. Location can also be set manually via a multi-mode picker: click on a map, search by place name, paste coordinates in any format (decimal, DMS, Google Maps URL), or describe the place in natural language for AI geocoding. A thumbnail preview shows below the image URL field. After creation, the dialog closes automatically and the new experience appears immediately in the list and on the map
- **Remove from region** — permanently remove a rejected experience from the region entirely (deletes the assignment). Unlike rejection (which hides), removal cleans the experience out of the region's list. The rejection record is kept as a guard — if a future spatial recompute re-adds the experience, it will automatically be hidden again. Available as an icon button in the rejected list (Map mode) and as a button in the curation dialog (Discover mode)
- **See rejected items** — rejected experiences appear dimmed with strikethrough in their list, invisible to regular users
- **Answer what a sync run could not decide** — a review page collects the decisions a run leaves open, and nothing else. An object the source stopped listing gets one of three answers: it was delisted but is still standing, it no longer exists, or the source simply hiccupped and nothing happened. The first two are different facts about the same object and can both be true — a destroyed site can remain inscribed, an intact one can be struck off — so they are answered separately rather than as one status. A field where the source keeps proposing a value over a curator's edit shows both versions side by side; the curator's version is what visitors already see, so keeping it needs no action and the question stays on the page, while accepting the source's also lifts the protection on that field — which is what settles the question and takes it off the page. A few kinds of disagreement — a moved location, a metadata key — cannot be applied on the spot; accepting those lifts the curator's protection and the next sync brings the value in, which the page says plainly rather than leaving the curator to guess when it takes effect. There is one exception, and the page says so instead of hiding it: when a category's own rule turns a row down — an archaeological museum in a list of art museums, a stretch of painted wall — the row is already hidden from visitors, because a candidate that fails the same rule is never added in the first place and one that predates the rule has to end up in the same place. That is not a guess about the world, so it is not offered as one: the card states the rule's own objection and asks a different question — was the rule right? Either answer sticks against the machine, and no later run reverses it. Keeping a row out does not stick against the person who did it: because a kept-out row is hidden from every list and gives nothing back at its own address, the page keeps its own kept-out list, collapsed at the foot, where one click puts any of them back. Apart from that, until someone answers, none of it has changed anything visitors see
- **Take a verdict back** — a mis-click is one click away from hiding an object from everyone, so it has to be one click away from coming back. Open the item and it offers exactly that: "It is still listed" for something recorded as delisted, right where the item already sits — those are never hidden — and "It does still exist" for something recorded as gone, which first has to be revealed, since hiding it is what the verdict did. For those two the review queue cannot host it — the queue lists open questions, and an answered one has left it — which is why it lives where the object is still reachable. A row a rule kept out is the one case with nowhere else to live, so the queue keeps it after all, out of the way of the work but one click from coming back
- **View curation history** — every action (edit, reject, unreject, create, assign, remove, accepting a source value, and the lifecycle verdicts above) is logged with who did what and when, viewable per experience. The history a region-scoped curator sees is bounded by that scope: an experience assigned to several regions shows only the entries for the regions they cover, plus entries that name no region. Global and category curators, and admins, see the whole history

Curators are the quality layer. They're local experts or subject-matter specialists who keep the content accurate and relevant. The system trusts them — nobody approves a curator's work, and there are no drafts. The review page runs the other way round: it is the machine asking a curator, not a curator waiting on anyone. Actions are logged for accountability, and curator edits are protected from being overwritten by automated syncs.

### Admin

Everything a curator can do (implicitly, without needing explicit curator assignments), plus infrastructure management:

- **Run syncs** — trigger and monitor data synchronization from external sources (UNESCO, Wikidata for museums, landmarks). A **Dry run** answers "what would this change?" without changing anything: it fetches from the source, works out the difference against what is stored, and records the result as a preview that writes no experiences. The same run can be previewed as often as needed before it is spent. **A sync cannot destroy anything a person recorded.** There is one kind of run, and it refreshes what the source still offers, adds what is new, and marks what the source stopped offering — visits, the individual points people ticked off, the artworks they logged as seen, curator edits and manual region assignments all survive it. The old **Force sync**, which emptied the source's whole catalogue and every visit record with it before starting again, is gone: with nothing left to delete it was a mode that differed from an ordinary run in nothing but the damage
- **See what a sync actually did** — a run opens into a per-object report rather than four totals: which objects were created, which fields changed on which object (and whether the change matters — a site entering the danger list is not a reworded description), which came through untouched, which the source stopped listing, where the source now disagrees with a curator's edit, and which entries the source offered that this category does not hold — a catalogue's collection is not a museum, and setting it aside is not a failure. The report defaults to the changes worth a look and hides only minor field edits
- **Region assignment is not a step to remember** — a sync places whatever moved during the run, so an admin no longer has to notice that new objects arrived and press anything. The run says so while it happens: after the last object it reports **assigning regions** rather than finishing, for as long as that takes — minutes on a category's first run — and Cancel is unavailable from the moment the last object is processed — through the tidying up and the assigning that follow — because by then there is nothing left for a stop to interrupt, and pretending otherwise would report a cancellation that never happened. There is no standing "assignment needed" warning any more, because a run that succeeds leaves no such question open. The Region Assignment panel remains for two cases a sync cannot settle by itself. The ordinary one is that **region boundaries changed**, so every location has to be tested against them again. The other is that **the placement at the end of a run failed** — the run then shows as Partial rather than Success, with the reason in its log entry, because the catalogue is correct while the region assignments for what it moved are not. That is the one situation where an admin does have to press the button. It rebuilds a whole world view and clears its automatic assignments first, so regions read as empty while it runs — which is exactly why a sync does not use it
- **Manage world views** — full CRUD on regional hierarchies, assign divisions to regions, compute geometries. When splitting GADM divisions into children, existing child regions (e.g., from a WorldView import) appear as assignment targets — admins manually assign which GADM geometry goes to which existing region via dropdowns. The "Create Custom Subregions" dialog also pre-populates target groups from existing child regions, letting admins drag divisions into imported regions. The Map View tab highlights the image overlay button when a region map is available — one click loads the map from Wikimedia Commons as a reference image, viewable either as a map overlay or side-by-side with the division map for precise geometry alignment. The dialog can be opened for any region — when a region has child regions but no direct divisions, descendant geometries are shown as a read-only context layer (color-coded by group) while only direct members remain interactive. A "Move to parent" tool lets admins click individual divisions to push them up to the parent region, and an "All to parent" batch action moves all unassigned divisions at once. **Manual Cluster Paint Editor** — when the CV auto-match pipeline produces incorrect cluster boundaries, admins can switch to a vector-border paint editor with paint bucket (flood fill), border eraser, and polyline drawing tools to manually correct cluster assignments. Borders are extracted from the cluster output as SVG vector paths (via OpenCV findContours) and rendered as a scalable overlay with smooth curves; the eraser splits paths at the cursor, and the line tool draws new polylines with automatic endpoint snapping. Flood fill rasterizes the SVG on demand and stops at the vector borders. The editor overlays a transparent color canvas on the map and submits the result to replace automated pixel labels before ICP alignment proceeds
- **Describe a world view without hitting a wall** — every description field — the create dialog, the settings dialog, and the inline editor in the world view header — carries a live character counter and stops at 1,000 characters, the length the system keeps — so the limit shows up while the description is being typed, rather than as a save that fails for no stated reason
- **Publish or hide world views** — toggle "Visible to everyone" per world view in its settings dialog (custom world views only — the picker offers no Settings entry for the default world view, so its flag is reachable only through the API); a hidden one is unlisted and unreadable through the API to everyone else (its map tiles aren't yet scoped by the same visibility check), and newly imported world views start hidden until an admin publishes them.
- **Import WorldView** — one panel with a source selector: Wikivoyage, a JSON file, or the administrative base layer. Choosing **Wikivoyage** and clicking "Fetch from Wikivoyage" automatically extracts the full Wikivoyage region hierarchy (~4,500 regions), enriches with Wikidata IDs, creates a WorldView, and matches countries to administrative divisions — all from a single button click with live multi-phase progress (extraction → enrichment → import → matching, 20-40 min). Choosing **JSON file** uploads a pre-generated JSON tree for any other external source. Choosing the **administrative base layer** imports the administrative divisions currently loaded into their own world view — one region per division, down to a chosen depth — matched by the same pipeline and landed in the same review as any other import; like any new import, the world view starts hidden. The Wikivoyage fetch uses a persistent cache — admins pick a named cache snapshot from a dropdown (showing size + age per snapshot), choose "Clean fetch (no cache)" to force a fresh fetch, or delete unwanted snapshots. Each successful run saves a timestamped snapshot for future re-use. Each source gets a distinct source type (`wikivoyage`, `imported`, or `base_layer`) shown in the existing world views list. Matching policy follows the source rather than being asked for: Wikivoyage and JSON-file imports get "Country-based", which looks for country names anywhere in the tree, and the administrative base layer gets "Hierarchical", which walks down the division tree alongside the imported one — that is what lets it resolve every region of a mirror instead of the 62% the country-based route reached. A JSON-file import can also be set to "None" to skip auto-matching entirely and assign everything by hand. Review/accept matches through a dedicated admin interface with a hierarchical tree view. The tree view uses role-based rendering: containers show "X/Y matched" summaries, countries show status chips with GADM names, and `children_matched` countries expand to show subdivision assignments. Sub-continental groupings (Melanesia, Polynesia, etc.) can be handled via a "Handle as sub-continental" button that clears the parent's match and re-runs country-level matching on each child independently. Division assignments made via the WorldView Editor are automatically reflected back in the match review interface (bidirectional sync). A "Re-match All" button resets and re-runs the matcher after improvements, under the same policy the source implies — the dialog is a plain confirmation and offers no policy choice — it deletes every division assignment for the world view first, including ones accepted by hand, so hand-work belongs after a re-match rather than before it. Because a run costs 20 seconds to two minutes and each one discards the previous result, the button is limited to five presses a minute and answers "too many requests" beyond that. "Close Review" finalizes the import (disabled until every region is matched and the coverage check reports no active uncovered administrative divisions). **Simplify Hierarchy** — collapse fully-covered subtrees (where every GADM child of a parent is already a member) up into the parent region with one click, useful when GADM has more granularity than the world view needs. **Smart Simplify** — detects when a GADM parent's children are split across multiple sibling regions and proposes consolidating them into one, showing a side-by-side map view of current vs proposed assignments so the admin can apply or skip each move. Spatial anomalies (exclaves and disconnected fragments) are highlighted in the same dialog with Accept/Skip actions. **Geoshape Match** — fetches the Wikidata geoshape for the Wikivoyage region and uses IoU scoring to find the best-covering set of GADM divisions; if no geoshape exists, automatically builds a composite from child entities (via Wikidata SPARQL + Wikivoyage regionlist). **Point Match** — for regions without any geoshape, extracts Wikivoyage marker coordinates and finds GADM divisions that contain those points; marker locations are stored for preview in the Division Preview Dialog as orange circle markers on the left map panel. The Division Preview Dialog adds a fourth mode: when a region has marker points but no geoshape or region map image, it shows those points as orange dots on the left-side map so the admin can visually verify the match before accepting. **Scope Fallback** — when Geoshape or Point Match returns no candidates (e.g. island groups whose centroid falls outside GADM polygons), a "Try wider: `<scope>`" link appears inline; clicking it retries the search at the next ancestor level (country → continent → world) without auto-triggering. **Conflict Detection and Accept-With-Transfer** — when a matched GADM division is already assigned to a sibling region, a warning chip ("from Mexico (split Baja California Sur)") marks the suggestion as a conflict. Clicking the map icon or Accept opens a Transfer Preview Dialog showing a three-layer map: the donor region's full geometry in red, the divisions that would move in orange, and the target region outline in dashed blue. The admin clicks "Accept Transfer" to atomically move the divisions and recompute both regions' geometries. **AI Extraction Interview** — during Wikivoyage extraction, when the AI is uncertain (e.g. should a region be split into subregions?), it pauses and asks the admin one structured question with a recommended option; the admin's answer is final for that page (the page is not re-asked) and, when it generalizes, produces a soft rule that informs future extractions. **AI Review Children** — on any region whose Wikivoyage source URL is set, an AI Review button (sparkle icon) audits the region's current child set against its Wikivoyage article. The AI reads the live Wikivoyage wikitext, compares it to existing child regions, and produces a grouped action list: regions to **Add** (missing children from the article), regions to **Remove** (children that no longer appear), and regions to **Rename** (children whose names differ). Each action shows the reasoning and, for Add/Rename actions, a verified Wikivoyage URL. Add and Rename actions are pre-selected by default; Remove actions (destructive) are opt-in. The admin reviews the grouped dialog, checks or unchecks individual items, then clicks Apply to execute all selected actions at once. After all actions complete, the tree refreshes automatically.
- **CV Settings** — a dedicated admin panel to switch the CV color-match pipeline between JavaScript (OpenCV.js WASM) and Python (FastAPI microservice using OpenCV + scikit-image). The setting persists to the database; the Python path is preferred when the service is healthy, with automatic fallback to JavaScript if the service is unreachable.
- **Manage curators** — promote users to curator role, assign scopes (region, source, or global), revoke assignments
- **Region assignment** — run the spatial assignment algorithm that maps experiences to regions based on their coordinates
- **Monitor system health** — sync logs, error tracking, database status

---

## The Experience System

Experiences are the atomic units of travel engagement — anything a user can discover, learn about, or do in connection with a region. Three experience categories are live: UNESCO World Heritage Sites (~1,250), Museums (~100 top art museums — archaeology, natural-history and military museums are a separate import, not yet built), and Public Art & Monuments (~200). Plans to expand into books, films, food, festivals, wildlife, and many more categories.

Users browse experiences in two views: **Map mode** (select a region, see grouped experiences below) and **Discover mode** (tree-based navigation with map + card list). Multi-location experiences (e.g. serial UNESCO nominations) show in-region locations first, with out-of-region locations collapsed behind a "Show N more" toggle and labeled with their region path (common prefix stripped for brevity). Curators maintain content quality through rejection, editing, and manual creation with AI-assisted lookup.

For the complete experience vision — categories, classification, user interaction, quiz system, context layers, gamification, and implementation phases — see [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md). For implementation details, see [`experiences.md`](../tech/experiences.md)

---

## The Region System

Regions are the geographic building blocks. The system supports multiple ways of dividing the world.

### Administrative Divisions (GADM)

The base layer: official country and sub-country boundaries from the GADM database. Pre-simplified at 4 levels of detail for performant map rendering. Forms a strict hierarchy (country → state → district → ...).

### World Views

Custom hierarchical groupings layered on top of GADM divisions. A world view might group countries into continents, cultural regions, or travel-focused zones.

- **Default world view** — browses the administrative divisions themselves, rather than regions grouped on top of them
- **Base layer mirror** — an optional world view imported one region per administrative division, which is what lets experiences attach to plain administrative geography
- **Custom world views** — user-created groupings. A region can contain whole divisions, specific sub-divisions, or custom-drawn boundaries
- **Computed geometry** — region boundaries are automatically computed from their member divisions, with hull algorithms for scattered geography display

### Map Rendering

Vector tiles served by Martin (PostGIS-native tile server). The frontend uses MapLibre GL with react-map-gl for:

- Choropleth coloring of regions (visited/unvisited) with clear visual hierarchy — selected, hovered, visited, and default states each have distinct fill and outline intensities
- Drill-down navigation (click a region to see sub-regions)
- Ancestor context layers — when drilling into a region hierarchy, all ancestor levels remain faintly visible as dimmed background layers (root siblings, parent siblings, grandparent siblings, etc.), providing full spatial orientation and clickable navigation back to any level
- Experience density on the overview, individual markers up close. Zoomed out, a region reads as a heat surface: where its experiences concentrate, and how strongly, in one glance — a continent shows its centres of gravity instead of a count in a bubble, and zooming in resolves each area into the finer structure inside it. From the marker threshold every experience is a pin of its own. Every experience in a region is represented either way, however many there are, and hovering one in the list rings it on the map
- Region outline persists during exploration mode as a subtle geographic border, giving spatial context alongside experience markers
- Antimeridian-aware camera positioning for regions that cross the date line
- Zoomed all the way out, the map draws a coarser rendering of each region than it does up close — detail no one can see at that scale is not fetched, so the world appears in about a second rather than the twenty to twenty-five it took when every coastline was cut down to size on each request. Every region still appears, however small: a place too little to survive that coarsening is drawn at a coarseness of its own instead of being left out
- A wait for map data never traps the viewer. If tiles have not arrived after a few seconds, or fail outright, the covering "Loading map…" panel steps aside, the map becomes pannable and zoomable, and a small note says some areas are still loading — rather than an opaque screen with no way forward
- The map's own furniture — zoom and compass controls, attribution, popups — is styled by a stylesheet the application ships with, not one fetched from a public CDN as the page loads. A visitor on a network that blocks that CDN, or one who arrives during an outage of it, sees the same map as everyone else rather than controls stripped bare of their styling. It also means the version of those styles can no longer drift away from the version of the map library actually in use
- A browser that cannot draw maps at all says so, once, in plain terms. Maps are drawn with WebGL, and some machines have it switched off — hardware acceleration disabled, or a graphics driver the browser distrusts. Where a map would be, such a visitor now reads that it cannot be displayed, why, and that turning on hardware acceleration brings it back, along with a line about what still works on that particular screen: the region tree and experience lists never needed WebGL, and a location can still be set by search, coordinates or description instead of by clicking. Previously this was invisible in the worst way — the main map claimed areas were "still loading" and that panning worked, neither of which was true, and Discover took the whole page down with it

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
