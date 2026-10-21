# How map products and guides sort sights, and what the surveys expect (2026-10-21)

The study #1163 asked for before it drew the line between its kinds. Public Art & Monuments had
become a mixed bag. It held the Manneken Pis and the Lincoln Memorial side by side, and also the
Tsar Bell, the Anne Frank House and Sanabria Lake. Meanwhile no kind offered the Eiffel Tower, the
Galata Tower or the Golden Gate Bridge. The report reads how eight map products, guides and open
data models sort sights into categories, and how the 21 surveyed regions' expectations
(`db/catalogue-coverage/`) sort. It states no decision; ADR-0131 does.

All pages were fetched on 2026-10-21 with the WebFetch tool. That tool does not let the caller set a User-Agent, so no custom header was sent, and no e-mail address or name went into any request. A source counts only where a page was actually fetched and read. Where only part of a source could be read, the section says so.

## Host table

| Host | robots.txt verdict for the paths used | Terms | Outcome |
|---|---|---|---|
| developers.google.com | Allowed (only `/youtube/partner/` is disallowed) | developer docs | Read |
| developer.apple.com | Allowed (`/documentation/dataformats/` and `/reference/` are disallowed; `/documentation/mapkit/…` and `/tutorials/data/…` are not) | developer docs | The HTML page renders by JS and came back empty, so the DocC JSON was read instead |
| docs.foursquare.com | Allowed (`/edit/`, `/login`, `/*/api-next` and a few others are disallowed) | developer docs | Read, but the full category tree sits in embedded Observable notebooks the fetch cannot render |
| observablehq.com | robots.txt answered HTTP 429 | — | **Not read**: robots could not be checked |
| huggingface.co | `Allow: /` | the dataset is gated behind an agreement | Only the dataset card was read; the gated categories file was not |
| wiki.openstreetmap.org | Allowed (`/w/`, `/api/` and `/wiki/Special:` are disallowed; Key:/Tag: pages are not) | open | **Every page answered HTTP 503** (about ten attempts across the session) |
| github.com | `/blob/` allowed; `/tree/` and `/raw/` disallowed | open source | Read `/blob/` files of `openstreetmap/id-tagging-schema` (the iD editor's OSM presets) as the stand-in for the OSM wiki |
| taginfo.openstreetmap.org | `/api`, `/keys` and `/tags` disallowed | — | Not used |
| schema.org | Allowed (`/docs/search_results.html` disallowed) | open | Read |
| en.wikivoyage.org | Allowed (`/w/`, `/api/` and `/wiki/Special:` disallowed; `Wikivoyage:` pages allowed) | CC BY-SA | Read |
| en.wikipedia.org | Allowed for article pages | CC BY-SA | Read one article, only to get a Wikidata item id |
| www.wikidata.org | `/wiki/Q…` allowed; `/w/` (so `api.php`) and `/wiki/Special:` disallowed | CC0 | Item pages read |
| docs.overturemaps.org | robots.txt returns 404, so nothing is disallowed | CDLA / open | Read |
| www.tripadvisor.com | robots allows `/Attractions-` paths | **The Terms of Use forbid** access "using any robot, spider, scraper or other automated means" (read at tripadvisor.mediaroom.com/us-terms-of-use) | **Skipped** |
| tripadvisor-content-api.readme.io | `Disallow: /` for every agent | — | **Skipped** |
| www.lonelyplanet.com | robots allows `/…/attractions`; it disallows `*?type`, `*?subtype`, `*?category` and `/*/articles/category/*` | the website-terms page came back with its terms text truncated, and only a search summary said it bans robots, spiders and scrapers | **Skipped as a precaution**: the terms could not be read and are reported to forbid automated access |
| www.atlasobscura.com | robots.txt answered HTTP 403 | — | **Skipped** |
| www.getyourguide.com | robots.txt answered HTTP 403 | — | **Skipped** |
| docs.viator.com | the technical docs and the tags spreadsheet (`/partner-api/technical/…`, `v1-subcategories-v2-tags.xlsx`) are disallowed | — | **Skipped**: the taxonomy lives on a disallowed path |
| www.yelp.com | `Disallow: /` for `*`, for ClaudeBot and for Claude-User (apart from `/article`) | — | **Skipped** |
| voyages.michelin.fr | DNS lookup failed (ENOTFOUND) | — | **Michelin Green Guide not read**; no other fetchable page that publishes its categories was found |
| raw.githubusercontent.com, cdn.jsdelivr.net, unpkg.com | robots.txt answered 404, 400 and an unusable page | — | Not used |

---

## 1. Google Maps Platform: Places API (New) place types

- URL: https://developers.google.com/maps/documentation/places/web-service/place-types (fetched 2026-10-21; the page footer says it was last updated 2026-10-20)
- **Structure.** The types are flat names. In the documentation they are grouped into **19 Table A categories**:
  - Automotive, Business, Culture, Education, Entertainment and Recreation, Facilities, Finance, Food and Drink, Geographical Areas, Government, Health and Wellness, Housing, Lodging, Natural Features, Places of Worship, Services, Shopping, Sports, Transportation.
  - The groups exist only in the documentation. A type has no parent in the API.
  - **Table B** holds extra values that a response may return but a request cannot filter on, such as `landmark`, `point_of_interest`, `place_of_worship`, `town_square`, `natural_feature` and `establishment`.
- **The sight-related branches:**
  - **Culture**: art_gallery, art_museum\*, art_studio, auditorium, castle\*, cultural_landmark, fountain\*, historical_place, history_museum\*, monument, museum, performing_arts_theater, sculpture
  - **Entertainment and Recreation**: amusement_park, aquarium, botanical_garden, city_park\*, cultural_center, ferris_wheel, garden, hiking_area, **historical_landmark**, marina, national_park, **observation_deck**, opera_house, park, planetarium, **plaza**, state_park, **tourist_attraction**, visitor_center, wildlife_park, wildlife_refuge, zoo … (plus non-sight venues such as bowling alleys and night clubs)
  - **Natural Features**: beach, island\*, lake\*, mountain_peak\*, nature_preserve\*, river\*, scenic_spot\*, woods\*
  - **Places of Worship**: buddhist_temple, church, hindu_temple, mosque, shinto_shrine, synagogue (`place_of_worship` itself is in Table B only)
  - **Transportation**: bridge\* (among the stations and other transport types)
  - **Services**: cemetery
  - \* = added in the 12 February 2026 release, as the page marks them.
- **Point 1, how the sights split.**
  - Monument, sculpture, fountain and castle are four separate types, all under Culture.
  - The page has **no** type for memorial, statue, public art, street art or mural, tower, gate, palace, fort, ruins or archaeological site, monastery, cathedral or temple (as a generic type).
  - "Historic" appears twice: `historical_place` sits under Culture, and `historical_landmark` under Entertainment and Recreation.
  - "Landmark" appears three times: `cultural_landmark` (Culture), `historical_landmark` (Entertainment and Recreation) and `landmark` (Table B).
  - Museums have three sub-types (art_museum, history_museum, art_gallery), but these are siblings of `museum` rather than its children.
- **Point 2, multiple and hierarchical.** A place carries **several** `types` and at most one `primaryType`, which is always one of its `types`. There is no hierarchy beyond the documentation's grouping.
- **Point 3, how the category is shown.** The page does not describe the consumer UI. The types are what an app filters on (`includedTypes` / `includedPrimaryTypes`).

## 2. Apple MapKit: MKPointOfInterestCategory

- **URLs.**
  - https://developer.apple.com/documentation/mapkit/mkpointofinterestcategory: the HTML renders by JS and came back empty.
  - The DocC JSON behind it was read instead: https://developer.apple.com/tutorials/data/documentation/mapkit/mkpointofinterestcategory.json, plus `/landmark.json` and `/nationalmonument.json` (fetched 2026-10-21).
- **Tree (the page's own topic groups):**
  - Arts and culture: museum, musicVenue, theater
  - Education: library, **planetarium**, school, university
  - Entertainment: movieTheater, nightlife
  - **Historical and cultural landmarks: castle, fortress, landmark, nationalMonument**
  - Parks and recreation: amusementPark, aquarium, beach, campground, fairground, marina, nationalPark, park, rvPark, zoo
  - Sports (15 sports, from baseball to volleyball), Water sports (fishing, kayaking, surfing, swimming)
  - Food and drink; Personal services; Health and safety; Travel (airport, hotel, parking, publicTransport …)
  - An ungrouped "Type properties" list: scenicView, visitorCenter, informationBooth, picnicArea, rangerStation, restArea, ticketOffice and others.
- **The newer categories.** `landmark` and `nationalMonument` are marked introduced in iOS 18.0 / macOS 15.0. Their abstracts only restate the names, for example "The point of interest category for landmarks." castle, fortress, planetarium and scenicView belong to the same expanded set.
- **Point 1, how the sights split.**
  - One small "Historical and cultural landmarks" group covers everything built: castle, fortress, landmark, nationalMonument.
  - It has **no** category for statue, sculpture, public art, memorial, fountain, tower, bridge, square, ruins or archaeology.
  - It has **no place of worship category at all**, and none for church or temple.
  - museum has no sub-types. `scenicView` is the viewpoint category.
- **Point 2.** The API gives a map item one `pointOfInterestCategory`. The list is flat, and the groups are documentation topics.
- **Point 3.** The categories drive `MKPointOfInterestFilter`, which includes or excludes categories on the map. Apple Maps draws an icon per category.

## 3. Foursquare Places taxonomy (partial)

- **URLs.**
  - https://docs.foursquare.com/data-products/docs/categories
  - https://docs.foursquare.com/places/docs/categories
  - https://docs.foursquare.com/developer/docs/categories
  - https://docs.foursquare.com/data-products/docs/places-categories-faqs
  - https://huggingface.co/datasets/foursquare/fsq-os-places (all fetched 2026-10-21)
- **Not read.** The full tree lives in two embedded Observable notebooks (`observablehq.com/embed/da51c7e6d46cd01e`, `…/aa026a10c12071a1`). Their host answered robots.txt with HTTP 429, so they were not fetched. The Hugging Face categories file is gated.
- **What the fetched pages state.**
  - The taxonomy is proprietary and holds "1K+ categories".
  - A place stores the ID of its "most granular category (or categories)", so **one place can have several categories**.
  - The tree is hierarchical: the FAQ's deepest example runs six levels, Dining and Drinking > Restaurant > … > Acai House.
- **Top-level branches named in the FAQ:** Arts and Entertainment, Business and Professional Services, Community and Government, Dining and Drinking, Event, Health and Medicine, **Landmarks and Outdoors**, Retail, Sports and Recreation, Travel and Transportation.
- **Sight-related paths that appear on the fetched pages:**
  - **Arts and Entertainment > Public Art > Outdoor Sculpture**
  - **Arts and Entertainment > Public Art > Street Art**
  - Arts and Entertainment > Amusement Park > Attraction; Arts and Entertainment > Zoo > Zoo Exhibit
  - **Landmarks and Outdoors > Structure** (renamed from "Building / Structure"); Landmarks and Outdoors > Park > State or Provincial Park; Landmarks and Outdoors > Hill / Tree / Well / Dam …
  - Renames in the Personalization taxonomy: "Monuments / Landmarks" → "**Monuments**"; "Historic Sites" → "**Historic and Protected Sites**"; "Buildings" → "Structures"; "Street Art Installations" → "Street Arts".
- **Point 1.** Public art (sculpture, street art) sits under **Arts and Entertainment**, while monuments, historic and protected sites, structures and parks sit under **Landmarks and Outdoors**. Foursquare thus separates "art in public" from "monument/landmark". The full sub-trees (castle, palace, memorial, fountain, bridge, the museum sub-types, the spiritual centres) could not be read.
- **Point 3.** Not documented on the fetched pages. The API responses show the most granular label, not the breadcrumb.

## 4. OpenStreetMap: read through the iD editor's tagging schema

- **The OSM wiki could not be read.** wiki.openstreetmap.org answered HTTP 503 to every request: Key:tourism, Key:historic, Key:artwork_type, Key:memorial, Map_features, Tag:tourism=artwork and Tag:historic=monument.
- **What was read instead.** The OSM model was read from `openstreetmap/id-tagging-schema`, the preset and field definitions the default OSM editor ships (fetched 2026-10-21):
  - `https://github.com/openstreetmap/id-tagging-schema/blob/main/data/fields/{historic,memorial,artwork_type,castle_type,tourism,museum}.json`
  - `https://github.com/openstreetmap/id-tagging-schema/blob/main/data/presets/{tourism/attraction,tourism/artwork,tourism/viewpoint,tourism/museum,historic/monument,man_made/obelisk,man_made/tower/observation,man_made/bridge,amenity/fountain,amenity/place_of_worship,place/square}.json`
- **Tree (keys and values as tagged):**
  - `historic=*` (the iD "Type" field lists 27 options): memorial, monument, castle, manor, fort, city_gate, citywalls, ruins, archaeological_site, building, church, tomb, wayside_cross, wayside_shrine, boundary_stone, milestone, cannon, aircraft, wreck, pillory, millstone, mine, mine_shaft, railway, bomb_crater, charcoal_pile, shieling
    - `memorial=*` (the subtype of historic=memorial): plaque, blue_plaque, war_memorial, stolperstein, statue, bust, sculpture, stele, stone, obelisk, cross, ghost_bike
    - `castle_type=*`: defensive, palace, stately, manor, fortress, castrum (Roman fort), shiro, kremlin, hillfort
  - `tourism=artwork` (search terms: mural, sculpture, statue; fields: artwork_type, artist)
    - `artwork_type=*`: sculpture, statue, bust, mural, graffiti, installation, painting, mosaic, relief, stone, tilework
  - `tourism=attraction` (preset "Tourist Attraction", star icon), `tourism=viewpoint`, `tourism=museum` (+ `museum=*` type combo), `tourism=gallery`
  - `amenity=fountain`; `amenity=place_of_worship` (+ `religion`, `denomination`)
  - `man_made=tower` + `tower:type=observation` (Observation Tower); `man_made=bridge`; `man_made=obelisk`
  - `place=square`
- **Point 1, how the sights split.**
  - OSM separates the **commemorative function** (`historic=memorial` with its `memorial=*` subtype, `historic=monument`) from the **art form** (`tourism=artwork` with its `artwork_type=*`).
  - A statue that is a war memorial can carry both: historic=memorial + memorial=statue, or tourism=artwork + artwork_type=statue. The two vocabularies even overlap (statue, bust, sculpture, stone appear in both).
  - Castles, palaces, manors and forts are one key with a typed subkey. Gates and city walls are historic=*. Ruins and archaeological sites are separate values.
  - Towers, bridges and obelisks are `man_made=*`, so they are structures first and sights only through `tourism=attraction` or a `historic=*` tag.
- **Point 2.** Tags are free and combinable. A feature can have `tourism=attraction` + `historic=castle` + `amenity=place_of_worship` at once. Each key is flat, with a typed subkey for depth. `tourism=attraction` is an overlay meaning "a tourist goes there", not a type.
- **Point 3.** The editors and renderers show one preset or icon per feature, chosen by preset match score. In iD, `tourism=attraction` has a 0.75 match score, below a specific preset.

## 5. schema.org

- **URLs.** https://schema.org/TouristAttraction, /Place, /CivicStructure, /LandmarksOrHistoricalBuildings, /Landform, /BodyOfWater, /PlaceOfWorship, /TouristDestination (all fetched 2026-10-21)
- **Tree.** Thing > Place >:
  - Accommodation, AdministrativeArea, CivicStructure, DefinedRegion, Landform, **LandmarksOrHistoricalBuildings**, LocalBusiness, Residence, **TouristAttraction**, **TouristDestination**
  - CivicStructure > Aquarium, Beach, **Bridge**, Cemetery, **Museum**, **Park**, **PlaceOfWorship** (> BuddhistTemple, Church, HinduTemple, Mosque, Synagogue), Zoo, MusicVenue, PerformingArtsTheater, Playground, StadiumOrArena, … (31 subtypes in all, transport and civic services included)
  - Landform > BodyOfWater (> Canal, LakeBodyOfWater, OceanBodyOfWater, Pond, Reservoir, RiverBodyOfWater, SeaBodyOfWater, Waterfall), Continent, Mountain, Volcano
  - LandmarksOrHistoricalBuildings has no subtypes and no properties of its own; it is defined as "An historical landmark or building."
- **Point 1.** There is no type for monument, memorial, statue, public art, fountain, tower, castle or ruins. All of these fall into LandmarksOrHistoricalBuildings, or into TouristAttraction used as an extra type.
- **Point 2.** TouristAttraction and TouristDestination are explicitly meant as an `additionalType` on any other type (a Museum + TouristAttraction). In principle any Thing can be one. Multi-typing is the design: the type says **what a place is**, and TouristAttraction says **that tourists go there**. TouristAttraction adds `touristType` (an audience) and `availableLanguage`. TouristDestination adds `includesAttraction`.
- **Point 3.** Not applicable. schema.org is a markup vocabulary.

## 6. Wikivoyage (English)

- **URLs, all fetched 2026-10-21.**
  - https://en.wikivoyage.org/wiki/Wikivoyage:Article_templates/Sections
  - https://en.wikivoyage.org/wiki/Wikivoyage:Huge_city_article_template
  - https://en.wikivoyage.org/wiki/Wikivoyage:Listings
  - Two real articles: https://en.wikivoyage.org/wiki/Berlin/Mitte and https://en.wikivoyage.org/wiki/Brussels/Pentagon
  - Three guessed page names answered 404 and were not read: `Wikivoyage:See`, `Wikivoyage:City_article_template`, `Wikivoyage:Where_to_list_attractions`.
- **Structure.** The top split is by what the traveller does: **See** (passive, standing sights: galleries, museums, zoos, parks, landmarks, scenery, observation towers), **Do** (active pursuits and events: sports, theatres, tours, hiking, skiing; an Events sub-section), then Buy, Eat, Drink, Sleep, Go. Where the line blurs (amusement parks, tiny places) the two may be merged.
- **Inside See.**
  - The guidance proposes **no fixed sub-headings by type**. It only offers an optional "Itineraries" sub-section.
  - The Huge City template suggests grouping similar sights in prose and lets the section split by theme, naming museums, historic sites and entertainment venues as examples.
  - In practice editors pick per article:
    - Berlin/Mitte splits See **by neighbourhood**: Dorotheenstadt/Unter den Linden, Museumsinsel, Alexanderplatz and Alt-Berlin, … plus "Private art galleries".
    - Brussels/Pentagon splits it **by type**: "Museums and galleries", "Churches", with unfiled sights directly under See.
- **Point 1.** No fixed monument, statue or landmark split. The sub-groups are editorial and local.
- **Point 2.** A listing sits in one section (`{{see}}`). The See listing has no type field. The `{{listing}}` template has a `type`, but that type is the section (see, do, eat …), not a sight category. A listing may carry a `wikidata` id.
- **Point 3.** Listings appear as numbered markers on the article's map, coloured by section.

## 7. Tripadvisor: skipped

The Terms of Use (https://tripadvisor.mediaroom.com/us-terms-of-use, fetched 2026-10-21) forbid accessing or copying content "using any robot, spider, scraper or other automated means" without written permission. The Content API docs host (tripadvisor-content-api.readme.io) disallows everything in robots.txt. **No Tripadvisor category names were collected.**

## 8. Lonely Planet, Michelin Green Guide, Atlas Obscura, GetYourGuide, Viator: skipped

- **Lonely Planet.** Robots allows attraction pages, but the URL parameters that carry the type filter (`?type`, `?subtype`, `?category`) are disallowed. The terms page could not be read in full, and a search summary reports a ban on robots and scrapers. Skipped.
- **Michelin Green Guide.** The host was not found, and no fetchable page publishing its sight categories was found. Not read.
- **Atlas Obscura and GetYourGuide.** robots.txt answered 403. Skipped.
- **Viator.** The tags taxonomy is on paths robots.txt disallows. Skipped.
- **Yelp** (a considered extra) disallows all agents. Skipped.

## 9. Extra: Overture Maps places taxonomy (2026-09 canonical)

- **URLs.**
  - https://docs.overturemaps.org/guides/places/
  - https://docs.overturemaps.org/guides/places/taxonomy/
  - https://docs.overturemaps.org/taxonomy/2026-09-23.0/taxonomy.csv (read in full, in four parts)
  - https://docs.overturemaps.org/taxonomy/2026-09-23.0/basic_categories.csv
  - All fetched 2026-10-21. This is the open taxonomy the Overture consortium publishes for its places data.
- **The 13 top-level categories:** arts_and_entertainment, community_and_government, **cultural_and_historic**, education, food_and_drink, geographic_entities, health_care, lifestyle_services, lodging, services_and_business, shopping, sports_and_recreation, travel_and_transportation. This release reduced the top level from 22 to 13.
- **Sight-related sub-trees:**
  - **cultural_and_historic**
    - cultural_center
    - **historic_site** > castle, fort, historic_mission, historic_tower, lighthouse, palace, ruin
    - **memorial_site** > cemetery, memorial_park, **monument**
    - **place_of_worship** > buddhist / christian (> eastern_orthodox > greek, russian, serbian …; oriental_orthodox > armenian_apostolic, coptic, ethiopian …; protestant > …; roman_catholic > eastern / western) / hindu / jewish / muslim / sikh …
    - **religious_landmark** > pilgrimage_site (> buddhist, christian, hindu, muslim), shrine (> catholic_shrine, shinto_shrine, sufi_shrine)
    - religious_organization > convent, **monastery**, seminary
    - religious_retreat_or_center
  - **arts_and_entertainment**
    - **museum** > art_museum (> asian_art, contemporary_art, decorative_arts, design, modern_art, photography, textile, costume, cartooning), history_museum (> civilization, community), aviation, childrens, military, national, science (> computer), sports, state
    - **arts_and_crafts_space** > art_gallery, **sculpture_park**, **sculpture_statue**, **street_art**
    - animal_attraction > aquarium, zoo, wildlife_sanctuary
    - science_attraction > observatory, planetarium …
    - amusement_attraction > amusement_park …
  - **geographic_entities**
    - built_feature > **bridge**, **garden** (> botanical_garden), **lookout**
    - **scenic_viewpoint** (> skyline, stargazing_area)
    - land_feature > cave …
    - water_feature > waterfall …
  - **community_and_government** > public_facility > **public_fountain**, **public_plaza**
  - **sports_and_recreation** > park > national_park, state_park …; recreational_trail_or_path > hiking_trail …
  - **travel_and_transportation** > travel_service > tour_operator (> architectural_tour, historical_tour, walking_tour, …), visitor_center
- **Point 1, how the sights split.**
  - **Monument sits under memorial_site**, not under art.
  - **sculpture_statue and street_art sit under arts_and_crafts_space**, beside art_gallery and sculpture_park.
  - Castle, palace, fort, ruin, lighthouse and historic tower are kinds of **historic_site**.
  - Religious **landmark** and pilgrimage site are kept apart from **place_of_worship**, and both sit under cultural_and_historic.
  - Fountains and plazas are public facilities. Bridges and lookouts are built features.
  - Museums have a deep sub-tree.
- **Point 2.**
  - A place has one `taxonomy.primary` (the most specific label), its `hierarchy` path from the top level down, and a list of `alternates`.
  - In parallel each place gets one **`basic_category`**, out of 298 "cognitively basic" labels, which the docs recommend for high-level filtering and map icons.
  - The sight-related basic categories are: museum, art_gallery, cultural_center, sculpture_statue, street_art, monument, memorial_site, cemetery, historic_site, castle, fort, lighthouse, place_of_worship (+ five by religion), religious_landmark, bridge, public_fountain, public_plaza, park, national_park, garden, nature_reserve, scenic_viewpoint, beach, waterfall, zoo, aquarium.
- **Point 3.** Two levels: the detailed hierarchy for the data, and a short flat basic list for what a user filters and sees as an icon.

## 10. Extra: Wikidata class structure (the source most of the catalogue reads)

- **URLs.** https://www.wikidata.org/wiki/Q570116, /Q4989906, /Q5003624, /Q557141, /Q2319498, /Q4895393, /Q179700, /Q219423, /Q152072, and https://en.wikipedia.org/wiki/Manneken_Pis (only to find that item's id). All fetched 2026-10-21.
- **Classes, each with its "subclass of" (P279) values:**

| Item | Label | Subclass of |
|---|---|---|
| Q570116 | tourist attraction | point of interest (Q960648), amenity (Q867393). The item is an instance of "type of place". |
| Q4989906 | monument | built structure (Q811979), **work of art** (Q838948) |
| Q5003624 | memorial | memory space (Q1354775), **monument** (Q4989906). Described as smaller than a monument. |
| Q557141 | public art | work of art (Q838948) |
| Q179700 | statue | sculpture (Q860861), figure (Q29527347), artificial physical object (Q8205328) |
| Q219423 | mural | wall art (Q118495619), painting (Q3305213) |
| Q2319498 | architectural landmark | built structure, landmark (Q4895393), tourist attraction (Q570116) |
| Q4895393 | landmark | geographical feature (Q618123). Its description points architectural landmarks to Q2319498. |

- **The worked example.** Manneken Pis (Q152072) is an instance of **sculpture** (Q860861) and **heritage site** (Q358).
- **Point 1.** Wikidata's own classes put monument under both *built structure* and *work of art*, and memorial under monument. Public art, statue and mural are works of art. Landmark is a navigational feature unless it is an *architectural* landmark.
- **Point 2.** A place has as many P31 values as apply. The classes form a lattice, not a tree.
- **Point 3.** Not applicable. Wikidata is a data model with no traveller-facing UI.

---

## Cross-source synthesis

Each cell gives the category the source puts the concept in. "—" means the source has no category for it. Foursquare cells come only from the paths that could be read.

| Concept | Google Places | Apple MapKit | Foursquare (partial) | OSM (iD schema) | schema.org | Wikivoyage | Overture 2026-09 | Wikidata |
|---|---|---|---|---|---|---|---|---|
| Monument | Culture › monument | Hist. & cultural landmarks › nationalMonument | "Monuments" (renamed from "Monuments / Landmarks") | historic=monument | LandmarksOrHistoricalBuildings | See (editorial) | cultural_and_historic › memorial_site › monument | built structure + work of art |
| Memorial | — (monument / historical_landmark) | — | (parent not read) | historic=memorial + memorial=* (12 subtypes) | LandmarksOrHistoricalBuildings | See | cultural_and_historic › memorial_site | subclass of monument |
| Statue / sculpture | Culture › sculpture | — (landmark) | Arts & Ent. › Public Art › Outdoor Sculpture | tourism=artwork + artwork_type=statue/sculpture/bust (or memorial=statue) | — (TouristAttraction add-on) | See | arts_and_entertainment › arts_and_crafts_space › sculpture_statue / sculpture_park | sculpture ⊂ work of art |
| Public art (generic) | — | — | Arts & Ent. › Public Art | tourism=artwork | — | See | arts_and_crafts_space | work of art |
| Street art / murals | — | — | Arts & Ent. › Public Art › Street Art | artwork_type=mural / graffiti | — | See / Do (tours) | arts_and_crafts_space › street_art | mural ⊂ painting, wall art |
| Fountain | Culture › fountain | — | (not read) | amenity=fountain | — | See | community_and_government › public_facility › public_fountain | — |
| Landmark (generic) | Table B landmark; cultural_landmark; historical_landmark | landmark | "Structure(s)" under Landmarks and Outdoors | tourism=attraction (overlay) | LandmarksOrHistoricalBuildings | See | — (no generic landmark) | architectural landmark ⊂ tourist attraction |
| Tower | — (observation_deck) | — | (not read) | man_made=tower + tower:type=observation | — | See ("observation towers") | historic_site › historic_tower | — |
| Bridge | Transportation › bridge | — | (not read) | man_made=bridge | CivicStructure › Bridge | See | geographic_entities › built_feature › bridge | — |
| Gate / city walls | — | — | (not read) | historic=city_gate / citywalls | — | See | — | — |
| Square / plaza | Ent. & Rec. › plaza; Table B town_square | — | (not read) | place=square | — | See | public_facility › public_plaza | — |
| Historic site (generic) | Culture › historical_place; Ent. & Rec. › historical_landmark | landmark / nationalMonument | "Historic and Protected Site(s)" | historic=* (27 values) | LandmarksOrHistoricalBuildings | See ("historic sites" as example sub-heading) | cultural_and_historic › historic_site | heritage site (Q358) on the item |
| Ruins / archaeology | — | — | (not read) | historic=ruins; historic=archaeological_site | — | See | historic_site › ruin | — |
| Castle / palace / fort | Culture › castle (no palace or fort) | castle, fortress | (not read) | historic=castle + castle_type (defensive, palace, stately, manor, fortress, castrum, shiro, kremlin, hillfort); historic=fort, manor | — | See | historic_site › castle / palace / fort | — |
| Notable building / architecture | — | landmark | Landmarks and Outdoors › Structure | historic=building | LandmarksOrHistoricalBuildings | See | — (historic_site) | architectural landmark |
| Place of worship | Places of Worship (6 types by religion) | — (none) | Community and Government › Spiritual Center (not read) | amenity=place_of_worship + religion + denomination | CivicStructure › PlaceOfWorship (5 by religion) | See ("Churches" sub-heading in Brussels/Pentagon) | cultural_and_historic › place_of_worship (by religion, then denomination); religious_landmark › shrine, pilgrimage_site; monastery | — |
| Museum (+ sub-types) | Culture › museum, art_museum, history_museum, art_gallery (siblings) | Arts and culture › museum (no sub-types) | (not read) | tourism=museum + museum=* ; tourism=gallery | CivicStructure › Museum | See ("Museums and galleries") | arts_and_entertainment › museum › art (9 sub), history (2), science, military, … | — |
| Park / garden | Ent. & Rec. › park, city_park, national_park, state_park, garden, botanical_garden | Parks and recreation › park, nationalPark | Landmarks and Outdoors › Park › … | (not read) | CivicStructure › Park | See | sports_and_recreation › park; geographic_entities › garden | — |
| Natural sights | Natural Features (beach, island, lake, mountain_peak, river, woods, nature_preserve) | beach, nationalPark | Landmarks and Outdoors (Hill, Tree …) | (not read) | Landform › Mountain, Volcano, BodyOfWater › Waterfall … | See ("scenery") | geographic_entities › land / water features | — |
| Viewpoint | Natural Features › scenic_spot; Ent. & Rec. › observation_deck | scenicView | (not read) | tourism=viewpoint | — | See | geographic_entities › scenic_viewpoint; built_feature › lookout | — |

### Where nearly every source agrees

1. **Places of worship are their own branch**, split by religion (Google, schema.org, OSM, Overture, and Foursquare's Spiritual Center). Apple is the only exception, with no category at all. Overture alone goes on to denomination, and it separates a working place of worship from a religious landmark or pilgrimage site.
2. **Museums are their own branch**, apart from monuments and public art. The sources that sub-type them (Google, Overture, OSM via `museum=*`) all split art from history; Overture also has science, military and others.
3. **Castles, palaces and forts belong together**, under historic or landmark (Apple castle + fortress, OSM castle_type, Overture historic_site, Google castle). None of them files a castle as a museum, even when it houses one.
4. **Public art and street art are an art category, apart from monuments.** Foursquare (Arts and Entertainment > Public Art), Overture (arts_and_crafts_space > sculpture_statue / street_art), OSM (tourism=artwork vs historic=*) and Wikidata (public art ⊂ work of art) all draw this line. Murals, graffiti and street art sit with art, never with monuments.
5. **Monument goes with memorial / commemoration**, not with art. Overture puts monument under memorial_site, OSM puts both under historic=*, Wikidata makes memorial ⊂ monument, and Google files monument as its own Culture type.
6. **Natural sights and viewpoints are a separate branch** from built sights: Google Natural Features, Overture geographic_entities, schema.org Landform, Apple scenicView.
7. **"Tourist attraction" is an overlay, not a type** (schema.org additionalType, OSM tourism=attraction, Google tourist_attraction beside the real type). Whether a place is worth visiting is orthogonal to what it is.
8. **A place can carry several categories**: Google types[] with one primaryType, Foursquare's "categories", Overture primary + alternates, OSM's free tag combination, schema.org multi-typing, Wikidata's several P31. Apple (one category) and Wikivoyage (one section) are the exceptions. The common pattern is **one primary category for display, more for search and filtering**.

### Where the sources disagree

- **Statue / sculpture.** Google, Foursquare, OSM and Overture each have a statue or sculpture category. Apple and schema.org have none. Within OSM, a statue can be tagged as art (`artwork_type=statue`) or as commemoration (`memorial=statue`): the statue-that-is-a-memorial is the overlap every model handles differently.
- **Generic "landmark".** Google has three (cultural, historical, Table B), Apple has one, and Overture and OSM deliberately have none. Wikidata separates a navigational landmark from an architectural one. Where the category exists it is a catch-all, which reproduces the "mixed bag" problem.
- **Towers, bridges, gates, squares.**
  - Overture spreads them over three branches: historic_tower under historic_site, bridge and lookout under built_feature, plaza under public_facility.
  - OSM spreads them over man_made=*, historic=* and place=*.
  - Google has bridge (Transportation) and plaza (Recreation) but no tower or gate. Apple has none of them.
  - No two sources agree on one "structures" bucket.
- **Fountain.** It is Culture in Google and a public facility in Overture and OSM (where amenity=fountain also covers drinking fountains). Apple and schema.org have none.
- **Ruins / archaeology.** These are a value of historic in OSM and Overture (ruin) and absent in Google, Apple and schema.org. None of the map products treats archaeology as a top-level branch.
- **Memorial vs monument.**
  - Wikidata (memorial is the smaller one, and a kind of monument) and Overture (monument is a kind of memorial_site) nest them in opposite directions.
  - OSM keeps them as siblings.
  - Google and Apple have only the monument side.
- **How sights are grouped for a traveller.** The products filter by category (Google types, Apple POI filters, Overture basic_category for icons and filters). The guidebook (Wikivoyage) groups by **area** as often as by type, with only an editorial "Museums and galleries" or "Churches" heading. There is no fixed sight taxonomy.

### What this reads as for "Public Art & Monuments" (observations, not decisions)

The field's majority split of the current bag would be:

- **public art**, with statue/sculpture, street art/murals and installations as sub-types (Foursquare, Overture, OSM, Wikidata);
- **monuments and memorials**, as commemoration (Overture memorial_site, OSM historic=memorial/monument);
- **historic sites / castles & palaces**, built heritage with castle, palace, fort, ruin and historic tower as sub-types (Overture historic_site, OSM historic=*, Apple);
- **landmark structures** (bridges, towers, gates, squares, fountains), where the sources scatter and only Google and Apple keep a catch-all "landmark".

In the current bag:

- The Brezhnev–Honecker mural is street art in every model that has the concept.
- Manneken Pis is a sculpture (Wikidata: sculpture + heritage site), so public art.
- A triumphal arch is a monument.
- A tower is a historic tower or a structure, depending on the model.

---

## What the surveyed regions expect

The coverage surveys (`db/catalogue-coverage/expectations/`, read on 2026-10-21) hold 4,486
entries over 21 regions, 3,269 of them places.

### Public Art & Monuments on the development catalogue

Kind 3 offered 178 places. Its run admits a place by one of two sets of Wikidata classes: the
commemorative ones (memorial, war memorial, cenotaph, triumphal arch, obelisk, victory column,
stele) and the art ones (sculpture, statue, fountain). Sorted by the classes each place carries,
together with "commemorates" (P547):

| Classes the place carries | Places | Examples |
|---|---|---|
| Commemorative only | 83 | the Arc de Triomphe, the Lincoln Memorial, the Brandenburg Gate, Mother Armenia |
| Art only | 60 | the Manneken Pis, the Trevi Fountain, the Little Mermaid, Cloud Gate, Maman |
| Both | 32 | the Bronze Horseman, the Motherland Calls, Christ the Redeemer, the Soviet War Memorial in Treptower Park |
| Neither | 3 | the Famine Stela, the Nestorian Stele, the Orkhon inscriptions |

About 20 of the 178 belong to no kind of the catalogue:
- objects shown inside another place: the Tsar Bell and the Tsar Cannon in the Kremlin, the
  Rondanini Pietà, the Portrait of the Four Tetrarchs, the Infant Jesus of Prague;
- museums and historic buildings: the Anne Frank House, Federal Hall, the Temple of Literature in
  Hanoi;
- a lake (Sanabria Lake), routes (the Way of Saint James, the Vía de la Plata) and gardens (the
  Villa d'Este);
- a work that is not visitable: Kryptos, in the CIA's courtyard.

A monument by intent can carry art classes only: the Statue of Liberty is typed a sculpture.

### The entries filed under the proposed Towers & landmarks kind

| What they are | Entries | Examples |
|---|---|---|
| Towers | 23 | the Galata Tower, the Ostankino Tower, the Qutb Minar, the Ivan the Great Bell Tower |
| City gates | 16 | Bab Zuweila, Tiananmen, the Delhi Gate, the Brandenburg Gate |
| City and frontier walls | 15 | the Great Wall at Mutianyu and Badaling, the Aurelian Walls, the Theodosian Walls |
| Water works | 10 | Agrasen ki Baoli, the Basilica Cistern, the Nilometer on Roda Island |
| Lighthouses | 9 | the Barrenjoey Lighthouse, the Farol da Barra |
| Stairs and lifts | 5 | the Spanish Steps, the Yerevan Cascade, the Elevador Lacerda |
| Others | 4 | the Twelve-angled stone, the World Clock on Alexanderplatz |

None of the towers, gates or lighthouses the surveys name is offered by any kind. The same holds
for the Eiffel Tower, the Golden Gate Bridge, Tower Bridge, the Atomium and the Spanish Steps.
