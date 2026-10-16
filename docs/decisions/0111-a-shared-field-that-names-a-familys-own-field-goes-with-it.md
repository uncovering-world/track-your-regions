# ADR-0111: A shared field that names another family's own field goes with that field

**Date:** 2026-10-16
**Status:** Accepted
**Issue:** [#1553](https://github.com/uncovering-world/track-your-regions/issues/1553)
**Narrows:** [ADR-0109](0109-a-field-belongs-to-the-family-of-sources-that-brings-it.md) decisions 1 and 3

---

## Context

ADR-0109 gives a family only the fields it brings and no other family does. A field both bring
keeps the upsert's rule. The country names are such a field: UNESCO writes the states party's
names, and the Wikidata kinds write their country items' labels.

UNESCO alone owns the states party's codes (`country_codes`). On the World Heritage sites
Archaeology also holds, Archaeology run 163 (2026-10-15) proposed Wikidata's labels over UNESCO's
names on 50 places:
- Troy: Türkiye → Turkey;
- Palmyra: Syrian Arab Republic → Syria;
- Babylon: Iraq → Babylonia, a historical state, beside UNESCO's code `IQ`.

The codes and the names describe one fact, and under ADR-0109 they could come from two sources
and disagree.

## Decision

**A field both families bring, that names or describes a field one family owns, belongs to that
family with the field it names.** `country_names` goes with UNESCO's `country_codes`: on a place
UNESCO holds, the states party are named as UNESCO names them, and elsewhere the Wikidata kinds'
labels stand as before.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the names shared | Codes and names from two sources can disagree: `IQ` beside "Babylonia". |
| Derive the names from the codes on read | A reader would get one naming everywhere, but the names are stored and shown on every surface. Moving that is a larger change than the field's owner. |

## Consequences

**Positive:**
- A World Heritage site's countries read as its states party, by code and by name, whichever kind's
  run last wrote it.

**Negative / Trade-offs:**
- UNESCO's official names ("United Kingdom of Great Britain and Northern Ireland") are longer than
  the labels a traveller is used to. That is a display question, not an ownership one.

## References

- Related ADRs: ADR-0109 (fields belong to families)
- Related docs: `docs/tech/experiences.md` § The place and its memberships
- PR / issue: #1553
