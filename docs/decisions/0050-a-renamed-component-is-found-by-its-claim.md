# ADR-0050: A renamed component is found by its claim, and a tie the name does not decide is nobody

**Date:** 2026-09-07
**Status:** Accepted
**Issue:** [#833](https://github.com/uncovering-world/track-your-regions/issues/833)

---

## Context

[ADR-0026](0026-a-run-records-what-a-container-holds.md) decision 4 has a run's record
*name* a part and never identify it: each entry of `contents.<kind>.changed[]` carries the
source's reference and the name as it stood, and no database id, so the record stays legible
after the row is renamed. [ADR-0037](0037-a-part-field-readers-see-is-held-like-the-objects.md)
decision 6 then gave the two readers that need the row behind the name — the held card, to open
the place, and publishing, to write the held field onto it — one rule in `partRecord.ts`: *the
reference narrows, the name decides among duplicated references, the lowest id breaks a tie.* The
name has to decide because `(experience_id, external_ref)` is not unique: a component crossing a
border is listed once per country under one number — Maloti-Drakensberg Park's `985ter-001` is
Sehlabathebe National Park in Lesotho (row 7485) and uKhahlamba Drakensberg Park in South Africa
(row 7486).

Two later decisions made the name a moving target. #583 put the place correction on the held
card's own dialog, and #731 seeded that dialog with the row's *stored* name, so renaming the
component a card is about became the ordinary, successful outcome of using the card. The record's
name is the name as the run saw it (`keptChanges` names an entry by `old_name`) and is never
rewritten, so after the rename no row answers to it, the tiebreak falls to the lowest id, and both
readers agree — on the sibling. Measured on the live rows in a rolled-back transaction on
2026-09-06: with 7486 renamed and claimed, the old ordering returned 7485 for the record naming
uKhahlamba; the card reopened on Sehlabathebe and publishing would have written the source's
name onto it.

The issue proposed carrying the card's `locationId` in the publish request. That does not reach
the defect: a correction's `onDone` invalidates the review queue, the card refetches and resolves
by the same rule, and the id it would carry is the sibling's. The rule is the one place.

What the data offers is a claim. A held row's stored name leaves the record's for exactly one
reason — a curator's correction — and `editLocation` claims `name` in `curated_fields` on every
rename. A claim carries no timestamp, so it says "carrying a curator's name", not "renamed since
the run"; that is what the term can tell, and the decision below is written to it.

## Decision

**1. The name decides, then the claim, and the lowest id only among rows the name admits.** Among
the rows the reference admits, `recordedLocationSql` prefers a row whose name matches the
record's; failing that, a row whose `name` is claimed; and the lowest id breaks a tie only where
the name matched — the rows that share a name as well as a reference, whose records are
identical and always were.

**2. A tie the name does not decide is nobody.** Where no row matches the record's name and the
claim does not single one out — more than one sibling carrying a curator's name, or none of them —
the row the rule returns carries `identified = false`, and no reader treats it as the record's
row. A sole row under the reference is always identified: there is nothing to confuse it with.

**3. Both readers act on `identified`, differently.** The card gives an unidentified part no door,
exactly as it gives a withdrawn one. Publishing reports it under `partsNotFound` with
`reason: 'ambiguous'` beside the existing `withdrawn`, writes onto neither sibling, and **leaves
the part's rows open** so the pointer and the card stand: the outcome line sends the curator back
to the card for a look at the siblings, and the card has to be there. A withdrawn part is still
cleared, for ADR-0037's reason — a card no answer could ever clear.

**4. The record still names and never identifies.** ADR-0026 decision 4 stands: no id is
written into the record. The claim is read off the row at resolution time, not stored beside the
name.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Carry the card's `locationId` in the publish request (the issue's proposal) | The card resolves by the same rule and refetches after the correction, so the id it carries after a rename is the sibling's. Fixes the request while the card is wrong. |
| Record the row's id in the record at write time | The writer has `el.id` in hand, and ADR-0022 makes ids durable — but it retires ADR-0026 decision 4 for every record, changes a stored jsonb shape, and leaves every record filed so far on the old rule. The claim term fixes those too. |
| Keep the lowest-id tiebreak for a tie the name does not decide | Silent write onto the wrong component. The issue's expected behaviour is to refuse and say so. |
| Prefer the row whose `name` claim is newest, read from `experience_curation_log` | Would tell "renamed since the run" from an older correction, but needs the run's timestamp threaded into both readers and a join on the audit log per candidate row, for a case that today lands on the safe answer with the card standing. Open if that case turns out common. |
| Record the corrected name's forfeit on the ADR and warn where the curator renames | Makes the ordinary correction the dangerous one. |

## Consequences

**Positive:**
- Renaming a component from its held card keeps the card on that component, and publishing
  lands where the curator looked.
- Nothing is written onto a row the rule cannot vouch for; the curator is told which of two
  reasons kept the write, and the card stays for the ambiguous one.
- No record shape, schema or API input changes; `partsNotFound` gains a `reason`.

**Negative / Trade-offs:**
- A sibling corrected before the run counts as claimed, so the #833 case then lands on
  `identified = false` rather than on the right row. Safe, and visible on the card, but the
  proposal is then answered by a refusal or by a later run rather than published.
- The picker reads window functions, so publishing locks with `FOR UPDATE OF el`, and an
  ambiguous row is held for the rest of a transaction that writes nothing to it.

## References

- Narrows: [ADR-0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) decision 6 —
  the tiebreak and the not-found outcome. Decisions 1–5 are untouched.
- Stands on: [ADR-0026](0026-a-run-records-what-a-container-holds.md) decision 4,
  [ADR-0022](0022-locations-are-marked-not-deleted.md).
- Related docs: `docs/tech/experiences.md` § the held card and § Publishing;
  `backend/src/controllers/experience/partRecord.ts`.
- PR / issue: #836 / #833; the correction from the card: #583, #731; a component's own
  identity, which would remove the re-derivation: #575.
