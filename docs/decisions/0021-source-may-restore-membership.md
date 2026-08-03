# ADR-0021: A sync may restore `source_membership`, in one direction only

**Date:** 2026-08-03
**Status:** Accepted

---

## Context

ADR-0020 split an experience's lifecycle into two axes and reserved both to
curators: "Both are set by curators only. The machine records `missing_since`
and nothing more." The reason was one-sided — a source outage must never remove
an object from what users see, so no run may write `former`.

Building the curator queue that answers those flags (#480) showed the other side
of that rule is not safe. `marked_former` is a claim about the source's
collection, and recording it clears `missing_since` in the same statement. That
pair blinds everything that could ever contradict the claim:

- the upsert clears `missing_since` when a source lists a row again and touches
  neither axis, so the row stays `former`
- `returned` keys off `missing_since`, which the verdict has already cleared, so
  no changeset row is written either
- the review queue and all three missing-detection predicates require
  `source_membership = 'present'`, so none of them surfaces it

A curator who answers `former` correctly on a genuinely absent object therefore
ends up with a permanent, unsignalled falsehood the moment the source recovers —
and the user-facing half of #480 renders `former` as a chip. The only remedy is
the correction endpoint, which nothing tells anyone is needed.

## Decision

A sync run that lists a row currently marked `former` sets `source_membership`
back to `present` and records the change as `returned`. `existence` is untouched
by that correction, and no run may ever write `former`.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leave the axis curator-only, as ADR-0020 states | The falsehood is invisible: no predicate, changeset row or queue entry can reach a `former` row the source has resumed listing. Correct only if a `former` verdict is meant to outrank the source, which contradicts what `former` means |
| Let the run clear both axes | A listing says nothing about whether the object still stands. Bamiyan is inscribed and destroyed; clearing `lost` would erase a fact the source has no view of |
| Widen `returned` to key off the verdict without correcting the axis | Records the event but leaves the row wrong, so the chip still lies until someone acts on a signal nobody is watching for |
| Surface such rows in the review queue instead | Asks a curator to answer a question the source has already answered, and the queue's own predicate would have to admit decided rows — the shape that made verdicts unanswerable in the first place |

## Consequences

**Positive:**

- The evidence that justifies `former` — the source not listing the object —
  also takes it back, read the other way.
- The correction is strictly toward more visibility, so ADR-0020's reason for
  reserving the axis holds unchanged: an outage still cannot hide anything.
- `returned` covers the event that contradicts a verdict, which is the one worth
  knowing about.

**Negative / Trade-offs:**

- ADR-0020's decision 2 is no longer true as written, which is what this ADR
  exists to mark. The rest of that decision stands: the axes remain independent,
  `existence` remains curator-only, and `former` remains a verdict no machine
  may reach.
- `state_decided_by`, `state_decided_at` and `state_note` record the last
  curator decision, not necessarily the state now stored. They are not cleared,
  because they cover both axes and an `existence` verdict may still stand;
  `experience_curation_log` carries the sequence.
- A curator who wants `former` to persist against a source that keeps listing
  the object has no way to express that. No such case is known — `former` is
  defined as a claim about the source — and inventing a "sticky" flag before one
  appears would be speculative.

## References

- Narrows: ADR-0020, decisions 1 and 2. Decision 1 defines `returned` as "an
  object previously flagged `missing_since` is listed again", and this ADR emits
  one for a row whose flag a curator's verdict had already cleared. Decisions 3
  and 4 stand untouched.
- Related docs: `docs/tech/experiences.md` § Change provenance, § Review Queue
- PR / issue: #487, [Issue: #480]
