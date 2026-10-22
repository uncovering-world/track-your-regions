# ADR-0134: OpenStreetMap is read from a layer cut from the planet, and a miss the layer cannot vouch for is asked live

**Date:** 2026-10-22
**Status:** Accepted — decisions 1 and 2 narrowed by [ADR-0136](0136-the-openstreetmap-layer-keeps-a-full-geometry-only-for-what-a-kind-draws.md)
**Issue:** [#1437](https://github.com/uncovering-world/track-your-regions/issues/1437)
**Narrows:** [ADR-0101](0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md) decision 4 (an admin starts every build) and decision 6 (OpenStreetMap from Geofabrik extracts)

---

## Context

The Archaeology run reads OpenStreetMap twice a run. It enumerates the planet's digs and ruins (63,630
rows on its last run), and it asks what is mapped at each candidate's Wikidata item, in batches. Both
reads go to QLever's `osm-planet` mirror, and to Overpass when the mirror fails (`oneDoorPerRun.ts`).
On the development machine on 2026-10-22, 6 of the last 7 Archaeology runs failed on the mirror.
All 1,268 `metadata.osm` rows then held came from Overpass, and runs 179–191 took between 35 minutes
and 2.5 hours. Several open issues measure OSM tag sets in bulk (#881, #861, #862, #1163, #899, #1189).

ADR-0101 decision 6 chose Geofabrik's regional extracts, filtered with `osmium` and loaded through an
osm2pgsql flex style. It gave two reasons for leaving the planet aside: a planet import needs 64–128 GB
of RAM, and it did not fit the machine. That figure is for importing the whole planet. A layer that
is cut with `osmium tags-filter` first needs no such memory, since osmium reads the file as a stream.
Only the objects kept reach the database.

The planet, as published on 2026-10-22:
- `planet-261012.osm.pbf` is 95,380,942,829 bytes, with an `.md5` beside it. A new one is released
  weekly. `planet.openstreetmap.org` redirects every file to the OSM Foundation's S3 bucket.
- The daily replication diffs (`replication/day/`, state 5153 for 2026-10-22T00:00Z) are about
  40–80 MB each, according to the OSM wiki's *Planet.osm* page.
- That page says mirrors are no longer needed to spare the Foundation's bandwidth, since the S3
  buckets have unlimited bandwidth. It asks for HTTPS and not to download through a web browser.
- `robots.txt` on `planet.openstreetmap.org` allows only `wget` and disallows `/` for every other
  agent. It keeps crawlers off the listings, and every file it guards is published to be downloaded.

Geofabrik's eight continent extracts total about 80.0 GB, measured on 2026-10-22. They overlap at
the continents' borders and carry eight diff streams. Geofabrik keeps the diffs for 100 days.

The development machine has 24 threads, 28 GB of RAM (about 17 GB free) and 661 GB of free disk.

## Decision

**1. The layer is cut from the planet file, kept current on the worker's disk.**
- The worker keeps the planet whole and brings it forward with the daily replication diffs
  (`osmium apply-changes`). Several days' diffs are applied in one pass.
- A first build, and a planet that cannot be brought forward, download the weekly planet file
  and verify its `.md5`. Those builds are started by an admin.
- From the current planet each update cuts the layer (`osmium tags-filter`), adds the pinned
  objects (decision 3), and loads the result through an osm2pgsql flex style.
- The result goes into `_next` tables in the `workbench` schema (ADR-0124). They are swapped in
  whole together with the build's record, as the Wikidata subset is (ADR-0105).
- The layer records the replication timestamp it was cut at. Every answer read from the layer
  carries that timestamp.
- Downloads follow the host rules of `docs/tech/dumps.md` and the wiki's two asks: HTTPS, the
  project's bot `userAgent()`, at most three connections, and no retry. A failed update waits for
  the next one, and the panel shows the failure.

This narrows ADR-0101 decision 6: OpenStreetMap is read from the planet, not from Geofabrik's
extracts.

**2. The layer keeps an object for what it is, with every tag and its full geometry.** An object is
kept when it carries any of these:
- `wikidata` or `wikipedia`;
- `historic`, `heritage`, `archaeological_site` or `ruins`;
- `amenity=place_of_worship`, `tourism`, `man_made` or `place`;
- `boundary=protected_area` or `boundary=national_park`.

The ways and relations kept bring the nodes and members they need. All the object's tags are kept as
`jsonb`, including its `addr:*` tags. An address does not select an object on its own: selecting every
object with an address would bring in most of the mapped world's buildings. Who edited an object is
never kept, so the flex style writes no `user`, `uid` or `changeset`.

**3. Every object the catalogue names is kept, whatever its tags.**
- The build reads a pin list from the database, and `osmium getid` cuts those objects into the layer
  beside the selection. The list holds every OSM object named in `metadata.osm` of a place or a
  location, and every object a cached OSM answer names.
- An object's absence from the layer never means OSM deleted it. Only a diff's delete or a live
  answer says that.
- A catalogue row may link an object that the selection does not keep, for example a ruin mapped
  with no `wikidata` tag. That object stays in the layer from the next update on, and a later
  run can still find it.

**4. A miss is a fact only when the layer can vouch for it, and every other miss is asked live.**

When the layer finds an object, that is the answer. When it finds nothing, the miss is read as
"OpenStreetMap maps nothing here" only if all three of these hold:
- **The question is inside the selection.** It asks by a `wikidata` or `wikipedia` tag, or by a tag
  that decision 2 selects.
- **The layer is fresh.** Its last update succeeded, and it is at most 8 days old: the default
  interval of decision 6 plus one day. The bound is fixed in code and does not follow the interval
  an admin sets.
- **The question does not name an OSM object by id.** An id lookup that misses is asked live, always.

A miss that fails any of these is asked of Overpass, in small batches. The questions asked are the
missed ones only. Overpass's own manners apply, as `docs/sources/global/openstreetmap-overpass.md`
records them. If Overpass cannot answer, the miss is no fact: the door fails as a lost answer does
today (`OsmDoorFailedError`).

The run's enumeration of digs and ruins asks only selected tags. On a fresh layer it is answered
from the layer whole.

**5. Each fact names the door that answered it.** A fact taken from OpenStreetMap carries the
object, the tag and the date, as ADR-0059 decision 2 asks. It also carries its door: the layer,
with the replication timestamp it was cut at, or Overpass, with the day it was asked. A run may mix
the two, because each fact says where it came from.

The run-wide rule in `oneDoorPerRun.ts` stays only for the live doors used when no layer is in place:
the mirror, and Overpass after it.

**6. The worker queues the layer's update itself, at an interval an admin can change.**
- The default interval is 7 days: the planet's own release cadence. It also fits the monthly
  minimum of ADR-0101 decision 4 with room to spare, and each update costs the worker about an
  hour while other builds wait. The 1 hour is an estimate, measured by the first update on #1437.
- An admin sets another interval in the admin panel, from 1 to 30 days, or turns the schedule off
  and starts updates by hand. The default lives in code with its reason, and a stored value means an
  admin decided otherwise, as `wikidata_cache_policy` does for cache lifetimes.
- The worker queues an update when the layer is older than the interval, no build of it is queued
  or running, and no scheduled update started within the interval. The ledger row says the schedule
  started it (`started_by` empty, the request marked `scheduled`). The schedule is measured from that
  row's start, so a failed scheduled update is not retried before the next interval.
- A longer interval, or no schedule, never turns a stale miss into a fact. Decision 4's bound
  stays at 8 days whatever the interval, so a layer older than that has its misses asked live. A
  longer interval saves the worker's time and spends Overpass questions instead.

This narrows ADR-0101 decision 4, under which an admin starts every build. A first build, and any
download of the planet file, are still started by an admin.

**7. The layer is ODbL, and what the catalogue takes from it stays separable.** The layer's tables
are a derivative database of OpenStreetMap and are offered under ODbL, as ADR-0101 decision 5 says of
an OSM-derived release (#1438). What a run writes from them follows ADR-0059 unchanged: provenance on
the row, the credit "© OpenStreetMap contributors" wherever it is shown.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Geofabrik's eight continent extracts, merged (ADR-0101's choice) | Eight files that overlap at the continents' borders, one merge and eight diff streams, from a third party that keeps the diffs for 100 days. The planet is one file and one diff stream from the source itself, for about 15 GB more download. |
| Regional extracts only for the regions being filled | The dig enumeration and the per-item read are planet-wide. A region left out would turn its admitted sites into misses. |
| Import the whole planet with osm2pgsql | Needs 64–128 GB of RAM and several hundred GB of database. Nothing reads most of it. |
| Apply the diffs to the layer in place (osm2pgsql append) | A diff names only what changed. When a way gains a `wikidata` tag and its nodes stay unchanged, the nodes are not in the diff and were not in the layer, so the way would arrive without its geometry: a new object lost to the subset. Cutting the layer again from a current planet has no such hole. |
| Every miss asked live | Most candidates have no OSM object, so this would send almost the same number of Overpass questions as today and gain nothing. Decision 4 asks live only where the layer cannot vouch for the answer. |
| A daily schedule by default | It would spend about an hour of the worker every day for answers that become proposals a curator reads later. An admin who needs a fresher layer can set it. |
| The update interval as an environment variable | It is an operator's decision about this machine's load and needs, and an admin reads and changes such decisions in the panel. |

## Consequences

**Positive:**
- The Archaeology run, the visit questions and the issues that measure OSM tags in bulk read a local
  layer. They no longer depend on a mirror that failed 6 runs out of 7.
- No object the catalogue links is lost because the layer keeps a subset. Each miss either has a
  fresh layer behind it or is asked live.
- Each OSM fact says which door answered it and as of when.

**Negative / Trade-offs:**
- The planet stays on the worker's disk: about 95 GB, plus a second copy while an update rewrites it.
  The layer itself is estimated at 15–45 GB in Postgres. The first build measures both on #1437.
- Every update rewrites the planet and cuts the layer again. That costs more than applying a diff to
  the layer, and it is the price of decision 3's guarantee.
- A run whose layer is stale, or whose questions fall outside the selection, still asks Overpass.
  The live door and its manners stay maintained.
- osmium-tool and osm2pgsql join the worker's image.

## References

- Related ADRs: ADR-0059 (ODbL, provenance per fact), ADR-0060 (the site pool's second entrance),
  ADR-0101 (decisions 4 and 6 narrowed), ADR-0105 (swapped in whole), ADR-0106 (the worker and the
  ledger), ADR-0124 (the workbench schema)
- Related docs: `docs/sources/global/openstreetmap-planet.md`, `docs/sources/global/openstreetmap-overpass.md`,
  `docs/tech/dumps.md`
- Issues: #1437; Epic #1312; #1438 (where a release is published)
- Sources read on 2026-10-22:
  [Planet.osm](https://wiki.openstreetmap.org/wiki/Planet.osm),
  [planet.openstreetmap.org](https://planet.openstreetmap.org/) (its `robots.txt`, `replication/day/state.txt`,
  the weekly file and its `.md5`),
  [Geofabrik download server](https://download.geofabrik.de/) and [its technical notes](https://download.geofabrik.de/technical.html),
  [osm2pgsql manual](https://osm2pgsql.org/doc/manual.html)
