# ADR-0107: A subset build cut in its second pass is picked up, not started again

**Date:** 2026-10-15
**Status:** Accepted

---

## Context

ADR-0105 decision 4 has a subset build write `_next` copies of its tables and swap them in whole, and says that **a failure drops the copies** and leaves the live subset as it was.

The second pass over the 2026-10-05 entities dump (156 GB of gzip, about 1.5 TB of JSON) took hours. On 2026-10-15 build 6 died about five hours into it: one Arabic label held a NUL, Postgres refused its batch, and the line reader's late error ended the process (#1488 fixed both). Everything the pass had written — 26 GB of `wikidata_entities_next` — was dropped, and the rebuild had to start the pass from the first line.

The passes now run in worker threads (#1479), so pass 2 takes a few hours rather than nine. A cut still costs those hours. A worker that ends (#1491), a backend redeploy that recreates the worker (ADR-0106), or a refused statement no budget allows is enough.

The dump is one gzip member, so a read cannot seek to where it stopped. It can decode everything before that point again, at about 390 MB/s in the image, and skip the rest of the work there: the parsing, the compaction and the inserts.

## Decision

**A build that fails in or after its second pass keeps what that pass wrote, and the next build of the same file and scope picks up after it.** This narrows ADR-0105 decision 4. A cancel still drops the copies, and so does a read of a file that is not the host's, whose rows no build may reuse.

1. **Pieces on a fixed grid.** The read cuts the text into pieces that end at the first line end at or past each multiple of 8 MB (`PIECE_BYTES`), and numbers them. Every read of a file cuts and numbers the same pieces.
2. **A piece is written whole or not at all.** Its terms are appended to the spool as one gzip member. Its rows and a record of it go in one transaction into an unlogged table beside the copies (`wikidata_build_pieces_next`). The record holds its lines, its rows written, its terms spooled, where the spool ended, the items it named and the rows refused.
3. **A key says what the copies were built from.** `wikidata_build_resume_next` holds the file's name and checksum, the scope's counts, the piece size and `WRITE_VERSION`. The version is raised by hand with any change to what pass 2 writes from a line. Copies under another key, or whose spool is missing or shorter than the record says, are dropped and the build starts afresh.
4. **The next build reads the file whole**, which verifies it, and hands on only the pieces not recorded. It first:
   - empties the derived copies;
   - drops any index the entities copy got;
   - cuts the spool back to the last recorded piece;
   - restores the counts, the ring and the refusals from the records.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep ADR-0105's drop on failure | Every cut costs the whole pass again: hours, and a night on build 6. |
| Checkpoint the last committed line | Pieces finish out of order in the worker pool, so the committed prefix lags the work done, and a row written past it would be written twice. |
| Make the entities copy unique on its id and let a redone row conflict | An index slows the load the copies are made without one for, and the spool and the counts still need their own record. |
| Seek into the gzip stream | One member has no index to seek by. Building one is a pass of its own. |
| Resume pass 1 too | Its result is already kept beside the dump once it ends (#1468), and the pass takes about an hour with the workers. |

## Consequences

**Positive:**
- A cut in pass 2 costs the decode up to where it stopped (about an hour for the whole file), not the pass.
- Nothing the pass wrote can be read twice or from another version of the code. Each piece is atomic and recorded, and the key names the file, the scope, the grid and the code's version.

**Negative / Trade-offs:**
- A failed build's copies, record and spool stay on disk until the next build of the file. The spool's few gigabytes now outlive a failed build.
- `WRITE_VERSION` is raised by hand, like `SCOPE_VERSION` for pass 1. A change to the written form that forgets it would mix rows of two versions in one subset.
- One transaction per piece measured pass 2 at 136.5 MB/s against 141–143 MB/s before, on 4 GB into the test stack's Postgres.

## References

- Related ADRs: ADR-0105 decision 4 (narrowed), ADR-0106 (the dump worker), ADR-0101 decision 4
- Related docs: `docs/tech/dumps.md` § The local Wikidata subset
- Issues: #1493, #1488, #1479, #1468, #1434
