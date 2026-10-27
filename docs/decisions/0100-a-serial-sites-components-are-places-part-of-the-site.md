# ADR-0100: A serial site's components are places, part of the site

**Date:** 2026-10-13
**Status:** Accepted — decision 4 narrowed by [ADR-0143](0143-a-place-is-found-by-its-identifiers-before-a-run-creates-one.md): the run finds a part by its item and adds its kind there, rather than the catalogue merging the two afterwards; decisions 2 and 3 narrowed by [ADR-0156](0156-a-virtual-kind-holds-how-a-source-knows-a-part.md): a part holds a membership of the virtual kind World Heritage components, which carries its item and the list's view of it

---

## Context

ADR-0046 decided what a component of a serial World Heritage site is. Its decision 1 makes it a
place: "its locations are the places, and identity is decided per location". Decision 6 makes
*part of* a relation between places, apart from identity. Decision 7 makes a visit to a part a
visit upward to the whole. The schema never followed. A component is a row of
`experience_locations`, the table that holds a place's own points, and a place is a row of
`experiences`. On the development catalogue on 2026-10-12, the places with more than one standing
point are 484 World Heritage sites with 5,574 points, and 11 other places with two points each.
Every multi-point place is, in practice, a serial site.

Because a component is not a place, everything a place has was built a second time for the point:

- its own name, picture, credit and description (#1270);
- its own card (#1271) and its own Wikidata item (#1269, #1272);
- the gate's held fields per part, the withdrawal and arrival questions per part, and the curator's
  claims per point.

The next step cannot be built that way. #1250 asks for a component to be the same place as another
kind's row: the component *Temple of Karnak* of *Ancient Thebes* and the place of worship *Karnak
Temple Complex* share one Wikidata item and stand 125 m apart. On 2026-10-12, 203 such pairs on
about 100 sites shared an item, and 148 component points had another kind's place within 300 m
under a similar name (the Kyiv-Pechersk Lavra among them).

A merge (ADR-0086) is how two rows that are one place become one. It moves the folded place's kind
memberships onto the survivor, and between a component point and a place it has no survivor that
is a place. Folding Karnak's place into *Ancient Thebes* would make the whole of Thebes a place of
worship. Folding the Antwerp cathedral's museum row into *Belfries of Belgium and France* would make
56 belfries an art museum. A separate "this point is that place" link would record one thing twice,
which is what ADR-0046 set out to stop.

Other gazetteers model it the same way. Pleiades separates *places*, *locations* (the geometries of
one place), *names* and *connections*, and "part of" is a connection between two places, never a
location. Wikidata gives each component its own item, with P361 *part of* the property's item:
Kamigamo Shrine is component `688-001` of the Historic Monuments of Ancient Kyoto and a Shinto
shrine in its own right. schema.org links places by `containsPlace` / `containedInPlace`. Google
Places gives a place `containingPlaces` and `subDestinations`, both lists of full places.

## Decision

1. **A component of a serial site is a place, part of the site.** Each component is a row of
   `experiences` with its own point. The site holds it through a part-of relation
   (`experience_parts`: the whole, the part, and the membership that placed it, with the
   component's reference). The relation is ADR-0046 decision 6's, the same one the Neues Museum
   will hold to Museum Island. `experience_locations` goes back to being what it is named: the
   points of one place.
2. **The site is the card that gathers its parts.** The site keeps its World Heritage membership
   and its anchor (ADR-0095). Its pins, its "made of N places" and its list of parts are its
   parts. A part carries no membership of its own for the site's kind: it is offered where its
   whole is offered and its own standing allows (`partOfferedSql`, composed beside the membership
   predicates). What the site is as a whole stays on the site and is never copied onto a part:
   its inscription, criteria and danger listing, its description and its picture, its badge and
   its gate. A part has its own row in a list only where it holds a kind of its own, as Karnak
   does once merged with the place of worship: Google's rule for a sub-destination, which gets a
   listing only when it operates as a distinct entity inside its host. A part with no kind — one of
   the 758 rock shelters of the Rock Art of the Mediterranean Basin on the Iberian Peninsula, a
   stretch of the Qhapaq Ñan — is shown
   as the site's components are today: a pin of the site, a row of its list of parts and its own
   card.
3. **What a component has today becomes the part place's own.** That covers its name, picture,
   credit and description, its Wikidata item, the curator's claims, its gate state and held fields,
   its withdrawal and arrival, and the visits on its point. The component's reference stays on the
   relation, the identifier the site's source knows the part by, as `external_ref` is on a
   placement today (ADR-0084 decision 2). The run finds a part by it.
4. **A part and another kind's place are merged as places.** `mergePlaces` applies unchanged,
   with one more thing it moves: the relations the folded place is a part in. The catalogue merges
   on an equal Wikidata item (ADR-0086 decision 5, ADR-0088 decision 2: a part is a place of one
   point and one item). A near place with a similar name is a proposal (ADR-0046 decision 2). After
   the merge, Karnak is one place with one pin, part of *Ancient Thebes*, in the Places of worship
   list. Its visits are reconciled, and the undo restores both.
5. **A visit is recorded on the part and cascades to the whole** (ADR-0046 decision 7). The site's
   progress is how many of its parts were visited. When the whole counts as visited is still #768's
   decision.
6. **A site of one point stays one place** (ADR-0088). Only a site of several components has parts.
   A site that gains a second component gains parts, and one that falls back to one keeps its
   remaining part as a part.

This narrows ADR-0046 decisions 1 and 5: the location becomes a place row, and the address of a
merged component is the part's own card rather than "the site's card opened at the location". It
narrows ADR-0086 decision 3: the folded points of a part are a place's. ADR-0084 holds unchanged.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A link "this component point is that place" (`experience_location_places`) | One thing is recorded twice. Every reader must follow the link for pins, visits and cards, and the undo is a second mechanism beside the merge's. ADR-0046 set out to stop exactly this. |
| Merge the other place into the site, its kinds moving there | The whole of Ancient Thebes would become a place of worship, and the Belfries an art museum. |
| A kind membership on a point | Every reader of kinds (lists, counts, filters, admission, the gate) learns a second level for a case that is really a place. |
| Keep components as points and reproduce each place feature on them as it is asked for | It is how #1269–#1272 were built, and it doubles the work for every feature a place gets. |

## Consequences

**Positive:**
- #1250 becomes the merge the catalogue already has. A component's card, picture, item, gate and
  visits are a place's, read by the code that reads places.
- The model matches Wikidata's (a component's item is a part's item), so the item reader and the
  finder compare like with like.
- The curator surfaces for parts (held part fields, withdrawn points, refused parts) can become the
  place surfaces, one per question rather than one per level.

**Negative / Trade-offs:**
- This is a migration of about 5,600 points into places, and a rewrite of the World Heritage run's
  component writing: pairing, renumbering (ADR-0090), the held parts, withdrawal, the anchor
  (ADR-0095) and the item reader.
- Every reader of "the points of a site" moves to "the parts of a site": the map pins, the cards,
  visits and progress, region placement, the review queue's part cards and the catalogue checks.
- The site lists must not offer parts as sites. A part is reachable through its whole, or through
  another kind it holds after a merge.

## Amendments

- 2026-10-13, before acceptance: decision 2 states what stays on the site and when a part has a row
  of its own in a list (Google's sub-destination rule), after the product review asked how parts
  group and share the site's data.

## References

- Related ADRs: ADR-0045, ADR-0046, ADR-0084, ADR-0086, ADR-0088, ADR-0090, ADR-0095
- Related docs: `docs/tech/experiences.md`
- Issues: #1250, #575, #755, #768
- Pleiades: [conceptual overview](https://pleiades.stoa.org/help/conceptual-overview),
  [connections](https://pleiades.stoa.org/help/what-are-connections);
  schema.org [containsPlace](https://www.schema.org/containsPlace);
  Google Places [sub-destinations](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places)
