# ADR-0195: Every copy built from a dump updates itself, and no swap lands under a run

**Date:** 2026-11-10
**Status:** Accepted
**Issue:** [#2415](https://github.com/uncovering-world/track-your-regions/issues/2415)
**Follows:** [ADR-0106](0106-public-dump-builds-run-in-a-worker-process-queued-through-the-ledger.md),
[ADR-0134](0134-openstreetmap-is-read-from-a-layer-cut-from-the-planet-and-a-miss-the-layer-cannot-vouch-for-is-asked-live.md) decision 6

---

## Context

The runs read seven copies built from public dumps: the Wikidata subset and its item redirects,
English Wikipedia's structure, readership with every edition's redirects, the items Wikivoyage
uses, English Wikivoyage's articles and the OpenStreetMap layer. Only the layer brought itself
forward (ADR-0134 decision 6). Each other copy waited for an admin to start its build.

On the development stack on 2026-11-10, five of the seven were built from the dumps of 1 October
while the host had published those of 1 November. Nothing on the admin panel said so, and the
six rebuilds were started by hand. The stack's keeper then held each swap back until the passes
and dry runs then going had ended. A copy swapped in under a run leaves the run's two halves on
two dumps, and a comparison of main against a branch on two inputs.

## Decision

**1. Every copy built from a dump updates itself on a schedule.**
- **When.** The dump worker queues a keeping build of a copy by itself once the host has a newer
  dump than the copy was built from, and the copy is older than its interval (`copySchedule.ts`).
  It queues at most one build a dump at a time, through the ledger (ADR-0106).
- **The interval.** An admin sets it from 1 to 30 days, or turns it off, on the copy's card
  (`dump_schedules`). The defaults are 30 days for the Wikidata subset and 7 for each other copy.
  The subset's dump is weekly and its build takes the worker most of a day. The others are
  published monthly.
- **A first build stays an admin's.** A copy never built is not built by itself.
- **A copy built from another copy follows it.** Readership folds each month with the edition
  redirects in place. When the redirects' own schedule swaps them, readership's refold is queued
  the same way, with no newer dump of its own. Until the refold is done, the runs read the months
  as they were folded.
- **A self-queued build** waits 30 minutes as a queued row before the worker takes it, as the
  layer's update does, so a pull of the machine's checkout can cancel it.
- **The OpenStreetMap layer** keeps its trigger, the daily diffs past it, and shares the table.

**2. No copy is swapped in while a run reads it.** The swap and the runs meet on one advisory
lock (`swapGuard.ts`):
- **A swap** takes it alone and swaps only where no run is alive. Otherwise it waits and asks
  again.
- **A pass** holds it shared for as long as it runs.
- **A run's start** holds it shared while it writes its log row.
- **The steps after a run and the component search** hold it shared for as long as they read,
  since they read the copies with no run's row alive.

This holds for a swap an admin started as for one the schedule queued. While a swap waits, its row
names the runs it waits for, and each run's card names the copies waiting for it. English
Wikivoyage's articles are read by the world-view extraction, not by a run, and their swap waits
for nothing.

**3. Each run names the copies it read.** Its log row records the dump date of every copy in place
when it started (`copies_read`), written under the same lock. For readership, whose dump date
stays the same through a refold, the row also records which redirects builds folded its twelve
months (`revision`). Two runs compared against each other can be seen to read the same copies,
a run before a refold and one halfway through it included.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep builds by hand, with a notice when a newer dump is out | The copies were stale for weeks on 2026-11-10 with nobody looking, and each rebuild took an admin's evening of starting builds and holding swaps. |
| Swap in under a run, and record which dump each read came from | A run's admissions and scores compare places against each other within one run; half of them on another dump is a wrong answer, not a recorded one. |
| Stop the runs while a swap waits | A pass runs for most of an hour and a dry run is someone's measurement; the swap is what can wait. |
| Rebuild every copy on a fixed day | The dumps publish on different cycles and days; a newer dump on the host is the event that matters. |

## Consequences

- **Builds start by themselves.** About once a month for each monthly copy, and once a month for
  the subset. Each waits behind the builds already queued, one at a time.
- **Readership keeps its twelve files on disk.** Some 70 GB beside the other dumps, so that its
  refold after each move of the redirects reads them from disk. The alternative was downloading
  all twelve again every month. The maintainer chose this on 2026-11-11.
- **A swap waits for the runs.** A build may finish and wait most of an hour before it swaps,
  behind a long pass. Its row says so.
- **A run may wait a few seconds to start**, while a swap under way finishes.
- **The admin's schedule control** appears on every copy's card, not the layer's alone.
