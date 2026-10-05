# ADR-0085: One Wikidata item is one reading, whichever source reads it

**Date:** 2026-10-05
**Status:** Accepted
**Issue:** [#1246](https://github.com/uncovering-world/track-your-regions/issues/1246), Epic [#755](https://github.com/uncovering-world/track-your-regions/issues/755)
**Narrows:** [ADR-0084](0084-a-place-belongs-to-no-source-and-no-kind.md) decision 4

---

## Context

ADR-0084 decision 4 records each source's view of a place's name, description, picture and
coordinate on its membership. Where the views disagree, a curator decides, instead of the last run
to write winning. Its trade-offs counted the 155 pairs of rows that share a Wikidata item on the
development catalogue: 4 pictures and 2 coordinates differed, so the first merge would raise about
six cards.

Every one of those six is two of our syncs reading **one** Wikidata item and keeping different
values of it. Wikidata often holds several values of an item at equal rank:
- the Dome of the Rock (Q172077) holds three pictures;
- the Gol Stave Church (Q1513478) holds a summer and a winter photograph;
- the Cave of Altamira (Q133575) holds two coordinates 752 m apart, one rounded to the arc-minute.

Every Wikidata place reader kept the first row SPARQL returned, in no defined order. Measured on
2026-10-05 against live Wikidata, over the 2,587 places the Wikidata sources hold, 201 carry several
pictures at best rank and 171 several coordinates.

A curator asked to choose between two readings of one item is not deciding between two sources; they
are tidying our nondeterminism. The product review of 2026-10-05 put it this way: where both
memberships resolve to one item, there must be no difference to ask about. The question is for
sources that are different data. A curator answers it once, and is asked again only when one of the
sources sends something new.

## Decision

**1. Every Wikidata reader keeps one value of an item by one rule.** Among an item's values at its
best rank:
- **Picture:** the first by its Commons URL, which is the picture UNESCO's lookup already takes with
  `MIN(?img)`.
- **Coordinate:** the most precisely written; ties go to the smaller latitude, then longitude.

Readers fold every row of an item by this rule, so the order the rows arrive in is no part of the
answer.

**2. Views of one item are one reading.** Two memberships that know a place by the same external id
read one item, so where their views of a field differ, one of them read it before an edit the other
has seen. The newer reading is written and nobody is asked. ADR-0084 decision 4's disagreement, and
the curator who decides it, are for memberships under different ids — a World Heritage id beside a
Wikidata item, two different data sources.

**3. A curator's choice between data sources stands until one of them changes.** A choice is not
asked again while both sources keep sending what they sent; it is asked again only when one of them
sends something new.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep each reader's first row and ask a curator wherever two sources' readings of one item differ | It asks a person to undo our own nondeterminism, on up to 201 pictures and 171 coordinates, and asks again whenever a query's row order changes |
| Prefer the item's first statement, Wikidata's editorial order | SPARQL does not expose statement order, and the statement-level form that would read rank and position 502s over the whole pool (`museum/queries.ts` header); the entity API reads it one item at a time |
| Keep whichever value a place already stores while it remains among the item's values | Two sources each keeping their own stored value never converge, and the place flips to whichever ran last |
| Prefer the most widely used picture on Commons | A further query per item for a ranking no reader asked for; editors who care set a preferred rank on Wikidata, which the readers already honour |

## Consequences

**Positive:**
- A merged place is one picture and one point whichever of its Wikidata sources ran last, and no
  card is raised for a difference that is ours.
- UNESCO's picture of a World Heritage site and every other source's picture of the same item agree.
- The Cave of Altamira's two points, the cave written twice, become one.

**Negative / Trade-offs:**
- The picture rule is arbitrary in what it prefers. The Museum Ulm keeps *Loewenmensch2.jpg*, the
  Lion-man, rather than its building. An editor who disagrees sets a preferred rank on Wikidata.
- Applying the rule changes stored values once: on 2026-10-05, 60 pictures and 80 coordinates moved
  by more than ten metres. Under a gated source, a change on a place readers see arrives as a held
  proposal, through the gate like any other.
- The coordinate rule reads precision from how the number is written, not from Wikidata's stored
  precision, which the readers do not fetch.

## References

- Related ADRs: ADR-0084 (decision 4 narrowed), ADR-0043 (pictures are Commons files), ADR-0027 (the
  ten metres two coordinates agree within)
- Related docs: `docs/tech/experiences.md` § the place and its memberships
- Code: `preferredPicture`, `preferredCoordinate`, `foldPreferred` (`backend/src/services/sync/wikidataUtils.ts`);
  `contestedFields` (`backend/src/services/sync/sourceView.ts`)
- PR / issue: #1246
