# ADR-0138: UNESCO's page about a site is kept by every other family's run

**Date:** 2026-10-23
**Status:** Accepted
**Issue:** [#1851](https://github.com/uncovering-world/track-your-regions/issues/1851)
**Narrows:** [ADR-0109](0109-a-field-belongs-to-the-family-of-sources-that-brings-it.md) decision 2 (another family's field is kept only while that family's membership lists the place)

---

## Context

ADR-0109 decision 2 has a run write another family's field as the place holds it while that
family's membership on the place still lists it. Once the membership is gone, or was never there,
the field is the run's and follows the gate.

Most of UNESCO's fields reach a place only through UNESCO's run, so that rule fits them. UNESCO's
page about a site, `unescoUrl` (#1538), does not:
- Migration 107 moved every `whc.unesco.org` address the Wikidata kinds had stored as a place's
  website into `unescoUrl`.
- Some of those places hold no UNESCO membership at all. One is Khajuraho Group of Monuments as a
  place of worship (experience 13685), beside UNESCO's own row. Its page came from Wikidata's
  official website (P856).
- A Wikidata run never writes `unescoUrl`. Under decision 2 its record then has no such key, so on
  each run of Places of worship (runs 248 and 256 on dev) the held change proposed to remove the
  page. Accepted, it would remove the card's "UNESCO page" link.

Since #1851 a Wikidata run never offers a World Heritage Centre address as a website either, so on
such a place no run would ever write the page back.

## Decision

**1. `unescoUrl` is written by UNESCO's run alone, and every other family's run keeps it as the
place holds it, whatever memberships stand** (`KEPT_BY_EVERY_OTHER_FAMILY`, `fieldFamilies.ts`).
Such a run neither writes it, nor holds it, nor files it as a change. The rest of ADR-0109
decision 2 stands for every other field.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep decision 2 as it is | A Wikidata run asks a curator, on every run, to remove the UNESCO page from a place no UNESCO membership holds. Accepted, the link is gone, and no run can write it back. |
| Remove the page from places without a UNESCO membership | It is true information, and on a place of worship or a site that UNESCO's row was never merged with it is the visitor's way to the inscription. |
| Let the Wikidata kinds write the page from P856 | It would bring back the World Heritage Centre addresses #1851 refuses as websites, under another key. Some of them are documents pages rather than the site's own page. |

## Consequences

**Positive:**
- A place keeps its UNESCO page whichever kinds' runs reach it, and no held change asks to remove it.

**Negative / Trade-offs:**
- Once UNESCO delists a site, its membership is marked missing and UNESCO's run no longer writes
  the place, so the stored page is kept for good. The World Heritage Centre keeps a page for a
  delisted property, so the link still opens.

## References

- Related ADRs: ADR-0109 (decision 2 narrowed), ADR-0084 (the source views)
- Related docs: `docs/tech/experiences.md` (the family fields, and a place's links)
- Code: `backend/src/services/sync/fieldFamilies.ts` (`KEPT_BY_EVERY_OTHER_FAMILY`)
- Issues: #1851, #1538
