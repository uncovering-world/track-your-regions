# Public Dumps

The shared pipeline every bulk read goes through
([ADR-0101](../decisions/0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md)):
it finds the newest complete file of a public dump, reads it line by line
into a consumer, and lets the consumer keep what it built only once the file
is verified. It holds no data of its own. A build that keeps something is a
builder plugged into it: the local Wikidata subset (§ The local Wikidata
subset, ADR-0105) is the first, and the Wikipedia structure tables (#1440)
and readership (#1436) come later. The counting consumer keeps nothing, which
is what the admin panel's *Verify newest* runs.

Code: `backend/src/services/dumps/` — `catalog.ts` (which dumps exist and how
the newest complete file of each is found), `fetch.ts` (the door to the host),
`rangedDownload.ts` (a local copy over several connections), `read.ts`
(reading and verifying), `job.ts` (the in-memory build and its
progress), `ledger.ts` (the `dump_builds` table).

## The catalog

`DUMPS` in `catalog.ts` names every dump the pipeline reads, by key
(`DUMP_KEYS`, the closed list a route accepts):

| Key | File | Verified by |
|---|---|---|
| `wikidata-entities` | `wikidatawiki/entities/<date>/wikidata-<date>-all.json.gz` | the sha1 in that directory's `wikidata-<date>-sha1sums.txt` |
| `wikidata-lexemes` | `wikidata-<date>-lexemes.json.gz`, same directory | the same sums file |
| `enwiki-page`, `enwiki-page-props`, `enwiki-categorylinks`, `enwiki-langlinks` | `enwiki/<date>/enwiki-<date>-<table>.sql.gz` | the sha1 and size `dumpstatus.json` gives the file once its job is `done` |
| `pageviews-user` | `other/pageview_complete/monthly/<year>/<year-month>/pageviews-<yyyymm>-user.bz2` | the host's `Content-Length` and a clean end of the bzip2 stream — no checksum is published |

Each descriptor's `resolve()` reads the host's own listing and answers the
newest dated file that is **complete**, or nothing. It never reads a
`latest-` link: a `latest-` link can be repointed while a 100 GB download is
in flight, and while a new Wikidata dump is being written
`latest-all.json.gz` is a 38-byte stub. A dated directory whose checksum is
not yet published is passed over for the one before it, up to six
directories back.

Every URL is built here from the fixed host (`WIKIMEDIA_DUMPS`) and a name
the listing gave, and every such name passes `safeFileName` — one plain path
segment — before it becomes part of a URL or a path. A request names a dump by
key and nothing else.

## Reading and verifying

`readDump(file, consumer, options)` in `read.ts`. The compressed bytes pass
through a hashing tap on their way to the decompressor, so a stream is
verified without being stored. At the end of the stream:

- the published checksum must equal the bytes read, where one is published;
- the byte count must equal the host's size, where the host gave one;
- the decompressor must have reached a clean end of its stream.

All three are needed. A stream cut short reads as a clean end of file to a
line reader (ADR-0055 measured it on the pageview files); the decompressor
fails on a truncated gzip or bzip2 stream; and the size catches a cut that
happens to fall on a block boundary. Only then is `consumer.commit()` called.
Any failure — a mismatch, a network error, a decoder error, a consumer that
throws, a cancel — destroys the source, stops the decoder (a bzip2 process is
killed rather than left to notice its closed pipes) and calls
`consumer.abort()`, so a consumer's half-built tables are never kept. The
read rejects with that failure: stopping the decoder breaks the text stream
the line reader was reading, and the reader's late `error` is listened to and
dropped, since an `error` nobody listens to ends the whole process and loses
the failure that stopped the read.

A consumer that splits lines itself (`DumpConsumer.chunk`, the subset
build's two passes) is handed the decompressed text in pieces of about 8 MB
instead, each ending at a line's end and in memory of its own, so a worker
thread can be given it without a copy; `lineCount` says how many lines it has
taken. Every other consumer gets one call per line.

gzip is decoded in-process (`createGunzip`). bzip2 runs as a child process,
`/usr/bin/bzip2 -dc` by its absolute path, whose exit code is what says the
stream ended cleanly: Node has no bzip2 of its own, and the Alpine image has
no parallel decoder (no `lbzip2` or `pbzip2`), so a gzip file is preferred
wherever the host offers both.

## Stream or local copy

`DUMPS_DIR` (environment; `.env.example` has the note) decides:

- **Empty** — every file is read straight from the host as a stream and
  nothing is kept on disk. A cut stream fails the build, and the next build
  starts from the beginning.
- **A directory** (a container path under `/app/data`, e.g. `/app/data/dumps`)
  — the file is first brought to the host's full size in that directory
  (`downloadTo` in `fetch.ts`), then read from disk. Where the host names the
  file's size, what is left is split into one range per connection the host
  allows (`downloadRanges` in `rangedDownload.ts`; ranges under 64 MB are not
  split off) and each range is written at its own offset in `<file>.part`,
  with where every range has got to saved in `<file>.part.json`. A cut
  download resumes each range where it stopped, and the file takes its own
  name only once every range is written. `dumps.wikimedia.org` serves about
  5 MB/s per connection, so three connections bring the 156 GB entities dump
  in under 3 hours instead of about 8 (measured 2026-10-14). A copy from
  before, written in order from byte 0, is continued from its end. Where the
  host names no size, the rest is fetched in order over one connection with a
  `Range` request from what is already on disk. A host that does not
  answer the range with `206` fails the build rather than appending a whole
  file to a partial one, except a `416` to a copy already at full size from a
  host that named no size: the copy is whole as far as the host can say, and
  the checksum decides. A copy at full size is never downloaded again, so
  one that fails verification — a checksum or size mismatch, or a stream the
  decoder refuses — is deleted, and the next build downloads it afresh; a
  failure of the network, the consumer or a cancel keeps it. `data/dumps/` is
  gitignored.

The full Wikidata dump is well over 100 GB, so a local copy needs a disk with
room for it; a machine without one streams.

**One copy per dump** (`localCopies.ts`, #1456). Every file the catalog names
carries its date as the second part of its name
(`wikidata-20261005-all.json.gz`, `enwiki-20261001-page.sql.gz`,
`pageviews-202609-user.bz2`), and `copyOf` reads a name's dump and date, with
its leftovers: a ranged download's `.part` and state, a subset build's terms
spool and first-pass result. A dump dated by day keeps one copy: once a copy
is verified, `readDump` removes the older copies of its dump (`olderCopies`,
matched by the catalog's `isFileName`); before a download, it removes them
first when the disk cannot hold what is left of the new one beside them
(`makeRoom`, `freeBytes`, with what a resumed ranged download already holds
read from its saved ranges, `bytesHeld`). The monthly pageview files are
twelve different months, which readership reads together (ADR-0055), so none
of them is removed. Either is said in the build's message (`onNote`), as is a
copy that could not be removed: the verified read stands. One build per dump
runs at a time in any process (§ A build), so no build of that dump is reading
an older copy then.

**A build from the local copy.** A build reads the newest file the host lists,
or, asked `from: 'local'`, the file of the dump's newest local copy
(`newestLocalCopy`, by the catalog's `isFileName`): its resolver walks the same
dated directories and keeps to that file name (`only`), so the copy is still
verified against the host's checksum and size. A copy downloaded for hours is
built from even after the host has published a newer dump. A copy whose
directory the host no longer lists among its recent ones cannot be verified,
and the build says so.

## The host's rules

`dumps.wikimedia.org` caps a client at three connections, rate-limits, and
enforces the Wikimedia User-Agent policy; it publishes no `robots.txt`.
`fetch.ts` holds at most `HOST_CONNECTIONS` (3) open per host from this
process, sends the bot `userAgent()` with the purpose `public dump builds` on
every request, follows redirects, and never retries: a failed request fails
the build, and an admin starts it again. A read opens one connection and a
download into the local copy up to three, so another build waits for a slot —
possibly behind a download or a read of hours — and a cancel ends that wait
rather than leaving the build queued.

What the files may be used for is the dump's own licence, and a table built
from one carries it (ADR-0101): Wikidata's entities and the pageview counts
are CC0; a table derived from the Wikipedia dumps is CC BY-SA and attributed.

## A build

`startBuild` in `job.ts` resolves the newest complete file,
opens a `dump_builds` row (`openBuild`), reads it — through the counting
consumer for a `verify` build, through the dump's builder (`KEEPERS`) for a
`keep` build, refused for a dump with none — and closes the row
(`closeBuild`) as `success`, `failed` or `cancelled`. Progress — what is
being resolved, the file, the bytes downloaded and read, the lines — is held
in memory (`buildProgress`) and lost on a restart.

One build per dump runs at a time, whatever process runs it (#1463). A running
build beats its row's `heartbeat_at` every minute (`beat`, `BEAT_EVERY_MS`),
and a start is refused while the dump has a `running` row that beat within the
last five minutes (`liveBuildOf`): a build a script runs reads the same local
copy, and a second download of the 156 GB entities dump beside it would fill
the disk under both. The ledger holds the rule too: a unique index admits one
`running` row per dump, so two starts that pass the check together cannot both
open a build (`BuildAlreadyRunning`). Each row names what runs it (`runner`):
this backend's builds are `server:<hostname>` (`SERVER_RUNNER`), and compose
fixes the backend's host name (`hostname:` in `docker-compose.yml`) so it stays
the same across a restart and a recreated container; anything else that opens
a build (`openBuild`) names itself, a script inside that container included. A `running` row is closed as `failed`
(`closeOrphanedBuilds`) when it stopped beating, and at startup
(`backend/src/index.ts`) also at once when this backend's own previous run
left it; the panel's list and a start of the dump close the stopped ones too.
A build alive in another process is left alone and survives this one's
restart.

`dump_builds` (migration `095-a-dump-build-is-recorded.sql`) records each
build: the dump, the file and its date, the mode (`stream` or `local`), the
bytes and lines read, the published and the computed checksum, the status
and the error, who started it, what runs it, when it last beat and when it
finished. It is what says which
dump a consumer's tables were built from.

## The local Wikidata subset

Code: `backend/src/services/dumps/wikidata/` —
[ADR-0101](../decisions/0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md)
decision 2 as narrowed by
[ADR-0105](../decisions/0105-the-wikidata-subset-follows-containment-chains-and-is-kept-compact-and-swapped-in-whole.md).
A `keep` build of `wikidata-entities` runs `buildSubset` (`subsetBuild.ts`),
which reads the file twice through `readDump`, each pass verified:

1. **Scope** (`scope.ts`). `ScopeCollector` scans every line without parsing
   it (`entityLine.ts`: the entity's id, whether a main snak has a value for a
   property, the items the main snaks name) and keeps ids and edges only, in
   bit sets and typed arrays (`idSets.ts`). It keeps the seeds (a coordinate,
   P625, or a class, P279), a seed's P31 classes and its place, part and
   collection values (P131, P276, P361, P527, P195, P189), every item that
   names a seed through one of those, every item whose chain of P276, P361 and
   P195 reaches a coordinate within `CHAIN_DEPTH` steps with every item on the
   way, and every property. `finish()` answers the kept set and its counts,
   the bytes of the kept lines among them. With a local copy, the result is
   kept beside the dump as `<file>.scope` (`scopeFile.ts`, #1468): the
   kept and property id sets, a bit per id, under a header naming the file,
   its checksum and the rules it was made under: the scope's constants
   written whole (`SCOPE_RULES`), so a change to one makes it stale by
   itself, and `SCOPE_VERSION`, raised by hand when the code that applies
   them (`entityLine.ts`, `ScopeCollector`) keeps something else. A build of
   the same file reads it back
   instead of scanning the dump again, about four hours on the entities dump;
   one for another file, checksum or rules is removed, not read. The second
   pass still verifies the file.
2. **Write** (`subsetWriter.ts`). `SubsetWriter` parses each kept line,
   writes its compact form (`compactEntity.ts`) to `wikidata_entities_next` in
   batches, and gathers the items the kept ones name (the labels ring). Every
   other item's labels and descriptions in `SUBSET_LANGUAGES` go to a gzip
   spool beside the dump (`labelsRing.ts`, `TermsSpool`), read without
   parsing the line.

Both passes run in worker threads (`linePool.ts`, #1479): the main thread
decompresses, hashes and hands pieces of text to a pool of workers, every core
but one by default (`DUMP_WORKERS` sets it; `0` runs the same code on the main
thread). A worker splits the piece into lines (`textLines.ts`) and runs the
pass's pure function on them — `scopeFactsOf` (`scope.ts`) or `writeFactsOf`
(`lineWork.ts`) — and answers in typed arrays and strings; pass 2's scope sets
are read in shared memory (`IdSet.toShared`). The main thread only merges. Pass
1's answers are absorbed in the order of the dump (`ScopeReader`), since the
chain walk follows its edges in the order they arrived; pass 2's in any order.
How many pieces are in flight is bounded, waiting on the database included, so
a slow insert slows the read instead of filling memory. A worker under tsx is
started from a line that registers tsx in it, since a loader passed in
`execArgv` does not reach a worker on the image's Node 22.

On 4 GB of the 2026-10-05 dump's JSON, on this repository's development
machine (two cores, four threads), with no database: from its start, pass 1
went from 165 to 358 MB/s and pass 2 from 81 to 214 MB/s; from 60 GB in, from
206 to 443 and from 196 to 475 MB/s, the decoder by then the limit. The scope,
rows, spooled terms and ring are the same either way (`parallelPasses.test.ts`).

Into a real Postgres the database's share shows: on the dump's first 4 GB,
where nearly two thirds of the items are kept, pass 2 with its inserts ran at
118 MB/s. Two changes took it to 143 MB/s: a worker quotes each entity as an
element of the insert's array literal (`arrayItemOf`, `EntityRow.arrayItem`),
so the main thread does not escape every quote of every entity, and six
inserts are in flight instead of three (`IN_FLIGHT`). Beyond that the
machine's cores are all busy. The derivations after the pass run as disjoint
statements at once, one per core and at most four, since each holds a client
of the pool the API shares (`deriveFromEntities`'s parts: the entities whose
id hashes to each; a part that fails cancels the rest): on the same sample the claims, labels and sitelinks
took 11 s instead of 22, which is about half an hour saved on a full build.

Every string kept is one Postgres can store (`storableText`,
`storableJson` in `compactEntity.ts`): `text` and `jsonb` hold no NUL, and
`jsonb` no surrogate without its partner, and the dump holds both — an
Arabic label ending in a NUL stopped the first full build of the 2026-10-05
dump in its second pass. A NUL is dropped and a lone surrogate becomes
U+FFFD. A row Postgres still refuses for its data (SQLSTATE class 22) is
left out rather than ending a build of hours (`refusals.ts`): a refused
batch of entities or ring labels is written again row by row, the rows still
refused are counted (`counts.refused`) and the first ten named in the
build's notes, and more than `MAX_REFUSED` of them, or any other failure,
stops the build as before.

Then the ring's terms are read back from the spool into `wikidata_labels_next`,
and `subsetTables.ts` derives the rest from the entities in SQL
(`deriveFromEntities`, `deriveClassClosure`), gives each `_next` copy the live
table's indexes (`indexNextTables`, read from the catalog, so `01-schema.sql`
is their one statement), and swaps the copies in with one transaction
(`swapIn`), recording the build in `wikidata_subset_builds`. A failure, or a
cancel (honoured between the steps and inside each long statement), drops
the copies; the spool is removed either way.

| Table | Holds |
|---|---|
| `wikidata_entities` | Each kept entity's compact JSON (`lz4`, `toast_tuple_target = 128`) and its sitelink count |
| `wikidata_claims` | A row per statement of `CLAIM_PROPERTIES`: rank (1, 0, −1), `value_item` for an item value (told by the property's datatype), `value` otherwise, qualifiers |
| `wikidata_labels` | Labels and descriptions in `SUBSET_LANGUAGES`, of the kept entities (derived from their compact form) and of the ring (from the spool) |
| `wikidata_sitelinks` | Every sitelink of a kept entity |
| `wikidata_class_closure` | Each class a kept item is an instance of, with itself and every class above it through non-deprecated P279 |
| `wikidata_subset_builds` | The builds swapped in: the `dump_builds` row, the dump date, the counts |

The five derived tables are `UNLOGGED`: rebuilt from the dump, they skip the
write-ahead log, and a crash of the database empties them until the next
build. Which dump a reader reads is the newest `wikidata_subset_builds` row.

## The admin panel

Admin → **Public Dumps** (`frontend/src/components/admin/DumpsPanel.tsx`)
groups the catalog's dumps by who publishes them (each descriptor's `source`),
one table per publisher on one column grid. A row is a dump with what it holds
and how its last build ended: *Verified*, *Failed* or *Cancelled*, when, the
dump's date — a day, or for the pageview files the month their counts cover
(`datedBy`) — its size and lines, and what verified it (`sha1 matched`,
`size matched`); a failed build's error sits under its row. The other builds
among its last three (`recentBuilds`) open under the row. *Verify newest* runs
the counting consumer over the newest complete file and the row turns into its
progress, polled every three seconds while the page is visible; *Cancel* stops
it. A dump something is built from (`keeps` in the list) also has *Build
newest*, which starts a `keep` build, and, where a local copy exists
(`localCopy` in the list, shown under the row's description with its date and
size), *Build \<date\> copy*, which starts one from that copy. Such a row
also names what is built and the dump date of the build in place, or says it
was never built. A build of the dump that
another process runs (`elsewhere` in the list) takes the row's progress cell,
with when it started and when it last beat, and the row offers no button
until it ends; the page polls every 30 seconds while one runs.
The routes are `GET /api/admin/dumps`, `POST /api/admin/dumps/:dump/build`,
`POST /api/admin/dumps/:dump/keep` and `POST /api/admin/dumps/:dump/cancel`
(`backend/src/controllers/admin/dumpController.ts`);
`docs/security/SECURITY.md` § Current Security Stack has their controls.
