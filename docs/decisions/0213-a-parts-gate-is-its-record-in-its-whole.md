# ADR-0213: A part's gate is its record in its whole, by the rules of its whole's source

**Date:** 2026-11-15
**Status:** Accepted — decision 1 narrowed by [ADR-0216](0216-a-withdrawn-part-stays-shown-until-a-curator-answers.md): a withdrawn part stays shown until a curator answers
**Issue:** [#2123](https://github.com/uncovering-world/track-your-regions/issues/2123), Epic #2115

---

## Context

A serial World Heritage site's part arrives, is read, turned down and withdrawn through its
point. ADR-0156 decision 4 kept it so: "A part's arrival, withdrawal and refusal are asked about
its point", and a component record "carries no gate of its own: it is never pending and opens no
card". ADR-0198 then made that record a row of `source_records`, World Heritage components'
record of the part in its whole, which already carries every column a membership's gate is made
of: `curation_state`, `published_at`, `admission`, `missing_since`, `source_membership`.

The point is going (#2124): a place has one coordinate, and a source's view of it is that
source's record (Epic #2115). Every question the point answers today has to be answered
somewhere else first. On the development catalogue on 2026-11-15:

- 5,645 parts, each with one record of World Heritage components in its site and one point of
  its list line (14 hold a second or third point, another kind's or a duplicate). Every record
  was `auto`, admitted and listed.
- 75 parts had no line point a curator had read: all 45 of Wudang's, which leave the site with
  no place a reader is shown; Western Tien-Shan's 10 renumbered areas, each waiting to replace the
  area the list numbered differently before (ADR-0189); Baalbek's 3; 17 more on six sites.
- 2 line points were withdrawn and still asked about, Western Tien-Shan's Maidantal and
  Bashkizilsay areas of the Chatkal reserve; 14 more were judged former.
- 19 held fields about parts (17 picture credits, 2 subtitles) sat in their sites' changesets,
  keyed by the part's reference and name: 8 on the Armenian Monastic Ensembles of Iran.
- 933 line points were marked approximate, on the point.
- 483 parts held a kind of their own, and a curator could separate none of their memberships
  (ADR-0144 decision 3).

## Decision

1. **A part's gate is its record in its whole.** World Heritage components' record of the part
   says whether a curator has read it (`curation_state`), turned it down (`admission`, written as
   a curator's no to an arrival is: refused, "kept out by a curator") and whether the list still
   gives its line (`missing_since`, `source_membership`). Whether the part is still in the world
   (`existence`) is the part's own, as for any place. A part a reader is shown is one whose record
   is admitted, read or published unread, still listed, and whose row is not lost
   (`partRecordShownSql`); one asked about is unread (`partRecordUnreadSql`) or withdrawn and
   not yet judged (`partRecordWithdrawnSql`).
2. **A record in a whole is gated by its whole's source.** The record is written by the run of
   the source whose record in a kind the whole holds (the World Heritage list for a serial site),
   and is pending where that source holds its new points for a curator, or where the whole is
   itself an arrival. A curator's record (ADR-0198 decision 5) is the curator's word and is
   never pending.
3. **Unread, publish, waiting, refusal and withdrawal of a part are read and written on its
   record.** Publishing a site's arrival publishes its pending records. A curator's no to an
   unread part keeps it a part: the relation is the records' claim, and only a curator's record
   decides it (`refresh_part_relation`). A withdrawn line's record carries `missing_since`, the
   relation stays, and the site's card asks *former* (the record's) and *lost* (the part's).
4. **A held proposal about a part is keyed by its record**, so two sources' proposals about one
   part are two questions, and a line the list renumbers or renames keeps its answer.
5. **"Approximate" is one predicate over the record's coordinate precision**: the record holds
   the precision of the coordinate its source gave, as it holds the coordinate itself, and the
   place is approximate while it stands at that coordinate. Nothing about it is stored on the
   place.
6. **A kind's membership can be separated off a part.** The new place takes the membership,
   and the part keeps its record in its whole and its relation.
7. **The gate moves in steps, and a check holds them together.** First the record follows the
   points of its line, the ones its whole's record in a kind placed or nothing did
   (`is_part_line_point()`), through `refresh_part_record_gates()` on every statement that writes
   a point and on a record that moves to another place. A new part's record arrives by its
   whole's source gate (`part_site_components()`): pending only when its line is unread and the
   site's source holds its new points for a curator or the site itself is an arrival, since a
   record never moves back to pending (`guard_curation_state_move`). Then the readers ask the record, then the writers write it and
   the points follow the record until #2124 deletes them, written by the record's writer in the
   same statement as the points its answer reaches (`answerPoints`). A
   curator's answer on a part (a publish, a refusal, its take-back) is a writer's answer on the
   record, and answers the whole part: each of its line points follows it, a duplicate the
   curator did not name among them. The record keeps following its points for what every other
   writer of a point writes (the run's withdrawal, a curator's *lost*, a held move), until those
   move too (#2124). The catalogue check
   `part-gate-out-of-step` compares the two readings on every part while both exist, and goes
   with the points.

This amends ADR-0156 decision 2 (the record is the part's gate as well as how its
source knows it) and decision 4 (the curator is asked about the record, never the point), and
narrows ADR-0144 decision 3 (a part holding a kind of its own is no longer refused a separation).
ADR-0156 decision 3 stands.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the gate on the point until #2124, and move it there | #2124 would change every reader, every writer and the gate's meaning in one step, with no state in between to compare. Moving it first, behind a check, lets each step be measured on the catalogue. |
| A gate column on the part's own row (`experiences`) | A part of two wholes would carry one gate for two sites' lists, and a part that holds a kind would mix the list's arrival with its kind's. The record is per source and per whole already. |
| Write the record from every writer of the point at once, with no derivation in between | Five writers (the run, publish, refusal, its take-back, the verdicts) would change in one pull request beside the readers. The derivation is right from the first step and is deleted when the writers move. |
| A part's refusal as a curator's record refusing the relation | It would take the part out of its whole, which a refused point never did; the turned-down line could no longer be taken back on the site's card, and the site's run would part it again. |

## Consequences

**Positive:**
- A part is gated like every place: by a record, under its source's rules. #2124 can delete the
  points without moving a single question.
- Wudang's 45 parts, Western Tien-Shan's renumbered areas and Baalbek's 3 read as unread on
  their records, the same parts the queue asks about on their points.

**Negative / Trade-offs:**
- Until the writers move, every statement that writes a point refreshes the gate of the records
  of the places it touches: one indexed read of their records, written only where it differs.
- A placement written after its point is not followed; the run writes a point's placement before
  it parts it, and parting moves the point, which is followed.
- A record whose line points gain an unread point after one was published stays read: a new
  point of a published part is a move or a duplicate, not an arrival, and stays the point's
  question until the writers move.
- Two shapes leave the record and its points reading the part differently until the writers
  move, and `part-gate-out-of-step` names both: a line point a curator judged lost, since *lost*
  is the part's own; and a published line the list dropped and then gives again at a new spot,
  which the run moves onto the part as an unread point (`part_site_components()`, #2182). The
  points read that part as unread. The record reads it as read and listed, since a read record
  never goes back to pending. Reading only the published points would read it as withdrawn,
  which is no closer. Neither shape was on the development catalogue on 2026-11-15.
- Composed into the review queue's questions about a membership, a pending or turned-down part
  record would be an arrival or a rule's refusal of its own. `arrivalOpenSql`,
  `arrivalWaitingSql` and `refusedOpenSql` ask for a record in a kind.

## Amendments

Revised as a Draft while its first three pull requests landed, and accepted with the third:

- In #2560's review, the two shapes the check names as known gaps were added to the
  consequences, and the review queue's questions about a membership were limited to records in
  a kind, after a pending part record was found to be raising an arrival of its own.
- In the accepting pull request, decision 7 says that a curator's answer answers the whole
  part, and that the record keeps following its points for the writers that do not move in
  this step. Decision 2's gate of a new part's record is the whole's source's and the line's
  together: a part revived with a line a reader already sees is no arrival. A trigger that made
  the points follow each record they wrote was measured and dropped: on a copy of the
  development catalogue on 2026-11-16 it made publishing Wudang's 45 parts take 220 ms, against
  15 ms when the record's writer writes the points in the same statement, as it now does.

## References

- Related ADRs: ADR-0025, ADR-0053, ADR-0100, ADR-0144, ADR-0156, ADR-0189, ADR-0198, ADR-0200,
  ADR-0206, ADR-0210
- Related docs: `docs/tech/experiences.md` § A part's record in its whole,
  `docs/tech/data-assertions.md`
- Issue: #2123 (Epic #2115); #2124 (the points go)
