# Public Dumps

The shared pipeline every bulk read goes through
([ADR-0101](../decisions/0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md)):
it finds the newest complete file of a public dump, reads it line by line
into a consumer, and lets the consumer keep what it built only once the file
is verified. It holds no data of its own. A build that keeps something (the
local Wikidata subset, #1434; the Wikipedia structure tables, #1440) is a
consumer plugged into it; the one consumer that ships with the pipeline counts
lines and keeps nothing, which is what the admin panel's *Verify newest* runs.

Code: `backend/src/services/dumps/` — `catalog.ts` (which dumps exist and how
the newest complete file of each is found), `fetch.ts` (the door to the host),
`read.ts` (reading and verifying), `job.ts` (the in-memory build and its
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
  (`downloadTo` in `fetch.ts`), resuming a cut download with a `Range` request
  from what is already on disk, then read from disk. A host that does not
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
the build, and an admin starts it again. A build opens one connection, so a
fourth build waits for a slot — possibly behind a read of hours — and a
cancel ends that wait rather than leaving the build queued.

What the files may be used for is the dump's own licence, and a table built
from one carries it (ADR-0101): Wikidata's entities and the pageview counts
are CC0; a table derived from the Wikipedia dumps is CC BY-SA and attributed.

## A build

`startBuild(key, startedBy)` in `job.ts` resolves the newest complete file,
opens a `dump_builds` row (`openBuild`), reads it, and closes the row
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
it. The routes are `GET /api/admin/dumps`, `POST /api/admin/dumps/:dump/build`
and `POST /api/admin/dumps/:dump/cancel`
(`backend/src/controllers/admin/dumpController.ts`);
`docs/security/SECURITY.md` § Current Security Stack has their controls.
