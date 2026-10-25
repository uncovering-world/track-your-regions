---
slug: openstreetmap-planet
name: OpenStreetMap's planet file, kept current by its daily diffs
publisher: OpenStreetMap contributors (data); the OpenStreetMap Foundation (the planet server and its S3 bucket)
urls:
  home: https://www.openstreetmap.org/
  dataset: https://planet.openstreetmap.org/
  api: https://planet.openstreetmap.org/replication/day/state.txt (the latest daily diff's sequence number and timestamp)
  terms: https://opendatacommons.org/licenses/odbl/1-0/
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, cut down to a layer of the objects the catalogue asks about (ADR-0134)" }
row:
  identity: "an OSM id, unstable across re-mapping; the wikidata tag where set"
  wikidata_link: tag
  coordinates: all
  languages: [name and name:xx tags]
  signal: "what the object is tagged as — historic, place, archaeological_site, ruins, boundary, man_made, tourism"
terms:
  licence: "ODbL 1.0"
  database_right: share-alike
  attribution: "© OpenStreetMap contributors, ODbL"
  agent: unknown
  agent_rests_on: "no line in site-access.md: not judged for an agent reading pages"
  program: allowed
  program_rests_on: "a published dump under its publisher's rules (ADR-0148): the planet and its diffs, ODbL 1.0; robots.txt keeps crawlers off the listings, which are not walked"
  model: "an object's label and tags from the layer, offered to Jev in the point-hint question (#1913); ODbL places no bar on that use"
access:
  mode: dump
  format: "PBF, the weekly planet file; OsmChange XML, gzipped, for the daily diffs"
  cadence: "a planet file weekly; a replication diff daily"
  volume: "planet-261012.osm.pbf: 95,380,942,829 bytes; a daily diff about 40–80 MB, at times 300–400 MB (the OSM wiki)"
  rate: "no published rate: the S3 buckets have unlimited bandwidth, the wiki asks for HTTPS and no browser downloads; the pipeline's host rules apply (at most eight connections to this host, ADR-0136; the bot User-Agent; no retry)"
scorecard:
  date: 2026-10-22
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
issue: 1437
looked_at: 2026-10-22
---

# OpenStreetMap's planet file, kept current by its daily diffs

The whole OpenStreetMap database as one file, published by the OpenStreetMap Foundation. The catalogue
keeps it on the dump worker's disk, brings it forward with the daily replication diffs, and cuts from it
the layer its OSM questions are answered from (ADR-0134). The live doors read the same data one question
at a time: `openstreetmap-qlever.md` and `openstreetmap-overpass.md`. Overpass stays the door for the
questions the layer cannot vouch for.

**The terms.** The OSM wiki's *Planet.osm* page (read on 2026-10-22) says planet files "remain licensed
under the same license as the master OpenStreetMap geo-database", the Open Database License. ADR-0059
holds what that asks of the catalogue: provenance on every fact taken, the credit "© OpenStreetMap
contributors" wherever it is shown, and the OSM-derived part offered under ODbL. The layer is a
derivative database and is offered under ODbL too (ADR-0134 decision 7). The ODbL text and the OSMF
community guidelines that ADR-0059 decision 4 asks a record to quote were read for the first OSM
connector: `openstreetmap-qlever.md` § What was read on 2026-09-14. They bind the data, whichever door
it is read through. Its tagging docs covered `wikidata`, `historic=archaeological_site` and that
tag's secondary key `archaeological_site=*` (with `site_type`, its deprecated spelling). The other keys ADR-0134 decision 2 selects, such as `tourism`, `man_made`,
`heritage`, `amenity=place_of_worship` and the protected `boundary` values, have no tagging-doc
reading yet. Each is owed one before a reader asks by it.

**The host.** `planet.openstreetmap.org` redirects every file to the Foundation's S3 bucket
(`osm-planet-eu-central-1`). The wiki says mirrors are no longer needed, because those buckets have
unlimited bandwidth. It asks for HTTPS and for no downloads through a web browser. The server's
`robots.txt` allows `wget` and disallows `/` for every other agent. That keeps crawlers off its
listings. The files themselves are published to be downloaded, and the pipeline asks for one by its
name and never walks a listing. The planet carries a `.md5` beside it, which the pipeline verifies.

**Personal data.** The planet carries each object's last editor. The layer keeps none of it: the flex
style writes no `user`, `uid` or `changeset` (ADR-0134 decision 2).

**Status.** `adopted` by #1437. The Archaeology run (`experience_sources` id 5) and its visit questions
read OpenStreetMap from the layer while a fresh one is in place (`OSM_READER` unset, ADR-0134). The
misses the layer cannot vouch for are asked live: of Overpass by the run, of the QLever mirror by its
visit questions.

**Scorecard notes.**
- **Completeness: 2.** Every object mapped as of the layer's replication timestamp.
- **Identity: 1.** An OSM id changes when an object is re-mapped. The `wikidata` tag names the item of
  the mapped object, which is not always the item the catalogue holds (ADR-0059 decision 4).
- **Terms: 1.** Share-alike, met by ADR-0059's separable provenance.
- **Cadence: 2.** Daily diffs; the layer's own interval is set in the admin panel (ADR-0134 decision 6).
