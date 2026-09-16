# ADR-0061: The catalogue's world map is a read of the API, not a tile source

**Date:** 2026-09-16
**Status:** Accepted

---

## Context

The map is empty until a region is chosen. Markers and the density heatmap are
built from a region's own read, so a visitor arriving at a world view sees
boundaries and nothing in them, and the places that belong to no region are on
no map at all. #910 asks for the catalogue itself to be drawn — a kind's places
across the whole world, before a region is named.

The read is of **places, not objects**. A serial World Heritage site is one row
and hundreds of places: Rock Art of the Mediterranean Basin is one site and 734
rock shelters. `GET /api/experiences` answers objects and caps a page at 1 000
of them, so it cannot draw this map. The development catalogue holds 8 830
reader-visible places across 3 755 objects.

Two things constrain how they are delivered.

**The catalogue changes under a curator's hands.** Publishing an arrival,
marking a place lost, refusing a point — each changes what this map should draw,
and the product's whole curation loop is people doing exactly that.

**The first screen is already the slowest thing the product draws.** The map
root's Lighthouse budgets are total-blocking-time ≤ 1 200 ms and
time-to-interactive ≤ 3 500 ms, and `main` measured 1 351 ms / 3 427 ms on the
run this decision was taken from. That figure is dated on purpose, because this
lane's numbers are comparable only within a sitting: `docs/tech/performance.md`
measures the same page on `main` at 1 683 ms on 2026-09-09 and 2 188 ms on
2026-09-16. What the number is doing here is saying the budget was already
breached before this layer existed — not standing as the page's cost.

The repository already runs a Martin vector tile server for region and division
geometry, which made a tile source the obvious first answer.

## Decision

The world layer reads a new endpoint, `GET /api/experiences/points`, and draws
a GeoJSON source from it. It is not served as a Martin tile source.

The endpoint answers **two tiers** — coordinates alone below the marker band,
and a pin's identity, name, kind and type at and above it — in a **columnar**
body (one array per field), and folds server-side when asked, so a folded read
answers one point per object rather than every point plus a flag.

## Alternatives Considered

A Martin tile source was not a paper alternative: it was built, reviewed and
measured first, as `tile_experience_points` on PR #916, which stays open as a
draft with the measurements in it.

| Option | Why rejected |
|--------|-------------|
| **Martin tile source** (`tile_experience_points`) | **Cannot go stale honestly.** Martin holds an in-process tile cache keyed on the URL and sends no cache headers. Measured: a place marked `lost` changed the function's answer to 1 336 bytes while Martin kept serving the old 1 366 for every request over ten seconds, and only a restart changed it. Nothing in the product could invalidate it — `invalidateTileCache()` bumps a URL parameter and was called on one view switch. Second cost: the four reader-facing guards had to be written again in SQL, a second runtime for a rule that already had one in TypeScript. |
| **GeoJSON `FeatureCollection` on the wire** | 267 kB brotli for the whole catalogue against 125 kB for the same values as arrays: every feature repeats its own keys 8 830 times. The collection is still what MapLibre is handed, built once per read in the client. |
| **One tier carrying every property** | 267 kB on the first screen for names no reader below the marker band can see. The tiered read is 37 kB there (18 kB folded). |
| **A page of `GET /api/experiences`** | Answers objects, caps at 1 000 rows, and carries a card's worth of columns per row. A serial site would be one pin. |
| **Fold as a client-side filter, as the tile did** | A tile is cached under its URL and must therefore carry both states. An endpoint is asked for the state being drawn: the folded World Heritage map is 1 272 points fetched rather than 6 347 fetched and 5 075 filtered away. |

## Consequences

**Positive:**

- **A curator's verdict shows up in the next request.** One
  `invalidateQueries({ queryKey: ['world-points'] })` in `invalidateExperiences`
  reaches every kind, tier, fold and box, because none of them is in what a
  verdict names. Measured on live rows: marking a place lost, withdrawing a
  point, refusing a membership — each took the place off the map immediately,
  and each restore put it back, with no restart and no cache-busting parameter.
- **One runtime for the reader's guards.** The four questions of
  `experienceLifecycle.ts` are composed from the same fragments every other
  reader-facing read composes them from, rather than spelled again in PL/pgSQL.
- **A malformed parameter is a 400, not a 500.** Zod validates the query, which
  is what the tile function had to do by catching
  `invalid_text_representation` and `numeric_value_out_of_range` by hand — the
  gap #918 reports for the five older tile sources. `?kindId=99999999999` was
  measured answering 500 with the database's own message before the schema
  bounded it to int4.
- **The viewport read is smaller than the tile it replaces**: 33 kB brotli for a
  central-European box at marker zoom against the 66 kB vector tile covering the
  same extent. Per-feature framing is most of a tile's weight once names travel.
- **Panning below the marker band costs nothing.** The overview read is the
  whole world at every position, so it is one cache entry; only crossing into
  the marker band asks a second question.

**Negative / Trade-offs:**

- **The first screen carries 37 kB where four z1 tiles carried 28 kB** — unless
  the fold is on, where it carries 18 kB and is the cheaper of the two. The
  payload is not what the budget is failing on (see below), but the extra bytes
  are real.
- **The drawing cost is unchanged by this decision, whatever it turns out to
  be.** The layer was measured adding blocking time to the first screen through
  a tile source and through this endpoint alike, and two candidate causes were
  ruled out by measurement: the parse and hand-off to MapLibre's worker, and the
  number of points. What is left is the heatmap, and **how much of it is the
  viewport-sized framebuffer is a hypothesis rather than a measurement** — one
  part of it was measured and removed after this ADR was written (layers mounted
  over an empty source, 158 ms on CI's runner), which is itself the reason not to
  state the rest as established. #915 owns the question, and
  `docs/tech/performance.md` carries every figure with the build and the machine
  it came from. What this decision rests on is only the part that is not in
  doubt: the cost follows the layer rather than the transport, so choosing the
  endpoint neither causes it nor cures it.
- **No CDN story.** A tile source is trivially cacheable at the edge and this is
  not; the endpoint answers from the database on every cold read, at 36–90 ms
  measured. That is the price of the freshness this ADR is choosing.
- **The client builds the FeatureCollection.** 8 830 features per overview read,
  on the main thread, where MapLibre parsed a tile in a worker.
- **A folded pin can fall outside the box that was asked for**, because the
  nearest place of a matched object may lie in the next box. The same answer the
  list endpoint gives, and the map asks with a snapped, outward-rounded box.

## References

- Related ADRs: ADR-0025 (what a gated source's unread rows are), ADR-0028
  decision 2 (where a reader is told an object is), ADR-0042 (which region a
  click opens), ADR-0045 decision 4 (a place's membership in a kind)
- Related docs: `docs/tech/experience-map-ui.md` § The world layer,
  `docs/tech/performance.md`, `docs/tech/addresses.md`
- PR / issue: #910; the measured tile alternative is PR #916 (draft); the
  heatmap's cost on the first screen is #915; tile sources answering a
  malformed parameter with a 500 is #918
