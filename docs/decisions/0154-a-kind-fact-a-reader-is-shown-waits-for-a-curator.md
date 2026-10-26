# ADR-0154: A kind's fact a reader is shown waits for a curator

**Date:** 2026-10-26
**Status:** Accepted
**Issue:** [#2068](https://github.com/uncovering-world/track-your-regions/issues/2068)
**Narrows:** [ADR-0153](0153-a-field-belongs-to-the-place-or-to-one-kind.md) decision 2

---

## Context

ADR-0153 decision 2 keeps a kind's facts on its membership. It lets every change to one pass the
gate, because no reader was shown any of them. That held for the facts it moved: a monument's year
and makers, the classes a rule read, a venue's work counts.

#2068 moves UNESCO's facts about an inscription onto the World Heritage membership. Three of them
are shown: the year a site was inscribed (the detail read's inscription line), whether it is on the
List of World Heritage in Danger, and since when (the In Danger badge). Letting those pass the gate
would let a run change what a traveller reads with no curator having seen it. ADR-0139 lets past
the gate only a field no reader sees.

## Decision

**A kind's fact a reader is shown is gated like any shown field of the place.** `PLACE_FIELDS`
marks it `shown`. While the membership holds a proposal, the run leaves the fact as the membership
holds it (`heldFacts`, `backend/src/services/sync/kindFacts.ts`). Publishing the proposal writes it
onto the membership (`publishFactsOnMembership`). A kind's fact no reader is shown still passes the
gate and is written whole on every pass, as ADR-0153 decision 2 says.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Let every kind fact pass, as before | A new danger listing would reach the badge without a curator. ADR-0139 lets only an unseen field past the gate. |
| Keep the three shown facts on the place | ADR-0153 decision 1 gives them to the World Heritage kind. On the place, a delisted site would go on showing its year and its badge. |

## Consequences

**Positive:**
- A run's change to a fact a traveller reads is reviewed, wherever the fact is stored.

**Negative / Trade-offs:**
- The membership holds a fact behind a proposal, so its run merges what it fetched with what is
  stored instead of writing it whole.

## References

- Related ADRs: ADR-0139 (a field no reader sees passes the gate), ADR-0153 (a kind's facts live on
  its membership)
- Related docs: `docs/tech/experiences.md` § The place and its memberships
- PR / issue: #2068
