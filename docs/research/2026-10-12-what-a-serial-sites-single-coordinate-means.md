# What the single coordinate of a serial World Heritage site means (2026-10-12)

A serial World Heritage site is made of components, each with its own coordinate. The Danube Limes (Western Segment), for example, has 77. The catalogue held one more coordinate for such a site, `experiences.location`, and its value came from the World Heritage export. When the export reordered its list, that coordinate jumped: the Danube Limes moved from Carnuntum to near Linz, 180 km, and the move became a held question a curator could not answer (#1354). This report asks what that single coordinate is, according to UNESCO and to other projects, and what this codebase uses it for. It is the measurement [ADR-0095](../decisions/0095-a-place-of-several-points-has-no-coordinate-of-its-own.md) cites.

## What UNESCO asks for and publishes

- **The nomination format** ([Operational Guidelines](https://whc.unesco.org/en/guidelines/), WHC.25/01 of 16 July 2025, Annex 5, field 1.d) asks for two things:
  - for the property, "a point at the approximate centre of the nominated property";
  - for a serial property, also a table of the components, whose column is headed "Coordinates of the central point".

  The Guidelines do not say how a centre is chosen for a property strung along 600 km. The property-level point is not "the main component" and not "the first listed".
- **The List's page for the Danube Limes** (`whc.unesco.org/en/list/1608/`) shows no property-level coordinate. Its maps page shows a table of the 77 components, each with its own coordinates; the first row is "1608ter-001 Bad Gögging – Heilbad", at N48 49 33.3 E11 46 52.8.
- **The open dataset `whc001`** has a `coordinates` field beside `components_list` and `components_count`. No description of that field was found. That finding was read once through a path the site's `robots.txt` disallows, so it stands unverified until it is re-read through the dataset's explore page.

## What other projects do

- **Wikidata.** P625 is "geocoordinates of the subject". Its constraint expects a single value, with preferred rank where there are several. On the property's talk page, a thread on serial World Heritage sites found "no consensus". Its reply was that each part would ideally be its own item holding its coordinates.
- **OpenStreetMap.** A `site` relation groups distant parts. Its `label` role is a node "located at the coordinate where the place is typically labelled": a place to put a name, not a measurement.
- **Wikivoyage.** A listing's coordinates are "for map output", and `lat=NA | long=NA` is written where none applies.
- **Google Places.** A place has one `location`, a `viewport` for display, and `subDestinations` for its parts.

## What the catalogue used it for

These uses were read from the code on 2026-10-12:

- **Not used for regions.** Region assignment reads the component points only (`directPlacementSql`, `regionAssignmentService.ts`).
- **Not used for tiles.** No Martin function reads the column.
- **Markers.** A marker is drawn per component (`buildMarkers.ts`).
- **The one effective role:** choosing which component stands for the place where only one can, as the component nearest the stored point:
  - the list row and the detail's position (`readerPositionSql`);
  - the folded world point (`foldedQuery`);
  - a marker drawn before the components are loaded.
- **Three further reads:**
  - a move of the stored point became a held "major" `location` change;
  - the review card's header printed its numbers;
  - one catalogue check compares an archaeology site with a World Heritage site by it.

## Conclusion

For a place made of several points, the single coordinate is a display convenience, not a geographic fact. UNESCO defines it only as an approximate centre, does not publish it on the site's page, and keeps the geography in the components' table. Every other project read either keeps a representative point marked as one, or none. The catalogue already reads the geography from the components; the stored point only chooses which component stands for the place.

## Method

The UNESCO pages and the Guidelines PDF were read with a research bot's User-Agent within `whc.unesco.org`'s `robots.txt`. Wikidata and the OpenStreetMap wiki were read on their `/wiki/` pages. Three early reads went to paths their sites' `robots.txt` disallows: the `data.unesco.org` API, and the `/w/` raw pages of wikidata.org and wiki.openstreetmap.org. Every quotation above was re-checked on an allowed page, except the dataset field noted above. The codebase map was read on `main` at c8030bda0.
