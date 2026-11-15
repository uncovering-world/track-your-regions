# ADR-0211: A nested whole is shown and placed by its leaves

**Date:** 2026-11-15
**Status:** Accepted

---

## Context

A place made of parts shows its own points and its direct parts' points (ADR-0100 decision 2,
ADR-0197 decision 2). That is the rule behind its pins, its card's list of places, its row's
count of places, a traveller's ticks on its card and the regions it is listed in. Its "k of N"
reads differently: N counts its offered leaves, the places at the bottom of its parts at any
depth (`whole_leaves`, ADR-0206 decision 2).

The two agree for a whole none of whose parts is a whole, and on the development catalogue
(2026-11-15) no part is one. A curator's word can make one (`partRecordController.ts`, up to four
levels), and #2126 will. Take Fujisan once a curator nests the eight Oshino Hakkai ponds under an
Oshino Hakkai of their own. Fujisan's count reads "k of 25" over the ponds and the other places,
while its map, its card and its regions use Oshino Hakkai's own point, where Oshino Hakkai is a
container that keeps one (ADR-0210). A dispersed whole holds no point at all, and then they use
nothing. Three defects follow:

- **Fujisan is not listed** where only a pond stands. The pond is two levels down, and a change to
  its point refreshed its direct whole only.
- **Fujisan's row keeps a checkbox.** Its row asks whether a direct part has a point (`has_parts`,
  `showsPartsSql`), which Oshino Hakkai does not. After a visit to a pond the box renders checked,
  because the state is counted at any depth. A click then sends an untick that removes nothing
  (#2121, found in #2547).
- **A shared pin opens the wrong place** (#2534). The region map draws one pin for a point two
  listed places show, and it opens the place without parts. Once Oshino Hakkai is a whole with a
  point of its own, Oshino Hakkai and Fujisan both have parts. The pin then opens whichever row
  came first, which can be Fujisan's.

## Decision

1. **A whole shows its own points and its leaves' points**, never a direct part that is a whole
   itself. The readers' arms (`PLACE_POINT_ARMS`, `pointsShownSql`, `somePointShownSql` in
   `backend/src/db/placePoints.ts`) and the regions' statement (`place_shown_points()`) read
   `whole_leaves` where they read `experience_parts`. A nested whole's own point is shown by that
   whole alone, as its count counts only its leaves. For a whole none of whose parts is a whole,
   its leaves are its direct parts, so nothing changes there.
2. **A whole is placed by its leaves.** `place_regions_reach()` walks up to every whole above a
   change (`place_ancestors()`) where it walked one level. A pond's point published, moved or
   withdrawn then rewrites Fujisan's regions in the same statement. The keys it takes are the ones
   `refresh_whole_leaves()` takes for the same change, and the leaf triggers fire first. So the
   region refresh reads the leaves as the statement left them, and it takes no key out of order.
3. **A whole's row is shown by its places when it has an offered leaf.** `has_parts` reads
   `whole_leaves` (`showsPartsSql`). A whole whose places all sit inside a whole nested in it
   shows its state and no checkbox.
4. **A point says whose it is.** Both reads of a place's points carry `own_point: true` where the
   listed place owns the point, and no key where it shows the point for a leaf: on Europe's 5,070
   points a key on every row added 89 kB of JSON to a hot read. The region map opens a
   shared pin on the row that owns it. Where no row owns it (a pond of no kind, listed under
   Fujisan and under Oshino Hakkai) the pin opens the row drawn first. The world points read
   already told its arms apart (`onePerPoint`).
5. **A place's parts stay what a site's run and a curator's write find the site's lines on.**
   `madeOfSql` holds the place, its direct parts and its leaves. A part that is a whole holds its
   line as its own point, which no reader shows on the site, and a run that could not find it
   would write it again.

This narrows ADR-0100 decision 2 and ADR-0197 decisions 2 and 3: a whole's pins, places and
regions are its leaves'. It also settles the trade-off ADR-0206 left open, under which a writer
holding a place's region keys locked only its direct wholes: `lock_place_regions()` now takes the
keys of every whole above.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Show every place below a whole: its leaves and every nested whole's own point | The map would show a point the count does not count. Fujisan would draw 26 pins under "k of 25", and Oshino Hakkai's own point would be listed twice on Fujisan's card, once for itself and once beside its own ponds. |
| Walk the part relations on every read | ADR-0206 measured a walk inline over Europe's list at 32.8 ms. The leaf table is one index probe per row, and the region list already reads it for the count. |
| Keep the region refresh one level up, and have the leaf refresh call it for the wholes further up | One refresh would call the other, which ADR-0206 decision 4 keeps apart. The keys would be taken twice, in two orders. |
| Tell a shared pin's owner by `has_parts` alone, as before | Once a part is a whole itself, both rows have parts and nothing tells them apart (#2534). |
| Read the run's lines through the leaves too | A run looks for a component's line on the part that holds it. A nested part would hide its line, and the run would add it again. |

## Consequences

**Positive:**
- A whole's pins, card, row, regions and count all read the same places, at any depth.
- Fujisan is listed wherever one of its ponds stands. Its row shows its state, and a pin at
  Oshino Hakkai's own point opens Oshino Hakkai.

**Negative / Trade-offs:**
- A refresh walks up through every ancestor of the places it is given, where it read one level.
  That is one recursive walk over `experience_parts` by `part_id`, eight levels at most. With no
  nesting today, the keys and rows it takes are the ones it took before.
- The run's readers of a site's lines that go through the arms, the component item finder and the
  World Heritage reading, see a nested part's leaves rather than its own line. No component is a
  whole on the development catalogue.
- Read through `whole_leaves`, the world overview's two arms were planned as a Parallel Append,
  two workers started per request. Through a client that took 57.3 ms against main's 34.0 ms
  (p50 on the development catalogue, 2026-11-15), though EXPLAIN ANALYZE showed a few
  milliseconds. Each arm now carries the read's own row cap, and Postgres runs no subquery with a
  LIMIT in a worker: 35.9 ms against 34.0. The answer is the same set of points as main's, in
  another order.
- `own_point` costs the locations batch 30,923 bytes of JSON on Europe's 5,077 points (1,819 of
  them a place's own), and 356 under brotli as the last key of a point, against 2,704 when it sat
  before `image_url` and broke the runs the rows repeat (2026-11-15). Sent as `false` on every row
  it would add about 58 kB of JSON. Served the same way, a fresh restart each side, the batch took
  211 against 214–218 ms through the endpoint, within what the box's mixed cores move one
  comparison by.

## References

- Related ADRs: ADR-0100, ADR-0197, ADR-0205, ADR-0206, ADR-0207, ADR-0210
- Related docs: `docs/tech/experiences.md` § Location model, `docs/tech/geometry-columns.md`
- Issues: #2121, #2534 (Epic #2115)
