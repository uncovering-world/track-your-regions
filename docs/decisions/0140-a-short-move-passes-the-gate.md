# ADR-0140: A short move passes the gate

**Date:** 2026-10-23
**Status:** Accepted
**Issue:** [#1837](https://github.com/uncovering-world/track-your-regions/issues/1837)
**Narrows:** [ADR-0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) decision 1

---

## Context

A gated source may not overwrite what a reader can already see (ADR-0025). Every coordinate change
of ten metres or more (`LOCATION_UNCHANGED_METERS`) was a move, and a move of a visible place or
point waited for a curator. The same ten metres decided when two sources' views of a place
disagree, and so raised a question too (`sourceViews.ts`).

On the development catalogue on 2026-10-22 every coordinate move in the review queue was checked.
Each was compared with the OpenStreetMap object that carries the place's own Wikidata item, and with
the other places of the catalogue around the new point. There were 261 moves, counting held moves of
a place or a part and disagreements between two sources' views:

- **Under 100 m (84 moves).** Both points stand on the same building or site, or a few steps from
  it. Most are corrections: the Choragic Monument of Lysicrates moves 28 m onto the monument, and
  the Boyana Church's point moves from a car park onto the church.
- **100–250 m (37 moves).** This is where a point first stands on another object. Mostly that is the
  stored point, which the new one corrects: Mamertine Prison's point was on the Rostra, and the
  Alcobaça Monastery's on a kindergarten. None of these moves makes a shown pin worse.
- **250 m–1 km.** Large archaeological areas such as Petra and Olympia, where both points stand
  inside the site. For a museum or a cathedral the same distance would put the pin on another
  building.
- **Over 1 km.** The real errors, such as the Rock-Hewn Churches of Lalibela moving 24 km.

No move under 250 m changes the GADM division the point falls in. A short move is still worth a
question in one case: when it lands at another place of the catalogue. For example, Reims Cathedral
stands beside the Reims World Heritage property.

## Decision

**1. A short move of a coordinate a reader sees passes the gate (`short-move`).** A move passes when
all of these hold (`shortMovePassesSql`, `backend/src/db/shortMove.ts`):
- it is shorter than `SHORT_MOVE_METERS`, 250 m, which is declared in `@tyr/shared/moves` beside
  the other two distances;
- the new point falls in the same GADM leaf divisions as the stored one, and in at least one;
- no point a reader sees of another place is nearer the new point than the stored point is.
  Another place is one that is neither the place, a whole it is a part of, nor a part of either.

As with ADR-0099's rewrites:
- the move is written and filed with the written fields, marked with its class;
- it raises no question, sets no held pointer and demotes no verified membership;
- a curator's claim on the coordinate still wins (ADR-0029).

Moves from 250 m to `LOCATION_MAJOR_METERS` stay an ordinary question, and longer ones stay major.

**2. On a place,** the upsert asks the rule under the lock and the diff files the move by it. The
held row takes the coordinate through `passingColumns`.

**3. On a point,** a move under a gated source is an unread arrival that holds back the old point's
withdrawal. Where the arrival is under the same reference, the old point is one the arriving
source placed as its own rather than adopted from another source (ADR-0137), and the move passes,
the run does two things (`settleShortMoves`):
- it publishes the arrival as verified;
- the old point names the arrival (`moved_to_location_id`) and leaves the map as any point the
  source no longer lists.

A point that names the one it moved to raises no withdrawal question. A move of a point nobody
verified (`auto`) stays a question. An arrival may only move from `pending` to `verified`
(ADR-0070), and doing so would claim a pass nobody gave.

**4. Two sources' views closer than `SHORT_MOVE_METERS` are not a disagreement.** No question is
raised. The run still keeps the coordinate the place holds whenever another view is ten metres or
more away, so two sources do not overwrite each other on every run.

**5. Migration 155** takes the moves earlier runs held by the same rule. On dev it publishes 19
point moves and writes the coordinates of 26 places; that closes 25 cards, 485 → 460 open held cards.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Only hide moves under 100 m | It leaves the 37 moves of 100–250 m, which mostly correct a stored point on another object. |
| A threshold relative to the site's size | The measured queue does not need one under 250 m: compact places moved under 50 m, except *Maman*, which the other-place test catches. |
| Pair a point moved a short way with its stored row in place | ADR-0027's ten metres is the pairing's identity rule. Widening it would let a source's dropped component lend its row to a new one 200 m away. |
| Publish an `auto` point's move as `auto` | ADR-0070 refuses `pending → auto`: it publishes a row nobody passed. |

## Consequences

**Positive:**
- On dev, 25 held cards and 19 unread point moves close, and the next runs file such moves as
  written.
- Sources whose views of a place are a few dozen metres apart are no longer asked about.

**Negative / Trade-offs:**
- A move under 250 m that puts the pin on another building, with no catalogue place there, passes.
  The measurement found such a case only for stored points, which the move corrected.
- A move of a point nobody verified is still asked: 4 of the held point moves on dev.

## References

- Related ADRs: ADR-0099 (decision 1 narrowed), ADR-0025 (the gate), ADR-0027 (point identity),
  ADR-0029 (claims), ADR-0070 (curation-state moves), ADR-0084 (placements), ADR-0137 (an adopted
  point), ADR-0139
- Related docs: `docs/tech/experiences.md` § Review Queue (the gate's passing classes, the source views)
- Code: `packages/shared/src/moves.ts` (`SHORT_MOVE_METERS`), `backend/src/db/shortMove.ts`,
  `backend/src/services/sync/shortMoveWriter.ts`, `backend/src/services/sync/changeSet.ts`,
  `backend/src/db/sourceViews.ts`, `db/migrations/155-a-short-move-passes-the-gate.sql`
- Issues: #1837, #1730 (the threshold for a component's two views)
