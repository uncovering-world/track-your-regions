# ADR-0222: A curator in scope reads a refused place by id

**Date:** 2026-11-17
**Status:** Accepted

---

## Context

ADR-0024 decision 5 made a confirmed refusal hide a place "from everyone". The row answers 404 by
id and appears in no list, and the review page's *kept out* list is the one surface it shows on.
ADR-0025 later relaxed the by-id read for a curator or admin whose scope reaches the place, but for
an unread arrival only (`readableByIdSql`).

Since then, a curator meets refused places on surfaces that open a place's Curate dialog:
- the refused neighbour on an arrival's card (#2185);
- an admin's audit table of a curator's acts (#956), where an arrival turned away is the act an
  auditor checks first;
- the places a merge proposal names.

Each one's *Curate* reads the place by id. On dev's catalogue of 2026-11-17, *Curate* on Lena
Bridge, which a curator kept out of Bridges & engineering marvels, answers 404, and the dialog
never opens (#2613). The curator who wants to check the call cannot reach the place's card.

## Decision

A curator or admin whose scope reaches a place reads it by id whether or not any of its
memberships is admitted. This covers the place, its points and its works (`readableByIdSql`'s
relaxed half). A reader still gets 404 for a refused place, and the lists, counts and map still
leave it out (`placeOfferedSql`).

This narrows ADR-0024 decision 5 for curators in scope. The *kept out* list stays the one list of
confirmed refusals, and the way back ("the rule was wrong") stays on it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Link a refused place to its row in the *kept out* list instead of the Curate dialog | The list has no address for one row, and a curator who opened a place to check a call would land on a list rather than on the place. The maintainer chose the dialog (2026-11-17). |
| Keep the 404 and hide *Curate* on a refused place | It leaves the auditor nothing to open on the act they audit first. |

## Consequences

**Positive:**
- Every *Curate* opens its place for a curator who answers for it, refused or not.
- Readers see nothing new. The relaxation is the one ADR-0025 made for unread arrivals, now
  without the admitted condition.

**Negative / Trade-offs:**
- A curator can now edit a refused place's facts from its dialog. Those facts reach readers
  only if the place is put back, which is the kept-out list's answer.

## References

- Related ADRs: ADR-0024 (decision 5 narrowed here), ADR-0025
- Related docs: `docs/tech/experiences.md`, `backend/src/db/readerPredicates.ts`
- PR / issue: #2613
