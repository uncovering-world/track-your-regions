# ADR-0099: A rewrite a visitor would not notice passes the gate

**Date:** 2026-10-12
**Status:** Accepted — decision 1 narrowed by [ADR-0129](0129-a-wikidata-item-a-place-holds-none-of-passes-the-gate.md), [ADR-0133](0133-a-subtitle-a-place-holds-none-of-passes-the-gate.md), [ADR-0135](0135-a-type-its-kind-has-no-word-for-passes-the-gate.md) and [ADR-0139](0139-a-field-no-reader-sees-and-a-typographic-rewrite-pass-the-gate.md)
**Issue:** [#1353](https://github.com/uncovering-world/track-your-regions/issues/1353)
**Narrows:** [ADR-0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) decision 1, and the object's own hold it mirrors (ADR-0025's gate, held per field since #519)

---

## Context

A gated source may not overwrite what a reader can already see (ADR-0025, ADR-0037 decision 1):
every rewrite of a visible object's or part's field waits for a curator. ADR-0089 let a part's
*empty* field be filled, since nothing a reader sees is overwritten. On the development catalogue
on 2026-10-12, 810 objects held a proposal, and three classes of what they held change nothing a
visitor reads:

- **a part's name extended with a qualifier** — 111 of the 114 held part names: the World Heritage
  list naming a component with its village, *Church of All Saints* → *Church of All Saints,
  Blizne*, or telling five components called *Abruzzo* apart;
- **a picture credit re-read for the same file under the same licence** — 28 of the 76 held
  credits, Commons now giving the author cleanly (*No machine-readable author provided. Ansgar
  Walk* → *Ansgar Walk*);
- **an area re-measured by under a tenth** — 11 of the 19 held areas (821.7474 → 821.748 ha).

## Decision

**1. These three rewrites pass the gate, and no other.** On a held row they are written, filed with
the written fields and marked with their class (`passedTheGate`: `qualifier`, `same-file-credit`,
`remeasured`); none raises a question, sets the held pointer or demotes a verified membership.

- *A qualifier:* the stored name, not empty, followed by a separator — a comma, an opening parenthesis or a dash, each after or around a space —
  and more. *Church of St Mary* → *Church of St Mary Magdalene* is another dedication and is held.
- *The same file's credit:* the place keeps its picture, no curator owns that picture, and the credit
  keeps a licence it states — a credit naming none on either side is not read as the same terms.
- *A re-measurement:* a key named as a measurement (`MEASURED_METADATA_KEYS`, an area) moved by
  less than a tenth. A year is a number too, and is never re-measured; a key the gate weighs as major
  (`dateInscribed`) never passes.

**2. The write and the record decide it once.** On an object, the diff and the upsert read one rule
(`metadataPassesTheGate`, `passingMetadataKeys`); on a part, the location writer's keeping arm
decides in SQL and returns its answer (`name_passed`) beside `was_held`.

**3. A claim still wins** (ADR-0029): a claimed field is never extended under a curator.

**4. On a part, only the qualifier passes.** The credit and the area are the object's: a part's
own picture, credit and description are held under ADR-0089 decision 2 (filled when empty, held
once they hold a value), and a part carries no area.

## Alternatives Considered

- **Any minor change passes.** The gate's `minor` covers a description rewritten and a picture
  replaced, which a visitor does read.
- **Any number moved by under a tenth.** A year is a number; a monument's 1935 → 2100 is no
  re-measurement.
- **A prefix alone.** *St Mary* → *St Mary Magdalene* is a prefix, and a different saint.

## Consequences

- A name replaced, another picture, a licence changed, an area moved more — still held.
- The issue's measurement is repeated after the first run under the rule.
