# ADR-0190: A place field only some sources read is kept by the others while one of them stands

**Date:** 2026-11-09
**Status:** Accepted
**Issue:** [#2144](https://github.com/uncovering-world/track-your-regions/issues/2144)
**Narrows:** [ADR-0109](0109-a-field-belongs-to-the-family-of-sources-that-brings-it.md) decision 1 (a family decides who writes a field), and [ADR-0153](0153-a-field-belongs-to-the-place-or-to-one-kind.md) decision 1 (ADR-0109's families still decide who writes a field of the place)

---

## Context

What a monument commemorates is a fact about the place, whichever kind offers it (#2144). The
Lincoln Memorial commemorates Abraham Lincoln under Public art and under Monuments & memorials
alike. ADR-0153 makes such a field the place's own.

Only two runs read it: Public art's and Monuments & memorials'. Towers, Bridges & engineering
marvels and Squares & streets read none of it. Their *named after* names an engineer or a patron
rather than whom the place was raised to remember: the Eiffel Tower → Gustave Eiffel, the Lugou
Bridge → Marco Polo.

Every Wikidata source is one family (ADR-0109). Under that rule, every Wikidata run writes the
family's fields. A run that does not read this field therefore sends a record without it, and the
gate files the gap as a removal. A memorial church held by Places of worship and Monuments &
memorials would then have its worship run propose removing what the Monuments run wrote.

ADR-0138 solved the same shape for UNESCO's page by keeping it whatever memberships stand. That
leaves a stale value once its writer is gone. ADR-0153's context measured the cost of that on a
kind's field: Charminar kept Monuments' year after Monuments refused it.

## Decision

**1. A field of the place that only some sources read names those sources, and a run of any other
source writes it as the place holds it while a membership of one of them stands on the place and
admits it** (`WRITTEN_BY_SOURCES`, `fieldsOfOthers`, `fieldFamilies.ts`). A refusal leaves the
membership listed (`source_membership`, `missing_since`), so standing alone is not enough: a writer
that refused the place stands behind nothing it wrote.

- **While a writer's membership stands and admits the place,** the other run neither writes the field, nor holds it,
  nor files it as a change.
- **Once none does** — every writer refused the place, stopped listing it, or never held it — the other
  run's record, which lacks the field, is what the run writes. The value then goes to the gate as a
  removal, held for a curator under a gated source.

`commemorates` is the first such field, written by `PUBLIC_ART_SOURCES`. The rest of ADR-0109
decision 1 stands: every other field is still decided by its family.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep it whatever memberships stand, as ADR-0138 keeps UNESCO's page | Once Monuments & memorials refuses a place, its "Commemorates:" line would stay on the card, and no run would ever correct it. That is the stale value ADR-0153 ended for a kind's field. |
| Make it a kind fact on Monuments' and Public art's memberships | It is not a kind's fact. A memorial church under Places of worship commemorates the same person, and two memberships would hold two copies of one place fact for the card to reconcile. |
| Have every Wikidata run read it | A worship, archaeology or museum run would read Wikipedia's categories and four more statements for a field no rule of its kind needs. A Towers run would also write the namesakes the Eiffel Tower shows are no commemoration. |

## Consequences

**Positive:**
- A run that does not read the field never asks a curator to remove it while the kind that reads
  it still holds the place.
- When that kind lets the place go, the field follows the gate like any other.

**Negative / Trade-offs:**
- Which sources write a field is now stated in two places: by family (`FAMILY_FIELDS`), and per
  source for these fields (`WRITTEN_BY_SOURCES`).

## References

- Related ADRs: ADR-0109 (decision 1 narrowed), ADR-0153 (decision 1 narrowed), ADR-0138 (the
  keep-regardless precedent), ADR-0025 (the gate)
- Related docs: `docs/tech/experiences.md` § Whom a place commemorates
- Code: `backend/src/services/sync/fieldFamilies.ts` (`WRITTEN_BY_SOURCES`, `fieldsOfOthers`)
- Issues: #2144
