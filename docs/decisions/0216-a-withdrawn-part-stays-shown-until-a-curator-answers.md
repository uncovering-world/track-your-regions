# ADR-0216: A withdrawn part stays shown until a curator answers

**Date:** 2026-11-16
**Status:** Accepted — decisions 2 and 3 narrowed by [ADR-0217](0217-time-in-the-catalogue-is-held-as-periods-and-the-catalogue-is-read-as-of-a-date.md): a trigger derives the record's `source_membership` from its listing periods
**Issue:** [#2123](https://github.com/uncovering-world/track-your-regions/issues/2123), Epic #2115
**Narrows:** [ADR-0213](0213-a-parts-gate-is-its-record-in-its-whole.md) decision 1

---

## Context

ADR-0213 made a serial site's part's record in its site the part's gate. Its decision 1 shows a
part to a reader while its record is admitted, read and *still listed*. The site's run marked the
part's line point withdrawn when the World Heritage list stopped giving the line, and every reader
hid the part at once: off the map, out of its site's places and out of its "k of N".

A kind's membership its source stopped listing does the opposite (#1251): the place stays shown
until a curator says *former*, because a source going silent is no fact about the ground.

On the development catalogue on 2026-11-16, two parts were withdrawn and not yet judged: the
Maidantal and the Bashkizilsay areas of the Chatkal reserve, which the list dropped from
Western Tien-Shan on 2026-10-25. Western Tien-Shan read 11 of 23 places. Eleven other withdrawn
parts had been judged former: Champagne's 9, one of Getbol's and one of Mangystau's.

The maintainer decided on 2026-11-15 (#2123): a component the list stops listing stays shown and
counted in its whole's "k of N" until a curator answers *former* (on the record) or *lost* (on
the part).

## Decision

1. **A part is shown while its record is admitted, read and not judged former**, and its row not
   lost (`partRecordListedSql`, `partRecordShownSql`). A withdrawal alone hides nothing. This
   narrows ADR-0213 decision 1, where *still listed* is read as *not judged former*.
2. **The withdrawal is the record's own.** The site's run writes the record's `missing_since`
   when its list no longer gives the line, and clears it, with a `former`, when the list gives it
   again (`writePartListings`). It keeps the line's point standing, out of the list's numbering
   (`lineWithdrawnOnItsRecordSql`). A line the list gives again elsewhere is a move, paired as
   the run pairs one (#2182): under its name, or under its reference where no other line carries
   the name. The old point goes as before. A part nobody has read is no reader's, and its line
   goes as before too. `refresh_part_record_gates()` no longer derives the record's listing from
   its points.
3. **The site's card asks the record.** The withdrawn card asks each line point of a part whose
   record is withdrawn and not judged (`withdrawnPointOpenSql`), dated by the record
   (`withdrawnSinceSql`).
   - *Former* is written on the record, and the point takes the record's mark, which hides the
     part.
   - *Lost* is written on the part (`setLifecycleVerdict`) and on its point. The record keeps
     its mark.
   - A false alarm clears the record's mark, and the site's next run marks it again while the
     list still leaves the line out, as for a membership.
   - Each verdict is taken back the same way: *still listed* sets the record present and clears
     its mark, and *still exists* sets the part extant. Taking *lost* back says nothing of the
     list, so the record keeps its mark and the site's card asks again.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep marking the point and teach every reader to show a withdrawn line point | Every reader of a point (the map, the regions, the leaves, the card) would learn an exception that #2124 deletes with the points anyway. Keeping the point standing changes no reader. |
| Hide the part at once, as before | The maintainer decided the membership rule: an outage or a renumbering of the list hides nothing a traveller sees until a curator reads it. |

## Consequences

**Positive:**
- A part and a kind's membership follow one rule when their source stops listing them.
- Western Tien-Shan's two areas are shown and counted again, and its card asks about them.

**Negative / Trade-offs:**
- A list that renames a line as it moves it, or drops one line and lists another under its
  name, misleads the pairing as it misleads the run's move (#2182).
- Western Tien-Shan was written before the run paired a renumbered line, so the Maidantal and
  Bashkizilsay areas are each two parts there today: the old one, withdrawn on its record and
  shown again, and the new one, under its new number and waiting for a curator. The site's card
  asks about both, and the site's next run leaves the old ones standing, since the list gives
  their names under a part the site already holds.

## References

- Related ADRs: ADR-0020, ADR-0026, ADR-0084, ADR-0213
- Related docs: `docs/tech/experiences.md` § A part's record in its whole
- Issue: #2123 (Epic #2115), #1251
