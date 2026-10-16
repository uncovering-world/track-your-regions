# ADR-0112: A handed-over work its own statements place nowhere goes where the refusal named

**Date:** 2026-10-16
**Status:** Accepted
**Issue:** [#1557](https://github.com/uncovering-world/track-your-regions/issues/1557)
**Narrows:** [ADR-0102](0102-a-work-one-kind-refuses-as-held-by-a-place-is-handed-to-the-kind-that-holds-it.md) decision 2

---

## Context

ADR-0102 decision 2 places a handed-over work by the receiving kind's own resolver, narrowed to the
places the refusal named: the work goes where its own statements and the containment chain put
it, never where the other kind merely said.

After every kind ran on the local Wikidata subset (2026-10-15/16), two works Public Art handed over
to places of worship were placed nowhere, though Places of worship admits both places:
- **The Unknown Warrior** is *part of* (P361) Westminster Abbey. The venue statements a works kind
  reads are P195 and P276.
- **The Bamberg Horseman** stands, by P276, in Bamberg Cathedral. The cathedral carries a
  dissolution (P576, 1081) that belongs to its first building, so the resolver refuses it as a venue
  (`venueVerdict`), though the kind admits it as a place by its fame.

The worship pool already held both works, and their own statements reached no venue the kind
admits, so decision 2 left them nowhere. Public Art had refused them, and each was lost: the outcome
ADR-0102 exists to prevent.

## Decision

**A handed-over work the receiving kind's pool holds, that its own statements place at no venue the
kind admits, is placed at the admitted places the refusal named** (`handedOverPoolWorks` in
`museum/venueSide.ts`).
- A venue folded into an admitted one counts as that one.
- A work nobody can see stays unseen.
- The work carries the hand-over's reason (`handedBy`) as any handed-over work does.

Where the work's own statements do reach an admitted venue, decision 2 stands unchanged: the
resolver places it, narrowed to the named places.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Read P361 among the venue statements | It finds the Unknown Warrior, but a painting's P361 names a series or a cycle as often as a place, and every kind's placement would change for one tomb. |
| Ignore a dissolution older than the venue's own inception | Bamberg Cathedral's inception (1004) is older than its 1081 dissolution, so the rule would not reach it. |
| Leave both works refused | The refusing kind and the admitting kind would both have looked at the work, and neither would hold it. |

## Consequences

**Positive:**
- The Bamberg Horseman and the Unknown Warrior are placed where a traveller finds them, and the
  venue's changeset says who handed them over.

**Negative / Trade-offs:**
- For these works the place comes from the refusing kind's chain, not the receiving kind's
  statements. That is narrow, since both kinds read one Wikidata item and the place must be one the
  receiving kind admits.

## References

- Related ADRs: ADR-0102 (hand-overs), ADR-0084 (placements per membership)
- Related docs: `docs/tech/experiences.md` § Places of worship
- PR / issue: #1557, #1444
