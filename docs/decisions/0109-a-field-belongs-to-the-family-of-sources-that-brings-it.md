# ADR-0109: A field belongs to the family of sources that brings it

**Date:** 2026-10-15
**Status:** Accepted — decisions 1 and 3 narrowed by [ADR-0111](0111-a-shared-field-that-names-a-familys-own-field-goes-with-it.md), decision 2 narrowed by [ADR-0138](0138-unescos-page-about-a-site-is-kept-by-every-other-familys-run.md), decisions 1 and 2 narrowed by [ADR-0153](0153-a-field-belongs-to-the-place-or-to-one-kind.md)
**Issue:** [#1534](https://github.com/uncovering-world/track-your-regions/issues/1534)
**Narrows:** [ADR-0084](0084-a-place-belongs-to-no-source-and-no-kind.md) decision 4, for the fields it left unsaid

---

## Context

ADR-0084 made a place nobody's: each source's view of the name, description, picture and
coordinate is recorded on its membership, and two views that disagree are a curator's question.
It said nothing about the other fields a place holds, and the upsert still writes each of them
whole from the run's record.

That was harmless while each place had one source. On 2026-10-08 World Heritage sites of one point
were merged onto their Wikidata item's place, and 139 places came to hold a UNESCO and an
Archaeology membership, 57 a UNESCO and a Places of worship one. The first Archaeology run after
that (run 159, 2026-10-15) proposed, on 138 of them, to remove everything only UNESCO reports:
- the inscription year, the danger flag, the criteria, the region, transboundary and the area;
- the official names in UNESCO's six languages;
- UNESCO's own text;
- the states party.

The Acropolis was among them. Places of worship (run 160) did the same on 57. Every removal waited
behind the gate, so nothing was lost, but the gate held it only because those memberships were
published, and a *Publish all waiting* would have stripped the sites. The other way round a UNESCO
run writes away Wikidata's item, classes and fame where its write is not held.

Measured over the places one source holds alone on 2026-10-15, the fields fall into three groups:
- **UNESCO only:** the inscription facts, the official names, its text and the states party.
- **Only the four Wikidata kinds:** the item, its classes and fame, a work's year and makers, the
  counts a run makes, the OpenStreetMap tag, the admission note.
- **Both:** the website, the Wikipedia article and the country names.

## Decision

**1. Each field of a place that one family of sources brings and no other does belongs to that
family.** A family here is a set of sources that bring the same fields, not one of the kinds of
source `docs/tech/filling-a-kind.md` § 7 calls families. The families are UNESCO's list and the Wikidata kinds, which read one item whichever of
them reads it (ADR-0085). Which source is in which family is `SOURCE_FAMILY`, and which
fields each family brings is `FAMILY_FIELDS`, both in `backend/src/services/sync/fieldFamilies.ts`,
the one place they are stated.

**2. A run writes a field another family owns as the place holds it,** while that family has a
membership on the place that still lists it. So it neither writes the field, nor holds it, nor
files it as a change, which is how a contested view is already kept (ADR-0084, `keptAsStored`).
Once the other family's membership is marked missing, the field is the run's again and follows
the gate.

**3. The four content fields keep ADR-0084's rule, and a field both families bring keeps the
upsert's.** The website is the one field that means two things: UNESCO's page about the site and
the site's own. It is split in its own slice (#1538), after which each half belongs to one family.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Record every field's view on each membership, as ADR-0084 does for four | It answers every field with a curator's question where two sources differ, and these do not differ: UNESCO and Wikidata each say what the other does not. A view per field would double the columns of `experiences` on the membership for questions nobody needs to answer. |
| Merge the run's metadata over the stored object, never removing a key | A key a source stops reporting, a site taken off the danger list, would then stay forever. Ownership keeps removal possible for the family that owns the key. |
| Move each family's fields onto its membership and read them from there | The right home in ADR-0084 decision 2's terms, but every reader of `metadata` would change at once. Ownership can be decided now, on the fields as stored, and the move stays open. |

## Consequences

**Positive:**
- A run of one family can no longer remove, or propose to remove, another family's fields. The
  held proposals of runs 159 and 160 are not repeated, and their next runs propose none.
- Which kind brings which field is written down, so a new source states its family and inherits
  the rule (`docs/tech/filling-a-kind.md` § 3).

**Negative / Trade-offs:**
- The table is kept by hand: a key a source starts writing is shared until it is listed.
- A field two Wikidata kinds both write and count differently, a museum's work count under Art
  Museums and under Archaeology, is still the last run's. Both are one family.
- The website stays shared until its split lands.

## References

- Related ADRs: ADR-0084 (a place belongs to no source), ADR-0085 (one item, one reading), ADR-0025 (the gate)
- Related docs: `docs/tech/experiences.md` § The place and its memberships
- PR / issue: #1534
