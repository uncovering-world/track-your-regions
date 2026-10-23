# ADR-0144: A curator separates one kind's membership of a place into a place of its own

**Date:** 2026-10-24
**Status:** Accepted

---

## Context

A place holds the memberships of several kinds when their sources read one identifier: the
Pantheon is one place for Places of worship and for Archaeology. Since [ADR-0143](0143-a-place-is-found-by-its-identifiers-before-a-run-creates-one.md)
a run finds the place an identifier names before it creates one, so the second source's arrival
is a membership on the place the first brought; before it, the equal-item merge folded two
places into one, with a record and an undo ([ADR-0086](0086-a-merge-is-a-record-that-moves-a-place-into-another-and-back.md)).

An identifier can mislead: it may name another thing than the place it was matched to. A merge
has a way back, its undo, which moves back exactly what its record says it moved; on the
development catalogue on 2026-10-21, 2 of 527 equal-item merges had been undone. A run's join
writes no merge record, so the undo cannot reach it: a membership the resolver put on a place has
no way out. The product review decided that a curator separates the membership into a place of its
own (#1885), that a traveller who marked the place visited is asked which of the two they visited
(#1887), and that the two are kept apart by the curator's word in the identifier registry
(ADR-0143 decision 5, #1896) rather than by a guard of the separation's own.

## Decision

**1. A separation moves one kind's membership to a new place, keyed on the membership.** With it go:

- the points and work links the membership alone places;
- a copy of each point and link that another membership of the place places too, which the
  separated membership places instead, so each place keeps what its own memberships place
  ([ADR-0084](0084-a-place-belongs-to-no-source-and-no-kind.md));
- the changeset rows of its source's runs, and the answers to held fields of its kind.

The place keeps its own records: a curator's choices between views and refusals of a value, its
region assignments and rejections, its parts and its visits. It works the same for a merge's
survivor and for a place a run joined. Any membership of a place that holds more than one may be
separated: since [ADR-0143](0143-a-place-is-found-by-its-identifiers-before-a-run-creates-one.md)
decision 6 nothing reads the place's own `source_id` and `external_id` as a key: the original keeps
its pair, and the new place takes the leaving membership's — or, where a place still holds that
pair (the original itself, or a place a merge folded — the place an undone separation of the same
membership made among them), a name of its own after its id, which no other place can take. The
membership-pair check reads a pair a live membership carries on another place as in order, since
that is where the run finds it, and knows the separation's own name.

**2. The new place starts from the membership's own view.** It takes the name, subtitle, picture,
credit and point the membership's source reported (`reported_*`, ADR-0084), and the rest of the
original's content. The source's next run writes through the usual rules, since it finds its
membership on the new place. The membership keeps its curation state: published, or waiting, as
it was.

**3. A separation is refused where it is no separation.** That is:

- the place's only membership, which is the place itself — that would be a delete;
- a place merged into another;
- a component part of a serial site, which follows its point ([ADR-0100](0100-a-serial-sites-components-are-places-part-of-the-site.md)).

**4. The curator's word in the registry keeps the two apart.** The membership's identifier moves
with it, so the registry holds the new place claiming it. Where the original still claims the same
value — a World Heritage site's item, a point's item — the separation writes the curator's `refers`
verdict on the original (ADR-0143 decision 5), so the value identifies the new place alone, and
both the resolver and the join follow it there; a third source bringing that identifier later joins
the new place. The separation's record (`experience_separations`) names the original, the new place,
the membership, the identifier the two were set apart on and whether the word was written, the
curator and what moved. The near-places pass never proposes the two as a pair while the separation
stands. An undo of a merge whose membership was separated since is refused, since what its record
names is not on the survivor any more. Both places' histories carry a `separated` row.

**5. A separation is undone by merging the two again.** The new place is folded back into the
original by the merge every other pair goes through (ADR-0086), as the curator's own, and in that
merge's transaction the word written on the original is taken back, the questions nobody has
answered are withdrawn and the record is marked undone by that merge. That merge is undoable like
any other, and its undo separates them again in full: the record stands again, the word is written
again and the questions are asked again, so nothing joins the two.

**6. Visits stay where the traveller put them, and the traveller is asked.** Each visit of the
original raises a question to its traveller, which of the two places they visited
(`separated_visit_questions`). The visit stays on the original until they answer (#1887).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Undo the resolver's join from a record of its own | A run's join is a membership written on a place it found, through the rules every second source's view goes through; recording it as a reversible move would make every run's write a record, for a case seen 2 times in 527. |
| A guard of the separation's own against the join (the item recorded on the separation, skipped by the join and the resolver) | Two statements of why two places are not one: the registry already holds a curator's word per identifier (ADR-0143 decision 5), and the resolver reads it. |
| Move the visits to the new place, or copy them | The catalogue cannot know which place a traveller stood at; the product review decided the traveller is asked. |
| Refuse to separate the kind that first brought the place | Readers name a place's kind from its shown membership since #1893, and the place's own pair is not a key (ADR-0143 decision 6): the original keeps it, and the check reads a pair a live membership carries anywhere as in order. |
| Re-key the original to another membership's pair | A place a merge folded keeps its pair, so the pair chosen can be taken and the separation fail on the unique index; and comparing with the pair reads it as the key it is not. |

## Consequences

- A membership a run joined has a way back, with the same record shape as a merge.
- A shared point or link becomes two rows, one per place. A traveller's visit to the shared point
  stays on the original's copy.
- The separated place has no description of its own until its source's next run writes one, if the
  source has one. Until then it shows the original's.
- A `refers` verdict written by a separation is a curator's word like any other: the identifier
  dialog shows it, and taking it back (`derived`) lets the registry derive the claim again.

## References

- Related ADRs: ADR-0046 (what a merge is), ADR-0084 (a place belongs to no source and no kind),
  ADR-0086 (a merge is a record and its undo), ADR-0100 (a serial site's components), ADR-0143 (the
  identifier registry and the resolver)
- Issues: #1885, #1887 (asking the traveller), #1891 (the Epic)
