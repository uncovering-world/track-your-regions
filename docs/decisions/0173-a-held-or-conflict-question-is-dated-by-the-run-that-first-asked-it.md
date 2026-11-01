# ADR-0173: A held or conflict question is dated by the run that first asked it

**Date:** 2026-11-01
**Status:** Accepted
**Issue:** [#2229](https://github.com/uncovering-world/track-your-regions/issues/2229)

---

## Context

ADR-0051 decision 1 dates every review question by the run that asked it, and for two kinds that
run is read through a pointer each run moves to itself: a held proposal through the membership's
`pending_change_sync_log_id`, a conflict through the newest changeset row carrying the claim. A
source repeats a proposal on every run until someone answers it, so the date was always the
latest run's. My Son Sanctuary's Wikipedia article, proposed by every Places of worship run since
2026-10-01, showed as 2026-11-01's question. On the development catalogue on 2026-11-01, 280 of
the 289 open held cards had been proposed with the same values by an earlier run, and 205 were
first proposed more than a week before the date they showed. The newest-first order, the day
headings and the run filter presented month-old questions as that day's.

A run records its changeset in one batched insert after it has moved the pointer, so the pointer
cannot say whether the run proposed anything new: the comparison has to be made where the
changeset row is written.

## Decision

**1. A changeset row records, per proposed value, the run that first proposed it.** On insert,
`stamp_first_asked()` reads the same source's previous run for the place. A value that run
proposed the same keeps that run's first run; any other value starts at this run. A run that wrote
no row for the place in between leaves the values standing. The values are keyed per field of the
object and per field of a part (`first_asked`), and compared per flag: `held` and
`curatedConflict`.

**2. A held or conflict question is dated by the newest of its values' first runs**
(`held_first_sync_log_id`, `conflict_first_sync_log_id`). A run that proposes the same again
leaves the date alone; a new value, or a value changed, makes the card that run's question. This
narrows ADR-0051 decision 1 for these two kinds; the table there stands for the others.

| Kind | The run that asked |
|---|---|
| held | the changeset row's `held_first_sync_log_id`, at the membership's `pending_change_sync_log_id` |
| conflict | the newest changeset row's `conflict_first_sync_log_id` |

**3. The run filter finds a run's questions both ways.** Under a run, the list holds the questions
it asked first, and the held and conflict questions it proposed again. The run facet counts the
first.

**4. Answering still reads the latest run.** `expectedSyncLogId` stays the pointer's run, so the
date moves back and the value a curator accepts does not.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Compute the first run when the queue is read | 165 ms over the 289 open held questions on dev, on every read of the queue's keys |
| A first-run pointer on the membership beside `pending_change_sync_log_id` | The run moves the pointer before it records the changeset, so the pointer's writer has no proposal to compare |
| Compare the whole set of a card's values | A field that stops being proposed restarts the date of every other field: My Son's article lost its 1 October when the subtitle beside it was answered |

## Consequences

**Positive:**
- A run's day lists what that run asked for the first time, and a card says how long its question
  has waited.
- The stamp is written once per row, so the queue reads it at no cost.

**Negative / Trade-offs:**
- A trigger on `experience_sync_changes` reads the place's previous run on every insert: two
  indexed lookups per row of a run's changeset.
- The newest first run is taken over every held value on the row, the answered ones included, so a
  card whose newest value was refused while older ones wait is dated by the refused one.

## References

- ADR-0051 — the review queue is one list of dated questions.
- `db/migrations/201-a-question-keeps-the-date-it-was-first-asked.sql`, `db/init/01-schema.sql`
  (`stamp_first_asked`, `first_asked_runs`, `proposal_entries`).
