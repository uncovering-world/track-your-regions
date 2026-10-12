# ADR-0097: A card's put-back pins only when the curator chooses to remember it

**Date:** 2026-10-12
**Status:** Accepted
**Issue:** [#1368](https://github.com/uncovering-world/track-your-regions/issues/1368)
**Narrows:** [ADR-0067](0067-accepting-a-refusal-keeps-it-and-a-batch-answer-pins-nothing.md) decision 2

---

## Context

ADR-0067 decision 2 made a batch answer pin nothing and the refusal card's answer always pin:
`answerAdmissionUnderLock` takes `pin`, "true for the card and false for the batch". The card's
put-back, "The rule was wrong — put it back", therefore claimed `admission` on the membership,
and every later run left the place alone — without the card saying so.

A curator who means "show it for now, and let the next run look at it again" had no way to say
that on the card. The batch could say it, since a batch put-back admits the row for now, but the
batch is for rows nobody reads one by one.

Since #1367 a pin holds only while a run says what it answered, so remembering a put-back is a
narrower promise than it was. It is still a promise the curator should make knowingly.

## Decision

**1. The card's put-back carries the choice, "Remember a put-back on later runs", ticked by
default.** Ticked, the put-back pins as before (ADR-0067). Unticked, it admits the row for now
with no claim, which is what a batch put-back does: the next run applies the rule again, and if
the row still fails it, the refusal comes back as a question. The admission answer takes
`remember`, read only with `override`; `pin` is true for the card's confirmation and for a
remembered put-back, and false for an unremembered one and for every batch answer.

**2. A confirmation on the card always pins.** It keeps a refused row out, and the kept-out
list is its way back; offering "for now" there would let a run re-admit a row a person kept
out, with no question asked.

**3. The choice is recorded.** The curation-log row's `pinned` says which was chosen, and the
place's history shows it: "Remembered on later runs" or "For now: the next run applies the rule
again".

## Alternatives Considered

- **Unticked by default.** A curator who read one row and overruled the rule usually means it;
  the default stays what ADR-0067 decided, and the box is there for the case the default does not
  fit.
- **A third button.** Two buttons that name their consequence are the card's shape (ADR-0067
  decision 1); a choice that qualifies one of them belongs beside it, not as a peer.

## Consequences

- ADR-0067 decision 2's "true for the card" holds for the confirmation and for a remembered
  put-back only. A batch answer still pins nothing.
- The kept-out list's put-back sends no choice and pins, as before.
