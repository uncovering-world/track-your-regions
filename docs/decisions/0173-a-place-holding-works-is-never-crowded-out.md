# ADR-0173: A place holding works is never crowded out

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

ADR-0172 shows a place unless ten better-known places of its kind and type lie within 10 km. A
place's fame is read from its own item: readers of its article, the Wikivoyage editions that use
it, its Wikipedia editions. What hangs inside it is not in that fame. A church known for one
painting ranks under churches known for themselves.

On the development catalogue of 2026-11-02, 124 memberships were crowded out. Five of them hold a
work the catalogue shows a reader, all in central Rome:

| Place | What it holds | Better-known churches within 10 km |
|---|---|---|
| San Luigi dei Francesi | Caravaggio's *Calling*, *Inspiration* and *Martyrdom of Saint Matthew* | 15 |
| Santa Maria della Vittoria | Bernini's *Ecstasy of Saint Teresa* | 11 |
| Santa Maria in Cosmedin | the *Bocca della Verità* | 19 |
| Sant'Agostino in Campo Marzio | Caravaggio's *Madonna di Loreto* | 31 |
| Sant'Alfonso all'Esquilino | the icon of *Our Lady of Perpetual Help* | 60 |

A traveller crosses Rome for these. Only 39 of the 1,582 places of worship hold any work today;
the number grows as the works side learns what churches hold.

## Decision

**1. A place holding a work a reader is shown is never crowded out, and it takes none of the
ten.** ADR-0172 decision 1 is narrowed:

- A work counts when its link is one the source still places and neither the link nor the work is
  unread. This is the set the row's works-inside mark counts (`treasure_count` in
  `experienceRegionQuery.ts`). The schema states it once as `place_shows_works(place)`.
- `recount_crowding()` writes no such place to `membership_crowding`.
- The ten are counted among the places of the type that hold none. A place with works is shown on
  top of them. Rome's churches show their ten best known, then every church that holds a work.

**2. The schema recounts when what a place holds changes.** This follows ADR-0172 decision 4.
`crowding_follows_link()` fires on `experience_treasures` when a link is written or deleted. It
also fires when a link's placement (`missing_since`), its unread state or its place changes.
`crowding_follows_work()` fires on `treasures` when a work's unread state changes. Both recount
around the place through `crowding_recount_place(place)`. That function does nothing for a place
with no membership in a kind that declares the rule. An art museum's works run writes links by
the thousand and recounts nothing.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Add the works' fame to the place's fame | It keeps the place competing for ten seats. Which of Rome's churches is shown would then depend on how two kinds of signal are weighed. The maintainer's rule is simpler: what holds something to look at is shown. |
| Exempt the place but keep it among the ten | The place would still take a seat from a church known for itself. Rome would show fewer than ten churches of the city's own fame. |
| Exempt only an iconic work's place | Sant'Agostino's *Madonna di Loreto* is not marked iconic, and a traveller goes there for it. The works-inside mark shows any work, so the display rule reads the same set. |

## Consequences

**Positive:**
- **Development catalogue, 2026-11-02:** 115 memberships are crowded out instead of 124. The five
  churches above are shown. Four churches of Rome rise into the ten: San Lorenzo fuori le Mura,
  Santa Sabina, San Clemente and Santa Prassede. A full recount takes about one second.
- **The display rule and the works-inside mark agree.** A row that says "3 treasures inside" is never
  in the tail.

**Negative / Trade-offs:**
- **A core can show more than ten of a type.** The excess is bounded by the places that hold
  works.
- **The schema states the works set** in `place_shows_works()`, and `experienceRegionQuery.ts`
  states it too. `backend/src/db/crowding.db.test.ts` holds the rule to its cases.

## References

- Related ADRs: ADR-0172 (decision 1 narrowed), ADR-0044 (a link the source stops placing),
  ADR-0025 (the unread gate on a link and on a work), ADR-0068 (a trigger owns the recount)
- Related docs: `docs/tech/experiences.md` § What a crowded city shows
- Issues: #2245; #2177 (the admission review that found it)
