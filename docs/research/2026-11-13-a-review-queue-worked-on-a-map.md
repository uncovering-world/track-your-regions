# How map-and-list review tools let a person work a queue on a map (2026-11-13)

#2477 asks for a map mode on the curator's review queue (`/review`): the same filters and the same question cards, with the questions drawn as points on a map. On 2026-11-11 the queue held 15,706 open questions. Before any design, the issue asks how established tools that combine a map with a list of tasks or results handle five things: picking a task from the map, keeping the list and the map in step, drawing dense areas, choosing the next task after an answer, and carrying filters between the two views. This report reads eight tools on those questions and lists the design options they suggest for the review queue. It states no design; the mock the issue asks for does.

**Short answer.**

1. **Picking.** Every tool opens a task by clicking its marker. What the click opens differs: a popup with the whole task (Osmose), a popup with a *Start* link (MapRoulette), the object selected with its issues in a side panel (iD, JOSM), or a selection a footer button acts on (Tasking Manager). A cluster click zooms in (MapRoulette). None opens a rich decision panel inside the map.
2. **List and map.** Only iD's issues list and the three search products make the list follow the map; MapRoulette does it in its admin table, Tasking Manager and Osmose not at all. Hovering a row highlights its object in iD and, by third-party reports, on Airbnb. No tool read here highlights a row from the map.
3. **Density.** Three answers: clusters computed on the server (MapRoulette, k-means, above 1,000 tasks in view), tiles capped per tile with a heat layer beside them (Osmose, 100 markers a tile), and a ranked subset drawn as full pins with the rest as dots (Airbnb, Google Maps). The two editors and Tasking Manager draw everything they hold.
4. **After an answer.** MapRoulette is the only tool with a chosen *next* task: random, or the nearest open task to the one just answered, found by the server by distance. Tasking Manager offers a random task. Osmose, iD, JOSM and the search products have no *next*: the answered marker disappears and the person picks again.
5. **Filters.** Where both views exist, one filter state drives both, and the web tools keep it in the address (Osmose's hash, MapRoulette's search page, Airbnb's and Zillow's query). The editors keep their filters in preferences.
6. **Tasks with no location.** Every tool that has a queue refuses them at the door: MapRoulette and Osmose drop a task with no geometry on import, iD drops an issue whose objects are not loaded, JOSM shows a relation's error in its tree only. None counts them beside the map.

## Method

- **Read on 2026-11-13.** The open-source tools were read in their code, in shallow clones of the default branch: MapRoulette's frontend (`maproulette3` at `8f3342f`) and backend (`maproulette-backend` at `4873755`), Osmose's frontend (`osmose-frontend` at `f8c5b04`) and backend (`osmose-backend` at `07bd27f`), iD (`develop` at `ae5315e5`), JOSM's GitHub mirror (`master` at `6813c54c`) and the HOT Tasking Manager (`develop` at `cbf2ec89`), with their documentation where it exists (learn.maproulette.org, the OSM wiki, JOSM's help wiki). No code from the clones was run.
- **The search products are closed.** Airbnb, Zillow and Google Maps were read from their help pages and engineering publications, from a page's server-rendered source where it could be fetched without an account, and from third-party write-ups, marked as such. Zillow answered 403 to direct requests, so its pages were read from the Wayback Machine. A claim no opened page states is marked *not confirmed*.
- **Extras.** HOT's Tasking Manager is added because it is a queue of map tasks with a list and a map side by side and a *next task* button. WikiShootMe is noted in one paragraph.
- **No account** was created or used, and every request carried a generic User-Agent.
- **Code links** point at the default branch: MapRoulette's frontend `https://github.com/maproulette/maproulette3/blob/main/` (MR-FE), its backend `https://github.com/maproulette/maproulette-backend/blob/main/` (MR-BE), Osmose's frontend `https://github.com/osm-fr/osmose-frontend/blob/master/` (OS-FE), iD `https://github.com/openstreetmap/iD/blob/develop/` (iD), JOSM `https://github.com/JOSM/josm/blob/master/src/org/openstreetmap/josm/` (JOSM) and the Tasking Manager `https://github.com/hotosm/tasking-manager/blob/develop/frontend/src/components/taskSelection/` (TM).

## The review queue today

The review page is a list of questions on the left and the open question's card on the right (`ReviewPage.tsx`, `ReviewQueueList.tsx`, `ReviewBench.tsx`). The toolbar narrows the list by a name search, the source, the kind of question, one region and one run, and orders it by date or by question (`feed/ReviewToolbar.tsx`). Each kind of question has its own colour (`KIND_COLOR`). The address holds all of it, the open row (`?row=waiting:11586`) and a tab beside the queue (`?view=crowded`) included, through `useReviewAddress` and `parseReviewUrl` (ADR-0051). A curator's move is pushed to the history; the selection moving on after an answer replaces the entry. The list is read a page at a time from a union of every kind's open predicate (`reviewQueueKeys.ts`).

Two map patterns exist in the product. Map mode draws a heatmap below zoom 5 and one marker per place above it, with no clusters (`ExperienceMarkers.tsx`, `docs/tech/experience-map-ui.md` § Density instead of clusters); its list lists what the map shows, with a "12 more in this region" way back, and keeps the open row listed when the camera leaves it. Discover mode clusters, and its clusters count places.

**Measured on the development stack on 2026-11-13** (read-only, the queue's own keys query, admin scope, no filter): 15,709 open questions read in 1.0 s. Every question's key is a place, and every such place has a point: no open question lacks one. A work's question is its museum's (*contents*), a part's is its whole's (*component-items*). 15,279 distinct points carry them; 408 points carry more than one question (at most 5). The densest one-degree cells: Osaka and Kyoto (118), Jerusalem (83), Tokyo (82), London (82), Florence (73), Rome (72).

## MapRoulette

MapRoulette serves *challenges*, each a set of tasks with a geometry, to mappers who fix them one at a time.

1. **Picking.** A single task's marker opens a popup with a *Start task* link (`startChallengeWithTask` in MR-FE `src/components/ChallengePane/TaskChallengeMarkerContent.jsx`). A cluster click zooms to its bounds (`markerClicked` → `map.fitBounds` in MR-FE `src/components/TaskClusterMap/MapMarkers.jsx`), and markers on one spot fan out (`spiderIfNeeded`). A lasso around tasks makes a *virtual challenge* of them, at most 2,000 tasks, expiring after 36 hours ([Editing virtual challenges](https://learn.maproulette.org/en-US/documentation/editing-virtual-challenges/); `REACT_APP_VIRTUAL_CHALLENGE_MAX_TASKS`, `REACT_APP_VIRTUAL_CHALLENGE_DURATION` in MR-FE `.env`).
2. **List and map.** The challenge search follows the map only under *Within map bounds* or *Shown on map*, and only then writes the bounds into the address (`withinMapBounds`, `intersectingMapBounds` in MR-FE `src/services/Challenge/ChallengeLocation/ChallengeLocation.js`; `updateBoundsOnRoute` in `src/components/HOCs/WithSearchRoute/WithSearchRoute.jsx`). The managers' task table re-reads its bounding box 800 ms after a pan (`updateTaskFilterBounds` in `WithFilterCriteria.jsx`), 20 rows a page. A lasso fills the same selection the table's checkboxes do (`onBulkTaskSelection` in `WithSelectedClusteredTasks.jsx`). No row-hover highlight was found.
3. **Density.** The server clusters with `ST_ClusterKMeans(location, LEAST(COUNT(*), numberOfPoints))` (`clusterCTEs` in MR-BE `app/org/maproulette/framework/repository/TaskClusterRepository.scala`); the client asks for 25 clusters (`fetchTaskClusters` in MR-FE `src/services/Task/TaskClusters.js`). It asks for individual tasks with a limit of 1,001 and falls back to clusters when 1,001 come back below zoom 18 (`UNCLUSTER_THRESHOLD = 1000`, `CLUSTER_POINTS = 25`, `MAX_ZOOM = 18` in `TaskClusterMap.jsx`). Browsing tasks across challenges needs a view no wider than 70 degrees.
4. **After an answer.** The confirmation dialog offers the next task as *Random* or *Nearby*, remembered per challenge (`TaskLoadMethod.js`). In *Nearby* it shows a small map, "Select your next nearby task (optional)", of 5 to 100 tasks (`MAX_NEARBY_TASK_LIMIT` in `WithNearbyTasks.jsx`). Otherwise the server orders by `ST_Distance(tasks.location, <the task just left>)`, skips that task and ignores priority (`getRandomTasksWithPriority` in MR-BE `app/org/maproulette/models/dal/TaskDAL.scala`); without a proximity it walks priorities at random ([Task priority rules](https://learn.maproulette.org/en-US/documentation/task-priority-rules/)). With none left the mapper returns to the challenge list.
5. **Filters.** The challenge search keeps its filters in the query string (`routeCriteria` in `WithSearchRoute.jsx`); task tables serialise theirs as `?filters.status=…&boundingBox=…` (`buildSearchURL` in `SearchCriteria.js`). The next-task method is a preference.

**No location** cannot occur: the import skips a feature with no geometry and stores its centroid (MR-BE `TaskDAL.scala`). **Own address:** a task is `/challenge/:cid/task/:tid`; the challenge map's view is component state.

## Osmose

Osmose runs checks over OpenStreetMap data and shows each finding as a marker, to be marked fixed or a false positive.

1. **Picking.** A marker click opens a popup that reads the issue and writes its id into the address (OS-FE `web/src/pages/map/popup.vue`; [Osmose on the OSM wiki](https://wiki.openstreetmap.org/wiki/Osmose)). No clusters, no area selection.
2. **List and map.** The side panel lists the kinds of check with checkboxes that filter the map, not the issues (`items-list.vue`). Below zoom 7 the map says "Zoom in to see issues" (lower above latitude 60). The list of issues is a separate page whose rows link to the map; *Export → HTML list* opens it with the map's filters and bounds, 500 rows (`setParams` in `top.vue`).
3. **Density.** Vector tiles from zoom 7 to 18, at most 100 issues a tile, unordered; a full tile draws an icon at its centre (`api/issues_tiles.py`, `_gets_mvt` in `modules/query.py`). A heat layer counts issues on a 32 by 32 grid per tile, off by default.
4. **After an answer.** *Done* and *False positive* are posted without waiting; 200 ms later the marker is hidden and the popup closes (`setDone`, `_dismissMarker` in `popup.vue`). Nothing opens next. After 100 closed issues the map warns against mechanical editing.
5. **Filters.** Filters and the open issue live in the address's hash, copied to the browser's storage (`initializeItemState`, `saveItemState` in `index.vue`); the HTML list takes the same names as query parameters.

**No location:** dropped at import; several locations become several markers (`update_issue` in `control/update_utils.py`). **Own address:** `/{lang}/map/#loc=z/lat/lon&item=…&issue_uuid=…`.

## JOSM's validator

JOSM is a desktop editor; its validator lists the problems it finds in a *Validation results* panel ([Help/Dialog/Validator](https://josm.openstreetmap.de/wiki/Help/Dialog/Validator)).

1. **Picking.** From the tree: one click highlights the error, a double click selects its objects (`MouseEventHandler.mouseClicked` in `gui/dialogs/ValidatorDialog.java`). From the map, *Lookup* selects a selection's errors in the tree.
2. **List and map.** The tree groups by severity, message and description and does not follow the view; one filter shows only the selection's errors. *Zoom to problem* frames the selected error.
3. **Density.** Errors are painted on a layer of their own, coloured by severity, no clusters (`ValidatorLayer.java`, `PaintVisitor.java`).
4. **After an answer.** *Fix* applies the chosen fixes as one undoable command and drops the fixed errors; *Ignore* saves to an ignore list. No *next error*.
5. **Filters.** Preferences, not an address.

**No location:** a relation is not drawn, so its error lives in the tree only. **Own address:** none.

## iD's issues panel

iD is the web editor on openstreetmap.org; its *Issues* pane lists what its validator finds.

1. **Picking.** A row click zooms to the issue and selects its first object (`focusIssue` in `modules/core/validator.js`). Selecting an object lists its issues in the inspector. The validator draws no marker of its own.
2. **List and map.** *Where: visible* keeps the issues whose extent meets the view, re-read one second after the map stops. Within a list the order is the rule, the subtype, then the distance from the map's centre; the list stops at 1,000 rows. Hovering a row highlights its objects (`validation_issues.js`).
3. **Density.** Nothing drawn per issue; the limits are the 1,000-row list and a footer count.
4. **After an answer.** Each issue offers its fixes, and *Ignore* for warnings; the validator runs again and the selection stays. No next issue.
5. **Filters.** *What*, *where* and the rules turned off are browser preferences (`validation_options.js`).

**No location:** an issue whose objects are not loaded is dropped. **Own address:** the hash holds the camera and the selection, not the pane.

## HOT Tasking Manager

The Tasking Manager splits a project into a grid of square tasks that mappers lock, map and hand to validators.

1. **Picking.** A click on a square or on its row selects it; the footer button then reads *Map selected task*, with nothing selected *Map a task* (TM `map.js`, `taskList.js`, `messages.js`).
2. **List and map.** One selection, shown on both; a task selected on the map turns the list to its page; each row can zoom to its task. The list's filters do not reach the map, which always gets every task (`mapResults={tasks}` in TM `index.js`).
3. **Density.** Every square drawn and coloured by status.
4. **After an answer.** *Map a task* picks one at random among the open ones (`getRandomTaskByAction`); a manager can force random selection. After a submission the button reads *Map another task*.
5. **Filters.** The list's search, status and order are query parameters; they do not reach the map.

## Airbnb search

1. **Picking.** Results are oval pins with a price; lower-ranked ones are smaller *mini-pins*, which get about eight times fewer clicks ([airbnb.tech/?p=683](https://airbnb.tech/?p=683)). A pin opens a card by a 2016 write-up ([ClickZ](https://clickz.com/?p=94783)); *not confirmed* today.
2. **List and map.** "You can zoom in or move around the map to find additional listings" ([Help article 421](https://www.airbnb.com/help/article/421)). Airbnb's paper on ranking for the map calls the bounds "a second source of searches" and says about 80% of searches come from the map ([arXiv 2407.00091](https://arxiv.org/html/2407.00091v1)). A row hover highlighting its pin is reported only by a third party.
3. **Density.** A ranked subset, not clusters: 18 cards a page with a pin each, and a listing becomes a pin only above a booking-probability threshold. The Lisbon results page fetched on 2026-11-13 ("Over 1,000 homes") held 20 map items, 12 full pins and 8 mini-pins.
4. **After picking.** No *next*.
5. **Filters.** One request feeds the grid and the map; the bounds are query parameters beside the filters.

**No location:** an exact spot a host hides is drawn as a shaded circle ([Help article 2141](https://www.airbnb.com/help/article/2141)). On a phone, list and map cannot be used at the same time (arXiv, above).

## Zillow search

1. **Picking.** "Homes … will appear on a map as colored dots. Click on a dot to see information on that home" ([advanced-search guide, archived 2025-07-25](https://web.archive.org/web/20250725210939/https://www.zillow.com/learn/zillow-advanced-search/)).
2. **List and map.** Results follow the visible area and a selected listing highlights its pin, by a third party ([raw.studio](https://raw.studio/blog/using-maps-as-the-core-ux-in-real-estate-platforms/)); *not confirmed*.
3. **Density.** Counted clusters that split on zoom, by the same third party. Zillow's Seattle page of June 2025 held 2,497 results at 41 a page and 20 pages ([archived 2025-06-12](https://web.archive.org/web/20250612200251/https://www.zillow.com/seattle-wa/)).
4. **After picking.** No *next*; a home or a search can be saved with alerts.
5. **Filters.** One state holds both views: `isMapVisible`, `isListVisible`, `mapBounds`, `mapZoom`, `filterState`, `pagination` (archived Seattle page).

## Google Maps search

1. **Picking.** "Results appear as red mini-pins and red dots. Mini-pins show the top results" ([Maps help 6303244](https://support.google.com/maps/answer/6303244)).
2. **List and map.** The list updates as the map moves, by third parties ([Search Engine Roundtable](https://seroundtable.com/google-maps-updates-search-interface-22888.html)); the apps show *Search this area* after a pan.
3. **Density.** Labelled mini-pins for the top results and bare dots for the rest.
4. **After picking.** No *next*.
5. **Filters.** Filters apply to the results; the list can be shared as a link ([Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)).

**WikiShootMe** ([Meta-Wiki](https://meta.wikimedia.org/wiki/WikiShootMe)) draws items with a picture green and without one red, toggled per layer; a click opens a popup where a photo can be added; the view is an address hash. It has no list and no *next*.

## General guidance on the split

- **Baymard Institute** ([accommodations split view](https://baymard.com/blog/accommodations-split-view)) recommends a list and a map side by side by default, with a list that updates as the map moves: 75% of users who zoomed a separate map then got a list that "didn't reflect the narrowing". It names maps laid over the list a pitfall.
- **Nielsen Norman Group** (2014, phones; [NN/g](https://www.nngroup.com/articles/mobile-maps-locations/)) advises a way to hide the map, warns that pins too close together cannot be tapped, and calls numbered cluster icons confusing; the clustering advice is older than today's real-estate search.

## Comparison

| Tool | Picking from the map | List and map in step | Dense areas | After an answer | Filters across views | No location | Map is an address |
|---|---|---|---|---|---|---|---|
| MapRoulette | Popup with *Start*; cluster zooms; lasso | Search and admin table follow the view; lasso and checkboxes share a selection | Server k-means, 25 clusters above 1,000 tasks | Random, nearest by distance, or picked from a nearby map | Query string; method is a preference | Refused at import | Task yes; view no |
| Osmose | Popup with the whole issue | None; separate table | 100 a tile; heat layer off by default | Marker hidden; nothing next | Hash, shared with the table | Refused; several locations, several markers | Camera, filters, open issue |
| JOSM | Tree first; *Lookup* | Tree ignores the view | All painted by severity | Fixed errors leave; nothing next | Preferences | Relation's error in the tree only | No |
| iD | Row click zooms and selects | List can follow the view, by distance; row hover | Nothing drawn; list capped at 1,000 | Revalidates; nothing next | Preferences | Dropped if not loaded | Camera and selection |
| Tasking Manager | Square or row | Shared selection; no view filter | All drawn by status | *Map a task* at random | List filters in the query | Cannot occur | Task page yes |
| Airbnb | Price pin | Bounds are the search | Ranked pins plus mini-pins | Nothing next | One request, bounds in the query | Approximate circle | Yes |
| Zillow | Coloured dot | Follows the view (third party) | Counted clusters (third party) | Nothing next | One state with both views | Does not arise | Yes |
| Google Maps | Mini-pin | Follows the view (third party) | Mini-pins plus dots | Nothing next | Filters on results | Does not arise | Yes |

## What this suggests for the review queue

The queue differs from every tool above in three ways: its questions are about places, and a place can carry several questions; a work's or a part's question belongs to its museum or its whole; and the answer is given on a rich card, not in a popup. The options below are listed with their evidence; the mock decides.

### Where the map sits

- **List, map and card in three columns.** The search products and the Tasking Manager keep list and map side by side, and Baymard measured why. It costs width the card needs.
- **The map in the list's place, the card where it is.** A mode, as the issue words it: list and map are two faces of one column, and the card is unchanged. It loses the list beside the map unless a marker's selection opens a short list.
- **The card over the map.** Osmose's popup works because an Osmose issue is two buttons; the review card is far richer, and an overlay is what Baymard calls a pitfall.

### Whether the list follows the map

- **The list lists the view**, as iD, Airbnb, Zillow and the product's Map mode do. A curator who opens Rome reads Rome's questions, but the list's meaning changes from the queue's order to the view's.
- **The list stays the queue, the map shows it all**, as the Tasking Manager and Osmose do. Order and paging stay; the list does not match what the curator sees.
- **The list follows the map on request**, MapRoulette's *within map bounds* or Google's *search this area*: today's list by default, the view as one more filter the address carries.

### Density

The issue asks that every question under the filters be drawn or counted, which rules out Osmose's per-tile cap and Airbnb's ranked subset.

- **Heat below a zoom, markers above it**, as Map mode draws places: a tuned pattern, but heat says where questions are thick, not how many, and nothing is clickable until the markers appear.
- **Counted clusters**, as Discover and MapRoulette draw them: "37 here", zooming on a click. MapRoulette clusters on the server above 1,000 tasks; the queue's 15,709 points were read whole in a second, so clustering the whole set on the client is an option to measure.
- **Colour by kind of question**, as JOSM colours by severity and Osmose by item: the queue already has `KIND_COLOR`. A place holding questions of several kinds needs a rule: the oldest kind's colour, a split marker, or a neutral colour with a count.

### A place with several questions

408 points carry more than one question, at most 5.

- **One marker per place with a count**, opening a short list of its questions. It matches how a curator thinks of one place and supplies the list beside the map.
- **One marker per question, fanned out**, as MapRoulette's `spiderIfNeeded`.
- **Open the first question and step through the rest.**

### Questions with no point of their own

None of the tools offers a precedent: every queue refuses a task with no location before it is listed. On the queue as it stands every question is a place's and every place has a point, so the case is a rule to keep rather than a list to show: a work's question stays on its museum, a part's on its whole. Should a question without a point arise, it is counted beside the map and reachable from the count, as JOSM keeps a relation's error in its tree.

### The next question after an answer

- **The next in the list's order**: today's behaviour; on a map it may jump across the city.
- **The nearest open question under the same filters**, MapRoulette's *Nearby*: the server orders by distance from the question just answered. It fits a curator working one quarter, the issue's case, and needs a rule for the place's other questions (first) and for a place with none left.
- **Pick among the nearby ones**, MapRoulette's small map of 5 to 100: more control, one more step.
- **Random**: spreads many mappers; the queue has few curators, the weakest fit.

In every tool the answered task leaves the map at once (Osmose after 200 ms); the issue asks for the same.

### Filters, the address and Back

- **The mode in the address, beside the filters.** Every web tool with both views keeps one state for both. The review address already has `view` for the crowded-city tab, so the map is a new value of it or a parameter beside it; Back returns to the list.
- **The camera in the address, or not.** Osmose and iD keep it, so a link opens Rome; MapRoulette and the Tasking Manager do not. With the region filter framing the map, the camera may not need storing. If it is stored, a pan replaces the history entry (ADR-0051), so Back is not a list of pans.
- **Batch selection on the map.** MapRoulette's lasso fills the table's selection; leaving batches to the list keeps the map simpler.

## What this does not settle

- The current labels and hover behaviour of Airbnb's, Zillow's and Google Maps' map searches could not be confirmed from their own pages; those claims are marked.
- Whether the live MapRoulette site clusters through the backend's vector tiles, and its servers' limits, were not confirmed; the figures are the code's and the shipped configuration's.
