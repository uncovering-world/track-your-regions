# ADR-0095: A place of several points has no coordinate of its own

**Date:** 2026-10-12
**Status:** Accepted

---

## Context

`experiences.location` is a place's coordinate, required on every row. For a place of one point it is where the place is. For a serial World Heritage site, made of components each with their own point, the World Heritage run stored the export's site coordinate. That value moves when the export reorders its list. The Danube Limes (Western Segment) moved from Carnuntum to near Linz, 180 km, and the gate held the move as a major `location` change. On 2026-10-12 that question waited on 6 held cards, among them Pompeii, W-Arly-Pendjari and the Rock Art of Alta. A curator answering it could decide nothing (#1354).

The research of 2026-10-12 ([report](../research/2026-10-12-what-a-serial-sites-single-coordinate-means.md)) found the following:

- **UNESCO** asks a nomination for "a point at the approximate centre" of the property, beside a table of each component's centre. It publishes no property-level coordinate on the Danube Limes' page.
- **Other projects** keep a representative point marked as one (OpenStreetMap's `label` role, Google's `viewport`), or none at all (Wikivoyage's `NA`).
- **In this codebase**, regions are assigned from the component points and markers are drawn per component. The stored point only chooses which component stands for the place where one has to: the list row, the detail position, the folded world point.

Deriving the anchor from the components instead of the export moves the stored point of 387 of the 485 multi-point World Heritage sites, by a median of 6 km and at most 2,068 km (measured on the development catalogue on 2026-10-12). None of these moves changes a region or a marker.

## Decision

1. **A place of several points has no coordinate of its own** (narrows ADR-0028 decision 2). Its stored `location` is an anchor: the component nearest the components' centroid (`resolveMainPoint`, `unescoSyncService.ts`, taken the short way round the antimeridian), whatever coordinate the source gives for the whole. A place of one point keeps the source's own coordinate, as before. The column stays `NOT NULL`, since every reader that needs one point gets the anchor. Where exactly one coordinate is unavoidable, ADR-0028 decision 2 puts the reader at the place nearest the object's published coordinate (`readerPositionSql`). For a place of several points that place is now the anchor itself, the most central component, not the place nearest what the source published. ADR-0028 dropped a different rule, which used the source's coordinate where it matched a place and the medoid otherwise, because it was discontinuous. The anchor reads the components alone, so it moves only when they do.
2. **The anchor is the run's, not a curator's question.** The run marks it (`locationIsAnchor`) and writes it past the gate even while the place's other fields are held. Its move is recorded in the run's change set as a minor change written, never as a held field (`pastTheGate`, `changeSet.ts`). That written move is not a proposal: it neither points the membership at the run's held proposal nor demotes a verified membership (`wroteContent`, `experienceUpsert.ts`). The run does not contest it with another source's view of the place (`contestedFields`, `sourceView.ts`). A curator's claim on the location still keeps it.
3. **No reader shows the anchor as the place's coordinate.** The review card's header says "made of N places" and prints no coordinate for an object of several places (`ObjectContext.tsx`).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Make the column nullable and give a place of several points none | About a dozen readers would need a replacement rule for the one point they need: `readerPositionSql`, `foldedQuery`, the point-move match, the anchor-claim release and the required `latitude`/`longitude` of the experience responses. The anchor is that rule, stated once, and no reader shows it as a fact. |
| Keep the export's coordinate and only stop holding its moves | The value would still be a number UNESCO does not publish, and it would still jump with the export's ordering: the same place represented by Carnuntum one week and by Linz the next. |
| Keep holding the move for a curator | The question has no answer: neither value is where the site is. |

## Consequences

**Positive:**
- The six held location cards on serial sites stop being asked on the next World Heritage run that finds nothing else to hold. The object upsert clears the pointer of a place whose own fields propose nothing, and a written anchor move proposes nothing.
- The place a serial site stands for, where one component has to, is a real component near its middle, steady across reorderings of the export.

**Negative / Trade-offs:**
- On the next run the anchor of most multi-point sites moves without a question. This changes which component a folded marker, a list row or a detail position starts from. It changes no region and no marker of a component.
- The sources card still compares the views the memberships store. The World Heritage membership records the anchor as its view of the location. A serial site that a curator merged with another source's place, which the catalogue's own merge never does (ADR-0088 decision 2), can therefore still be asked which of the two points it stands at, and that question reopens whenever the anchor moves.
- The catalogue check comparing an archaeology site with a World Heritage site by their coordinates (`archaeologySiteTwinOfWorldHeritage`) compares against the anchor of a serial site rather than the export's value.

## References

- Related ADRs: ADR-0028 (decision 2 narrowed), ADR-0020 (the run's change set), ADR-0025 (a gated source), ADR-0088 (a site of one point)
- Related docs: `docs/tech/experiences.md` § Serial nominations carry their coordinates in their parts
- Research: [2026-10-12 report](../research/2026-10-12-what-a-serial-sites-single-coordinate-means.md)
- Issue: #1354
