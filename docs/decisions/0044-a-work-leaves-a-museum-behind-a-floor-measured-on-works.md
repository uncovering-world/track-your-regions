# ADR-0044: A work leaves a museum by a mark, behind a floor measured on works

**Date:** 2026-09-02
**Status:** Accepted

---

## Context

A traveller reading a museum's works saw every link any run had ever written. Nothing unlinked
a work, and that was a decision, stated in three places: `upsertMuseumTreasures` linked with
`INSERT … ON CONFLICT DO NOTHING` and stopped; ADR-0023's consequences named the accumulation it
causes — "previous" placements become the union of every venue a work has ever hung in; and
ADR-0026 decision 5 shipped `treasures.withdrawn` in the changeset's shape while producing none,
"because no contents coverage floor exists for treasures: unlinking on a run that under-fetched
would delete real data and report success."

The measured case is museum sync run 42. It fetched **291** artworks where run 3 before it had
fetched **1906**, reported `success`, and 45 of 128 museums had their artwork counts fall — the
Art Institute of Chicago from 14 to 3, the Bode Museum from 4 to 1. The data survived only
because nothing unlinked. A run like it that also unlinked would have taken two thirds of the
catalogue's works off the walls and called it a success; `museum-import.md` § 3.6 warned in bold
that anyone who "fixes" the missing unlink without first adding the floor does exactly that.

Under the works-first model (ADR-0023) the pool is not display: it decides which museums the
category admits and which works are Iconic, so a silently short pool is bad input to admission,
not just missing paintings. Museums are a `ranked` source, so the floor missing detection applies
to experiences (`MISSING_DETECTION_MIN_COVERAGE = 0.9`) never runs against this category at all.
And ADR-0030's banded pool made partial fetches likelier rather than rarer: a run can now
legitimately mix bands answered from cache with bands fetched fresh.

Three questions had to be settled before a link could be withdrawn: what the floor measures,
what a withdrawal *is*, and what a gated source may do to a link a reader can see.

## Decision

**1. A link the source stops placing is marked, never deleted.** `experience_treasures.missing_since`
records when a run first placed the work somewhere other than here, or nowhere — the observation a
point already carries (ADR-0022 decision 1), for the same reason: the row is what a person's
viewed record points at. It is a machine observation, not a verdict. Every reader-facing read of
a museum's works carries `missing_since IS NULL`, through `offeredLinkSql` — the list, the viewed
ids, the queue's contents card and its counts, the waiting count, both publish statements, the
work edit's proof that the work hangs here, and `linkedForReaderSql`. A curator's widening of the
gate does not widen it: a marked link is not an unread row awaiting a verdict, it is the source's
own list. Two lookups that merely *locate* a global work through any link it has —
`recordedTreasureSql` and the credit-waiting assertion — stay unfiltered, since a held proposal
about the work's own fields stays publishable wherever the work now hangs.

**2. The floor is measured on works, per pool, at the museums this run admits.** Of the works
the catalogue offers at the museums this run admits, the share the run places at an admitted
museum — any of them — must reach **90 %** (`WORKS_COVERAGE_MIN`, `worksCoverage.ts`). Below it,
no link is marked. Each clause was the wrong way round once:

- *Works, not links.* A work re-homed from one admitted museum to another is seen; only the link
  moves. Measured on links, a placement-rule change that moved a tenth of the works would fail
  the floor on every later run, because the old links stay stored until the very withdrawal the
  floor is blocking — a deadlock with no way out but hand-written SQL.
- *At the museums this run admits.* Admission has its own floor and sweep (ADR-0024). A museum
  the art test drops takes its works out of both sides, or every admission change would read as
  an under-fetch.
- *Per pool, not per band.* A band is whole or fatal: a failed or truncated band ends the run
  (ADR-0030 decision 8, `failIfTruncated`), so the band is not the unit that can be quietly
  short. What can be is the pool *as placement sees it* — a class closure that stopped early, a
  venue graph that came back thin, a rule that stopped resolving — and each shows up as works
  the run no longer places, which is what this counts. A cached band is the same whole answer
  it was when fetched, so a run mixing cached and fresh bands is judged on what it placed, like
  any other; a genuinely short fresh band cannot hide behind cached ones because it cannot be
  short and succeed.
- *Against the stored table, not the previous run's count.* Two consecutive short runs are
  refused twice rather than believed the second time, which is what a run-to-run baseline would
  do with run 42 followed by run 43.

The same 90 % as missing detection and not the admission sweep's 50 %: that floor guards a rule
that is supposed to change the set, this one guards what the source listed, and a tenth of it
going quiet in one run is the source misbehaving rather than the world changing.

**3. A run below the floor withdraws nothing, cannot report `success`, and says why.** The
collector measures the floor before a single museum is written, over the placements it read up
front (`readPreviousPlacements`, offered links only) against the proposal it is about to write.
The verdict goes three places through the orchestrator: onto the log row
(`experience_sync_logs.withdrawal_skipped_reason`, shown on the run card as "Withdrawals
skipped"), into every `processItem` through the run context so the writer marks nothing behind
it, and into the run's status, which is `partial` while the source's departures are unrecorded.
Floor first, withdrawal second, never the reverse.

**4. The withdrawal happens after every work of the museum is written, once per museum.** Two
set-based arms in one transaction (`linkWithdrawal.ts`): a link of a work the run no longer
places here is marked; a marked link of a work the run places here again is restored
(`missing_since = NULL`), keeping the curation state it had. A museum whose write throws part-way
reaches neither arm, so nothing is marked on the strength of a list the run did not finish; and a
failure between the two rolls both back, so a restore never lands where the record of it cannot.
Restoring is unconditional — never what a short run gets wrong, and ADR-0021's one direction a
level down.

**5. A visible link is held while the work's new place is not yet readable.** A gated source may
not overwrite what a reader can already see (ADR-0025 decision 5), and a work that moved between
museums under a gate arrives at the new one `pending`: marking the old link at once would take the
work off every reader's screen until a curator publishes the new one. So a link a reader can see —
its museum, itself and its work all past the gate — is passed over while *this run places the same
work at another admitted museum* and no readable link of it stands anywhere yet: one that is
offered, past the gate, at a museum past the gate and not refused. Decided from the run's own
proposal and the table together, never from the table alone: the new museum may be written after
the old one in the same run, and a hold that looked for the new link in the table would find
nothing and mark. No pointer column and nothing to release, unlike a point's deferral
(`withdrawal_deferred_for_location_id`): the question is asked again on every run, and the mark
lands on the first run after the arrival is readable — under an ungated source with a visible new
museum written after the old one, on the very next run. An unread link costs a reader nothing when
it goes and is marked at once; so is a link of a work the run places nowhere, whatever unread links
of it stand elsewhere.

**6. The record now carries `treasures.withdrawn` and `treasures.returned`**, named as ADR-0026
decision 4 asks, read off the statements that performed the writes. A held withdrawal is absent
from the record, for the reason a held point's is: the link is still on show.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Measure the floor on links | Decision 2. A placement-rule change re-homing a tenth of the works fails the floor for ever: the old links stay stored until the withdrawal the floor blocks |
| Measure per band, against each band's cached row count | A band cannot be short and succeed (ADR-0030 decision 8), so the unit that can be quietly short is the pool as placement sees it, and that shows up in works placed. A per-band comparison would also key on the query hash, which changes with any edit to the query text |
| Compare this run's fetched count with the previous run's | Two consecutive short runs would be believed the second time — run 42 followed by run 43 withdraws two thirds of the catalogue and reports success, one run late |
| Compare against every museum the catalogue holds, not only the admitted ones | Every admission change reads as an under-fetch; the art test alone moved 110 rows to 82 in one run |
| The admission sweep's 50 % floor | That floor guards a rule meant to change the set. This one guards the source's listing, where a 10 % drop in one run is the source misbehaving |
| Delete the link | The row is what `user_viewed_treasures` points at, and `ON DELETE CASCADE` would take the record with it (ADR-0022) |
| Mark the link at once, gate or no gate | A work moved under a gate vanishes from every reader until the new link is published — the state ADR-0025 decision 5 exists to prevent |
| A pointer column on the link, released by publishing, as a point has | The hold for a link needs no state: "does this run place the work elsewhere, and is a readable link of it standing yet" is a question the proposal and the table answer on every run, and publishing already changes the answer. A pointer would add a column, a publish hook and a chain to take apart |
| Decide the hold from the table alone — "is there an unread twin link" | The new museum may be written after the old one in the same run, so at the old museum's turn the twin is not there yet: the old link is marked, the new one lands `pending`, and the work is visible nowhere until published — the very state the hold exists to prevent |
| Give a link the two-axis lifecycle (`source_membership`, `existence`) and a verdict card | A verdict on a link — "the work really did leave", "false alarm" — is a screen of its own, filed as #749; until it exists a marked link comes back only through the source listing the work here again |
| A second floor per museum, so one museum cannot lose most of its works while the pool passes | A museum with three works loses two on any single departure, so a per-museum share refuses exactly the small museums whose works really do move; and a refusal per museum would need recording per museum, on a row that today records only what the run did. The pool floor is what the measured failure (run 42) needed; the museum-scale case is stated below as a cost and is what #749's verdict answers |
| Apply withdrawals regardless of the floor on an admin's say-so, as a per-run option | The one shape that is run 42 with a button. If a legitimate change ever drops more than a tenth of the works in one run, the reason is on the run card and a person reads it; the remedy is not a switch that skips the reading |

## Consequences

**Positive:**

- A reader sees at a museum the works the source still places there; a work that left leaves the
  wall on the first believed run after it did.
- Run 42's shape cannot report success again, and cannot withdraw anything: the reason is on the
  run card with the numbers it measured.
- `readPreviousPlacements` measures what the catalogue shows rather than what it once held, so the
  placement diff converges again after the first transition — the accumulation ADR-0023's
  consequences describe stops.
- The changeset's `treasures.withdrawn` stops being a shape nothing produces, and a museum row with
  no `withdrawn` entries becomes evidence that nothing left — on a run that cleared the floor.
- The works pool feeding admission and Iconic is the pool the run actually saw, or the run says it
  was not.

**Negative / Trade-offs:**

- **A legitimate drop of more than a tenth of the works at admitted museums in one run is refused
  too**, and stays refused on every later run until the table and the source agree again — the
  same deadlock missing detection accepts for a listing. It takes a rule change or a data change of
  that size, and the run card names the numbers; the remedy is a person reading them, not a
  switch.
- **The floor guards the pool, not a museum.** One museum can lose most of its works in a run
  that passes. The Louvre is the measured case: 113 of its 122 works reach it through the `P361`
  walk past curatorial departments and rooms, and on the live catalogue (2026-09-02: 1272 works
  offered at 101 admitted museums) losing all 113 is 8.9 % of the pool — the run marks them,
  reports success, and a reader sees a Louvre with nine works until the source resolves again.
  The record says so on the museum's row ("works: lost …"), and the mark is reversible by the
  next run that resolves; what is missing is a person being asked, which is the next point.
- **No verdict exists for a marked link.** A point's withdrawal has a card and two answers; a
  link's has neither. A link marked by mistake — a resolver regression that stops seeing a venue —
  comes back only when the source lists the work there again, which for a regression means when
  the code is fixed; and a link that really left is asked about by nobody, so nothing stops a
  later run from restoring it if the source blinks. Filed as #749.
- A held link costs holding a work the source really did drop for as long as an unread link of the
  same work stands anywhere the category admits, which is the visible mistake rather than the
  invisible one — and, unlike a point's deferral, nothing records *that* it is held.
- `experience_treasures` only grows, like `experience_locations`: nothing prunes a marked row, and
  every reader-facing read carries a predicate to skip it, with a partial index to make that cheap.
- `partial` now has a third meaning beside "some items errored" and "placement did not finish":
  "the source's departures are unrecorded". All three surface as the same chip; the
  `withdrawal_skipped_reason` line is what tells this one apart.
- The visibility terms in the mark's SQL repeat `linkedForReaderSql` rather than import it — no
  service depends on a controller module — and have to track that definition by hand.

## References

- Related ADRs: [ADR-0022](0022-locations-are-marked-not-deleted.md) (the mark this copies, a
  table over); [ADR-0023](0023-works-first-museum-selection.md) (the accumulation consequence this
  answers; its Status now points here); [ADR-0026](0026-a-run-records-what-a-container-holds.md)
  (decision 5 named this floor as the gate on producing a withdrawal; its Status now points
  here); [ADR-0025](0025-per-source-curation-gate.md) (decision 5, why a visible link is held);
  [ADR-0030](0030-answers-from-a-source-are-kept-with-an-expiry.md) (decision 8, why a band is
  not the unit that can be short); [ADR-0024](0024-a-category-may-refuse-what-the-source-still-lists.md)
  (admission's own floor, why admitted museums bound the measure)
- Related docs: `docs/tech/experiences.md` § Treasures, § What a run did to an object's contents,
  § Top Art Museums; `db/migrations/041-a-work-is-marked-not-deleted.sql`
- PR / issue: #588
