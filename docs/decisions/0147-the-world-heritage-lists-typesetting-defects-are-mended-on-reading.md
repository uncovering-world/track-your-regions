# ADR-0147: The World Heritage list's typesetting defects are mended on reading, and the mend passes the gate

**Date:** 2026-10-25
**Status:** Accepted
**Issue:** [#1965](https://github.com/uncovering-world/track-your-regions/issues/1965)
**Narrows:** [ADR-0139](0139-a-field-no-reader-sees-and-a-typographic-rewrite-pass-the-gate.md) decision 2

---

## Context

A serial World Heritage site's components are named by UNESCO's list, and the catalogue stores those
names as the list types them. The list carries typesetting defects, and a reader then sees them.
On the development catalogue on 2026-10-25 six component points held one, and so did the part
places named after them:
- a comma with no space between two words: *Shoal Tower,Kingston* (Rideau Canal), *fortlets
  Haselburg,Buergstadt* (Frontiers of the Roman Empire), *Segment
  Patacancha-Huacahuasi,Huacahuasi-Machucucho* (Qhapaq Ñan), *Epipolae,Achradina,Tyche and
  Neapolis* (Syracuse);
- a typographic ligature with a space before it: *Dionysian forti ﬁcations*, where *ﬁ* is U+FB01
  (the same Syracuse component);
- a double quote with no opening one: *"Kluchevskoy" Regional Nature Park"* and *Southern
  Kamchatka" Regional Nature Park (two parcels)* (Volcanoes of Kamchatka).

These are the list's own text, so a curator cannot fix them for good. A curator who corrects one
claims the name, and after that the list's own later corrections are only reported beside the
claim.

ADR-0139 decision 2 lets a rewrite of typesetting alone pass the gate. It covers composition, quote
and dash shapes, a trailing literal escape and runs of whitespace, and says that "a space added or
removed between two characters is not typography". It has no rule for ligatures or unmatched quotes.
So mending these names on reading would hold a card for every one of them.

Some names now carry square brackets ("Jebel Barisha [Deirouné]", "[main complex of
Mahabalipuram]"). The maintainer decided to keep them as written, since rewriting them makes the
catalogue harder to compare with UNESCO's own data. The same concern bounds this decision: a mended
name must still compare equal to the list's.

## Decision

**1. The list's reader mends a component's name.** The rule is `untypeset` in
`@tyr/shared/labels` (ADR-0065). It makes three mends, in this order:
- a straight double quote with no opening one is removed. That is every run of quotes that follows
  a letter before the first quote that opens, and a last one that follows a letter and ends a text
  holding an odd number of them. A quote after a digit stays, since it is an inch or a second:
  *Battery of 12" guns*. A quote in another shape counts when telling whether one opens, so
  *the “Golden" Gate* keeps its quote, and only a straight quote is ever removed;
- a Latin ligature (U+FB00–U+FB06) is spelled out, and a space before it that follows a letter is
  removed;
- a comma between two letters gets one space after it. A comma between two digits stays, as in
  *Tokhwa-ri Tombs No. 1,2,3*.

The order makes the result its own mend. Removing a quote can bring a comma or a ligature next to
a letter, and nothing after the quotes brings a quote back. So what the reader stores is what
`untypeset` answers for it, and the reader's output passes the one-way check below.

Square brackets and everything else stay as the list writes them. The mend is applied to a
component's name only. A site's own name and the source's view of the place (`reported_*`,
ADR-0084 decision 4) keep what the list says.

**2. A mend is typography (narrows ADR-0139 decision 2).** `foldTypography` folds every double
quote shape to the straight one, then applies `untypeset`, then its other folds. The order means a
rewrite of quote shapes alone still passes over mixed shapes (*the “Golden" Gate* → *the “Golden”
Gate*), and an unopened quote folds away in any shape. So the list's raw name and its mended name fold to the same text, and a run
that writes the mend over a stored raw name passes the gate as `typography`. The two spaces
`untypeset` adds or removes are the only exceptions to "a space added or removed between two
characters is not typography".

The mend counts one way only, as the escape does. A rewrite that brings a defect into a text that
held none, *Shoal Tower, Kingston* → *Shoal Tower,Kingston*, is asked. A text that held a defect
and still does is not affected: another source's description with *word,word* in it, rewritten in
its quote shapes alone, passes as it did under ADR-0139. The location writer's SQL spelling (`untypesetSql`, `typographyFoldSql` in
`backend/src/services/sync/labelFold.ts`) is pinned to the TypeScript rule by
`labelFold.db.test.ts`.

**3. Points are matched by their reference, never by name.** A mend changes a point's name and
nothing that pairs the point with the list's component. The next run writes it on the same row, and
the part place follows its point (`part_follows_point`, ADR-0100).

**4. No migration cleans the stored names.** A run under this rule writes every stored defective
name as it would write any rewrite of typography: on a held row it files the field as passed
(`passedTheGate: typography`), and a curator's claim keeps the name (ADR-0029). The next UNESCO run
from the admin panel is that once-only clean. A migration would have to spell the rule in SQL a
second time, since a migration cannot import it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Mend in `feedText`, which every name of the feed goes through | It would also rewrite a site's own name and `reported_name`. The source's view has to keep what the list says, and no site name holds these defects. |
| Mend on reading, and leave the gate as it is | Every mended name over a stored raw one would hold a card whose answer changes nothing a visitor notices. That is what ADR-0139 closed. |
| A curator corrects each name | The correction claims the name, and the list's later corrections are only reported beside it. |
| Tell a ligature that starts a word from one inside a word | Nothing in the text tells them apart. The list's one ligature is mid-word. A word that starts with a ligature after a space would be joined to the word before it, and none does on 2026-10-25. |
| A migration that cleans the stored names now | The run does the same work under the same rule, files it the same way, and needs no second spelling of the rule. |

## Consequences

**Positive:**
- A reader sees *Shoal Tower, Kingston* and *Dionysian fortifications*, and no curator is asked
  about it.
- The mend reads one rule on both sides, and the SQL spelling is pinned to it.
- A later run that sends the raw name again is no rewrite.

**Negative / Trade-offs:**
- The stored names stay defective until the next UNESCO run.
- A word that starts with a ligature after a space would be joined to the word before it.
- A comma between two letters that a name means without a space would get one. None does on
  2026-10-25.

## References

- Related ADRs: ADR-0139 (a typographic rewrite passes the gate), ADR-0099 (a rewrite a visitor would
  not notice), ADR-0084 decision 4 (a source's view of a place), ADR-0100 (a part follows its point)
- Related docs: `docs/tech/experiences.md` § The World Heritage list's typesetting
- Issue: #1965
