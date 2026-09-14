---
slug: openstreetmap-qlever
name: OpenStreetMap, the objects carrying a Wikidata tag, through the QLever osm-planet mirror
publisher: OpenStreetMap contributors (data); University of Freiburg, Chair of Algorithms and Data Structures (the endpoint)
urls:
  home: https://www.openstreetmap.org/
  dataset: https://qlever.dev/osm-planet
  api: https://qlever.dev/api/osm-planet
  terms: https://opendatacommons.org/licenses/odbl/1-0/
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, asked one batch of Wikidata items at a time" }
row:
  identity: "an OSM id (node/way/relation), unstable across re-mapping; the `wikidata` tag is what joins it to a catalogue row"
  wikidata_link: tag
  coordinates: all
  languages: [name and name:xx tags]
  signal: "what the object is tagged as — historic, place, archaeological_site, ruins, boundary, man_made"
terms:
  licence: "ODbL 1.0"
  database_right: share-alike
  attribution: "© OpenStreetMap contributors"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL (osm2rdf's RDF of the OSM planet), JSON results"
  cadence: continuous
  volume: "1,544 objects carrying `wikidata=<item>` for 885 of the 1,126 world-tier site candidates (2026-09-14); 20 queries of 100 items for the pool at its floor"
  rate: "no published numeric limit; the usage page asks a heavy user to run their own endpoint. This connector sends one batch of 100 at a time, pauses a second between batches, and caches every answer for a day"
scorecard:
  date: 2026-09-14
  completeness: 2
  identity: 1
  coordinates: 2
  names: 2
  signal: 2
  terms: 1
  access: 2
  cadence: 2
  total: 14
  verdict: adoptable
status: adopted
issue: 581
looked_at: 2026-09-14
---

# OpenStreetMap through the QLever osm-planet mirror

The second signal the Archaeology kind's site door reads: what OpenStreetMap has actually mapped
at an item Wikidata files under `archaeological site`. Wikidata cannot tell Troy from Athens —
both are settlements in its tree — and OSM can: one carries `historic=archaeological_site` on a
polygon, the other a `place=city` node. The same objects carry the extent a traveller sees drawn
on the map.

Adopted for the **world tier of Archaeology** by #581, on the terms of
[ADR-0059](../../decisions/0059-what-the-catalogue-takes-from-openstreetmap-it-keeps-separable-and-offers-under-odbl.md):
a classification and an extent, kept separable with their provenance on the row, offered under
ODbL, and credited wherever they are shown. It is not adopted as a source of *rows* for any kind.

## What was read on 2026-09-14

**The ODbL 1.0 text** (<https://opendatacommons.org/licenses/odbl/1-0/>). § 4.2 (*Notices*)
binds anyone who publicly conveys the database, a derivative of it, or it as part of a collective
database: the licence or its URI travels with the data, and the notices are kept intact. § 4.3
(*Notice for using output*) is the one a reader-facing page answers to — a produced work needs "a
notice associated with the Produced Work reasonably calculated to make any Person that uses,
views, accesses, interacts with, or is otherwise exposed to the Produced Work aware that Content
was obtained from the Database … and that it is available under this License". § 4.4 makes a
Derivative Database share-alike; § 4.5 a, the Collective Database clause, says "You are not
required to license Collective Databases under this License if You incorporate this Database or a
Derivative Database in the collection", the licence still reaching the incorporated part.

**The OSMF Attribution Guideline**
(<https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>). "Attribution must be to
'OpenStreetMap'", made to show the data is under the ODbL, with "© OpenStreetMap contributors"
named as an acceptable historical form. It must reach "anyone who uses, views, accesses,
interacts with, or is otherwise exposed to the map or produced work", and "should not require
individuals to interact with the map or produced work to see the attribution"; it belongs "in the
vicinity of the produced work or in a location where customarily attribution would be expected by
the users of the produced work". For a database, the guideline asks for the attribution and the
ODbL text or a link to it "in a location … such as a readme file, or within the data or metadata".

**The Collective Database Guideline**
(<https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline>,
endorsed by the OSMF board 2016-06-17). Two datasets are "independent", and so a Collective
Database rather than a Derivative one, "so long as the data used for a particular data type is
either all OSM or all non-OSM within the same regional cut" — among the listed cases, one where "a
non-OSM database replaces or adds a property of a primary feature, and uses either all OSM data or
no OSM data for that property of that primary feature within the same regional cut". That is the
shape ADR-0059 decision 2 writes into the row: the object, the tag and the date beside the value,
so the OSM-derived property stays a property whose data is all OSM and nothing else.

**The QLever usage and privacy page**
(<https://github.com/ad-freiburg/qlever/wiki/Usage-and-privacy-information-for-the-QLever-SPARQL-endpoints>,
the project's own wiki; written for `qlever.cs.uni-freiburg.de`, the host that now redirects to
`qlever.dev`). There are no formal terms of use and no published numeric rate limit. Under
*Usage information*: "The current timeout is at least 600s. If you are a heavy user, we encourage
you to set up a SPARQL endpoint on your own machine." Under *Privacy information*: "We currently
store standard Apache logs (containing IP addresses), which are deleted after a week. We only
look at these logs when necessary, for example, when there is a very large number of queries
coming from the same IP address. The SPARQL endpoint also has a log, but there we only see the
queries and no IP addresses. These logs are currently also not stored permanently, but we reserve
the right to save interesting queries for later analysis." It is **not** an OSM Foundation
service. What the page asks is answered by not being a heavy user: the batch of 100, the pause
between batches and the day's cache are that answer, and a query the endpoint would have to look
at twice is one this connector does not send.

**The tagging documentation.** `Key:wikidata`
(<https://wiki.openstreetmap.org/wiki/Key:wikidata>): the tag is "the ID of the Wikidata item
about the feature", and "only entries which are 'about the feature' should be linked" — which is
why a town's item can sit on a ruin and a ruin's item on a town, and why this connector reads
every object that carries the item rather than picking one.
`Tag:historic=archaeological_site`
(<https://wiki.openstreetmap.org/wiki/Tag:historic%3Darchaeological_site>): the secondary key is
`archaeological_site=*`, "to further describe the type of the archaeological site" (`city`,
`settlement`, `megalith`, `necropolis`, `fortification`, `tumulus` …). `site_type` is the older
spelling, deprecated in favour of `archaeological_site` in December 2022
(<https://wiki.openstreetmap.org/wiki/Key:site_type>) and not documented on the tag's own page —
the measurement found it unused across all 1,544 objects.

## What was measured (2026-09-14; the data is kept in `data/cache/osm-sites/`)

1,544 objects carry `wikidata=<item>` for 885 of the 1,126 Wikidata items under `archaeological
site` (Q839954) with 22 sitelinks or more, a coordinate and an English label.

- Ruin values: `historic=archaeological_site` on 477 items, `ruins` 70, `castle` 34, `tomb` 29,
  `monument` 18, `temple` 6, `bridge` 6, `citywalls` 3, `theatre` 3, `aqueduct` 2, `roman_road` 2
  (measured but **not** read as a ruin: the two items it decides are Watling Street and the Via
  Flaminia, and a 430 km road is not a place a traveller stands in — `memorial`, on 2 items and
  deciding only the Lop Desert, is out for the same reason);
  `ruins=*` on 96; `archaeological_site=*` on 190 (`city` 101, `settlement` 33, `fortification`
  13, `megalith` 12, `necropolis` 12, `temple` 9, `amphitheatre` 6 …).
- Living values, on the settlement branch: `place=town` 41, `city` 37, `village` 19,
  `neighbourhood` 5, `suburb` 4, `hamlet` 2. `place=locality` (27: Pompeii, Sounion, Capernaum)
  is a named spot rather than a living place, and `place=island` (20: Rhodes, Samos) an island;
  neither counts.
- Geometry: 544 of the 770 `historic=archaeological_site` objects are polygons, and 516 of the
  651 items with a ruin signal carry a polygon on the ruin object itself.
- Tried and dropped: "the item's node lies inside a mapped ruin polygon" (`ogc:sfContains`) —
  true for Pompeii only; Bagan's and Anuradhapura's nodes are not inside one.

## How the scorecard was read

`docs/tech/filling-a-kind.md` § 6.2. **Identity 1**: an OSM id moves when an object is
re-mapped, so the only stable join is the `wikidata` tag — which is why nothing here is stored as
a row of its own. **Terms 1** for share-alike, which since ADR-0059 no longer forces a `hold`:
the OSM-derived part is kept separable and offered under ODbL. **Signal 2**: the tags are a
measured statement about what stands there, and the whole reason this source is read.
**Completeness 2** for what it is asked — what OSM has mapped at a known item — not for
enumerating anything.

## The risk this connector carries

QLever is a third-party mirror and has moved host once already, from `qlever.cs.uni-freiburg.de`
to `qlever.dev`. So: the run **fails loudly** when the endpoint is gone rather than reading its
silence as "no OSM object carries this item" — which would turn every site into a refusal — and
the day-long cache carries the last answers through a short outage. Overpass is the documented
fallback ([`openstreetmap-overpass`](openstreetmap-overpass.md)), one adapter behind the same
interface, and is filed as its own ticket rather than built unused.

## The runs that adopted it

\#581, PR 2. The dry run of record is in
[`wikidata-archaeology`](wikidata-archaeology.md), which is where this kind's runs are tabled.
