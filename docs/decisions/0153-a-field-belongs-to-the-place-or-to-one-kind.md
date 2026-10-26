# ADR-0153: A field belongs to the place or to one kind, by what it means

**Date:** 2026-10-26
**Status:** Accepted — decision 2 narrowed by [ADR-0154](0154-a-kind-fact-a-reader-is-shown-waits-for-a-curator.md)
**Issue:** [#1775](https://github.com/uncovering-world/track-your-regions/issues/1775)
**Narrows:** [ADR-0109](0109-a-field-belongs-to-the-family-of-sources-that-brings-it.md) decisions 1 and 2

---

## Context

ADR-0109 gave each field of a place to the family of sources that brings it. Its families are
UNESCO's list and the Wikidata kinds. The Wikidata kinds read one item, so ADR-0109 treated their
fields as the family's and let the last run of any of them write the field. Some of those fields
are not the item's, though. They are what one kind's run concluded about the place:

- a monument's inception year and its makers (Public art, Monuments & memorials, Towers, Bridges,
  Squares & streets);
- the classes the kind's rule read, and whether its artwork rule answered;
- the counts a run makes of a venue's works (Art Museums, Places of worship, Archaeology);
- Archaeology's reading of Wikipedia's categories;
- the question a run asks a curator about the place's admission.

Stored on the place, each was written over by every other kind's run. It also stayed after the
kind that wrote it refused the place. Measured on the dev catalogue on 2026-10-26:

- 716 places carried a `year`. On 112 of them, no kind that reads a year admitted the place.
- Charminar still held Monuments & memorials' 1591 while only Places of worship admitted it.
- 98 places admitted by two of Art Museums, Places of worship and Archaeology held whichever
  run's work count came last.

The fixes before this one were lists that kept the old copies in step: `SOURCE_OWN_METADATA`,
`WRITTEN_EMPTY_METADATA` and a separate readership-note key per run (#1879). Each new kind had to
be added to them by hand.

## Decision

**1. Each field is the place's or one kind's, by what it means.** The place's fields describe the
object, whoever reads it: its name, picture, coordinate, item, website, fame and OpenStreetMap
tag. A kind's fields are what that kind's run concluded about it. The owner of each field is its
entry in `PLACE_FIELDS` (`@tyr/shared/placeFields`), which also says whether a reader is shown the
field. ADR-0109's families still decide who writes a field of the place.

**2. A kind's facts live on its membership.** They are kept in
`experience_kind_memberships.facts`, and its run writes them whole on every pass
(`backend/src/services/sync/kindFacts.ts`). No other kind's run writes them. A refused membership
keeps its own facts, and they are never shown as the place's. A run's diff still names a fact
`metadata.<key>`, read from the run's own membership. No reader is shown one, so a change to a
fact always passes the gate, a removal included.

**3. The database refuses a kind's fact on the place.** A check on `experiences.metadata` names
every such key. The three readership-note keys the runs used before this ADR are on the list too.
A writer that puts one back fails at once instead of drifting out of step again. Migration 178
moves what the catalogue held onto the membership of every source that writes it. A value with no
such membership left is dropped.

**4. UNESCO's facts about an inscription are the World Heritage kind's too.** They move to that
kind's membership in a second slice of #1775. Until then they stay on the place, kept by
ADR-0109's family rule.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the family rule and keep listing a kind's own keys (`SOURCE_OWN_METADATA`) | Every new kind has to remember to join the list. A refused kind's facts would also stay on the place, still read as the place's. |
| Record each kind's view of the field and ask a curator where they differ (ADR-0084) | These facts do not compete. Monuments' year and Places of worship's work count answer different questions, so nobody needs to choose between them. |
| A table of facts per kind | Each kind would need a schema of its own, and the run writes one JSON record anyway. One column on the membership row keeps a fact next to the admission it explains. |
| Delete the code that writes these keys to the place and add no check | The JSON object also holds the place's own keys, so the keys cannot be dropped as a column could. A future writer could quietly bring the old place back, the drift this ADR ends. The check is one line. |

## Consequences

**Positive:**

- A kind's run can no longer overwrite another kind's facts or leave them on a place it refused.
  Charminar's year is Monuments & memorials', on that membership.
- `SOURCE_OWN_METADATA`, `WRITTEN_EMPTY_METADATA` and the per-run note keys are gone. A new kind's
  facts need only their entry in `PLACE_FIELDS`.
- A Catalogue Check or a review card reads the facts of the kind it asks about.

**Negative / Trade-offs:**

- A held review card filed before migration 178 about a kind's fact can still be published, but
  the fact is no longer written onto the place. It arrives on the membership with the kind's next
  run.
- Two kinds that read the same item hold the same classes twice. Each kind's copy is its own
  reading.

## References

- Related ADRs: ADR-0084 (a place belongs to no source), ADR-0109 (the families), ADR-0139 (a field
  no reader sees passes the gate)
- Related docs: `docs/tech/experiences.md` § The place and its memberships
- PR / issue: #1775
