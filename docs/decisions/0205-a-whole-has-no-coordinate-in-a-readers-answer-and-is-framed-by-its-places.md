# ADR-0205: A whole has no coordinate in a reader's answer, and is framed by its places

**Date:** 2026-11-15
**Status:** Accepted
**Issue:** [#2122](https://github.com/uncovering-world/track-your-regions/issues/2122), Epic #2115
**Narrows:** [ADR-0095](0095-a-place-of-several-points-has-no-coordinate-of-its-own.md) decision 1,
[ADR-0028](0028-a-reader-is-positioned-by-places-they-can-go-to.md) decision 2

---

## Context

A whole is a place made of parts: `experience_parts` names it as the whole of at least one part
(`place_is_whole()`, ADR-0203). On the development catalogue on 2026-11-13 there were 482 of them,
all serial World Heritage sites.

ADR-0095 decision 1 kept one coordinate for such a place, its anchor: the component nearest the
components' centroid. Where a reader needed exactly one point, ADR-0028 decision 2 put them at the
place nearest that anchor (`readerPositionSql`), which for a whole is the anchor's own component.
So the region's list, a place's own read and the search answered every whole with one component's
point. Its Alternatives table rejected making the response's `latitude` and `longitude` nullable,
since the anchor gave every reader that needed one point an answer.

That answer misdescribes a whole on the ground. Seville's World Heritage site is the cathedral, the
Alcázar and the Archivo de Indias, and the list sent the reader to the cathedral as though it were
the site. The Struve Geodetic Arc runs through ten countries, from Hammerfest to the Black Sea, and
a click on its row flew the map to one station of 34. The maintainer decided on 2026-10-27/28 that
a dispersed whole has no coordinate: on the map it is its parts, and lists, search and fly-to frame
their extent (#2122).

## Decision

1. **A whole has no coordinate in a reader's answer** (narrows ADR-0095 decision 1 and ADR-0028
   decision 2). The region's list, a place's own read and the search answer a whole with
   `latitude` and `longitude` null. `readerPositionSql` asks whether the row is a whole
   (`isWholeSql`, the body of `place_is_whole()`) and gives a whole neither the anchor nor the
   point nearest it. The two fields are nullable in the response schemas
   (`backend/src/api/responses/experiences.ts`), so the OpenAPI document and every client
   generated from it say so.
2. **A whole is framed by its places.** Its row carries `focus`, `{ bbox, anchorPoint }`: the frame
   of the places the caller is shown of it, measured on read by `geometry_focus()`, the rule a
   region's frame is measured by (`wholeFocusSql`, `db/placePoints.ts`). A whole whose places lie on
   both sides of the antimeridian is a window across it, framed through its anchor point. The key is
   absent on every other row, and on a whole that shows no place. A map frames a whole by the places
   it holds (`frameGeoJson`), and by its `focus` while it holds none of them (`frameFocus`). It never
   flies to a point of a whole.
3. **Everything else stands.** A place that is not a whole keeps ADR-0028 decision 2: the point
   nearest its own coordinate, which for an edition cast in several cities is its most central cast
   (ADR-0145). `experiences.location` stays `NOT NULL`, and a whole's still holds ADR-0095's anchor,
   which the run writes as ADR-0095 decision 2 says. The readers that read the column itself, such as
   crowding, the catalogue checks and the publish's moved-point match, are unchanged. ADR-0095
   decision 3 already shows no anchor to a curator, and stands.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the point nearest the anchor as a whole's row coordinate | The list and the fly-to stand the reader at one component as though it were the site: Seville's site at its cathedral, the Struve Arc at one of 34 stations. |
| Store the frame, refreshed with the regions | The places a reader is shown move with every run and every verdict, and differ by caller: a curator previews the places the queue has not passed. Measured on read, the frames cost about 10 ms of a 133 ms read of Europe's list, 1 943 rows with 177 wholes (2026-11-13). A stored frame is the way out if that grows. |
| Frame a whole in the web from its places alone | The web holds no place of a whole until the region's batch of places loads, and a shared link may arrive before it. The row needs the frame first. |
| Drop the stored anchor in the same change | The run, crowding and the catalogue checks read `experiences.location`, and each needs its own replacement. That is a migration of its own, in a later slice of #2122. |
| Stand a whole at the centroid of its places | ADR-0028 measured it 25–143 km from the nearest real component for the worst cases, and for scattered parts it can fall in open water. |

## Consequences

**Positive:**
- A list row, a click on it and a shared link show a whole as its places: Seville opens on its three
  places, and the Struve Arc on all ten countries.
- No reader-facing answer names one component as the place of a whole.

**Negative / Trade-offs:**
- A client of the API reads `latitude` and `longitude` as nullable on these three answers. The web's
  generated client is regenerated with this change, and a native client must handle the null too.
- The card and the search pay a fixed cost of about 0.3 ms per statement for the frame step, which
  runs only for a whole. The lists, which are the hot reads, run as before.
- A whole that shows no place has no frame, and a map frames nothing for it.

**Not decided here:** Later slices of #2122 take up what this ADR leaves standing. One gives a
dispersed whole no stored coordinate at all: `location` nullable, no anchor written by the run, a
curator's location edit refused (migration 244). That slice would reach ADR-0095 decisions 1 and 2
again, and records its own decision. Another computes a place's regions from its geometry.

## References

- Related ADRs: ADR-0028 (a reader is positioned by places), ADR-0095 (the anchor), ADR-0145 (an
  edition's casts), ADR-0203 (a place made of parts)
- Related docs: `docs/tech/experiences.md` § Location model (where a reader is told an object is)
  and § Serial nominations, `docs/tech/geometry-columns.md` § How a crossing region is told from a global one
- Issues: #2122, Epic #2115
