# Public Dumps

The shared pipeline every bulk read goes through
([ADR-0101](../decisions/0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md)):
it finds the newest complete file of a public dump, reads it line by line
into a consumer, and lets the consumer keep what it built only once the file
is verified. It holds no data of its own. A build that keeps something is a
builder plugged into it: the local Wikidata subset (§ The local Wikidata
subset, ADR-0105), readership (§ Readership, ADR-0055) and English
Wikipedia's structure (§ English Wikipedia's structure, ADR-0121) are the
three today. The counting consumer
keeps nothing, which is what the admin panel's *Verify newest* runs.

Code: `backend/src/services/dumps/` — `catalog.ts` (which dumps exist and how
the newest complete file of each is found), `fetch.ts` (the door to the host),
`rangedDownload.ts` (a local copy over several connections), `read.ts`
(reading and verifying), `buildQueue.ts` (the panel's side of a build),
`dumpWorker.ts` and `buildRun.ts` (the worker's), `keepers.ts` (what a build
keeps), `ledger.ts` (the `dump_builds` table).

## The catalog

`DUMPS` in `catalog.ts` names every dump the pipeline reads, by key
(`DUMP_KEYS`, the closed list a route accepts):

| Key | File | Verified by |
|---|---|---|
| `wikidata-entities` | `wikidatawiki/entities/<date>/wikidata-<date>-all.json.gz` | the sha1 in that directory's `wikidata-<date>-sha1sums.txt` |
| `wikidata-lexemes` | `wikidata-<date>-lexemes.json.gz`, same directory | the same sums file |
| `enwiki-page`, `enwiki-page-props`, `enwiki-linktarget`, `enwiki-categorylinks`, `enwiki-langlinks` | `enwiki/<date>/enwiki-<date>-<table>.sql.gz` | the sha1 and size `dumpstatus.json` gives the file once its job is `done` |
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
`consumer.abort()`, so a consumer is never left to commit what it half read;
what of its work survives is its own call (the subset build keeps pass 2's
for the next build to pick up after, ADR-0107). The
read rejects with that failure: stopping the decoder breaks the text stream
the line reader was reading, and the reader's late `error` is listened to and
dropped, since an `error` nobody listens to ends the whole process and loses
the failure that stopped the read.

A consumer that splits lines itself (`DumpConsumer.chunk`, the subset
build's two passes) is handed the decompressed text in pieces of about 8 MB
instead, each ending at a line's end and in memory of its own, so a worker
thread can be given it without a copy; `lineCount` says how many lines it has
taken. Every other consumer gets one call per line.

gzip is decoded in-process (`createGunzip`), in 1 MB pieces (`GUNZIP_CHUNK`):
at zlib's default 16 KB the image's Node 22 decoded the entities dump at
207 MB/s, at 1 MB at 392 MB/s, and the decoder bounds a subset build's passes
once their work runs in worker threads. bzip2 runs as a child process,
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
of them is an older copy of another and this rule removes none; readership's
build removes each once its month is kept (§ Readership). Either is said in the build's message (`onNote`), as is a
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
download into the local copy up to three. The worker runs one build at a
time, so a second build waits as a queued row (§ A build), not on a
connection.

What the files may be used for is the dump's own licence, and a table built
from one carries it (ADR-0101): Wikidata's entities and the pageview counts
are CC0; a table derived from the Wikipedia dumps is CC BY-SA and attributed.

## A build

A build runs in the dump worker, a process of its own
([ADR-0106](../decisions/0106-public-dump-builds-run-in-a-worker-process-queued-through-the-ledger.md)),
so an edit, a `git pull` or a restart of the backend does not stop it. The
backend and the worker talk only through the build's `dump_builds` row:

1. **Queued.** `startBuild` in `buildQueue.ts` checks the request — a keeping
   build needs a builder (`keeperOf` in `keepers.ts`), a re-derive a builder
   that can derive again and a build of it in place, a build from the local
   copy needs one — and queues a row (`enqueueBuild`) holding what was asked
   for (`request`: the kind, and the local copy's file to keep to).
2. **Taken.** The worker (`workLoop` in `dumpWorker.ts`, entry
   `backend/src/worker.ts`, run as the `dump-worker` compose service with
   `npm run worker` and no file watcher) takes the oldest queued row
   (`claimNextBuild`, `FOR UPDATE SKIP LOCKED`) and runs it (`runBuild` in
   `buildRun.ts`): it resolves the file and records it (`recordFile`), reads it
   through the counting consumer for a `verify` build or the dump's builder for
   a `keep` build — a `rederive` finds and reads no file, and runs the
   builder's derivation alone (`Keeper.rederive`) — and closes the row (`closeBuild`) as `success`, `failed` or
   `cancelled`, with what it did on the way (an older copy removed) in the
   message either way.
3. **Followed.** Every `BEAT_EVERY_MS` (five seconds) the build writes its
   progress — phase, message, bytes downloaded and read, what the read is
   measured against (`total`), lines, when the step running now started
   (`stepStartedAt`), and the time the step has left at its pace so far
   (`PassClock`: none in a step's first minute, a new clock for each step,
   none in a step that reads no file) — and its heartbeat to the row (`beat`),
   and the panel reads them back (`buildProgress`), whatever process runs the
   build, showing the time left as "about 1 h 10 min left in this step". A step is
   named by its message before a colon (`stepName`); a new step resets what
   is measured, starts its clock and counts one more (`step`, the ordinal),
   while a message of the same step only says more. The panel's answer also
   carries the build in the shape every long admin operation reports
   (`operation`, #1356): step by ordinal and message, with no step count since a
   build names its steps as it goes, measured as `read` against `total`, and
   `BuildProgressDetails` draws it with `OperationProgressView`, sizes for
   counts, beside the ETA and the heartbeat.
4. **Stopped.** *Cancel* (`requestCancel`) closes a queued row at once and
   marks a running one (`cancel_requested_at`); the build reads the mark with
   its next heartbeat and ends as `cancelled`. A worker that stops (SIGTERM)
   ends its build as `failed`, saying to start it again. A worker ended by an
   error nothing caught first closes the builds it runs as `failed` with that
   error's message (`failBuildsOf`, `backend/src/worker.ts`; the stack goes to
   the log only), then exits with 1; compose starts it again
   (`restart: on-failure:5`) to take the next queued build, and never the
   failed one, which the admin starts again. Docker keeps that count while the
   container exists: after five crashes the worker stays down, and queued
   builds wait until `docker compose up -d dump-worker` recreates it.

One build per dump is queued or running at a time, whatever process runs it
(#1463): a unique index admits one such row per dump, and a second request is
refused with 409 (`BuildAlreadyRunning`) — a second download of the 156 GB
entities dump beside the first would fill the disk under both. Each row names
what runs it (`runner`): the worker's builds are `worker:<hostname>`
(`WORKER_RUNNER`), and compose fixes the worker's host name so it stays the
same across a restart and a recreated container; anything else that takes a
build names itself. A `running` row is closed as `failed`
(`closeOrphanedBuilds`) when it stopped beating for five minutes, and a worker
that starts also closes at once the rows of its own runner, which its previous
run left; the backend's startup and the panel's list close the stopped ones
too. A queued row waits for a worker: a stack without one shows it waiting.

The worker runs the code it started with: a change to the build reaches it on
`docker compose restart dump-worker`, which stops the build it is running.

The worker also runs a world view's geometry computation
([ADR-0122](../decisions/0122-a-world-views-geometry-computation-runs-in-the-dump-worker-beside-its-builds.md),
#1658), queued from the panel in a ledger of its own (`geometry_computations`,
`controllers/worldView/computationLedger.ts`) and taken by a second loop
(`computationLoop` in `controllers/worldView/computationRun.ts`) beside the
builds' loop, each loop one piece of work at a time. A computation never waits
behind a build, nor a build behind a computation. Its row is followed, stopped
and closed after a crash the way a build's is, and a restart of the worker
stops it after the region in hand. `docs/tech/world-views.md` § Geometry
Computation has the rest.

`dump_builds` (migrations `095-a-dump-build-is-recorded.sql`, `100-…`,
`101-a-dump-build-is-queued-for-the-worker.sql` and
`109-a-dump-build-says-what-it-did.sql`) records each build: the dump,
what was asked for, the file and its date once resolved (none for a build that
ended before it found one), the mode (`stream` or `local`), the bytes and lines
read, the published and the computed checksum, the status (`queued`,
`running`, `success`, `failed`, `cancelled`) and the error, who started it,
what runs it, its progress and when it last beat, a cancel asked for, and when
it finished. A build that ended well says what it did in `outcome` (#1527):
what it verified and kept, how long each step took (`StepTimes` in
`stepTimes.ts`, read off the phase messages the build reports; a step under a
second is left out), and what it
did on the way, such as an older copy removed. It is what says which dump a consumer's tables were built from.

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

Between the two passes the build checks the disk (`diskRoom.ts`, #1466): the
tables are unlogged, so a database that runs out of disk mid-build would come
back with them empty. The write is estimated from the first pass's counts: the
tables as `TABLES_SHARE` of what the kept lines weigh (`keptBytes`), the terms
spool as `SPOOL_SHARE` of what the other lines weigh (`bytes - keptBytes`),
whose labels it holds. On the first 4 GB of the 2026-10-05 dump's JSON, built
into Postgres with every index, the tables took 0.37 of the kept bytes and the
spool 0.0034 of the rest; the shares are set above that, at 0.45 and 0.005.
The sample under-counts two tables, which fill in only over the whole dump:
the labels ring (the labels of entities the kept items name, spooled only from
the lines inside the sample) and the class closure (cut at the first parent
past it). The first full build's table sizes are what checks the 0.45. Each is checked on its own disk — the spool on its
directory's, the tables on the database's, named by `DB_DISK_DIR` (compose
mounts the database's volume read-only at `/app/db-disk` for that, since
`DATA_DIR` may point at another disk) — and on one disk where the two share
it; the build is refused, with the figures, unless each disk holds its share
and `HEADROOM` besides. Without `DB_DISK_DIR` (a managed database) only the
spool's disk is checked, and the build's message says the database's was not.

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
inserts are in flight instead of three (now six piece transactions,
`PIECES_IN_FLIGHT`). Beyond that the
machine's cores are all busy. The derivations after the pass run as disjoint
statements at once, one per core and at most four, since each holds a client
of the pool the API shares (`deriveFromEntities`'s parts: the entities whose
id hashes to each; a part that fails cancels the rest): on the same sample the claims, labels and sitelinks
took 11 s instead of 22, which is about half an hour saved on a full build.
Which claimed properties take an item is read once before the parts start and
handed to each as a list, rather than joined from the entities table: that
table has no index yet, and the join had each part hash all of it (#1523).

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
(`swapIn`), recording the build in `wikidata_subset_builds`. A cancel
(honoured between the steps and inside each long statement) drops the copies
and the spool, and so does a read of a file that is not the host's
(`isDamagedRead`), whose rows no build may reuse.

**The derived tables can be made again without the dump** (#1526). A change
to how the claims, labels, sitelinks or class closure are derived from the
entities needs the derivation, not the two passes over the file: a
`rederive` build (`rederiveSubset` in `subsetBuild.ts`) makes empty `_next`
copies of the four derived tables alone (`createDerivedNextTables`), carries
the ring's labels over from the live table (`carryRingLabels`: the labels of
ids that are not kept entities, which a build reads from the dump's terms),
derives the rest from the live `wikidata_entities` (`deriveFromEntities`
given that table), indexes the copies and swaps the four in alone (`swapIn`'s
`only`), recording the build under the dump date and counts of the one whose
entities it read (`latestSubsetCounts`). It first asks the database's disk
for what the live derived tables take (`derivedTablesSize`,
`assertRoomForCopies`). A failure or a cancel drops its copies alone
(`dropDerivedNextTables`): the entities copy, the record and the spool a cut
keeping build left stay, and the next build of that file still picks up
after it. A re-derive is enough for a change to the SQL that derives, and
for a property added to `CLAIM_PROPERTIES`, since a compact entity keeps
every claim it had. A change to what pass 2 writes from a line
(`WRITE_VERSION`), to the scope or to `SUBSET_LANGUAGES` still needs a build
from the dump: the entities, and the ring's labels, are what it would change.

**A build cut after pass 2 began picks up where it stopped** (#1493). The
read cuts its pieces on a fixed grid — each ends at the first line end at or
past the next multiple of `PIECE_BYTES` (8 MB) of text — so every read of a
file numbers the same pieces alike. Pass 2 writes a piece whole or not at all:
a worker compresses the piece's terms into one gzip member, which is appended
to the spool, and then the piece's rows and its record (its lines, rows
written, terms spooled, where the spool ended, the items it named for the
labels ring, the rows refused) go in one transaction (`commitPiece`, into the
unlogged `wikidata_build_pieces_next` beside the copies), no more than
`PIECES_IN_FLIGHT` of them open at once, since each holds a client of the
pool the API shares. Any other failure — a refused statement, a worker that
ended — keeps the copies, the record and the spool (ADR-0107, narrowing
ADR-0105 decision 4). The next build of the same file finds them when
`wikidata_build_resume_next` holds its key: the file's name and checksum,
the scope's counts, `PIECE_BYTES` and `WRITE_VERSION` (`lineWork.ts`,
raised by hand with any change to what pass 2 writes from a line), so rows
of two versions never meet — and when the spool is still there at least as
long as the records say; a spool in a temporary directory goes with a
recreated container, and then the build starts afresh, removing an earlier
build's spool kept elsewhere. Picking up, it empties the derived copies,
drops any index the entities copy got, cuts the spool back to where the last
recorded piece ended, restores the counts, ring and refusals from the
records, asks the disk only for what is left to write (`assertRoomToWrite`'s
`written`), and reads the file whole — which verifies it — handing on only
the pieces not recorded. A piece that spooled its terms twice is labelled
once. A crash of the database empties the unlogged record with the copies,
and the build starts afresh.

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

### What each step reports

The steps after the two passes run for minutes to hours on the whole dump,
and each says what it is doing while it does it (#1519):

- **Labelling the entities the kept items name** reads the terms spool and
  reports its compressed bytes read of its size (`onMeasure`), with the time
  left, as a pass reports the dump.
- **Deriving the claims, labels and sitelinks** says which of its three
  statements runs and how many of its parts have ended (`deriveFromEntities`:
  "claims, 2 of 4 parts done"); the parts run at once.
- **Indexing** says which index of how many it builds, and every five seconds
  that index's own phase and share from `pg_stat_progress_create_index`
  ("index 3 of 7, idx_wikidata_claims_subject: building index: scanning
  table, 45 %", `indexNextTables`). The class tree's index is reported the
  same way under *Walking the class tree*.
- **Walking the class tree** is one statement, with no measure of its own.

Every step shows when it started, so a step with no measure still reads as
alive. The worker beats every five seconds whatever step it is in: the panel
says a build whose last beat is more than a minute old may have stopped,
rather than showing it as slow.

## Readership

Code: `backend/src/services/dumps/readership/` (#1436). A `keep` build of
`pageviews-user` (`buildReadership`, `readershipBuild.ts`) keeps readership
over the last twelve complete months, as ADR-0055 decision 1 reads it: the
newest month the host has finished and the eleven before it. Each month that is
not kept already from the same file is read, oldest first, through `readDump`
like any dump, so it is verified by its size and the bzip2 stream's clean end
and kept only once it is (`readership_month_files` names the file each month
came from). A month that fails leaves the months before it kept, and the next
build reads from there; a yearly build reads only the month it lacks. Months
before the twelve are dropped once the twelve are in place. A month's local
copy (about 6 GB) is removed once the month is kept, as is any copy of a month
kept already or older than the twelve (`retiredCopies`), and the build's
message says which: the kept rows are what readership reads, and twelve copies
would hold some 70 GB beside the entities dump. A copy of a month not kept yet
stays, so a cut download resumes from it. The three tables are unlogged, the
record of the months kept among them: a crash that empties the months empties
that record too, and the next build reads the year again rather than skipping
months it no longer holds. The panel's
*Build newest* runs it, and always ends the year at the newest month the host
has finished: there is no *Build \<date\> copy* (`Keeper.fromCopy`), since the
only local copy left is a month not kept yet, which *Build newest* resumes
anyway, and a year ending there would be the wrong year. There is no sample or
trial either, since a month is kept only from its whole file (`Keeper.samples`).

**A month, line by line** (`monthSummer.ts`, `pageviewLine.ts`). A line is an
edition, a title, a page id, an access method, the month's total and the daily
counts (a letter per day from `A`, then the count). Only Wikipedia editions are
read, and a line is read from its end, since Wikimedia's readme says a row with
no page id has one column fewer. The file is sorted by edition and title, so a
title's access methods are adjacent lines and are summed as they pass, with no
table of every title in memory: the views, the views on a phone (mobile web and
app, for the automated-traffic check of ADR-0055 decision 3), and, where the
month reaches 400 views (5,000 a year), the daily series, for the burst flag of
decision 4. A title under 10 views in the month is not staged.

**Three spellings, and the trap in the third** (`decodeTitle`). The dump
writes a title raw, as `%XX` bytes of UTF-8, and as `%uXXXX` code units of old
JavaScript `escape()`, each in its own row with its own count (ADR-0055). The
encoded rows sort apart from the plain one, so each is staged under the decoded
title whatever its count, and the month's SQL sums them. `%uXXXX` writes UTF-16,
so a character outside the Basic Multilingual Plane arrives as two surrogates
(`%uD83D%uDE00`) and is one character; September 2026's file also carries lone
surrogates, which are unreadable and become U+FFFD rather than failing the read. A control
character, which `%00` and its kind decode to and which no title can hold,
becomes U+FFFD too: PostgreSQL refuses a NUL in text, and November 2025's file
carries one.

**Kept per item and edition.** The staged rows go to `readership_staging` in
batches, and once the file is verified `keepMonth` (`readershipMonth.ts`) sums
them per title, joins them to items through the local subset's sitelinks
(`wikidata_sitelinks`, on site and title) and swaps the month into
`readership_months` (month, item, site, views, mobile, daily) in one
transaction. Every edition is kept, which adds 2.7 % to the rows of the
editions ADR-0055 counts (36.9M titles over 10 views against 35.9M in September
2026): an edition near the counted line crosses it from month to month, so which
editions count is not decided by one month. Every Wikipedia edition's total that
month is kept beside it (`readership_month_files.editions`), the denominator a
door divides by. A month under 50 million lines or 80 Wikipedia editions in all
(`MIN_EDITIONS`; the file names 371) is refused as a stream that stopped
(ADR-0055 decision 1), on top of the read's own checks. A title's daily series
is the one of its largest row, the plain spelling in practice.

A door reads readership by item: `readership_months` for the item's sitelinks,
summed over the twelve months `readership_month_files` lists, in the editions
ADR-0055 counts — those whose twelve `editions` totals add up to more than 15
million views — which the door picks from those totals; summing every edition
would count the small ones the ADR leaves out. The redirects of
ADR-0055 decision 2 are not folded in yet: they need each edition's redirect
table, which no build keeps (English Wikipedia's structure keeps no redirect,
ADR-0121 decision 2).

On September 2026 (`pageviews-202609-user.bz2`, 5.9 GB, 561.8M lines, measured
2026-10-17 on #1436), 80 editions are counted. They have 181.9M titles, 35.9M
of them with 10 views or more. 9.6M of those are sitelinks of 3.6M subset items,
0.74 GB a month as a heap, with 1.0M at 400 views or more.

## English Wikipedia's structure

Code: `backend/src/services/dumps/wikipedia/` —
[ADR-0121](../decisions/0121-english-wikipedias-structure-is-kept-as-articles-categories-and-their-links.md).
A keeping build of `enwiki-page` (`buildStructure`, `structureBuild.ts`)
reads that file and the three of the same dated directory
(`STRUCTURE_FILES`, each resolved by name, `siblingName`), each verified by
the sha1 and size `dumpstatus.json` gives it before the next is read:

1. `page`: the articles (namespace 0) and categories (14) that are no
   redirect go to `enwiki_pages`, and their ids to two bit sets (`IdSet`);
2. `page_props`: a kept page's `wikibase_item` goes to `enwiki_page_items`,
   and a category page's `hiddencat` marks it hidden;
3. `linktarget`: every namespace-14 target that is not a hidden category's
   title goes to `enwiki_categories` under its link target id, the id a
   category link names its category by;
4. `categorylinks`: a `page` link from a kept article or a `subcat` link from
   a kept category, into a kept category, goes to `enwiki_category_links`; a
   file's, another namespace's, or one into a hidden category is left out.

A statement is read by `InsertReader` (`sqlInsert.ts`): the dumps write a
table's `INSERT` with one row a line after the line that names the table,
each row ended by a comma and the last by the semicolon, and a row's strings
carry mysqldump's backslash escapes. A line is decoded as UTF-8, which turns a
binary sort key into replacement characters and leaves every quote and
backslash where it was; the sort keys are not kept. On the first 30 MB of the
2026-10-01 `categorylinks` file (320 MB of SQL, 3.33M rows) it read 82–88 MB/s
on this repository's development machine at a load average of about 4.6,
which puts the whole file, some 27 GB of SQL, at about five minutes of
parsing.

The rows go to `_next` copies of the four tables, made without their indexes
(`createNextTables`); once the four files are verified the copies are given
the live tables' indexes and key constraints, read from the catalog as the
subset's are (`indexNextTables`, `indexesOf`), and swapped in with the
build's row in `enwiki_structure_builds` in one transaction (`swapIn`). A file
that fails its check, or a cancel, drops the copies; the structure in place
stays. So does a file whose `CREATE TABLE` does not name, at the positions the
build reads, the columns it reads there (`STRUCTURE_FILES`' `columns`, held by
`InsertReader` before the first row), and a build that kept no row of one of
the tables (`refuseEmpty`): a change to a table's columns is refused rather
than read into the wrong values. The build's row records the page file's own
size, lines and checksum; the other three files' reads are measured as steps
against their own sizes, and the summary gives the four files' totals. Every table is `UNLOGGED`, the record too, so a crash of the database
empties both and the panel asks for a build (`latestStructure` answers none).
There is no trial build: a table is kept from its whole file.

| Table | Holds |
|---|---|
| `enwiki_pages` | An article or category that is no redirect: page id, namespace, title with underscores |
| `enwiki_page_items` | The Wikidata item of a kept page |
| `enwiki_categories` | A category a link may name that is not hidden: its link target id and title |
| `enwiki_category_links` | A kept page filed under a kept category, and whether the page is itself a category |
| `enwiki_structure_builds` | The builds swapped in: the `dump_builds` row, the dump date, the counts |

The `langlinks` table is listed in the catalog and verified like any dump, and
kept by no build: Wikidata's sitelinks say the same (ADR-0121 decision 3).

## Trying a change on a sample

A build of the subset reads the whole entities dump twice, about ten hours on
the 2026-10-05 dump. A change to the build — the scope rules, the compact form,
the derivations, the worker — is tried on a sample first (#1527):

1. **Cut a sample.** A `sample` build (`cutFrom` in `buildRun.ts`,
   `cutSample` in `samples.ts`) copies the first `SAMPLE_JSON_BYTES` (16 GB) of
   the local copy's entities into a file of its own beside it, closed as a
   valid JSON array (`CutAt`: the line the limit falls in is finished, its
   trailing comma dropped, and a `]` line follows) and gzipped. It reads the
   copy only as far as the cut, and writes under a temporary name it renames
   once whole. The sample is named `sample-16gb-<copy's name>`: the catalog's
   test for the dump's files refuses that name, so nothing that replaces or
   removes older copies of the dump touches it, and a build of the dump never
   reads it. While it cuts, its bar measures the entities taken against the
   sample's size, and its row keeps the copy's bytes read. A new cut removes the dump's earlier samples once it is whole,
   with what builds of them left beside them, so the directory holds one
   sample of a dump as it holds one copy.
2. **Try the build.** A `trial` build (`tryOnSample`) runs the dump's builder
   on the newest sample with `trial` set (`buildSubset`): both passes, the
   labels ring, the derivations and the indexes run into the `_next` copies
   as a real build's do, and the copies are then dropped instead of swapped
   in. The subset the runs read is never touched, so a trial can run on the
   deployment whose catalogue reads that subset. A trial always runs every
   step whole: it neither reads back a first pass kept beside the sample nor
   picks up after an earlier trial's copies, since the code of each step is
   what it tries and each step's time what it reports. The sample is read from disk
   only (`held` in `ReadOptions`): it has no host to download from and no
   published checksum, so its size and a clean end of the gzip stream are
   what the read checks.
3. **Read the result.** The trial's row says what it kept, the size of its
   tables against the kept lines' bytes the disk check estimates from
   (`TABLES_SHARE`), and how long each step took — which is how a change that
   makes a step slower shows before a full build pays for it.

The sample's size is set so a trial takes about ten minutes. On the
2026-10-05 dump, on this repository's development machine, a 4 GB sample was
cut in 1 min 36 s and its trial took 2 min 35 s (pass 1 40 s, pass 2 1 min
21 s, deriving 24 s, indexing 9 s); a trial's time grows with the JSON it
reads, so the sample is four times that.

A trial is refused, before its first pass, while a build of the dump cut in
its second pass waits for the next build of its file to pick up after it
(#1493): its copies share the `_next` tables, and the trial would throw them
away. A trial's own leftovers — from one the worker's end stopped before it
could drop them — no build picks up after, and the next trial drops them. The dump begins with the oldest
items, which are among the largest and the most often kept, so a sample keeps
a larger share of its lines than the whole dump does, and its time per
gigabyte is not the whole dump's.

## The admin panel

Admin → **Public Dumps** opens on what an admin needs (#1583): one card for
the copy syncs read, the Wikidata copy (`WikidataCopyCard.tsx`); readership is
built under *For developers* only. It says what the copy is, which dump it was built
from, and, only when something needs doing, a notice naming the one action and
what it costs:

| What the copy needs (`needs`) | The notice | The button |
|---|---|---|
| `newer-dump`: the host lists a newer dump than the one it was built from | A newer dump is out | *Update*, a `keep` build of the newest file (hours) |
| `recompute`: the code now makes the derived tables differently | The app was updated, and the tables need recomputing | *Recompute*, a `rederive` (minutes) |
| `rebuild`: the code now keeps or writes the copy differently, or no copy is in place | The app was updated, and the copy needs a full update | *Update* (*Build* where there is none) |
| `nothing` | "Up to date" | none |

While a build runs, the card shows its progress and *Stop*. What the copy needs
is `whatTheKeptNeeds` (`keepers.ts`). It reads two things:
- The rules the build in place was made under. Each swap records them in
  `wikidata_subset_builds.rules` (migration 112, `buildRules.ts`): the first
  pass's version and rules, `WRITE_VERSION`, and `DERIVE_VERSION`, which is
  raised by hand with any change to what the derived tables hold. A re-derive
  records the build's scope and writing with the code's derivations. A row
  from before the rules were recorded is read as current.
- The newest dump the host lists (`newestOnHost.ts`). It is asked at most once
  a day, in the background, so the page never waits on the host. Until it has
  been asked since the backend started (`newestChecked: 'not-yet'`) the card
  says it is checking rather than "Up to date", and the page asks again every
  ten seconds. When the host did not answer (`unreachable`), the card says a
  newer dump may be out.

Everything else sits in the collapsed section *For developers*: every dump,
every build button, the sample and the trial, and the build history.

The developers' section (`frontend/src/components/admin/DumpsPanel.tsx`)
groups the catalog's dumps by who publishes them (each descriptor's `source`),
one table per publisher on one column grid. A row is a dump with what it holds
and how its last build ended: *Verified*, *Failed* or *Cancelled*, when, the
dump's date — a day, or for the pageview files the month their counts cover
(`datedBy`) — its size and lines, and what verified it (`sha1 matched`,
`size matched`); a failed build's error sits under its row. The other builds
among its last three (`recentBuilds`) open under the row. *Verify newest* queues
a build of the counting consumer over the newest complete file and the row
turns into its progress, polled every three seconds while the page is visible:
*Waiting for the dump worker* while it is queued, then the worker's phase, its
bytes and lines, the time the pass has left, and when it was last seen alive; *Cancel* stops it, queued or
running. A dump something is built from (`keeps` in the list) also has *Build
newest*, which starts a `keep` build, and, where a local copy exists
(`localCopy` in the list, shown under the row's description with its date and
size) and its builder builds from a copy (`keeps.fromCopy`, the subset's), *Build \<date\> copy*, which starts one from that copy. Where a build
is in place and its builder can derive again without the dump (`keeps.rederives`,
the subset's), *Derive again* starts a `rederive` (#1526), which reads no file.
*Cut a sample* and *Try the build* are offered only where the builder can be
tried on a sample (`keeps.samples`); readership keeps only whole files and has
neither.
The row's last build stays the last that read a file; the re-derive has a
line of its own under what is built (*Last derived again …*, with its outcome
when it did not succeed), and among the earlier builds it says *Derived* and
*Derived again from the subset in place*. `recentBuilds` keeps the last three
of each, so re-derives never push the file builds out. A re-derive is refused
where the entities table is empty, as a crash of the database leaves it
(unlogged) while the record of the build says a subset is in place, and a
worker that meets a kind of build it does not know fails it rather than
reading a file. Such a row
also names what is built and the dump date of the build in place, or says it
was never built. Where a local copy exists, *Cut a sample* starts a `sample`
build, and once a sample exists (`sample` in the list, shown under the row
with the copy's date and its size), *Try the build* starts a `trial`. The
last trial has a line of its own under the sample (*Last trial …*, with its
`outcome`: what it kept and how long each step took), and among the earlier
builds a sample says *Cut* and a trial *Tried*, each with its outcome.
`recentBuilds` keeps the last three of each of these kinds as well. While a build of the dump is queued or running, the row offers no other
button; it shows the step's message, its measure when it has one, when the
step started and when the worker was last seen alive, or, after a minute
with no beat, that the worker may have stopped.
The routes are `GET /api/admin/dumps`, `POST /api/admin/dumps/:dump/build`,
`POST /api/admin/dumps/:dump/keep`, `POST /api/admin/dumps/:dump/rederive`,
`POST /api/admin/dumps/:dump/sample`, `POST /api/admin/dumps/:dump/trial`
and `POST /api/admin/dumps/:dump/cancel`
(`backend/src/controllers/admin/dumpController.ts`);
`docs/security/SECURITY.md` § Current Security Stack has their controls.
