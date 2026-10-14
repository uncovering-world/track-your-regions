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
Any failure — a mismatch, a network error, a decoder error, a cancel —
destroys the source, stops the decoder (a bzip2 process is killed rather than
left to notice its closed pipes) and calls `consumer.abort()`, so a
consumer's half-built tables are never kept.

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

`startBuild(key, startedBy, kind)` in `job.ts` resolves the newest complete file,
opens a `dump_builds` row (`openBuild`), reads it — through the counting
consumer for a `verify` build, through the dump's builder (`KEEPERS`) for a
`keep` build, refused for a dump with none — and closes the row
(`closeBuild`) as `success`, `failed` or `cancelled`. One build per dump runs
at a time; a second start is refused. Progress — what is being resolved, the
file, the bytes downloaded and read, the lines — is held in memory
(`buildProgress`) and lost on a restart; startup marks a row left `running`
by a stopped backend as `failed` (`closeOrphanedBuilds`, called from
`backend/src/index.ts`).

`dump_builds` (migration `095-a-dump-build-is-recorded.sql`) records each
build: the dump, the file and its date, the mode (`stream` or `local`), the
bytes and lines read, the published and the computed checksum, the status
and the error, who started it and when it finished. It is what says which
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
   the bytes of the kept lines among them.
2. **Write** (`subsetWriter.ts`). `SubsetWriter` parses each kept line,
   writes its compact form (`compactEntity.ts`) to `wikidata_entities_next` in
   batches, and gathers the items the kept ones name (the labels ring). Every
   other item's labels and descriptions in `SUBSET_LANGUAGES` go to a gzip
   spool beside the dump (`labelsRing.ts`, `TermsSpool`), read without
   parsing the line.

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
| `wikidata_labels` | Labels and descriptions in `SUBSET_LANGUAGES`, of the kept entities and of the ring |
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
it. A dump something is built from (`keeps` in the list) also has *Build*,
which starts a `keep` build, and its row names what is built and the dump date
of the build in place, or says it was never built.
The routes are `GET /api/admin/dumps`, `POST /api/admin/dumps/:dump/build`,
`POST /api/admin/dumps/:dump/keep` and `POST /api/admin/dumps/:dump/cancel`
(`backend/src/controllers/admin/dumpController.ts`);
`docs/security/SECURITY.md` § Current Security Stack has their controls.
