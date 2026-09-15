---
slug: openstreetmap-overpass
name: OpenStreetMap through the public Overpass API
publisher: OpenStreetMap contributors (data); the overpass-api.de operators (the endpoint)
urls:
  home: https://www.openstreetmap.org/
  dataset: https://overpass-api.de/
  api: https://overpass-api.de/api/interpreter
  terms: https://opendatacommons.org/licenses/odbl/1-0/
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, asked one batch of Wikidata items at a time (the reader); any unit with a boundary relation, or a bounding box (the enumerator)" }
row:
  identity: "an OSM id, unstable across re-mapping; the wikidata tag where set"
  wikidata_link: tag
  coordinates: all
  languages: [name and name:xx tags]
  signal: "what the object is tagged as — historic, place, archaeological_site, ruins, boundary, man_made — when read at a known item; none of its own as an enumerator"
terms:
  licence: "ODbL 1.0"
  database_right: share-alike
  attribution: "© OpenStreetMap contributors, ODbL"
  scraping: not-needed
access:
  mode: api
  format: "Overpass QL, JSON"
  cadence: continuous
  volume: "as the reader: 253 objects, 740 kB, for 94 of 100 admitted site items in one query (2026-09-14); as the enumerator: Paris 146, Florence 110, Berlin 247, Kraków 89, Lima 109 (box), Tbilisi 43, Tallinn 67, Estonia 350; as the site pool's second entrance: eight questions a run, tags only — the same list asked as one question was 43,759 elements and 16 MB (2026-09-15)"
  rate: "overpass-api.de's own guidance, quoted below: about 10,000 queries and 1 GB a day for a one-off, a hundredth of that for regular use; two slots per address, 429 when both are taken, 504 when the declared run time and memory would take more than half of what is left; no parallel scripts; a 30 s pause after a 429. This connector sends one batch of 100 items at a time, never two at once, five seconds apart, declares a 120 s timeout, fetches a geometry only for a ruin or a protected area, and caches every answer for a day; the site pool's enumeration is eight exact-match questions a run, one at a time with the same pause, each declaring 600 s and fetching no geometry, cached the same day"
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
issue: 895
looked_at: 2026-09-15
---

# OpenStreetMap through Overpass

Two readings of one endpoint. First, the most complete *enumeration* of what stands — a farm
museum and a school's museum room are `tourism=museum` too — with a Wikidata tag on a third to
four fifths of the objects and pictures on almost none, looked at on 2026-09-06 as the worked
example of an enumerator that is the yardstick before it is a source (`docs/tech/filling-a-kind.md`
§ 7.4, § 6.1). Second, since #893, the **fallback reader of the Archaeology kind's site door**:
what OpenStreetMap maps at a known Wikidata item, which is the question the QLever mirror
([`openstreetmap-qlever`](openstreetmap-qlever.md)) is asked first and this endpoint is asked
when the mirror is gone. The body keeps both readings in order.

**What was measured (2026-09-06).** `tourism=museum` inside the unit's boundary relation
(area by its Wikidata tag), with a Wikidata tag, with a picture, tagged `museum=art`: Paris 146,
120, 3, 17; Florence 110, 73, 0, 7; Berlin 247, 144, 22, 26; Kraków 89, 51, 0, 4; Tbilisi 43,
25, 0, 2; Tallinn 67, 26, 0, 3; Estonia 350, 104, 0, 5; Lima 109, 35 in the metropolitan box
(`-12.25,-77.20,-11.85,-76.80`), the city's relation not being found by its item. Estonia's
350 against Statistics Estonia's 160 museums (2024) says what the tag enumerates. Kraków's
tags carry five of the state register's nine (the National Museum Q195311, Manggha Q572206,
the Aviation Museum Q377904, the Ethnographic Museum Q194616, the Jagiellonian University
Museum Q11787234) and the Czartoryski Q1450630, which is the world tier's row; Lima's
carry the Larco Museum (Q1954240) and the Pedro de Osma museum (Q6033665) but not the Lima Art
Museum.

**Terms.** ODbL: attribution, and share-alike on a derivative database. Reading OSM to find
and count binds nothing; storing its rows beside rows from a CC BY register makes a derivative
database whose ODbL obligations reach the whole (ADR-0002 noted the same for boundaries).

**What decides it.** The yardstick and the finder for both tiers — what a unit holds that no
register lists — and a source of *rows* only once the share-alike question is answered for the
catalogue as a whole: the total is 12, and the verdict is `hold` by § 6.2's share-alike clause,
whatever the total. Identity is the other weakness: ids move on re-mapping, and only the
Wikidata tag is stable.

**The share-alike question is answered (2026-09-13).**
[ADR-0059](../../decisions/0059-what-the-catalogue-takes-from-openstreetmap-it-keeps-separable-and-offers-under-odbl.md)
decides it for OSM-derived data — kept separable, offered under ODbL to anyone who asks, credited
wherever it is shown — so the `hold` above no longer waits on the catalogue as a whole. The verdict
and the status stand until the first connector is written, which is the site door's slice: decision
4 asks a record that has read the ODbL text, the OSMF guidelines that apply, the usage policy of
the endpoint it reads and the tagging documentation of the keys it asks for, and this record has
not yet quoted them.

**The verdict is settled (2026-09-14).** #581 adopted the QLever osm-planet mirror for the
Archaeology kind's site door ([`openstreetmap-qlever`](openstreetmap-qlever.md)), whose record
quotes the policies ADR-0059 decision 4 asks for. This record's `hold` becomes `adoptable` at
`looked-at` — the register's word for a source a sync could read and none does — and the reading
was **not adopted, the documented fallback**: Overpass was to stay the second reader to write if
the mirror went away (#893), one adapter behind the same interface, a ticket rather than unused
code — until #893 wrote it the same day, which is the section below. Nothing about the
measurement above has changed.

## The fallback reader (2026-09-14, #893)

The site door reads OpenStreetMap through one interface and two adapters, and an operator names
the one a run uses (`OSM_READER`, `qlever` unless set). This section is what ADR-0059 decision 4
asks a connector to have read before it exists: the usage policy of the instance it will send to,
quoted and dated, and the manners that follow from it. The ODbL text, the OSMF guidelines and
the tagging documentation of the keys read are the same for both adapters and are quoted once,
in the [QLever record](openstreetmap-qlever.md) § What was read.

### What was read on 2026-09-14

**The public instance's own usage page**
(<https://dev.overpass-api.de/overpass-doc/en/preface/commons.html>, *Usage Rules and Limits for
Public Overpass API Instances*). Under *Magnitudes*: "Each of the Overpass API servers can fulfill
about 1 million requests per day, and two servers listen on the address overpass-api.de", and "As a
broad guideline to stay within safety margins, users are expected to send a maximum of about 10000
requests per day and keep their download volume below about 1 GB per day." Under *Quotas*, the rate
limit: "Every execution of a request occupies one of the slots available to the user, in
particular for the full actual execution time plus a cool down time"; "The cool down time grows
with the load of the server and proportionate to the execution time"; "Multiple slots are made
available to users. The number of available slots is written in line 3 after `Rate limit:`";
"Requests stay enqueued up to 15 seconds on the server if not yet a slot is available to them";
"Requests that are denied due to the rate limit are answered with the HTTP status code 429." The
second mechanism, the run time and the memory: "The declaration of maximum run time can be made
explicit by prepending the request with a `[timeout:...]`"; "If no maximum run time is declared
then a default limit of 180 seconds applies"; "The server admits a request if and only if it is
going to use in both criteria at most half of the remaining available resources"; "Requests that
have been denied due to this resource mismatch are answered with an HTTP status code 504."
`https://overpass-api.de/api/status` answered `Rate limit: 2` on the day, with both slots free.

**The OSM wiki's table of public instances** (<https://wiki.openstreetmap.org/wiki/Overpass_API>
§ *Public Overpass API instances*, page last modified 2026-09-12), on overpass-api.de: "You can
assume that you don't disturb other users when you do less than 10,000 queries per day and download
less than 1 GB data per day. That limit is fine for a one-off use of Overpass. If you set something
up that uses the Overpass API regularly, then divide those numbers by 100 (making less than 100
queries fetching less 10 MB of data per day fine)." Then: "Be sure to check that your app or website
adds `User-Agent` or `Referer` headers to requests that uniquely identify your app. No parallel
running of multiple scripts. Commercial use should use self-hosted or paid Overpass servers. Cache
and rate-limit calls, use extracts if you need a lot of data. If you receive an HTTP error code
such as 429 or 406, pause for 30 seconds before making a new request." And, in the operators' own
words: "Nowadays this server is overloaded - be mindful of that, do not overconsume resources and do
not expect high reliability. Use alternatives if possible." The page's warning box above the table:
"Free public servers are designed for small projects and can often become overloaded. Consider
deploying your own server or using a commercial provider." The table names other public instances
with global coverage (maps.mail.ru, overpass.private.coffee, and several behind an API key); this
connector sends to overpass-api.de, the instance whose policy is quoted here, and to no other.

### What was measured (2026-09-14)

One question in the shape the connector sends — the union of an exact `nwr["wikidata"="Q…"]`
statement per item, the ruin and protected-area subset taken out of it with the same tag values
the QLever query binds a geometry for, `out tags` for the rest and `out geom` for that subset
only:

- 2 items (Troy, Athens): 3.3 s. Troy came back as `way/423938794` with 26 vertices, Athens as
  its `place=city` node with no geometry.
- 100 admitted site rows of the development database: **4.9 s, 740 kB, 94 of the 100 answered**,
  253 objects — 155 ways with a geometry, 28 ways with tags only, 42 nodes, 18 relations with
  their members' geometries (`type=multipolygon` 14, `boundary` 2, `site` 2, the last carrying
  no ring to draw), 10 relations with tags only. The Acropolis of Athens is a multipolygon of 30
  outer ways, the Nazca Lines' World Heritage zone a `boundary` relation of one, both stored on
  the development database from the mirror's WKT.
- **The rings the connector joins are the mirror's polygons.** Of the 143 polygonal geometries
  assembled from that answer, 63 are the object the development database had chosen as a site's
  extent from the mirror's WKT, twelve of them relations; measured with the writer's own
  expression (`ST_Area(ST_Multi(ST_CollectionExtract(ST_MakeValid(…), 3))::geography)`), all
  63 agree with the stored `area_km2` to within a tenth of a percent — the Nazca zone at
  774.4051 km² and the Acropolis at 0.0303 km² to the fourth decimal.
- The same 100-item question ran to completion under a declared `[maxsize:8388608]` (8 MiB),
  in 5.2 s with the same 253 objects, which is what the connector's declared 64 MiB is eight
  times of.
- A regular run asks the per-item read about every candidate at the line, the second entrance's
  rows included: 1,471 items on dry run 137 (2026-09-15), so fifteen questions — under the
  hundred a day the wiki asks of regular use — answered in 1.7 MB of tags and outlines between
  them. What keeps that read's download under ten megabytes is the geometry rule — a city's
  administrative outline never crosses the wire — and the day's cache, which is why a dry run
  repeated the same afternoon sends nothing at all.
  The site pool's enumeration (#895, below) does not fit that line: eight more questions, still
  under the hundred, but about 16 MB of tags between them, so a run through this door is some
  17.7 MB on the day it asks — past the wiki's regular-use figure. What makes that acceptable is
  that this door is the configured fallback and not the default (ADR-0059 decision 4: the mirror
  answers the same list in seconds and a few megabytes), every answer is cached a day, and the
  one-off allowance the wiki states is a gigabyte.

An exact-match union rather than one `~"^(Q1|Q2|…)$"` regular expression over the key: the
regular expression is matched against every object carrying `wikidata=*` on the planet, and the
union is an index read per item.

### Rate and manners

What the policy asks, answered in the code (`backend/src/services/sync/osm/overpassOsm.ts`):
one request at a time — the reader is sequential by construction and a run never opens a second
— with a pause between requests measured from the end of the last one; a `[timeout:120]` on a
batch and a `[timeout:600]` on each of the enumeration's eight questions (#895, below), and a
`[maxsize:]` of 64 MiB declared in every query — both halves of the admission rule quoted above,
where the undeclared default would claim 512 MiB — and a client-side deadline just past the
declared run time; the project's own `User-Agent`
with the bot marker (`userAgent()`, ADR-0043's rule, #864); a 429 waited out for what
`Retry-After` says, else the thirty seconds the wiki asks for, and a 504 or a 5xx on the doubling
backoff, all on the run's shared wait budget (#886); a 200 whose body carries a `remark` naming a
runtime error — which is how this endpoint reports a query that timed out or ran out of memory —
read as a retry rather than as an empty map; and every answer cached for a day under the same
kind as the mirror's (`osm`, ADR-0030), so the object-share floor of the site door
(`OSM_ANSWER_FLOOR`) holds whichever reader answered and the run log names the one that did.

### How the reading fits the scorecard

**Signal 2** where the enumerator scored 0: read at a known item, the tags are the same measured
statement about what stands there that the mirror's record scores 2 for, and the whole reason the
door reads OSM. The total is 14, the verdict `adoptable`, and the status `adopted` — as the fallback
reader of the Archaeology site door, chosen by configuration, adopted by #893 and reading through
the same `experience_sources` row (id 5) the kind's run writes from. The enumerator reading is
unchanged: a source of *rows* for no kind, and the yardstick § 7.4 describes.

## The enumeration through this door (2026-09-15, #895)

The site pool's second entrance (ADR-0060) is eight more questions in this language, **one per
selector and each an exact match**: `nwr["historic"="archaeological_site"]["wikidata"]`,
`nwr["historic"="ruins"]["wikidata"]`, `nwr["archaeological_site"]["archaeological_site"!="no"]["wikidata"]`,
`nwr["ruins"]["ruins"!="no"]["wikidata"]`, and the same four with `["wikipedia"][!"wikidata"]` —
`out tags` and never `out geom`, and `ruins=no` left out as the mirror's form leaves it out. Two things the first live attempt through this door taught, on dry run
134: a regular expression over the value (`historic~"^(archaeological_site|ruins)$"`) is a scan
of every `historic` object on the planet and timed out at that line after the declared 120 s,
where an exact value is an index read; and even the exact form answered as one question ran
past 300 s in its print phase (43,759 elements, 16 MB), while one selector alone answered in
131 s (26,767 elements, 9.6 MB) against the batch budget of 120 s. So each selector is its own
question under a budget of its own, `[timeout:600]`, declared as the batch budget is, and asked
one at a time with the door's five-second pause between them. **The two doors answer the same
list.** Folded by object, the eight answers dry run 137 cached (2026-09-15) hold 43,759
objects — 41,707 carrying an item (39,257 items) and 2,052 carrying only an article — against
the mirror's one answer the same day, 66,417 rows folding to 43,190 objects (41,163 with an
item, 38,753 items, 2,027 article-only); 43,066 objects are in both — 41,066 of the
item-carrying ones and 2,000 of the article-only ones, joined by the article — and the rest is
the mirror's snapshot against Overpass's live data (693 objects only Overpass has, 641 of them
carrying an item; 124 only the mirror, 97 with an item), the same selector rule and the same
fold. Through the mirror the same
enumeration is one question answered in seconds; this door is the fallback the record promises
and pays for it in minutes.
