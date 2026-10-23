# ADR-0142: A curator separates one kind's membership of a place into a place of its own

**Date:** 2026-10-23
**Status:** Accepted

---

## Context

A place holds the memberships of several kinds when their sources read one Wikidata item: the
Ajanta Caves are one place for World Heritage and for Places of worship. Today two places on one
item are merged by the catalogue's equal-item pass (ADR-0046 decision 2, ADR-0086). From #1801 on,
a run that reads an item an existing place holds joins that place on arrival, instead of creating
a copy for the pass to fold.

An item can mislead: it may name another thing than the place it was matched to. A merge has a way
back, its undo, which moves back exactly what its record says it moved. On the development
catalogue on 2026-10-21, 2 of 527 equal-item merges had been undone. A join on arrival writes no
merge record, so the undo cannot reach it. The product review decided that a curator separates
the membership into a place of its own (#1885), and that a traveller who marked the place visited
is asked which of the two they visited (#1887).

## Decision

**1. A separation moves one kind's membership to a new place, keyed on the membership.** With it go:

- the points and work links the membership alone places;
- a copy of each point and link that another membership of the place places too, which the
  separated membership places instead, so each place keeps what its own memberships place
  (ADR-0084);
- the changeset rows of its source's runs, and the answers to held fields of its kind (ADR-0125).

The place keeps its own records: a curator's choices between views and refusals of a value, its
region assignments and rejections, its parts and its visits. It works the same for a merge's
survivor and for a place a run joined.

**2. The new place starts from the membership's own view.** It takes the name, subtitle, picture,
credit and point the membership's source reported (`reported_*`, ADR-0084), and the rest of the
original's content. The source's next run writes through the usual rules, since it finds its
membership on the new place. The membership keeps its curation state.

**3. A separation is refused where it is no separation.** That is:

- the place's only membership, which is the place itself;
- the kind that brought the place, which every reader names it by (`rowKindJoinSql`). What a
  misleading item brought is the other kind: the arrival a run joined, or the folded place's kind
  after a merge;
- a place merged into another;
- a component part of a serial site, which follows its point (ADR-0100).

**4. A separation is a record that keeps the two apart.** A row of `experience_separations` names
the original, the new place, the membership, the item the two were set apart on, the curator and
what moved. The equal-item pass and a run's join on arrival leave the new place out of the item it
was separated on, so a third source that brings the item later joins the original. The near-places
pass never proposes the two as a pair. An undo of a merge whose membership was separated since is
refused, since what its record names is not on the survivor any more. Both places' histories carry
a `separated` row. A separation is not undone by its own action: a curator who separated in error
merges the two again (ADR-0086), and that merge is undoable.

**5. Visits stay where the traveller put them, and the traveller is asked.** Each visit of the
original raises a question to its traveller, which of the two places they visited
(`separated_visit_questions`). The visit stays on the original until they answer (#1887).

## Consequences

- A join on arrival (#1801) can be shipped with a way back.
- A shared point or link becomes two rows, one per place. A traveller's visit to the shared point
  stays on the original's copy.
- The separated place has no description of its own until its source's next run writes one, if
  the source has one. Until then it shows the original's.
