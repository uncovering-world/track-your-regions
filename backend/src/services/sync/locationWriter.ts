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
 *
 * **A point that moved is a withdrawal plus an insert, and under a gated source
 * the two halves become visible at different moments.** The insert lands
 * `pending`, so applying the withdrawal in the same run takes the old pin off the
 * map while the new one is invisible — and 1119 of the catalogue's 1604
 * experiences hold exactly one point (measured 2026-08-11: 788 of 1272 UNESCO
 * sites, all 128 museums, 203 of 204 landmarks), so for most of them that is an
 * object still in every list with nothing on the map. So the arrival records
 * which point it replaces, in `withdrawal_deferred_for_location_id`, and the
 * withdrawal waits for the publish that makes the arrival visible
 * (`publishController.ts`, ADR-0025 decision 5).
 *
 * **The pairing has to be created here, because nothing else in the run knows
 * it.** This function returns aggregates — a `rowCount` and a flat id list — and
 * the withdrawal `UPDATE` does not report the ids it marked, so no caller could
 * reconstruct "old point X moved to new point Y" afterwards. The definition
 * available is the reference: `external_ref` is populated on 6679 of 6680 stored
 * locations, and a move is *the same reference at a different point*. For museums
 * and landmarks it is the experience's own Wikidata id, so it cannot change while
 * the experience stays the same; for UNESCO it names a component.
 *
 * Three shapes make the reference an imperfect key, and all three hold rather
 * than apply, because the mistakes are not the same size: holding too long leaves
 * a pin the source dropped, applying too early leaves an object with no pin at
 * all while it is still in every list.
 *
 * - Nine `(experience_id, external_ref)` pairs are duplicated, across nine
 *   objects — a component crossing a border is listed once per country under one
 *   reference. Withdrawals and arrivals are numbered within a reference and
 *   matched by position, so each arrival holds one withdrawal and no two arrivals
 *   claim the same one.
 * - One location carries no reference at all (8754, "Routes of Santiago de
 *   Compostela in France"), and it is that experience's only point — so the match
 *   is `IS NOT DISTINCT FROM` rather than `=`. Under `=` that site's withdrawal
 *   would apply at once and leave a World Heritage site with nothing on the map.
 * - A renumbered component changes the reference itself, so no match by reference
 *   is possible at all — and 787 of the 788 single-point UNESCO sites carry one.
 *   Whatever the references cannot pair is therefore paired by position.
 *
 * That makes the promise a count rather than a hope. Exactly
 * min(withdrawals, arrivals) withdrawals are held, so the points a reader can see
 * after a run are min(what they could see before, what the source now offers) —
 * and therefore **never zero while the source still offers a point**. Stated that
 * way rather than as "never below the source's list", which is not what happens:
 * an arrival is gated, so a run that adds more points than it drops leaves the
 * visible count below the new list, on purpose, until a curator answers.
 *
 * A withdrawal with no arrival left to hold it is applied at once, exactly as
 * before. So is one whose arrival the source withdrew in turn — that arrival can
 * never be published, since the publish statement carries `missing_since IS
 * NULL`, so a pairing left standing on it would hold the old point visible for
 * ever. That one takes a further run to notice, because the arrival still looks
 * offered while the statement withdrawing it is deciding what to pass over.
 */

import { pool } from '../../db/index.js';
import { retirePassAfterNewContent } from './curationDecay.js';

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

    // `ordinal` is unique per experience, so renumbering in place would collide
    // with a row that has not been renumbered yet. Park every positive ordinal on
    // the negative side first — only reached when the set really changed, since
    // the fast path returned otherwise.
    //
    // Rows the source has stopped offering are parked too, and their ordinals go
    // to NULL at the end of the transaction rather than at the start. That order
    // is what lets the withdrawal read the pairing: the column lives on the
    // arrival, so nothing can be paired until the insert has run.
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
       INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, curation_state)
       SELECT $1, i.name, i.external_ref, i.ordinal,
              ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326),
              -- A pending point is written, indexed and placed into regions like
              -- any other, and no reader-facing read may offer it (ADR-0025):
              -- keeping it off those reads is one predicate's job rather than a
              -- reason to withhold the row. Withholding it would leave a region
              -- curator nothing to review for an arrival.
              --
              -- Read from the experience rather than passed in: this writer has
              -- an experience id and no category id, and a parameter would be a
              -- second source of truth that could disagree with the column
              -- between the check and the write.
              CASE WHEN (SELECT c.requires_curation
                           FROM experiences e JOIN experience_categories c ON c.id = e.category_id
                          WHERE e.id = $1)
                   THEN 'pending' ELSE 'auto' END
       FROM incoming i
       WHERE NOT EXISTS (
         SELECT 1 FROM experience_locations el
         WHERE el.experience_id = $1
           AND el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
       )
       RETURNING id, curation_state`,
      params,
    );

    // Each arrival a reader cannot see yet names the point it replaces, so the
    // withdrawal below can wait for it. Asked only when there is such an arrival:
    // an ungated source writes every point `auto`, so this leaves the statement
    // list of an ungated run exactly as it was.
    //
    // The state comes back from the insert's own RETURNING rather than from a
    // second reading of `requires_curation`, so this cannot disagree with what
    // was written.
    const unreadArrivals = inserted.rows
      .filter(r => r.curation_state === 'pending')
      .map(r => r.id as number);
    if (unreadArrivals.length > 0) {
      await client.query(
        `WITH ${cte},
              -- Only points a reader can actually see. An unread one costs a
              -- reader nothing when it goes, so it is withdrawn at once rather
              -- than held — and letting it compete to *be* the held point builds a
              -- chain that nothing can take apart.
              --
              -- Traced end to end: a gated site shows P(r1); a run renumbers and
              -- moves it, so A1(r2) holds P; before anyone publishes, the next run
              -- moves it again, and A2(r2) matches A1 by reference while P is left
              -- over with no arrival — surviving only because A1 still names it.
              -- Publishing A2 withdraws A1 but leaves A1's own pairing standing,
              -- and A1 can never be published (the publish statement carries
              -- \`missing_since IS NULL\`), never revisited by the statements below
              -- (they take offered rows only), and never deleted (nothing in this
              -- backend deletes a location, so the foreign key's ON DELETE SET NULL
              -- never fires). P stays visible for ever beside A2: two pins on a
              -- one-point site, one of them a coordinate the source retired two
              -- runs ago, recoverable only by hand-written SQL.
              --
              -- With this predicate the chain cannot form: the arrival pairs with
              -- the visible row, and the invisible intermediate is withdrawn in the
              -- same run.
              withdrawn AS (
                SELECT el.id, el.external_ref
                FROM experience_locations el
                WHERE el.experience_id = $1
                  AND el.missing_since IS NULL
                  AND el.curation_state <> 'pending'
                  AND NOT EXISTS (
                    SELECT 1 FROM incoming i
                    WHERE el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
                    AND el.external_ref IS NOT DISTINCT FROM i.external_ref
                  )
              ),
              arrived AS (
                SELECT el.id, el.external_ref
                FROM experience_locations el
                WHERE el.id = ANY($${params.length + 1}::int[])
                  -- The rule, in the one place the database enforces it: only a
                  -- point a reader cannot see yet is worth waiting for. An
                  -- arrival a reader can already see replaces the old pin the
                  -- moment it lands, so holding the withdrawal would put the same
                  -- place on the map twice.
                  AND el.curation_state = 'pending'
              ),
              -- Numbered within the reference and matched by position, because
              -- nine (experience_id, external_ref) pairs are duplicated across
              -- nine objects. Without the numbers both withdrawn rows would pair
              -- to both arrivals, and each arrival can name only one point — so
              -- one of the two withdrawals would be applied on the strength of a
              -- row another arrival had already claimed.
              by_reference AS (
                SELECT w.id AS old_id, a.id AS new_id
                FROM (SELECT id, external_ref,
                             row_number() OVER (PARTITION BY external_ref ORDER BY id) AS rn
                        FROM withdrawn) w
                JOIN (SELECT id, external_ref,
                             row_number() OVER (PARTITION BY external_ref ORDER BY id) AS rn
                        FROM arrived) a
                  ON a.external_ref IS NOT DISTINCT FROM w.external_ref AND a.rn = w.rn
              ),
              -- Whatever the references could not pair, matched by position
              -- alone. This is where "hold rather than apply" is decided, and it
              -- is not a nicety: a source that renumbers a component writes a
              -- withdrawal and an insert whose references do not line up, and 787
              -- of the 788 single-point UNESCO sites carry a component reference.
              -- Under a gate, applying that withdrawal takes the site's only pin
              -- off the map while its replacement is invisible — and a renumber
              -- does not even have to move the point to do it.
              --
              -- What this buys is stated as a count, because that is the promise:
              -- exactly min(withdrawals, arrivals) withdrawals are held, so the
              -- points a reader sees after a run are min(what they saw before, what
              -- the source now offers) — never zero while the source still offers a
              -- point. Not "never below the source's list": an arrival is gated, so
              -- a run that adds more than it drops leaves the visible count below
              -- the new list on purpose. It costs holding a point the source really
              -- did drop until an unrelated arrival is published, which is the
              -- visible mistake rather than the invisible one.
              left_over AS (
                SELECT w.id AS old_id, a.id AS new_id
                FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM withdrawn
                       WHERE id NOT IN (SELECT old_id FROM by_reference)) w
                JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM arrived
                       WHERE id NOT IN (SELECT new_id FROM by_reference)) a
                  ON a.rn = w.rn
              )
         UPDATE experience_locations n
         SET withdrawal_deferred_for_location_id = m.old_id
         FROM (SELECT old_id, new_id FROM by_reference
               UNION ALL
               SELECT old_id, new_id FROM left_over) m
         WHERE n.id = m.new_id`,
        [...params, unreadArrivals],
      );
    }

    // A point the source is offering again is not being withdrawn, so nothing is
    // waiting for anything. Reachable where one reference covers two points — a
    // component listed once per country — and the source lists the replaced point
    // beside its replacement: `kept` above gives it its place back, no withdrawal
    // is left to hold, and a pairing standing from an earlier run would otherwise
    // hide a point the source offers the moment the arrival is published.
    await client.query(
      `WITH ${cte}
       UPDATE experience_locations n
       SET withdrawal_deferred_for_location_id = NULL
       FROM experience_locations old
       WHERE n.experience_id = $1
         AND old.experience_id = $1
         AND n.withdrawal_deferred_for_location_id = old.id
         AND EXISTS (
           SELECT 1 FROM incoming i
           WHERE old.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND old.external_ref IS NOT DISTINCT FROM i.external_ref
         )`,
      params,
    );

    // Rows the source no longer offers. Marked, not deleted: the row is what a
    // person's visit record points at. `missing_since IS NULL` restricts this
    // to points going missing *now* — a row unoffered for the fifth run running
    // was first observed missing once, and rewriting it every run would churn
    // the table to say nothing new.
    //
    // Passed over where an arrival is waiting on it. That is the half which makes
    // the pairing mean anything: without it the row would be paired and withdrawn
    // in the same transaction.
    //
    // The pairing on a row this *does* withdraw goes with it. Such a row was an
    // arrival in an earlier run, and the source has now dropped it before anyone
    // published it — so it can never be published (the publish statement carries
    // `missing_since IS NULL`) and a pairing left standing on it would hold the
    // point it named visible for ever, with nothing able to release it.
    const marked = await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = NULL, missing_since = NOW(),
           withdrawal_deferred_for_location_id = NULL
       WHERE el.experience_id = $1
         AND el.missing_since IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM incoming i
           WHERE el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
         )
         AND NOT EXISTS (
           SELECT 1 FROM experience_locations waiting
           WHERE waiting.experience_id = $1
           AND waiting.withdrawal_deferred_for_location_id = el.id
         )`,
      params,
    );

    // The other half of a held withdrawal: the point keeps its `missing_since`
    // NULL, so every reader still sees it, and loses its place in a list it is no
    // longer in.
    //
    // Not cosmetic. `ordinal` is unique per experience and every later run parks
    // the positives at their negatives before renumbering, so a held row left at
    // -3 collides with its replacement's 3 the moment anything else about the
    // object changes — and the whole write for that experience dies on the unique
    // key, on every run, until a curator answers. NULL is also what the column
    // already means for a row the source no longer lists.
    //
    // `el.ordinal IS NOT NULL` because a held row keeps failing the fast path
    // until it is answered, so every run reaches this statement; without the guard
    // each one would rewrite the row to the value it already holds.
    await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = NULL
       WHERE el.experience_id = $1
         AND el.missing_since IS NULL
         AND el.ordinal IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM incoming i
           WHERE el.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
           AND el.external_ref IS NOT DISTINCT FROM i.external_ref
         )
         AND EXISTS (
           SELECT 1 FROM experience_locations waiting
           WHERE waiting.experience_id = $1
           AND waiting.withdrawal_deferred_for_location_id = el.id
         )`,
      params,
    );

    // A point the curator has never seen is content their pass did not cover,
    // so the venue stops claiming to have been passed. In the same transaction
    // as the insert that caused it: the two are one fact about the object.
    if (inserted.rows.length > 0) await retirePassAfterNewContent(client, experienceId);

    await client.query('COMMIT');

    return {
      unchanged: kept.rows.map(r => r.id as number),
      needsAssignment: [
        ...inserted.rows.map(r => r.id as number),
        ...returned.rows.map(r => r.id as number),
      ],
      // A held point is not counted: `unoffered` answers "how many stored points
      // this run was the first to find missing", and this run wrote nothing of
      // the kind about it. The callers turn that number into "place this
      // experience again", which the arrival beside it asks for anyway.
      unoffered: marked.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
