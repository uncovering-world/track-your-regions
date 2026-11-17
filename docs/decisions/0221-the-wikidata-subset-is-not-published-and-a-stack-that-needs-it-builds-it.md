# ADR-0221: The Wikidata subset is not published, and a stack that needs it builds it

**Date:** 2026-11-17
**Status:** Accepted
**Issue:** [#1438](https://github.com/uncovering-world/track-your-regions/issues/1438) (closed as
not planned), Epic #1312
**Built by:** #1438, #1312, #1693
**Narrows:**
[ADR-0101](0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md)
decision 5 (a built subset is shared as a dated release);
[ADR-0105](0105-the-wikidata-subset-follows-containment-chains-and-is-kept-compact-and-swapped-in-whole.md)
decision 5 (only its clause that a published release may fill the emptied tables again)

---

## Context

ADR-0101 decision 5 reads: "A built subset is shared as a dated release. A build publishes its
tables to object storage with the dump date and checksum, and a developer loads the latest
release in minutes." Its consequences count on it: "A developer gets the data from a release,
not from a 103 GB download and an overnight build."

#1438 was the issue that would build the release. It waited from 2026-10-18 on two calls of the
maintainer's: where a built subset is published (object storage, or GitHub Releases split under
2 GiB a file), and whether the dump-derived data is published at all.

The maintainer decided on 2026-11-12, recorded on #1438: the subset is not published. A stack
that needs it builds it from the Wikidata dump itself, as the development stack does. #1438 was
closed as not planned.

No release was ever built, so nothing is taken away from anybody. What is left is text that
still promises one:

- ADR-0101 decision 5 and the line of its consequences quoted above;
- ADR-0105 decision 5, which says that the subset's unlogged tables, once a crash empties them,
  are filled again by "the next build or a published release (#1438)";
- #2348 ("A Wikidata kind reads the subset only, once production can get one"), which is blocked
  by #1438 as the way production gets a subset without building it;
- #1696, which names #1438 as how a second developer gets the data without an overnight build;
- Epic #1312, whose list still carries the slice.

A build of the subset reads the entities dump twice, about ten hours on the dump of 2026-10-05
(`docs/tech/dumps.md` § Trying a change on a sample).

## Decision

**1. The Wikidata subset is not published** (the maintainer, 2026-11-12, #1438). No build writes
a release, no object storage holds one, and no script fetches one. ADR-0101 decision 5 no longer
stands as a thing to build.

**2. A stack that needs the subset builds it from the Wikidata dump** (the maintainer,
2026-11-12), as the development stack does: the `dump-worker` service runs the build the admin
panel queues (ADR-0106), and `docs/tech/dumps.md` § A build and § The local Wikidata subset
describe it. This holds for a second developer's stack and for a production host alike.

**3. The subset's tables emptied by a crash are filled by the next build**, and by nothing else.
This is what is left of ADR-0105 decision 5 once its "published release" is gone, and it is how
that decision is built today.

**4. The licences ADR-0101 decision 5 names stay true of the tables themselves**: Wikidata and
pageviews CC0; Wikipedia-derived tables CC BY-SA; OpenStreetMap-derived tables ODbL. ADR-0134
decision 7 offers the OpenStreetMap layer under ODbL and cites decision 5 for an OSM-derived
release. Its licence statement stands; the release it mentions is not built.

**What this does not decide.**

- Where a source run computes once a host exists, and so how production comes by a subset: on
  the host, or on a machine that holds one. That is #1693's, a design session the maintainer
  leads.
- Whether the OpenStreetMap layer or the readership tables are ever published. The maintainer's
  words name the subset. #1438 also covered those two, and it is closed as not planned, so no
  issue builds a release of them either.
- How a second developer shortens the first build (#1696). A sample build exists
  (`docs/tech/dumps.md` § Trying a change on a sample).

**Accepted on 2026-11-17** (#2619 line 4.12): every decision here is the maintainer's, recorded on #1438; no decision changes with the acceptance.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Publish to object storage (Cloudflare R2, Backblaze B2), as #1438 proposed | The maintainer decided on 2026-11-12 not to publish. It needs an outside service and an account, and a release to keep in step with every build. |
| GitHub Releases, split under 2 GiB a file | The same decision. |
| Leave ADR-0101 decision 5 as it stands and only close the issue | An Accepted ADR would still decide a release, and #2348 and #1696 would go on reading it as the way a host or a developer gets the data. |

## Consequences

**Positive:**

- No outside storage, no account and no release to keep in step with the builds.
- One way to get the subset on every stack, the one the development stack already uses.

**Negative / Trade-offs:**

- A new developer's stack, and any host that reads the subset, pays for a full build: the
  download of the entities dump and about ten hours of reading it twice. This is the cost
  ADR-0101 counted on a release to remove.
- #2348 cannot be unblocked by a release. It waits on #1693's answer to where a run computes.
- A crash that empties the unlogged tables is repaired by a build of hours and by nothing
  quicker.

## References

- Related ADRs: ADR-0101 (decision 5, narrowed here), ADR-0105 (decision 5), ADR-0106, ADR-0134
  (decision 7)
- Related docs: `docs/tech/dumps.md`
- Issues: #1438, #1312, #1693, #1696, #2348
