# ADR-0206: One visited place visits the whole, which reads "k of N" over its offered leaves

**Date:** 2026-11-15
**Status:** Accepted — decisions 2 and 3 narrowed by [ADR-0218](0218-a-record-states-its-shape-and-its-pin-is-derived-from-what-it-holds.md): a leaf that has no point is offered by its record in its whole, and a part with a shape of its own and parts of its own counts as one place of the whole above it; decision 7 narrowed by [ADR-0219](0219-a-visit-is-one-row-on-what-the-traveller-met-and-a-tick-on-a-region-moves-or-asks-when-the-region-goes.md): a region is painted from a visit's own point, and a whole shown visited still paints none; decision 4 narrowed by [ADR-0225](0225-the-catalogue-has-one-model-of-records-sources-time-relations-works-regions-and-visits.md): the triggers are on `experience_parts` and `source_records`

---

## Context

A place made of parts reads a visit through its parts (ADR-0199 decision 2): it reads *Partly
visited* until every point it shows is visited, and a tick on the whole itself ("Visited, not sure
which part") reads partly visited too. Nothing on screen says how far along the traveller is. The
counts that are shown count something else:

- A list row in Map mode reads the points in the region over the points of the place: the Struve
  Geodetic Arc reads "1/34" in Moldova's list, a count of the stations that stand in Moldova.
- A card in Discover reads the place's `location_count`, every point it shows: "34" for the Arc,
  2 for a part holding two points (ten parts on the development catalogue do, all duplicates such
  as the Cave of Altamira's).
- The open card counts its own point rows ("k/N Visited").

The rule was decided on the issue (#2121, 2026-10-28; Epic #2115 § What a visit means): one
visited part makes the whole visited, and the row shows "k of N" beside it, everywhere the whole
is listed. Every nested whole keeps its own count: Fujisan reads "1 of 25" while Oshino Hakkai
inside it reads "1 of 8". A direct tick reads "? of N". A whole with no place a reader is shown
(Wudang's 45 parts all wait for a curator) shows no count. A whole shown visited never marks a
region visited.

On the development catalogue (2026-11-15) there are 482 wholes and 5,620 part relations, none
nested, no part in two wholes. The biggest whole, the Rock Art of the Mediterranean Basin, has 758
parts. A region list of Europe with its children holds 5,226 places, 177 of them wholes, and is
read on every visit to the map. The parts of a whole are derived from source records
(`parts_follow_records()`), which have no loop guard of their own; a curator's word refuses a loop
and a chain deeper than four levels.

## Decision

1. **A visit to any place below a whole makes the whole visited**, at every level of nesting.
2. **The count is "k of N" over the whole's offered leaves.** A leaf is a place reached down the
   part relations, at any depth, that has no parts of its own: a place, not a point, so a part
   holding two points counts once, and a whole's own point is not a leaf. A place reached twice
   (a pond named a part of Fujisan and of Oshino Hakkai inside it) is one leaf. A leaf is offered
   when a reader is shown one of its points, by the same terms a region places a place by
   (ADR-0197 decision 2). Every nested whole keeps its own count.
3. **The count is "?" when the whole is visited and no offered leaf is**: a direct tick, a tick on
   a nested whole, or a visit to a leaf since withdrawn. A whole with no offered leaf shows no
   count, and a whole of one offered leaf shows its plain state.
4. **The leaves are derived into `whole_leaves` by a refresh of their own.**
   `refresh_whole_leaves(places)` rewrites the rows of the given places and of every whole above
   them (`place_ancestors()`) as `whole_leaves_expected()` makes them, writing only what differs.
   Statement-level triggers on `experience_parts` and `experience_locations` call it: a part
   relation made, moved or taken away; a point added, deleted, moved to another place, or changing
   the state that decides whether a reader is shown it. The walk up and down carries its path and
   stops at eight levels, so a loop of records ends. It takes the region keys
   `lock_place_regions()` takes (ADR-0197), for every place it rewrites, in key order, before it
   computes, and its triggers fire before the region triggers on the same tables, so the region
   refresh after it takes no key out of order. It is not part of `refresh_place_regions()`, which
   neither calls it nor is called by it. A catalogue check, `whole-leaves-out-of-step`, compares
   the rows with what the function makes.
5. **One count everywhere**: global, the same in every region's list the whole is in, from one
   read.
6. **An edition shows no count** (ADR-0145 decision 5), and neither does a whole of casts once
   #2126 makes one: every cast is the work.
7. **Region visits stay the traveller's.** A whole shown visited marks no region visited.
8. **A writer that locks several places locks a whole before its parts.** The order is one sort
   key (`placeLockOrderSql`, `db/locks.ts`): the fewer wholes a place stands under, at any depth,
   the earlier, then the lower id. A whole stands under fewer wholes than its parts, so it comes
   first whatever their ids; a part adopted as a component or nested by a curator often has the
   lower id. A site's run, which writes its points and then its parts' rows, takes its parts'
   locks and then the region keys of the site, its parts and every whole above them before its
   first point write (`lockPartsAndRegionKeys`): decision 4's trigger on a point added takes the
   site's key, and a curator holding a part and writing its point asks for it. A merge, its undo,
   a merge proposal's answer, a curator's word on a part and missing detection's marks take their
   places in the same order. "A whole first, otherwise the lower id" would not do: across three
   places it can order them in a circle.

Once accepted, this narrows ADR-0145 decision 5 (an edition and a serial site no longer differ in
state, only in the count), ADR-0199 decisions 2, 3, 5 and 6 (partly visited is retired, and with it
the visit read's `partialIds`; a whole is visited when any place below it is, so the belfries
read visited through a work seen in Antwerp Cathedral), ADR-0100 decision 5 further, and ADR-0086 decision 6 (two
places are locked in that order rather than by id, decision 8). ADR-0197 is unchanged by
decision 4: the region refresh still walks up one level and places a whole by its direct parts'
points; what a nested whole shows and where it is placed are a later change.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Count the leaves on every read | The region list would walk every whole's parts per row and per request: 177 wholes in Europe's list, each up to 758 parts deep, on the hottest read. A walk inline measured 32.8 ms over Europe's rows; the table makes it one index probe per row. |
| Write the leaves inside `refresh_place_regions()` | One refresh would own two tables whose inputs are the same, and the region refresh's body is being rewritten for geometry (#2122); two changes would meet in one function. Its own function, on the same keys and the same inputs, keeps the two apart with the same guarantees. |
| Widen the region refresh's reach to every ancestor, so its lock covers the leaves | Every region refresh would recompute wholes whose regions do not change (a grand-whole is placed by its direct parts), and the walk up is ADR-0197's to change when a nested whole is placed by its leaves. The leaf refresh takes the extra keys itself. |
| Row triggers that cascade up the part-of chain | Recursion through triggers, once per row: a statement writing a site's 758 parts would refresh the site 758 times. |
| Count points rather than places | A part holding two points would count twice, and the count would not survive the point tables going (#2124). |
| Count the whole's own point as a leaf | A tick on it is a direct tick (ADR-0199 decision 5); #2122 turns the 16 wholes with a line of their own into parts, and N then counts them. |

## Consequences

**Positive:**
- A whole's "k of N" is one indexed read per row, the same in every region.
- A nested whole keeps its own count without any reader walking the hierarchy.
- The table is keyed by place, so it outlives the point tables (#2124); what "offered" means for
  a leaf is one expression to change when a part is gated by its source record (#2123).

**Negative / Trade-offs:**
- The rule that a point is shown to a reader is stated a third time, in
  `whole_leaves_expected()`. `placeRegionsSchema.test.ts` holds it to `offeredLocationSql` and
  `publishedContentSql`, as it holds `place_shown_points()`.
- A part relation written one record at a time, as a source run writes them, refreshes its whole
  once per record: a run creating a site of 758 parts walks it 758 times, as the region refresh
  already does.
- With nesting, a writer that took a place's region keys before writing it holds the place and
  its direct wholes; the leaf trigger then adds the wholes further up, possibly out of key order.
  Two such transactions meeting in a cycle are broken by Postgres aborting one, as
  `lock_place_regions()` already accepts for a key a wait added. No whole is nested today.

**Amended in its accepting pull request (#2547):** the list of what this narrows names ADR-0199
decisions 3 and 6 beside 2 and 5. Decision 3 named `partialIds`, which the flip removes, and
decision 6 said the belfries read partly visited through a work seen in one of them.

## References

- Related ADRs: ADR-0086, ADR-0100, ADR-0145, ADR-0197, ADR-0199, ADR-0202
- Related docs: `docs/tech/experiences.md` § Location model, `docs/tech/data-assertions.md`
- Issue: #2121 (Epic #2115)
