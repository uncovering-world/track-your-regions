# ADR-0116: A gap the catalogue carries is judged once, in a committed ledger by cause

**Date:** 2026-10-16
**Status:** Accepted

---

## Context

The coverage check in Catalogue Checks (#1162) compares the catalogue with the survey lists of
ADR-0081 and reports what a live kind does not offer although a traveller is sent there. On the
development catalogue on 2026-10-16 it found 186 such places and works, 154 of them filed under
Art Museums. Most are not defects. The Frida Kahlo Museum, the Museum of Contemporary Art
Australia and a hundred more wait for the regional tier of Art Museums (#628), which does not
run yet; the Vatican Pinacoteca is a part of the Vatican Museums, which the catalogue offers;
the Arch of Constantine is offered by Archaeology and absent from Public Art because the product
gives a Roman arch to one kind (ADR-0102); a commercial gallery is on a guide's list and is no
museum's business. A few are defects of a rule that runs today: the Villa Farnesina is refused
as a villa although Raphael's *Galatea*, over the works line, names it; the Museo Soumaya is
refused as a museum network; the Raphael Rooms are not a work of art by their classes.

The check could not tell these apart. Every finding was one row nobody had answered for, the
only answer was to accept the whole number, and a judgement, once made, lived nowhere the next
run would read: a comment on an issue holds it for one reading, a note in a session for none.
Berlin and Moscow (#1600) add thirty findings on top, and every new survey adds more. The
maintainer asked that gaps be sorted by cause in batches, with an issue only for a concrete
defect of a rule the product runs, never one per museum.

Where such a judgement belongs is the question. The expectation lists are written from the
traveller's chair and never moved by the catalogue (ADR-0081 decision 4), and a judgement is a
record about the catalogue's rules, not about what a traveller expects. The database is a copy
the load replaces, and does not travel with the repository. An issue comment is read by nobody
twice.

## Decision

1. **A gap is judged once, in a committed ledger.** `db/catalogue-coverage/judgements.jsonl`
   holds one line per judged gap, beside the lists and reviewed like them. A judgement is
   never written into an expectation list, never kept only in the database, and never left in
   an issue comment.
2. **A judgement names one subject.** Either an entry of a region's survey list together with
   the live kind that does not offer it (the coverage check's finding; an entry filed under two
   live kinds has a gap per kind, judged apart, so a judgement made for one kind never answers
   for the other), or a catalogue row, by its Wikidata id, that the catalogue offers within a
   surveyed region's reach and no entry names (#1601). One of the two, and each subject once.
3. **The cause is one of a closed vocabulary**, stated in the schema and read from it:
   `rule-defect`, a rule the product runs today should have admitted it; `door-missing`, no rule
   the product runs would admit it yet, such as the regional tier or readership;
   `kind-missing`, a traveller looks for it under a kind the product does not have, named in
   the note and in the entry's filing; `part-of-offered`, the catalogue offers the place it is
   part of; `offered-elsewhere`, a reader finds it under the kind the product's rules give it
   to; `not-a-must`, a visitor misses nothing by the kind not offering it. A cause that fits
   none is a reason to extend the vocabulary in a pull request, never a free-text cause.
4. **A defect and a missing door name the issue that owns them.** The other causes may. The
   issue is where the fix or the build is decided; the ledger says only that this gap waits on
   it. One issue owns many judgements, never one issue per place.
5. **The check and the report read the ledger.** A judged finding is counted by its cause
   beside the rows and listed no more; an unjudged one is listed as needing a person. So the
   number the panel leads with converges to zero as judgements land, not as findings are
   accepted wholesale.
6. **A judgement does not outlive its gap.** When the kind it names offers the entry, the
   report and the check name the judgement as stale, a line to remove. A
   judgement whose issue has closed is found by the check skill, which asks GitHub once per
   run; the backend never does.
7. **Where the finding is the list's fault, the list is corrected and nothing is judged.** An
   entry whose identifier is the wrong one of two Wikidata items names the other in `same_as`;
   an entry filed under a kind a traveller would not look for it under is refiled. The
   judgement ledger holds what the catalogue, not the list, has to answer for.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| One issue per missing place | 127 issues for Art Museums alone on the first reading; the maintainer refused it, and the board would say nothing a count by cause does not |
| Comments on the owning issue, in batches | Readable once; nothing reads them again, so the check would list the same 127 museums after every run and the judgement would be made twice |
| A judgement field on the expectation entry | A list is written from the traveller's chair (ADR-0081 d4); a judgement about the catalogue's rules in it would move the list with the catalogue, and an entry judged for one kind would carry a judgement that is wrong for another |
| A table written from the admin panel | A judgement made on the development catalogue would not reach a published one, nor the repository, nor a review; the lists are files for the same reason (ADR-0081 d6) |
| Accepting the check's count in the panel | An accepted count says nothing about why; a run that loses the Frida Kahlo Museum and a survey that adds a museum would cancel out |
| A free-text cause | Cannot be counted, and the second judge writes the same cause in other words |
| The judge decides in code, by rule | The judgements are the test set a later judge is measured on (#1601); there is nothing to measure it against until a person has judged |

## Consequences

**Positive:**
- The coverage check reports only what nobody has answered for; on 2026-10-16, 152 of the 156
  findings of the nineteen earlier regions were judged in one pull request, 3 wait for a
  curator in the review queue, and 1 was the list's fault and corrected there.
- Each judgement names a cause and, for a defect or a door, the issue that owns it: four
  defects got their issues (#1614, #1615, #1616, #1617), two older issues (#1160, #1161) got
  their examples, and 106 museums wait on #628 as one line of context, not 106 rows.
- A judgement that goes stale is found by the next report, so the ledger describes the
  catalogue as it is.

**Negative / Trade-offs:**
- A fifth coverage table and a fourth file; the load replaces it with the others.
- A judgement is a person's reading of a run's changeset and of Wikidata on one day; the date
  on the line says which day, and a later reader may disagree. The vocabulary is small so that
  disagreement is about one word.
- The check cannot tell a judgement whose issue has closed from a live one; the skill does,
  once per run.
- The row subject (#1601) is loaded and counted and read by nothing yet.

## References

- Related ADRs: [ADR-0081](0081-a-kind-is-a-record-before-it-is-code-and-an-expectation-is-listed-before-the-catalogue-holds-it.md),
  [ADR-0032](0032-a-rule-stays-absolute-and-the-debt-is-recorded.md), [ADR-0102](0102-a-work-one-kind-refuses-as-held-by-a-place-is-handed-to-the-kind-that-holds-it.md),
  [ADR-0114](0114-work-is-held-in-queues-one-issue-per-goal.md)
- Related docs: `docs/tech/catalogue-coverage.md`, `docs/tech/data-assertions.md` § What travellers expect
- PR / issue: #1605, #1162, #1601, #1594
