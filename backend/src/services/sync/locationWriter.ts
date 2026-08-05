/**
 * Writing an experience's locations without destroying anything hanging off them.
 *
 * The obvious implementation — delete every location for the experience and
 * insert the incoming ones — is what the sync used to do, and it is why a full
 * region re-assignment was needed after every run.
 * `experience_location_regions.location_id` is `ON DELETE CASCADE`, so deleting
 * a location silently takes its region assignments with it, `manual` ones
 * included. The recompute afterwards was not placing new objects; it was
 * rebuilding what the run had just destroyed. Measured on the live database
 * after one acceptance round: 6647 of 6677 location rows had been re-created
 * that day.
 *
 * So a location that has not moved must keep its row, and therefore its id.
 *
 * **And a location the source stopped offering keeps its row too.** The same
 * cascade runs from `user_visited_locations.location_id`, so deleting the row
 * of a withdrawn point takes a person's record of having stood there — a fact
 * no later run can put back, unlike anything else here. Instead the row is
 * marked: `missing_since` records when a run first offered the experience
 * without it, `ordinal` goes to NULL because it has no place in a list it is
 * no longer in, and every reader-facing query passes it over. A source that
 * offers the point again finds the same row and gives it its place back.
 *
 * That is a machine observation, not a verdict — the same split
 * `experiences.missing_since` already makes. Whether the point is gone or the
 * source merely blinked is a question for a curator, and until it is answered
 * nothing about the row is irreversible.
 *
 * **Identity is the point together with the reference.** Neither alone works,
 * and the data says so in both directions:
 *
 * - the reference alone is not unique — UNESCO's reference names a *component*,
 *   and a component crossing a border is listed once per country, so
 *   `749ter-001` appears three times on W-Arly-Pendjari with three distinct
 *   points; eight experiences are like that;
 * - the point alone is not unique either — the source repeats a coordinate
 *   across distinct components. Checked against UNESCO's own API rather than
 *   assumed: site 874 offers 758 components at 546 distinct points, 97 of them
 *   shared, and the worst is one coordinate given to seventeen separately named
 *   and separately referenced rock shelters. It is not a rounding artefact —
 *   the published values carry ten decimals and are identical. Treating those
 *   as one row would discard 336 named components across the catalogue.
 *
 * The pair is unique across all 6677 stored rows, with no collisions. The
 * remaining candidate, the `(experience_id, ordinal)` unique key, is positional:
 * if the source reorders `components_list`, ordinal 3 becomes a different place
 * and keeping its assignment would be worse than rebuilding it.
 *
 * For the region assignment this is the right question either way: a component
 * that kept its point kept its region, and one that moved has to be recomputed
 * whatever it is called. Keying on the pair only adds that a *renumbered*
 * component is treated as new — which errs towards recomputing, the safe side.
 *
 * Every comparison happens in PostGIS rather than on JavaScript numbers.
 * Round-tripping a coordinate through a JS float to compare it risks calling an
 * unmoved point moved, which would throw away a good assignment for nothing.
 */

import { pool } from '../../db/index.js';

export interface IncomingLocation {
  name: string | null;
  externalRef: string | null;
  lon: number;
  lat: number;
}

/** Which rows the write touched, so assignment can be limited to them. */
export interface LocationWriteResult {
  /** Rows that already held this point. Their assignments are still valid. */
  unchanged: number[];
  /** Rows inserted, moved, or offered again. These need region assignment. */
  needsAssignment: number[];
  /** How many stored points this run was the first to find missing. */
  unoffered: number;
}

/**
 * Build the incoming list as a relation the query can join against.
 *
 * `$1` is always the experience id; each location contributes four parameters
 * after it. The empty case still has to produce a well-typed relation, because
 * the queries below join against it either way — and an untyped `NULL` column
 * would leave Postgres unable to infer the join's types.
 */
function incomingCte(count: number): string {
  if (count === 0) {
    return `incoming(ordinal, external_ref, name, lon, lat) AS (
              SELECT NULL::int, NULL::text, NULL::text, NULL::float8, NULL::float8
              WHERE FALSE)`;
  }
  const rows = Array.from({ length: count }, (_, i) => {
    const b = i * 4 + 2;
    return `(${i + 1}, $${b}::text, $${b + 1}::text, $${b + 2}::float8, $${b + 3}::float8)`;
  });
  return `incoming(ordinal, external_ref, name, lon, lat) AS (VALUES ${rows.join(', ')})`;
}

/**
 * Drop repeats of the same (point, reference) pair, keeping the first.
 *
 * Two entries with the same point *and* the same reference carry no information
 * to tell them apart, so collapsing them is the only reading available. That is
 * a different case from the shared coordinates above: those components differ
 * by reference and stay separate rows.
 *
 * It matters because a repeated pair would make the join below many-to-many —
 * both stored rows could take the same incoming ordinal, and the write would die
 * on the `(experience_id, ordinal)` unique key, rolling that experience back on
 * every subsequent sync. Deduping here keeps every claim in this file true at
 * once: the CTE is one row per identity, the UPDATE matches at most one entry
 * per stored row, and the fast path compares two counts that mean the same
 * thing.
 */
export function dedupeByIdentity(incoming: IncomingLocation[]): IncomingLocation[] {
  const seen = new Set<string>();
  return incoming.filter(loc => {
    // JSON rather than a joined string: `null` and `''` are different
    // references to `IS NOT DISTINCT FROM`, and a key that flattened them would
    // drop one of a pair the SQL then treats as two — the mark would take the
    // survivor's stored row and hide a point the source still offers.
    const key = JSON.stringify([loc.lon, loc.lat, loc.externalRef]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bindParams(experienceId: number, incoming: IncomingLocation[]): unknown[] {
  const params: unknown[] = [experienceId];
  for (const loc of incoming) params.push(loc.externalRef, loc.name, loc.lon, loc.lat);
  return params;
}

/**
 * Make `experience_locations` for one experience match `incoming`, keeping the
 * row — and the id — of every point that is still offered.
 *
 * Returns the ids that need region assignment, which is empty in the common
 * case where nothing about the object's geometry changed.
 */
export async function writeExperienceLocations(
  experienceId: number,
  offered: IncomingLocation[],
): Promise<LocationWriteResult> {
  const incoming = dedupeByIdentity(offered);
  const cte = incomingCte(incoming.length);
  const params = bindParams(experienceId, incoming);

  // Fast path, and the reason this is cheap to call on every object of every
  // run: ask in one round trip whether the stored rows already say exactly
  // this. Most objects in most runs are unchanged — 1235 of 1272 UNESCO rows
  // in the acceptance round — and those must cost no writes at all, or the
  // churn this function exists to remove comes back in another form.
  //
  // All three subqueries ask about the *offered* rows only. Counting marked
  // ones as stored would fail this comparison on every later run for any
  // experience that ever lost a point, which is the slow path forever over an
  // object nothing is changing.
  const same = await pool.query(
    `WITH ${cte}
     SELECT (SELECT count(*) FROM experience_locations
               WHERE experience_id = $1 AND missing_since IS NULL) AS stored,
            (SELECT count(*) FROM incoming i
               JOIN experience_locations el
                 ON el.experience_id = $1
                AND el.missing_since IS NULL
                AND el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
                AND el.external_ref IS NOT DISTINCT FROM i.external_ref
                AND el.ordinal = i.ordinal
                AND el.name IS NOT DISTINCT FROM i.name) AS matched,
            (SELECT array_agg(id) FROM experience_locations
               WHERE experience_id = $1 AND missing_since IS NULL) AS ids`,
    params,
  );
  const { stored, matched, ids } = same.rows[0] as
    { stored: string; matched: string; ids: number[] | null };

  if (Number(stored) === incoming.length && Number(matched) === incoming.length) {
    return { unchanged: ids ?? [], needsAssignment: [], unoffered: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Rows the source no longer offers. Marked, not deleted: the row is what a
    // person's visit record points at. `missing_since IS NULL` restricts this
    // to points going missing *now* — a row unoffered for the fifth run running
    // was first observed missing once, and rewriting it every run would churn
    // the table to say nothing new.
    const marked = await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = NULL, missing_since = NOW()
       WHERE el.experience_id = $1
         AND el.missing_since IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM incoming i
           WHERE el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
         )`,
      params,
    );

    // `ordinal` is unique per experience, so renumbering in place would collide
    // with a row that has not been renumbered yet. Park the survivors on the
    // negative side first — only reached when the set really changed, since the
    // fast path returned otherwise. Marked rows sit at NULL and are already out
    // of the way.
    await client.query(
      `UPDATE experience_locations SET ordinal = -ordinal
       WHERE experience_id = $1 AND ordinal > 0`,
      [experienceId],
    );

    // Survivors keep their id. At most one incoming entry can match, since the
    // incoming list is deduped by identity above.
    //
    // Runs *before* the arm below, and the order is what keeps the two over
    // disjoint sets: that one clears `missing_since`, so a row it had already
    // resurrected would satisfy this predicate too and be reported as both
    // unchanged and needing assignment.
    const kept = await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = i.ordinal, external_ref = i.external_ref, name = i.name
       FROM incoming i
       WHERE el.experience_id = $1
         AND el.missing_since IS NULL
         AND el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
       RETURNING el.id`,
      params,
    );

    // A point the source is offering again. Same row, same id, so the visit
    // record and any manual region assignment on it are still the right ones —
    // but its *auto* assignments were dropped while it was missing, so it goes
    // back for placement rather than being reported as unchanged.
    const returned = await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = i.ordinal, external_ref = i.external_ref, name = i.name,
           missing_since = NULL
       FROM incoming i
       WHERE el.experience_id = $1
         AND el.missing_since IS NOT NULL
         AND el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
       RETURNING el.id`,
      params,
    );

    // Deliberately no `missing_since` predicate in this NOT EXISTS: it asks
    // whether the row exists at all, and a point that just came back was
    // resurrected two statements ago. Restricting it to offered rows would let
    // that row be inserted a second time — two rows for one place, and the
    // visit record pointing at whichever of them the reader is not shown.
    const inserted = await client.query(
      `WITH ${cte}
       INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location)
       SELECT $1, i.name, i.external_ref, i.ordinal,
              ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
       FROM incoming i
       WHERE NOT EXISTS (
         SELECT 1 FROM experience_locations el
         WHERE el.experience_id = $1
           AND el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
       )
       RETURNING id`,
      params,
    );

    await client.query('COMMIT');

    return {
      unchanged: kept.rows.map(r => r.id as number),
      needsAssignment: [
        ...inserted.rows.map(r => r.id as number),
        ...returned.rows.map(r => r.id as number),
      ],
      unoffered: marked.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
