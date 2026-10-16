# ADR-0102: A work one kind refuses as held by a place is handed to the kind that holds that place

**Date:** 2026-10-13
**Status:** Accepted — decision 2 narrowed by [ADR-0112](0112-a-handed-over-work-its-statements-place-nowhere-goes-where-the-refusal-named.md)

---

## Context

Each kind fills itself in its own run (ADR-0045). A kind's rule refuses what is not its own, and the refusal is right, but nothing gives the refused thing to the kind it belongs to. On the development catalogue on 2026-10-13, the runs' own changesets show works passed between kinds and kept by none:

- **The Horses of Saint Mark (Q1994701).**
  - Public Art (run 143): "in the collection of St Mark's Basilica: a work of a place of worship, not public art".
  - Places of worship (run 144): "not a treasure by its classes: group of sculptures — held by St Mark's Basilica".
- **The Venus of Berekhat Ram (Q793335).**
  - Public Art: "inside Israel Museum: a work of a museum, not public art".
  - Archaeology (runs 126–129): "not a find by its classes: sculpture — held by Israel Museum".
- **The Bamberg Horseman (Q680156).**
  - Public Art: "inside Bamberg Cathedral: a work of a place of worship, not public art".
  - Places of worship took the cathedral and did not name the horseman at all.

Each refusal holds within its own kind's rule. Together they hold no work, and the catalogue check `work-no-offered-place-holds` (#1444) lists what they lose.

The works kinds already read what an admitted venue holds by the venue's own statements (#890, `museum/venueSide.ts`). That read places an object with the museum stack's resolver (`venueGraph`, `placement.ts`), which walks the containment chain to the nearest venue: a chapel to its church, Room 325 of the Louvre Palace to the Louvre. What it keeps is decided by the kind's own class rule, and a sculpture is no find to Archaeology and no worship object to the places of worship. The Venus of Berekhat Ram reached that rule and was refused there.

A run of one kind could write another kind's links directly. But then a run would change what another kind shows without that kind's run or changeset knowing. That is the implicit cross-kind write the product review asked to avoid, and the one pass for every kind is #1445, after the local Wikidata subset (#1434).

## Decision

1. **A refusal that says the thing is another place's records where it is held.** When a kind's rule refuses something because it stands in, or belongs to, another place, the run records the refusal with that place's chain of containment (`experience_hand_overs`: the refusing source, the item, the reason and the places, item ids nearest first). Today that is Public Art's "inside X" and "in the collection of X". The record is made from what the run filtered, whether or not the source ever held the work as a row: most of these works never had one, because the rule refused them the first time it saw them. A complete run replaces its source's set, so a work it no longer refuses this way leaves it. The chain is the rule's own walk, so the Ecstasy of Saint Teresa records the Cornaro chapel and, beyond it, the church.
2. **The kind that holds the place takes the work.** A works kind's venue-side read keeps an object its own class rule refuses when another kind refused it as held elsewhere (decision 1), at a venue the read itself placed it at. The read reads the hand-overs once per run. Placement is the resolver's, narrowed to the places the refusal named: the object goes where its own statements and the containment chain put it among the venues this kind admits, and only to those the refusal named or one folded into them (the Galleria Palatina is Palazzo Pitti's). Another admitted venue its statements reach refused it by its own rule. The link is written and placed by the venue's own membership (ADR-0084), so the venue's runs keep it, withdraw it and mark it as they do any other link, and no run writes another kind's rows.
3. **The hand-over is named.** The venue's run names an object it kept this way in its changeset: the work added to the venue carries `handed_by`, the refusing kind and its reason. The run's log counts the hand-overs beside the venue-side read's own.
4. **The fame line is the refusing kind's.** A handed-over object passed the refusing kind's pool and fame line before its rule refused it. The venue-side read still applies its own floor (`POOL_MIN_SITELINKS`), and asks nothing more of the object's fame.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Record the chain on the refusing source's membership | Most of these works never have a row in the refusing source: the rule refuses them the first time it sees them, before any membership exists. A curator's writes on the membership would also have to keep the column true. |
| Public Art writes the link to the venue itself, under its own membership | A run of one kind would change what another kind shows, invisibly to that kind's run and changeset. Public Art's walk names a container ("inside Cornaro chapel"), not the venue the catalogue holds. |
| Widen each works kind's class rule until it keeps these objects | A sculpture would become a find and a worship object everywhere, not just where another kind refused it as held there. Each widening moves the next object's refusal to another kind. |
| Wait for the one pass for every kind (#1445) | It is blocked by the local Wikidata subset (#1434). Until then the Venus of Berekhat Ram and the Horses of Saint Mark stay on no card. |

## Consequences

**Positive:**
- A refused work reaches the card of the place that holds it, through that place's own kind and run. The Horses of Saint Mark go to St Mark's Basilica, and the Venus of Berekhat Ram to the Israel Museum.
- Every write stays within its own kind (ADR-0084), and the hand-over is visible on both sides: the refusal's record says where the work is, and the venue's changeset says who handed it over.

**Negative / Trade-offs:**
- The venue's run sees a hand-over only after the refusing run has recorded it. The first run after a new refusal does not see it, and the next run does.
- A refused work whose place no kind admits stays lost, and the watch keeps naming it: the Veiled Christ's Cappella Sansevero, and the Venus of Willendorf's museum in Vienna. Another slice of #1444 admits such museums.
- Two resolvers still exist, Public Art's walk and the museum stack's. #1445 replaces both.

## Amendments

- 2026-10-13, before acceptance: decision 1 records the hand-over in a table of its own rather than on the refused membership, after the review found that a work refused on first sight has no membership to carry it.
- 2026-10-13, before acceptance: decision 2 places a handed-over work only at a place the refusal named, after the review found that its statements could reach another admitted venue.

## References

- Related ADRs: ADR-0024 (a kind may refuse a row), ADR-0045 (a traveller browses by kind), ADR-0084 (placements per membership), ADR-0044 (the works floor)
- Related docs: `docs/tech/experiences.md`, `docs/tech/data-assertions.md`
- Issues: #1444, #1445, #890
