# ADR-0125: A held answer to a kind's type is the kind's, and every other is the place's

**Date:** 2026-10-19
**Status:** Accepted

---

## Context

A curator's answer to a held row is recorded in `experience_held_decisions` by value, one standing answer per place, part and field (ADR-0038 decision 3). The readers stop asking a row while the proposal equals what was answered.

Since ADR-0084 a place belongs to no kind, and most of what a run proposes is a fact of the place: its name, description, picture, coordinate and pages, or a field of one of its parts. Several kinds' runs can propose the same value, and #1599 relies on the place-level answer so that one answer settles every kind's copy.

One field is not the place's. The type within a kind is the membership's (ADR-0084), and publishing it writes the answered membership only (`publishTypeOnMembership`). Under a place-level answer, publishing `type: museum` under Art Museums also read Archaeology's proposal of the same value as answered, so Archaeology's card stopped asking it while nothing wrote Archaeology's type. A refusal under one kind silenced the other's proposal the same way (#1720).

## Decision

An answer to a held field that is a kind's rather than the place's records the source of the run it answers (`experience_held_decisions.source_id`), and answers only that source's runs. Today the type within the kind is the only such field (`KIND_FIELDS` in `heldDecisions.ts`). Every other answer keeps a NULL source and answers every run of the place, as ADR-0038 decided.

- **The standing-answer key** gains the column: `UNIQUE NULLS NOT DISTINCT (experience_id, part_kind, part_ref, part_name, field, source_id)`.
- **Every reader** names the run whose proposal it reads, and an answer matches when its source is NULL or that run's.
- **Migration 133** gives a published type answer recorded before this its source where one membership of the place holds the value. A refusal, which no membership holds, and any other stays the place's, as it was.

This narrows ADR-0038 decision 3 for that one field; the rest of that decision stands.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the type answer the place's, and write the type to every membership whose proposal holds the same value | A kind's type is from that kind's vocabulary, and a curator answering it on one kind's card has not answered it for another. The issue records the answer that settles the membership's proposal only |
| Key the type answer by the membership rather than the source | A membership is replaced on a merge or a move (ADR-0086), while every reader already has the run, whose source names the kind. The source is what the run proposed for |
| Leave type out of the decision table and let the pointer carry its answer | A refused type would come back with the next run's identical proposal, which is the defect ADR-0038 was written to end |

## Consequences

**Positive:**
- Publishing or refusing one kind's type leaves another kind's identical proposal asked until its own curator answers it, and publishing it then writes that membership's type.
- #1599's pointer sweep needs no exception for a type: another kind's answer never reads this kind's type as settled.

**Negative / Trade-offs:**
- Every reader of the decision table names the run it reads, and a new reader has to. The helpers in `heldDecisions.ts` take it as a required argument, so it cannot be forgotten silently.
- A type answer recorded before this that was a refusal, or whose value no single membership holds, still answers the place's runs.

## References

- Related ADRs: ADR-0038 (decision 3 narrowed), ADR-0084, ADR-0086
- Related docs: `docs/tech/experiences.md` § Publishing
- PR / issue: #1720, #1599
