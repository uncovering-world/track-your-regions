# ADR-0146: A place's outline belongs to the source that drew it

**Date:** 2026-10-25
**Status:** Accepted

---

## Context

A place is one row whatever kinds offer it (ADR-0084), and its outline is one column pair,
`experiences.boundary` with `area_km2` beside it (#763). The Archaeology site door is the only run
that draws one: OpenStreetMap's polygon around a site (ADR-0059 decision 2). The upsert read an
omitted outline as "this place has none", so every other run that wrote such a place cleared it,
and the next Archaeology run drew it again (#1968). The development catalogue's ledger shows the
cycle every day from 2026-10-21 to 2026-10-24:

- Places of worship cleared about 60 outlines a run, Angkor Wat and the Parthenon among them.
- Bridges & engineering marvels cleared 8, the Pont du Gard among them, and Squares & streets
  cleared the Largo di Torre Argentina.
- A UNESCO dry run would have cleared 95.

Which outline a visitor saw depended on the order of the day's runs. Epic #1969 plans outlines
for five more kinds: World Heritage Sites, Squares & streets, Bridges, Places of worship and Art
Museums. Once two kinds draw, two sources write one outline, and nothing says whose stands.

## Decision

The outline belongs to the source whose run drew it, recorded on the place
(`experiences.boundary_source_id`, migration 170):

1. **A run whose source reads no extents never touches the outline**, in the write or in the
   diff. A source says it reads extents (`readsExtents` on the upsert's parameters); the
   Archaeology site door is the only one that does today.
2. **A source that reads extents replaces or clears only an outline it drew, or one no source
   holds.** Its collector sending none clears its own outline and lets the place go. It never
   replaces or clears another source's outline, and records no change to it.
3. **Between two sources that both draw, a curator chooses.** Two outlines of one place are two
   readings of the ground, and which one a traveller should see is a judgement about the place:
   the World Heritage protected area at Nazca, the temple's own footprint at Karnak. The answer
   follows the pattern the sources card already uses where two sources' views of a name or a
   picture contradict (ADR-0084, #1246): the place keeps the outline it holds, and the card
   asks the curator which source's outline it shows. The slice of #1969 that makes a second kind
   draw builds that question. Until then only one kind draws, and the outline a source drew
   stands: another extent-reading source does not replace it.
4. **A curator's claim on `boundary` still refuses every run**, as for any column.
5. **The outline goes with its drawer's membership.** A curator's separation (ADR-0144) moves the
   outline to the place the drawer's membership moves to, and an owner whose membership left the
   place holds no outline there, so its run, which reaches only places it is a member of, is never
   the only one that could clear it.

Every outline stored before migration 170 was drawn by the Archaeology run, so the migration names
source 5 as their owner.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Omitted keeps the outline, for every run | A source that reads extents could then never clear an outline OpenStreetMap no longer draws, and two drawing kinds would still overwrite each other in turn. |
| A fixed precedence between kinds (World Heritage over Archaeology over Places of worship…) | Which shape a traveller wants differs per place: a protected area for Nazca, a temple's footprint for Karnak. A ranking would be wrong for one of them; a curator answers per place, as for two sources' names or pictures. |
| The first source to draw keeps the outline for good | A better outline a second kind draws would never be shown. It is only the rule while one kind draws. |
| One outline per membership | A place is one row (ADR-0084), and the map draws one outline per place. Several outlines would need a rule for which one to draw, which is this question moved to the reader. |

## Consequences

**Positive:**
- Angkor Wat, the Parthenon and the Pont du Gard keep the outline the Archaeology run drew, whatever
  runs come after it, and no run's changeset records an outline change it did not make.
- Each slice of #1969 can add a drawing kind without overwriting another kind's outline.

**Negative / Trade-offs:**
- Until the slice of #1969 that adds a second drawing kind builds the curator's question, a
  second kind's outline of a place another kind outlined is not shown. That slice cannot ship
  without the question.
- A collector that reads extents must say so (`readsExtents`). One that forgets keeps the outlines
  it sends from replacing anything it drew, and cannot clear them.

## References

- Related ADRs: ADR-0059 (an archaeological site's extent from OpenStreetMap), ADR-0084 (one place,
  many sources), ADR-0136 (what the OSM layer keeps)
- Related docs: `docs/tech/experiences.md` § The extent
- PR / issue: #1968, Epic #1969
