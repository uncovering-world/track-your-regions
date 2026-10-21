# ADR-0130: A place keeps a picture its item still carries

**Date:** 2026-10-21
**Status:** Accepted
**Issue:** [#1778](https://github.com/uncovering-world/track-your-regions/issues/1778)
**Narrows:** [ADR-0085](0085-one-wikidata-item-is-one-reading-whichever-source-reads-it.md) decision 1

---

## Context

ADR-0085 decision 1 has every Wikidata reader keep one picture of an item, the first by its Commons
URL among the item's best-ranked pictures. Its alternatives rejected keeping whichever picture a place
already stores while it stays among the item's: two sources each keeping their own stored value would
never converge. Its consequences expected the one-time move to the first picture to reach curators as
held proposals, answered once each.

The move did not happen once. A picture a place took before the rule, or from another source, is
proposed again on every run of a gated source until a curator answers, and each answer is a choice
between two valid photographs of one item:

- the Art Institute of Chicago (Q239303) holds one of its item's two pictures, and Art Museums
  proposed the other on every run from 158 to 177;
- Archaeology proposed the Ruwanwelisaya stupa over "Anuradhapura 02.jpg" for the Sacred City of
  Anuradhapura (Q5724) from run 108 (2026-09-13) to run 178;
- Places of worship proposes a different picture of its item for the Al-Hakim Mosque in Cairo.

Measured on the development catalogue on 2026-10-21, 130 places hold a picture of their item that is
not its first: 66 under Archaeology, 45 under Places of worship, 16 under Public Art and 10 under Art
Museums. Over the 114 distinct picture proposals since 2026-09-25 whose place has an item, 47 were
such swaps. The visitor gains nothing from either answer.

The objection ADR-0085 raised does not hold for the place. A place stores one picture, not one per
source, and every run asks the same question of that one value, so no run undoes another.

## Decision

**1. A place keeps the picture it holds while that picture is one of its item's best-ranked
pictures** (`keepsItsPicture`, `backend/src/services/sync/sourceView.ts`). Every Wikidata reader hands
the upsert all of the item's best-ranked pictures with the one it chose. When the place holds another
of them, the run keeps it, with its credit, and proposes nothing about the picture.

**2. The rule of ADR-0085 decision 1 still chooses where the place has no picture of its item.** A
place with no picture, or one whose picture left the item, takes the first by URL. A picture that
left the item is a change someone made on Wikidata, and it is proposed as before.

**3. A source's view stays what it read.** The membership's `reported_image_url` is the reader's
choice, so two Wikidata sources' views of one item still agree (ADR-0085 decision 2), and the place
may hold a different picture of the same item.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep ADR-0085 as it stands: each swap is answered once per place | 130 cards whose answer changes nothing a visitor sees; a curator spends the time choosing between two valid photographs |
| Close the held swaps once, by a migration that writes the first picture | Moves a picture a curator or an earlier run chose, for an order of URLs no person picked |
| Ask each place to choose among its item's pictures | Turns an item with several pictures into a question whether or not anything changed |

## Consequences

**Positive:**
- The held swaps between two pictures of one item close with each source's next run, and do not
  return.
- A picture that left the item, a real change on Wikidata, is still proposed.

**Negative / Trade-offs:**
- A place's picture can differ from what its sources report and from UNESCO's `MIN(?img)`. Which of
  the item's pictures a place shows is decided by its history, not by a rule a reader can restate.
- A picture newly added to the item is never offered to a place that holds another one. Whether to
  offer it, as a question of its own, is a separate decision.

## References

- Related ADRs: ADR-0085 (decision 1 narrowed), ADR-0084 decision 4 (a source's view of a place),
  ADR-0043 (pictures are Commons files)
- Related docs: `docs/tech/experiences.md` § the place and its memberships
- Code: `keepsItsPicture` (`backend/src/services/sync/sourceView.ts`); `foldPreferred`,
  `applyPreferred` (`backend/src/services/sync/wikidataUtils.ts`); the upsert's `writeUnderLock`
  (`backend/src/services/sync/experienceUpsert.ts`)
- PR / issue: #1778
