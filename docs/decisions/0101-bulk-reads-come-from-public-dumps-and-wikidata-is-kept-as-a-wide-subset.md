# ADR-0101: Bulk reads come from public dumps, and Wikidata is kept as a wide subset cut by entity

**Date:** 2026-10-13
**Status:** Accepted — decision 2 narrowed by ADR-0105, decision 6 narrowed by ADR-0121
**Narrows:** [ADR-0060](0060-the-site-pool-has-a-second-entrance-the-map.md) decision 1 (the reader of the OSM ruin enumeration)

---

## Context

The catalogue is filled from open data: Wikidata, Wikipedia, Commons and OpenStreetMap. Almost all of it is
read through the live services those projects run for people and small tools, and the bulk passes keep
running into those services' limits.

- **The Wikidata Query Service** allows a client 60 s of processing per 60 s and 5 parallel queries, and
  answers a client that ignores its 429s with a ban. The kind syncs send it hundreds of queries a run:
  Art Museums and Places of worship about 300–600 each, Archaeology about 400–800, Public Art about
  100–200. These counts are estimated from batch sizes. The museum class closure alone takes about 11
  minutes; sculpture's reaches 143,000 classes.
- **QLever's Wikidata mirror** took the component-item search's near rule after the query service could
  not answer it (#1272, #1307). Its usage page asks a heavy user to run their own copy and publishes no
  limit. It refused a full pass with a 429 halfway on 2026-10-09 and again on 2026-10-13, after about
  125 of 606 areas. Nothing was written either time.
- **Pageviews**: ADR-0055 already moved readership to the monthly `pageview_complete` dumps, after
  measuring the REST route at more than a week per pass.
- **Nominatim's** policy discourages bulk geocoding (#1308).

An inventory of 2026-10-13 counts about 25 live readers in the backend. A scan of the open issues finds
about 45 that need the same data in bulk. What they read recurs:
- class trees (P31, P279), sitelinks, coordinates;
- P757 at every rank;
- place, part and collection statements with their end dates;
- pictures, register ids, and labels in several languages.

What they ask next changes all the time: styles and periods (#911–#914), languages (#809), addresses
(#1189), equal-rank coordinates qualified by P518 (#880), statement GUIDs (#1401).

**The public dumps, as published on 2026-10-12/13:**
- `latest-all.json.bz2` is 103.4 GB. JSON is produced about twice a week, one entity per line.
- `latest-truthy.nt.bz2` is 43.5 GB, but it holds best-rank values only, with no qualifiers or
  references.
- The daily incrementals are revision XML, about 1.1 GB a day, not entity diffs.
- `dumps.wikimedia.org` rate-limits, caps a client at 3 connections, and enforces the Wikimedia
  User-Agent policy.
- The OpenStreetMap planet is 88.5 GB as PBF. Geofabrik serves regional extracts and keeps daily diffs
  for 100 days.

**Other projects that read this data in bulk work offline:**
- Nominatim builds its importance table from monthly dumps, about 9 hours on 4 cores, and ships the
  finished table.
- Wikimedia Analytics keeps each weekly JSON dump as a dated snapshot and derives tables from it.
- KGTK and simple-wikidata-db normalise the dump into tables of claims, qualifiers, labels and
  sitelinks.
- Sophox dropped its Wikidata copy for space.

A full local SPARQL copy does not fit one developer machine. QLever's own Qleverfile states about
500 GB of index, about 20 GB of RAM to build and 35 GB to serve; a Blazegraph import takes about 12 days.
This project's machine has 19 GB of RAM and 85 GB of free disk.

## Decision

1. **A bulk read comes from a public dump; a live service answers only small, interactive or
   freshness-bound questions.** A read is bulk when it covers the whole catalogue or the world, or
   sends more than 50 requests in one run. Bulk reads include:
   - a sync's class trees and pools;
   - the component-item search;
   - readership;
   - an OpenStreetMap enumeration;
   - a Wikipedia category walk.

   Live stays for:
   - a curator's click (confirming a component's item, nearby pictures, one picture's credit);
   - the export-time check of #1402;
   - the Nominatim search in the creation dialog.

   Commons credits are an explicit exception to the threshold. A sync asks 50 files a request,
   so one that captures more than about 2,500 pictures is bulk by the rule above. But no dump
   holds what `extmetadata` answers for every file: the structured-data dump carries a licence
   (P275) and a creator (P170) for some files only, and no credit text, and the author and licence
   `extmetadata` reads come from the file pages' wikitext, whose dump is 121.7 GB. The credits
   stay live, paced as now.
2. **Wikidata is kept as a wide subset, cut by entity and never by property.**
   - An item in scope is kept whole: every statement at every rank, with its qualifiers and its
     statement id, plus every sitelink, and labels and descriptions in a configured set of languages.
     The set starts with the eight the code reads, `en, mul, en-gb, de, fr, es, it, nl`, and widens
     without a rebuild of anything else.
   - References are not kept: no reader asks for them.
   - **A labels ring:** the labels, in the configured languages, of every entity a kept item names
     through any property, with nothing else of that entity. A work's maker is named this way: the
     museum works and public-art pools read `?creatorLabel` through P170, and the person behind it
     has no coordinate and is no class. Leonardo is kept as a label because the Mona Lisa names
     him, so `artists` (ADR-0040) fills from the subset. The second pass collects it: it takes every
     entity's labels and trims them to the ids the kept items name.
   - In scope, one hop from a seed set and never further, so a build reads the dump twice — once
     to collect the seeds and once to keep them and their neighbours:
     - the seeds, known from what an entity holds itself: every item with a coordinate (P625), and
       every class (an item with P279);
     - every class a seed is an instance of (its P31 targets);
     - every item a seed names through a place, part or collection property (P131, P276,
       P361, P527, P195, P189), **and every item that names a seed through one**. The second
       direction is what brings in the pools that point at their place: a painting names its museum
       (P195, P276), and a find its find spot (P189). The Mona Lisa is kept because it names the
       Louvre, as the museum works pool (ADR-0023), the worship works and the archaeology finds
       read them.

   A new experiment with a property is then a query, not a rebuild. #880's qualified coordinates
   and #1401's statement GUIDs are already in it. The truthy dump is never the source, since it
   loses the ranks ADR-0088 reads.
3. **Dump-derived data lives in local tables stamped with its dump.**
   - Each source has a build ledger: the dump's name and date, its checksum, row counts, duration and
     outcome.
   - A build writes new tables and swaps them in whole, so a reader never sees half a build.
   - Every reader of a derived table can say which dump it reads.
   - The entity JSON is kept beside the derived tables for the hot reads (claims with rank and
     qualifiers, labels, sitelinks, the class closure), which are rebuilt from it.
4. **A build is started by an admin and runs from the shared pipeline** (#1433). The pipeline:
   - downloads within the host's rules (at most 3 connections, the project's `userAgent()`,
     resumable);
   - verifies the published checksum, since a stream cut short reads as a clean end of file
     (ADR-0055);
   - reads the dump either as a stream from the host or from a local copy, whichever the machine has
     room for.

   A rebuild is due when the work needs fresher data, at least monthly while a kind is being filled.
   The live change stream is not used: it keeps 7–31 days, cannot filter on the server, and is meant
   for small tools. Freshness between rebuilds comes from the live service, one item at a time.
5. **A built subset is shared as a dated release.**
   - A build publishes its tables to object storage with the dump date and checksum, and a developer
     loads the latest release in minutes. This is the base layer's shape (#1319, #1322).
   - The release carries the licences of what it holds: Wikidata and pageviews CC0; Wikipedia-derived
     tables CC BY-SA, attributed; OpenStreetMap-derived tables ODbL, attributed and shared alike.
6. **Other sources:**
   - OpenStreetMap is read from Geofabrik extracts, filtered by tag with `osmium` and loaded through an
     osm2pgsql flex style, kept current by daily diffs. The planet is not imported here: its import
     needs 64–128 GB of RAM. This narrows ADR-0060 decision 1: the ruin enumeration it sends to the
     mirror or Overpass reads the extract layer once #1437 builds it. What the catalogue takes from
     the extracts stays separable and is offered under ODbL (ADR-0059).
   - Wikipedia's structure (page, page_props, categorylinks, langlinks) comes from its SQL dumps.
   - Readership comes from `pageview_complete`, as ADR-0055 decided.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the live services and pace harder | Paced at the published rates, the component-item search was still refused twice halfway and wrote nothing, and a museum run spends minutes on one closure. The services ask heavy users not to do this. |
| A full local QLever over all of Wikidata | It would answer today's SPARQL unchanged and cut nothing. But it needs the index (about 500 GB) plus its input (about 110 GB) and build scratch, so about 650 GB of disk, and 20 GB of RAM to build and about 35 GB to serve. This machine has 85 GB free and 19 GB of RAM. It stays open for a rented machine as a research convenience. |
| The full JSON dump kept queryable (Postgres jsonb, DuckDB/Parquet) | The compressed dump alone (103 GB) is larger than the free disk, and uncompressed it is about 1.5 TB. |
| The truthy dump | It holds best-rank values only, with no qualifiers: P757 at every rank (ADR-0088), end dates on P276/P195, and P518 on coordinates are lost. |
| A narrow subset by property allowlist | Every new question needs a property the allowlist did not keep, and so a full rebuild. That is the opposite of how this catalogue's decisions are made. |
| The EventStreams change stream as the source | It keeps 7–31 days, cannot filter on the server, and is intended for small tools. A top-up at most. |

## Consequences

**Positive:**
- The component-item search, the kind syncs' class trees and pools, readership and the OpenStreetMap
  and category reads stop depending on live services' limits. A full pass is bounded by local reads,
  not by a mirror's load.
- A new property, qualifier or rank is a query over what is already kept.
- A developer gets the data from a release, not from a 103 GB download and an overnight build.
- Each dump-derived answer names its dump date, so a stale answer is visible as stale.

**Negative / Trade-offs:**
- The subset's size is not known until its first build (#1434), which measures it: the seeds, and
  the neighbours each edge brings in, the reverse edges (the works naming a museum, the finds naming
  a site, the events held at a place) above all, and the labels ring. While the second pass runs,
  every entity's labels in the configured languages (about 115 million entities) are held in a
  transient table before they are trimmed to the ring; that peak counts against the free disk and is
  measured too. The scope may need narrowing by class where one edge brings in too many for the disk.
- Data trails Wikidata by the age of the dump (days to weeks). QLever's mirror trailed by days already,
  and a candidate is a proposal a curator answers (ADR-0046), so the cost is a late candidate, not a
  wrong one.
- Every sync moves from SPARQL to SQL over local tables: a rewrite per kind (#1439).
- Keeping the dump locally between builds needs disk beyond what the machine has today; until then each
  build streams it again.

## References

- Related ADRs: ADR-0023, ADR-0040, ADR-0030 (whose alternatives rejected "their weekly RDF dumps instead of SPARQL" as a larger project, which this record takes up), ADR-0046, ADR-0055, ADR-0059 (the ODbL terms the extract route still meets), ADR-0060 (decision 1 narrowed), ADR-0088
- Related docs: `docs/sources/global/wikidata-qlever.md`, `docs/tech/experiences.md`
- Issues: #1312 (epic), #1432 (this record), #1433–#1440 (the slices), #1272, #1307, #1308, #1319,
  #1322, #1429
- Sources read on 2026-10-13:
  [Wikidata: Database download](https://www.wikidata.org/wiki/Wikidata:Database_download),
  [Wikidata: Data access](https://www.wikidata.org/wiki/Wikidata:Data_access),
  [WDQS user manual](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual),
  [QLever for Wikidata](https://github.com/ad-freiburg/qlever/wiki/Using-QLever-for-Wikidata),
  [Nominatim importance](https://github.com/osm-search/wikipedia-wikidata),
  [Wikimedia `wikidata_entity`](https://wikitech.wikimedia.org/wiki/Data_Platform/Data_Lake/Content/Wikidata_entity),
  [EventStreams](https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service),
  [osm2pgsql manual](https://osm2pgsql.org/doc/manual.html),
  [Geofabrik technical](https://download.geofabrik.de/technical.html)
