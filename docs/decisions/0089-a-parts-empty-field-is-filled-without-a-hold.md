# ADR-0089: A part's empty field is filled without a hold

**Date:** 2026-10-08
**Status:** Accepted

---

## Context

ADR-0037 decision 1 holds a field of a part a reader can already see, as the object's own fields
are held: a gated source may not overwrite what a reader sees. A point has had two such fields,
its name and its coordinate. Neither is ever empty on a point a reader sees.

#1270 gives a World Heritage component three more: the picture, its credit and the description
that the component's Wikidata item states. Every point starts with all three empty. Under
decision 1, the first World Heritage run would hold every one of them on every visible point.
Measured on 2026-10-08 against live Wikidata and the development catalogue's 6 365 component
points: 1 977 resolve to a picture and 3 690 to a description. That would put 3 828 visible
points on 353 held cards. One card, for Rock Art of the Mediterranean Basin on the Iberian
Peninsula, would hold 706 parts, most of them described as "rock art site in Spain".

What a reader sees on an empty point is the site's own picture, which the card marks as the
site's. No value of the point is on show to protect. The gate exists so that a source cannot
quietly replace what a reader sees.

## Decision

1. **A part's field that holds nothing is filled by the run, gated source or not.** This applies
   to a component's picture, its credit and its description. A value a reader already sees is
   held as ADR-0037 decision 1 says: a different picture, a corrected description, or a removal.
   This narrows that decision for a part's fields that start empty.
2. **The credit goes with the picture.** Where the picture changes, the credit is held exactly
   when the picture is. Where only the credit changes, it is filled if the point had none and
   held if it had one.
3. **A claim still wins.** A field a curator claimed is never written, empty or not, and the run
   reports the source's value beside it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Hold every change, the first fill included (ADR-0037 as written) | 353 cards and 3 828 parts that protect nothing a reader sees. A curator would page through descriptions like "rock art site in Spain" one part at a time. |
| Hold pictures, write descriptions | This still holds 1 977 first pictures, which are a component's own item's P18. That item is chosen by the same id match as the site's own picture, and nothing replaces a value a reader sees. |
| Fill the object's own empty fields the same way | Out of scope. An object's empty field is rare, and its card shows nothing in its place. That question belongs to the object's gate (ADR-0025), not to this slice. |

## Consequences

**Positive:**
- The first World Heritage run gives about 2 000 component points their own picture and about
  3 700 their own description without a card. After that, the queue holds only changes to what
  readers see.

**Negative / Trade-offs:**
- A wrong first picture reaches readers without review. The match is by the component's own World
  Heritage id (#1269, ADR-0088), so a wrong picture is a wrong Wikidata statement. A curator can
  correct it on the point, and the correction is claimed (#1270).

## References

- Related ADRs: ADR-0037 (decision 1 narrowed here), ADR-0025 (the gate), ADR-0043 (Commons
  pictures and their credit), ADR-0085 (one picture of several at one rank)
- Issues: #1270, #1269, #575
