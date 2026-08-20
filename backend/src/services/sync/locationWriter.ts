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
 * locations, and a move is *the same reference at a point more than ten metres
 * away* — the tolerance being ADR-0027's, because within it the source is writing
 * the same place more precisely rather than moving it. For museums
 * and landmarks it is the experience's own Wikidata id, so it cannot change while
 * the experience stays the same; for UNESCO it names a component.
 *
 * Three shapes make the reference an imperfect key, and all three hold rather
 * than apply, because the mistakes are not the same size: holding too long leaves
 * a pin the source dropped, applying too early leaves an object with no pin at
 * all while it is still in every list.
 *
 * - Nine `(experience_id, external_ref)` pairs are duplicated, across nine
 *   objects — usually a component extended across a border and listed once per
 *   country under one number (`354rev-001` is Waterton Glacier in the US and in
 *   Canada; `749ter-001` holds three, for Benin, Burkina Faso and Niger), though
 *   one is a single country with two parts of one city (`412-003`, the historic
 *   centre of Mexico City *and* Xochimilco). Withdrawals and arrivals are numbered
 *   within a reference and
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
import { LOCATION_UNCHANGED_METERS } from './changeSet.js';
import type { ContentItem, ContentsDelta } from './types.js';

/**
 * When a stored row is the point the source is offering (ADR-0027).
 *
 * One fragment for both halves of the question, because they are one rule and
 * separating them is the way it gets broken: **the reference decides which row is
 * a candidate, and the geometry decides whether the source means the same place.**
 * A tolerance applied without the reference would be a nearest-point search over
 * an object's own points, and 4172 pairs of points of one experience lie within a
 * kilometre of each other — many at 0.000 m, because what distinguishes two
 * rock-art shelters in one cliff is the component number, not the metres between
 * them. Every site that asks this question composes this, so no site can ask half
 * of it.
 *
 * Ten metres, from `changeSet.ts`, where it already answers the same question
 * about the experience's own coordinate. Below the width of the thing being
 * pointed at — a museum's door against its centroid — so a source re-centring a
 * park still reads as a move and still raises a card; what it absorbs is
 * arithmetic. 1642 of 6680 stored points sit on a coordinate rounded to six
 * decimals, which is what the World Heritage list's degrees-minutes-seconds
 * become, so a single re-publication at full precision would otherwise withdraw a
 * quarter of the catalogue's pins in one run.
 *
 * Exact where the incoming point carries no reference: without one there is
 * nothing to be a candidate *of*, so the tolerance would have nothing to hold it
 * to one component.
 *
 * `LOCATION_UNCHANGED_METERS` is interpolated rather than parameterised because it
 * is a module constant and never reaches here from a request; the coordinates
 * beside it are parameters, as everywhere in this file.
 */
function samePointSql(alias: string): string {
  return `${alias}.external_ref IS NOT DISTINCT FROM i.external_ref
        AND (CASE WHEN i.external_ref IS NULL
                  THEN ${alias}.location = ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)
                  ELSE ST_DWithin(${alias}.location::geography,
                                  ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography,
                                  ${LOCATION_UNCHANGED_METERS})
             END)`;
}

/**
 * The pairing a claimed coordinate needs, and the reason the tolerance cannot
 * serve it.
 *
 * Identity is the point together with the reference, and the point half is a ten
 * metre window (ADR-0027). A curator's correction is the opposite of a rewrite
 * inside that window — the motivating case is 2.0 km — so a corrected row falls
 * out of `samePointSql` against the coordinate the source keeps offering. Out of
 * the pairing it is out of every arm that could protect it: the source's point is
 * inserted as a new row, the curator's is marked withdrawn, and the guard below
 * never runs. The claim would then hold for exactly the corrections too small to
 * need it.
 *
 * So a claimed row pairs on the reference alone. It keeps its real `metres`, so
 * where another stored row sits on the source's coordinate that row still wins
 * the pairing — a claim buys the corrected point its place in the list, not
 * priority over a better match.
 *
 * `IS NOT DISTINCT FROM`, so a referenceless row is covered too, and the reason
 * is worth stating because the null-safe form usually deserves suspicion. Made
 * strict, this fragment excludes exactly the row it most needs to protect: with
 * no reference `samePointSql` falls back to *exact* coordinate equality, so a
 * corrected referenceless point matches nothing, is withdrawn, and the source's
 * pin returns — the defect this whole branch exists to close, on the one row the
 * strict form declines to cover. And because that row is its experience's only
 * point, the anchor moved with the correction, so the object would end with its
 * coordinate on the curator's point and its only visible point on the source's:
 * #550, made by the endpoint written to close it.
 *
 * What the null-safe form costs is bounded by the data and by the pairing.
 * Measured 2026-08-21: the catalogue holds exactly one location with no
 * reference (Routes of Santiago de Compostela in France, 868) and no object holds
 * two, so "any referenceless incoming point" is one point. Were there two, the
 * second `DISTINCT ON` still makes the pairing one-to-one, and it breaks that
 * collision by `ordinal` — the source's own order, distance unread, the greedy
 * rule stated below — so the first-listed point takes the claimed row and the
 * other arrives as new.
 */
function claimedPointSql(alias: string): string {
  return `${alias}.curated_fields ? 'location'
        AND ${alias}.external_ref IS NOT DISTINCT FROM i.external_ref`;
}

/**
 * The opening of a `CASE` that keeps a stored value a curator has claimed.
 *
 * The same guard `syncUtils` puts on an experience's columns (#488), one level
 * down: a point is a thing a curator can be right about, and before this every
 * arm below wrote the source's name and coordinate over whatever they had
 * decided, on the next run, silently.
 *
 * Only `name` and `location` are ever claimed. `external_ref` is the source's
 * handle on the row and `ordinal` is its place in the source's list — both are
 * what the pairing above reads to decide whether a point moved or was replaced,
 * so a claim on either would not protect a judgement, it would make the writer
 * unable to recognise the row it is holding.
 */
function claimed(column: 'name' | 'location'): string {
  return `CASE WHEN el.curated_fields ? '${column}'`;
}

/** An empty delta, for the paths on which the writer performed nothing. */
const NO_CHANGE: ContentsDelta = { added: [], withdrawn: [], returned: [] };

/** Name a row the way the record names it: what the source calls it, not its id. */
function named(rows: Array<{ name?: string | null; external_ref?: string | null }>): ContentItem[] {
  return rows.map(r => ({ name: r.name ?? null, ref: r.external_ref ?? null }));
}

export interface IncomingLocation {
  name: string | null;
  externalRef: string | null;
  lon: number;
  lat: number;
}

/** Which rows the write touched, so assignment can be limited to them. */
export interface LocationWriteResult {
  /**
   * Rows that already held this point, at this coordinate. Assignments still valid.
   *
   * "At this coordinate" is the part ADR-0027 had to add: the keeping arm now adopts
   * the source's value, so matching no longer implies standing still, and a row that
   * moved inside the tolerance belongs in `needsAssignment` instead. The distinction
   * is not cosmetic even at a centimetre — see the `RETURNING` clause of that arm.
   */
  unchanged: number[];
  /** Rows inserted, moved, or offered again. These need region assignment. */
  needsAssignment: number[];
  /** How many stored points this run was the first to find missing. */
  unoffered: number;
  /**
   * What the run did to the object's set of points, named (ADR-0026).
   *
   * Separate from the id lists above, which exist for region placement: these
   * are the same events read as news about the object rather than as work still
   * to do, and a reader of one has no use for the other.
   */
  delta: ContentsDelta;
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
 * Drop repeats of the same place under the same reference, keeping the first.
 *
 * Two entries with the same reference at the same point — or, since ADR-0027,
 * within the ten metres that make it the same point — carry no information to
 * tell them apart, so collapsing them is the only reading available. That is a
 * different case from the shared coordinates above: those components differ by
 * reference and stay separate rows, however close they sit.
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
  const kept: IncomingLocation[] = [];
  return incoming.filter(loc => {
    // JSON rather than a joined string: `null` and `''` are different
    // references to `IS NOT DISTINCT FROM`, and a key that flattened them would
    // drop one of a pair the SQL then treats as two — the mark would take the
    // survivor's stored row and hide a point the source still offers.
    const key = JSON.stringify([loc.lon, loc.lat, loc.externalRef]);
    if (seen.has(key)) return false;
    // And the same question the matcher asks, or the promise above is only true of
    // exact repeats: two entries carrying one reference nine metres apart are both
    // within the tolerance of one stored row. What that costs is not silence — the
    // pairing is one-to-one, so the lower ordinal takes the row and the other is
    // *inserted*, deterministically. It costs the run creating a second row nine
    // metres from the first under one reference: exactly the pair ADR-0027 exists to
    // remove and migration 026 exists to repair, manufactured fresh, for the next run
    // to pair one of them and mark the other. With no stored row yet they both insert
    // and reach the same place. Deduping is cheaper than either.
    //
    // Two such entries are indistinguishable to every rule this file has: the
    // reference is the same and the geometry says one place. So one place is
    // what they become, which is the existing rule widened rather than a new
    // one — and points that really are apart stay apart, the catalogue's
    // multi-point references standing 14 km and more from each other.
    if (loc.externalRef !== null && loc.externalRef !== undefined
      && kept.some(other => other.externalRef === loc.externalRef
        && metresBetween(other, loc) <= LOCATION_UNCHANGED_METERS)) return false;
    seen.add(key);
    kept.push(loc);
    return true;
  });
}

/**
 * Metres between two incoming points, near enough for a ten-metre question.
 *
 * The one place in this file that measures in JavaScript, and it is allowed here
 * for the reason the rest is not: this compares two entries of the *source's own
 * list* to decide which of two indistinguishable ones to carry, and writes
 * nothing to the database on its answer. Every comparison against a stored row
 * still happens in PostGIS, where a rounding error would cost a region
 * assignment.
 *
 * Equirectangular rather than haversine: over ten metres the two agree to well
 * under a millimetre at any latitude this catalogue holds, and the cosine keeps
 * a degree of longitude honest at 78°N, where it is a quarter of what it is at
 * the equator.
 *
 * The haversine it replaces was antimeridian-safe for free — `sin(dLon/2)` reads
 * 360° − ε as ε — and a raw subtraction is not, so the difference is normalised
 * to (−180, 180]. Without it, two entries either side of the line and a metre
 * apart measure 40 000 km, both survive the dedupe, both answer the tolerance
 * against one stored row, and the object gains a second row for one place under
 * one reference. Latent rather than live: the catalogue's Pacific sites all sit
 * clear of the line. It is the repo's standing rule regardless (CLAUDE.md
 * § Antimeridian Handling), and this is the file's only distance in JavaScript.
 */
function metresBetween(a: IncomingLocation, b: IncomingLocation): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLon = ((b.lon - a.lon + 540) % 360) - 180;
  const x = dLon * toRad * Math.cos((a.lat + b.lat) / 2 * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.sqrt(x * x + y * y) * R;
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

  /**
   * One stored row per incoming point, and one incoming point per stored row.
   *
   * The exact comparison was injective for free: two rows cannot share a coordinate
   * *and* a reference, so at most one could match. A tolerance gives that away, and
   * what it costs is not cosmetic. Two rows within ten metres under one reference —
   * a marked row and its offered replacement, or the two an ungated run inserts —
   * both satisfy the predicate for one incoming point, so the keeping and
   * resurrection arms would each write `ordinal = i.ordinal` on a different row and
   * `UNIQUE(experience_id, ordinal)` would abort the write. Not once: on every run
   * after, for that experience, until someone repairs the rows by hand.
   *
   * So the arms stop asking the predicate and read a decided pairing instead.
   * `DISTINCT ON` twice makes it one-to-one from both directions, and the order
   * inside it is the product decision: **prefer the row that is not marked**, then
   * the nearer one. Not "the row a reader can see" — under a gate those come apart,
   * and the difference is load-bearing. In the held shape both rows carry
   * `missing_since NULL`, so the first term ties and `metres` gives the pairing to
   * the `pending` arrival sitting on the source's own coordinate rather than to the
   * visible row a centimetre off it. Which is right: what keeps the visible row
   * visible is the arrival's pointer at it, not the pairing. A tie reaching
   * `location_id` is two rows equidistant under one reference, where nothing
   * distinguishes them and any choice is the same choice.
   *
   * What loses is withdrawn, and *because* it lost rather than on any merits of its
   * own. The withdrawal and hold arms ask membership of this relation for the reason
   * a nearness test cannot serve them: a row that lost the pairing is by
   * construction near the incoming point, so nearness would exclude it from every
   * arm at once and strand it with the negative ordinal the parking step gave it. An
   * unmatched marked row stays marked; an unmatched offered row reaches the
   * withdrawal arm. Degrading to "the point stays where it was" is the only failure
   * mode that keeps a reader's map and a curator's queue answering the same
   * catalogue.
   *
   * Greedy, and knowingly: the first pass commits an ordinal before the second
   * learns two of them chose one row, so a complete pairing inside the tolerance can
   * go unfound where a source lists two points of one reference between ten and
   * twenty metres apart. No source does; ADR-0027 decision 5a-i states the cost and
   * #549 holds the maximum matching.
   */
  const paired = `${cte},
     candidate AS (
       SELECT i.ordinal, el.id AS location_id, el.missing_since,
              ST_Distance(el.location::geography,
                          ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography) AS metres
       FROM incoming i
       JOIN experience_locations el
         ON el.experience_id = $1
        AND (${samePointSql('el')} OR ${claimedPointSql('el')})
     ),
     best_row AS (
       SELECT DISTINCT ON (ordinal) ordinal, location_id, metres
       FROM candidate
       ORDER BY ordinal, (missing_since IS NULL) DESC, metres, location_id
     ),
     paired AS (
       SELECT DISTINCT ON (location_id) ordinal, location_id, metres
       FROM best_row
       ORDER BY location_id, ordinal
     )`;
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
                AND ${samePointSql('el')}
                AND el.ordinal = i.ordinal
                -- A claimed name against a source that offers none is matched, and
                -- it is the one claim this comparison forgives. upsertSingleLocation
                -- synthesises a null name for every museum's and every landmark's
                -- single point, so a curator who names such a point would fail this
                -- term on every run for ever — and the slow path it buys can only
                -- publish silence, because noNameOffered suppresses the rename the
                -- run would otherwise report against a name nobody offered. ADR-0029
                -- decision 5 keeps the path narrow so a claimed field reaches the
                -- keeping arm that computes its conflict; there is no conflict to
                -- compute where the source proposes nothing. A source that starts
                -- offering a name fails this term again, which is when there is.
                -- COALESCE rather than IS NULL, so this is the same question
                -- noNameOffered asks: it folds the empty string, which the UNESCO
                -- parser produces from a malformed "name:" with nothing after it.
                -- Written differently, the two would disagree on exactly that row —
                -- a transaction every run, recording nothing.
                AND (el.name IS NOT DISTINCT FROM i.name
                     OR (el.curated_fields ? 'name' AND COALESCE(i.name, '') = ''))
                -- A row the source lists while recorded as delisted is *not* matched:
                -- it needs the one-direction restore below, and this comparison is how
                -- the writer decides there is nothing to do. Without the term the fast
                -- path returns first and a delisting written on an offered point is
                -- permanent, and such a point can never be asked about again, since
                -- the queue reads the axes as nobody having answered.
                AND el.source_membership = 'present') AS matched,
            (SELECT array_agg(id) FROM experience_locations
               WHERE experience_id = $1 AND missing_since IS NULL) AS ids`,
    params,
  );
  const { stored, matched, ids } = same.rows[0] as
    { stored: string; matched: string; ids: number[] | null };

  if (Number(stored) === incoming.length && Number(matched) === incoming.length) {
    return { unchanged: ids ?? [], needsAssignment: [], unoffered: 0, delta: NO_CHANGE };
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

    // **Decided once, here, and read as a table by every arm below.**
    //
    // As a CTE it was decided six times, and the arms disagreed — because the first of
    // them changes the state the next one would decide from. `kept` adopts the source's
    // coordinate, which moves a stored row *off* every other incoming point it had been
    // near, so an ordinal that lost the pairing to that row can win it back from a second
    // row afterwards. Every later arm then agrees the pair exists and skips it: nothing
    // inserts the point, nothing withdraws the row, and nothing writes the row's ordinal —
    // leaving it visible on the negative ordinal the parking step gave it, which collides
    // with the parking of the next run and aborts that experience's write for good.
    //
    // Only reachable in the shape ADR-0027 decision 5a-i already describes, two points of
    // one reference between ten and twenty metres apart. But 5a-i was accepted on a cost —
    // one withdrawal that did not happen, settling next run — that this made untrue, and a
    // relation has to mean the same thing to everything that reads it regardless.
    //
    // Which is *every statement below this one* — stated as a class rather than a count,
    // because the count has been wrong twice on this branch as statements moved onto the
    // pairing one at a time. The five arms read it, the unpairing statement reads it, and
    // so does the deferral's `withdrawn`, which asks it for a reason of its own.
    //
    // `ON COMMIT DROP` rather than an explicit drop: it goes on COMMIT and on ROLLBACK
    // alike, so no path can leave it behind on a pooled connection.
    await client.query(
      `CREATE TEMP TABLE paired_rows ON COMMIT DROP AS
       WITH ${paired}
       SELECT ordinal, location_id, metres FROM paired`,
      params,
    );

    // Survivors keep their id. At most one incoming entry can match, since the
    // incoming list is deduped by identity above.
    //
    // `source_membership` is restored here as well as in the `returned` arm, and that
    // is what makes this the analogue of the experience upsert rather than a narrower
    // copy of it: `syncUtils.ts` writes `present` unconditionally, so a still-listed
    // object carrying `former` is corrected on the next run. Gated on the flag, the
    // restore would reach a flagged row only, and a `former` written on an offered
    // point would be permanent (ADR-0021, and ADR-0026 decision 6, which states the
    // restore as unconditional wherever the source lists the point — both arms and the
    // fast path's `matched` term — precisely so it cannot be rebuilt as one arm).
    //
    // Runs *before* the arm below, and the order is what keeps the two over
    // disjoint sets: that one clears `missing_since`, so a row it had already
    // resurrected would satisfy this predicate too and be reported as both
    // unchanged and needing assignment.
    const kept = await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = i.ordinal, external_ref = i.external_ref,
           name = ${claimed('name')} THEN el.name ELSE i.name END,
           source_membership = 'present',
           -- The coordinate the source is offering, on the runs that reach this arm.
           -- The source's value is the more precise of the two by construction — it is
           -- what the rounding lost (ADR-0027 decision 4).
           --
           -- Worth knowing what this does *not* buy: an object whose only change is a
           -- rewritten coordinate now passes the fast path and returns before any arm
           -- runs, so its stored value stays as it was. That is the common case rather
           -- than the corner — 1235 of 1272 UNESCO rows take the fast path per run —
           -- so the catalogue keeps serving a coordinate the source retired, within
           -- ten metres of the one it now publishes. Accepted rather than hidden: a
           -- traveller cannot stand ten metres from a component and be in the wrong
           -- place, and paying a transaction per object to chase the last digits would
           -- rebuild the churn this writer exists to remove.
           location = ${claimed('location')} THEN el.location
                      ELSE ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326) END
       FROM paired_rows p JOIN incoming i ON i.ordinal = p.ordinal
       -- Scoped to the experience as well as to the pairing. The pairing holds this
       -- object's rows only, so this narrows nothing -- but with the pairing now a table
       -- rather than a CTE, it is the last mention of $1 in the statement, and without it
       -- Postgres cannot infer that parameter's type and refuses the whole query.
       WHERE el.experience_id = $1
         AND el.id = p.location_id
         AND el.missing_since IS NULL
       -- The distance decides whether this row still holds the place it was assigned
       -- to. A traveller cannot be in the wrong place ten metres out, but a region
       -- polygon can: its edge is a line, so a rewrite of a centimetre across it is two
       -- different countries for a row that keeps the assignment of the one it left.
       -- Nothing revisits it either -- the fast path matches the new coordinate on every
       -- run afterwards -- so this is the one number that has to leave the statement.
       RETURNING el.id, p.metres`,
      params,
    );

    // A point the source is offering again. Same row, same id, so the visit
    // record and any manual region assignment on it are still the right ones —
    // but its *auto* assignments were dropped while it was missing, so it goes
    // back for placement rather than being reported as unchanged.
    //
    // `source_membership` comes back with it, in the one direction, exactly as the
    // experience upsert does it (`syncUtils.ts`, ADR-0021): the source listing a
    // point is evidence about membership, and a curator's `former` was a claim about
    // the source's list that the source has just contradicted. Without this the row
    // returns visible while still recorded as delisted — and worse, it can never be
    // asked about again, because the queue's withdrawal kind reads the axes to mean
    // "nobody has answered": the next withdrawal of that point would raise no card
    // and the point would go quiet for ever. `existence` is untouched, because a
    // listing says nothing about whether the thing still stands, and a curator's
    // `lost` must outlive a source that keeps offering a demolished building.
    const returned = await client.query(
      `WITH ${cte}
       UPDATE experience_locations el
       SET ordinal = i.ordinal, external_ref = i.external_ref,
           name = ${claimed('name')} THEN el.name ELSE i.name END,
           missing_since = NULL,
           source_membership = 'present',
           -- Adopted here too, for the keeping arm's reason: a point coming back within
           -- the tolerance is the same point written differently, and the row that
           -- carries the visit should carry the source's coordinate.
           location = ${claimed('location')} THEN el.location
                      ELSE ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326) END
       FROM paired_rows p JOIN incoming i ON i.ordinal = p.ordinal
       -- Scoped to the experience for the reason given on the arm above: the pairing
       -- already narrows it, and $1 has to appear or Postgres cannot type the parameter.
       WHERE el.experience_id = $1
         AND el.id = p.location_id
         AND el.missing_since IS NOT NULL
       RETURNING el.id, el.name, el.external_ref`,
      params,
    );

    // Deliberately no `missing_since` predicate in this NOT EXISTS: it asks
    // whether the row exists at all, and a point that just came back was
    // resurrected two statements ago. Restricting it to offered rows would let
    // that row be inserted a second time — two rows for one place, and the
    // visit record pointing at whichever of them the reader is not shown.
    const inserted = await client.query(
      `WITH ${cte},
       ins AS (
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
       -- Read from the same decided pairing the keeping arms use, not from the
       -- predicate again: a point that matches for keeping and does not match here
       -- inserts a second row beside the row it just updated, and one that matches
       -- here and loses the pairing above inserts a row for a place the run also
       -- kept. Both halves therefore ask the one relation (ADR-0027 decision 5).
       WHERE NOT EXISTS (SELECT 1 FROM paired_rows p WHERE p.ordinal = i.ordinal)
       RETURNING id, ordinal, curation_state, name, external_ref
       ),
       -- **The rows this just created join the pairing, in the same statement.**
       --
       -- Deciding the pairing once fixed the arms disagreeing about it; it also meant the
       -- table predates every row the insert writes, and the withdrawal arm's only test of
       -- whether a source still offers a row is membership of it. A new row would be
       -- inserted and marked missing by the next statement but one -- reported as added and
       -- withdrawn by the same run, hidden from every reader, and under a gate left
       -- pending *and* marked, which no publish can ever release.
       --
       -- At nought metres by construction: the row was written on the incoming point.
       -- Nothing reads the distance after the keeping arm, but a lie there would be a lie
       -- waiting for the next reader of this table.
       joined AS (
         INSERT INTO paired_rows (ordinal, location_id, metres)
         SELECT ordinal, id, 0 FROM ins
       )
       SELECT id, curation_state, name, external_ref FROM ins`,
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
              -- With the curation_state term the chain cannot form: the arrival
              -- pairs with the visible row, and the invisible intermediate is withdrawn
              -- in the same run. That holds only while the visible row stays *available*
              -- to be paired with, which is why the held-row term below is narrowed to
              -- arrivals the run keeps rather than written as the mark has it.
              --
              -- Membership of the pairing, not nearness, and the two are no longer the
              -- same set. Before the tolerance they were one predicate, which is what
              -- made the count above a derivation instead of a hope: this CTE was
              -- exactly the set the mark would mark. Nearness is now the broader
              -- question by one row -- the pairing's loser, which *is* near an incoming
              -- point -- so asking it here would leave that row out of the deferral
              -- while the mark marks it anyway: a visible pin withdrawn with a pending,
              -- invisible arrival beside it, which is the one thing the deferral exists
              -- to prevent. Every other row the run touched is in the pairing by now,
              -- kept, resurrected or inserted, so none of them can reach this.
              withdrawn AS (
                SELECT el.id, el.external_ref
                FROM experience_locations el
                WHERE el.experience_id = $1
                  -- Rows a reader can *see*, which is what a deferral slot is scarce for:
                  -- one per arrival, and spending one on a row nobody is looking at leaves
                  -- a visible pin unheld. So all three terms of that, not one:
                  -- offeredLocationSql (experienceLifecycle.ts) is
                  -- missing_since IS NULL AND existence <> 'lost', and the gate adds
                  -- pending on top -- repeated rather than imported, no service here
                  -- depending on a controller, and it has to track that definition.
                  --
                  -- The existence term is not decoration. A curator answers "no longer
                  -- exists" on a withdrawn point; the source offers it again, so the
                  -- resurrection arm clears missing_since and deliberately leaves
                  -- existence alone; a later run drops it again. That row is invisible,
                  -- unpaired and not pending -- and without this it would take the slot
                  -- from a point a reader really can see.
                  AND el.missing_since IS NULL
                  AND el.existence <> 'lost'
                  AND el.curation_state <> 'pending'
                  AND NOT EXISTS (
                    SELECT 1 FROM paired_rows p WHERE p.location_id = el.id
                  )
                  -- Held by an arrival **this run keeps** -- which is the mark's term
                  -- narrowed, and both halves of the narrowing are load-bearing.
                  --
                  -- The term at all, because covering the *visible* rows the mark will mark
                  -- is the promise and membership alone is one term short of it: a row held by
                  -- an earlier run stays unpaired for ever, so without this it comes
                  -- back as a candidate on every later run and takes a deferral slot
                  -- from a withdrawal the run really is performing -- leaving a row the
                  -- source did drop unheld and marked at once, a reader's pin gone with
                  -- only an invisible arrival to replace it.
                  --
                  -- And only for a surviving arrival, or a point moved twice before
                  -- anyone publishes loses its handle: the first arrival is itself
                  -- unoffered now, so this statement marks it and clears its pointer,
                  -- and the visible row it was holding would end up with no pointer on
                  -- it at all -- two pins on a one-point site until the next run, which
                  -- is exactly the chain the note above says cannot form.
                  AND NOT EXISTS (
                    SELECT 1 FROM experience_locations waiting
                    WHERE waiting.experience_id = $1
                      AND waiting.withdrawal_deferred_for_location_id = el.id
                      AND EXISTS (
                        SELECT 1 FROM paired_rows p WHERE p.location_id = waiting.id
                      )
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
           SELECT 1 FROM paired_rows p WHERE p.location_id = old.id
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
           SELECT 1 FROM paired_rows p WHERE p.location_id = el.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM experience_locations waiting
           WHERE waiting.experience_id = $1
           AND waiting.withdrawal_deferred_for_location_id = el.id
         )
       RETURNING el.id, el.name, el.external_ref`,
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
           SELECT 1 FROM paired_rows p WHERE p.location_id = el.id
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

    // The keeping arm splits on whether the coordinate actually moved, which is what
    // makes `unchanged`'s promise below true again now that the arm adopts geometry.
    // Any non-zero distance counts: a region boundary is a line, so there is no
    // distance small enough to be safe near one, and the row's `experience_location_regions`
    // rows are the thing being answered for — not what a reader can see.
    //
    // A claimed row is the exception, and it is the reason this predicate cannot be
    // `metres` alone any more. `metres` is the *pairing* distance — how far the
    // source's point is from the stored one — and for a claimed row the arm above
    // deliberately wrote nothing, so 2000 metres there means "the source is still
    // offering somewhere else", not "this point moved". Placed on it, the run would
    // delete and reinsert that experience's `auto` region rows on every run for as
    // long as the correction stands: nothing lost, since a manual assignment is
    // never touched, but exactly the churn this writer's fast path exists to remove,
    // growing with how much curation has happened.
    const moved = (r: { metres?: number; old_curated_fields?: string[] | null }) =>
      Number(r.metres) > 0 && !(r.old_curated_fields ?? []).includes('location');
    const keptMoved = kept.rows.filter(moved);
    const keptStill = kept.rows.filter(r => !moved(r));

    return {
      unchanged: keptStill.map(r => r.id as number),
      needsAssignment: [
        ...inserted.rows.map(r => r.id as number),
        ...returned.rows.map(r => r.id as number),
        ...keptMoved.map(r => r.id as number),
      ],
      // A held point is not counted: `unoffered` answers "how many stored points
      // this run was the first to find missing", and this run wrote nothing of
      // the kind about it. The callers turn that number into "place this
      // experience again", which the arrival beside it asks for anyway.
      unoffered: marked.rowCount ?? 0,
      // Read off the same statements, which is what keeps the delta and the
      // write from disagreeing: `withdrawn` is what the mark actually marked, so
      // a held withdrawal is absent here for the same reason it is absent from
      // `unoffered` — the point is still on the map.
      delta: {
        added: named(inserted.rows),
        withdrawn: named(marked.rows),
        returned: named(returned.rows),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
