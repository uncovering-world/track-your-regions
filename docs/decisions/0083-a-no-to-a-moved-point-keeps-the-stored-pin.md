# ADR-0083: A no to a moved point keeps the stored pin

**Date:** 2026-10-04
**Status:** Accepted
**Issue:** [#1233](https://github.com/uncovering-world/track-your-regions/issues/1233)
**Narrows:** [ADR-0053](0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md) decision 2

---

## Context

A gated source that finds a point somewhere else does not move the pin readers see. The location
writer keeps the stored point and writes the new position as an unread point that names the one it
replaces (`withdrawal_deferred_for_location_id`, `locationWriter.ts`), and the stored point's
withdrawal waits for an answer. On the development catalogue on 2026-10-04, 31 of the 124 unread
points are such moves. Ephesus (Archaeology) is the plain case: its one point moved 158 m in
run 146, and the run also held the object's own coordinate as a `location` field.

ADR-0053 decision 2 made a curator's no to the moved point release that withdrawal: the stored
point became withdrawn and asked its own question among the lost places. In practice a no to a
move then removed something readers could see:

- On a one-point object the no took the object's only pin off the map. Ephesus would stay in every
  list with nothing on the map until a second question was answered.
- Everywhere else on the review card, *not this* changes nothing readers see and settles the
  question for that value. The moved point's *not this* was the one exception.
- Taking the no back did not undo it. The one refusal of moved points on the development
  catalogue so far, Champagne Hillsides on 2026-09-09, withdrew nine stored pins at once. Two of
  the refusals were taken back within minutes, and their pins stayed withdrawn, since the
  take-back restored the question and not the pairing. Readers saw the site with nine of its
  fourteen components missing from the map until the moves were published on 2026-09-14.

The object's coordinate and its moved point are also one question (#1233). Publishing the
coordinate already takes the moved point along (`pointMovedWithObject`), but refusing the
coordinate left the point waiting.

## Decision

**A no to a moved point keeps the stored pin where readers see it and settles the question for
that position. A no to the object's held coordinate is a no to the point that is the same move.**

- Refusing an unread point marks it refused (`refused_at`) and does nothing else. The pairing
  stays on the refused point. The location writer withdraws no stored point that an arrival still
  names, so the stored pin stays visible on every later run, for as long as the source keeps
  offering the refused position.
- The source moving the point somewhere else is a new question. The refused row stops being
  offered, and its pairing goes with it. The new position arrives unread and holds the stored
  pin's withdrawal again. The source offering the stored position again clears the pairing, and
  nothing is asked.
- Refusing the object's held `location` also refuses the unread point `pointMovedToSql` names for
  the proposed coordinate: the same rule the publish and the queue use. The object is re-placed
  after the commit, as every refusal of a point is.
- Taking a refusal back restores the move as it was: the point is unread again, still naming the
  pin it would replace.

ADR-0053 decision 2 stands otherwise. A refused point is still a mark beside `pending`. The location
writer still makes no *new* pairing onto a refused point, since the curator was never asked about
that move. Placement still leaves a refused point out.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Release the withdrawal on a no (ADR-0053 decision 2 as written) | A no to a move took a pin readers could see off the map, on a one-point object the only one. Taking the no back left the pin withdrawn. |
| Make the no a curator's claim on the stored coordinate | A point has no conflict card, so a claimed point keeps its coordinate and every later move from the source is dropped without a question (`claimedPointSql`). "This move is wrong" is not "I vouch for the old position". A curator who means the second already has the point's correction dialog, which claims. |
| Keep the behaviour and only say on the card what the no does | That was the interim state of #1242. The row said that the no takes the old pin off the map, and the card's other *not this* buttons said that nothing readers see changes. |

## Consequences

**Positive:**
- *Not this* means the same on every row of the card: nothing readers see changes, and the
  question is settled for that value.
- A one-point object never loses its pin to an answer about a move.
- The object's coordinate and its moved point are one question for both answers, as the card
  shows them.
- Taking a refusal back is complete: the move is asked again with the pin it would replace.

**Negative / Trade-offs:**
- A point the source has really moved stays shown at its old position for as long as the source
  keeps the refused position. That is the curator's answer, and the source moving it again asks
  again.
- A refused point now holds a pairing indefinitely. The location writer, the queue's offered
  count and the withdrawn-point question already read a held pairing correctly. Nothing else
  assumed that only an unread point holds one.
- `refuse-contents` no longer reports `withdrawalsReleased`, and a `contents_refused` log entry
  no longer carries it. Entries written before this decision keep it, and the log reader still
  reads it.

## References

- Related ADRs: ADR-0025 (the per-source gate, decision 5 on deferred withdrawals), ADR-0026 (a
  withdrawn point asks its own question), ADR-0053 (a curator's no, decision 2 narrowed here)
- Related docs: `docs/tech/experiences.md` § Review Queue
- Issue: #1233
