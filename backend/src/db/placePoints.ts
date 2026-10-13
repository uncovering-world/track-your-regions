/**
 * The points a place shows: its own, and the points of the places that are
 * its parts (ADR-0100). A component of a serial site is a part place with one
 * point, and the site shows it on its map, in its count of places and in a
 * traveller's progress through it, as it shows its own.
 *
 * Every reader of "the points of a place" composes this module and never
 * reads `experience_locations` by `experience_id` alone, so a component moving
 * into a part place changes nothing a reader sees. A place shows its own
 * points and its parts' points: this module is the one statement of that rule,
 * in the three shapes a read takes.
 *
 * - `overPlacePoints` writes a reader's query once per arm and unions the arms
 *   at the top of the statement, for a read over many places (a region's
 *   points). Each arm is planned on its own, as the read was before parts
 *   existed: joined inside a query, one union of both arms made the planner
 *   sort every point of the catalogue before the region filter, 30 ms more on
 *   Italy's locations read on 2026-10-13.
 * - `placePointsSql` is the same rule as a derived table of (place, point),
 *   for a read about one place, where the place's id reaches both arms.
 * - `madeOfSql` and `shownBySql` are the rule for places already known (a
 *   correlated count, a write for given places): the places themselves and
 *   their parts, and a point whose own place is one of them.
 *
 * A read about one place that comes from an outer row takes the arms as well:
 * `pointsShownSql` is them as a table of the place's points, and
 * `somePointShownSql` as a test that one of them meets a condition.
 *
 * Read the other way, from a point to the places that show it:
 * `withWholesSql` adds the wholes of given places, and `answeringPlaceSql`
 * names the one place a curator's write on a point is judged and locked
 * under.
 */

/** One way a place shows a point: the tables it is read from, and the place it is shown by. */
export interface PlacePointArm {
  /** The FROM clause: binds `el` (the point) and `e` (the place that shows it). */
  from: string;
  /** The id of the place that shows the point, as a column expression. */
  placeId: string;
}

/** The place's own points, and its parts' points shown by the whole. */
export const PLACE_POINT_ARMS: readonly PlacePointArm[] = [
  {
    from: 'experience_locations el JOIN experiences e ON e.id = el.experience_id',
    placeId: 'el.experience_id',
  },
  {
    from: `experience_parts prt
           JOIN experience_locations el ON el.experience_id = prt.part_id
           JOIN experiences e ON e.id = prt.whole_id`,
    placeId: 'prt.whole_id',
  },
];

/**
 * A query over the points places show: `arm` writes one SELECT given an arm's
 * FROM clause and its place column, and the arms are joined by UNION ALL. An
 * ORDER BY goes outside, over the union's own column names.
 */
export function overPlacePoints(arm: (source: PlacePointArm) => string): string {
  return PLACE_POINT_ARMS.map(source => `(${arm(source)})`).join('\nUNION ALL\n');
}

const pairOf = ({ from, placeId }: PlacePointArm): string =>
  `SELECT ${placeId} AS place_id, el.id AS location_id FROM ${from}`;

/** The (place_id, location_id) pairs of every point a place shows, as a derived table. */
export function placePointsSql(): string {
  return `(${overPlacePoints(pairOf)})`;
}

/**
 * The places a place is made of, itself among them: the place and the places
 * that are its parts, as an int[] for `= ANY(...)`. `places` is an int[]
 * expression, `ARRAY[e.id]` for one place.
 */
export function madeOfSql(places: string): string {
  return `ARRAY(SELECT unnest(${places})
    UNION ALL SELECT prt.part_id FROM experience_parts prt WHERE prt.whole_id = ANY(${places}))`;
}

/**
 * Whether the point `point` is one the places `places` show, their own or
 * their parts': the predicate of a read about given places, `places` an int[]
 * expression (`ARRAY[e.id]` in a correlated read). Kept to an index probe on
 * the point's own place, which a semi-join against the arms is not: on 1,472
 * places a correlated count took 9 ms this way and 23 ms through the arms.
 */
export function shownBySql(point: string, places: string): string {
  return `${point}.experience_id = ANY(${madeOfSql(places)})`;
}

/**
 * The places given and the places they are parts of, as an int[]: the places
 * whose own answer moves when the given places' points move — Ancient Thebes
 * is placed again when the Temple of Karnak's point is.
 */
export function withWholesSql(places: string): string {
  return `ARRAY(SELECT unnest(${places})
    UNION SELECT prt.whole_id FROM experience_parts prt WHERE prt.part_id = ANY(${places}))`;
}

/**
 * The place a curator answers for a point under, as an expression over the
 * point `point`: the site that shows it when the point's own place is one of
 * its parts (ADR-0100), and its own place otherwise. Its scope, its source and
 * its lock are the ones a write on the point is judged and taken under, as the
 * site's are for a component today. A part of two sites answers to the lower
 * id, so every lookup names the same one.
 */
export function answeringPlaceSql(point = 'el'): string {
  return `COALESCE((SELECT min(prt.whole_id) FROM experience_parts prt WHERE prt.part_id = ${point}.experience_id),
         ${point}.experience_id)`;
}

/**
 * The points one place shows, as a FROM item binding `point` to every column
 * of `experience_locations`: the place's own points and its parts', one arm
 * each by an equality on `place`, so each arm is an index probe for the outer
 * row it is asked about. The shape for a read that comes from an outer row (a
 * region list's count, a card's points); joined beside that row it needs
 * LATERAL. As a filter (`shownBySql`) the places' array is computed again for
 * every row the plan meets wherever the plan reaches the points from
 * elsewhere: the review queue's first page took 4.2 s that way on the
 * development catalogue on 2026-10-13, against 260 ms before parts.
 */
export function pointsShownSql(place: string, point = 'el'): string {
  // The arms' own aliases are named after `point`, so a `place` that names an
  // outer alias (the finder's `prt.whole_id`) is never captured inside them.
  const own = `${point}_own`;
  const link = `${point}_prt`;
  const ofPart = `${point}_of_part`;
  return `(SELECT ${own}.* FROM experience_locations ${own} WHERE ${own}.experience_id = ${place}
        UNION ALL
        SELECT ${ofPart}.* FROM experience_parts ${link}
          JOIN experience_locations ${ofPart} ON ${ofPart}.experience_id = ${link}.part_id
         WHERE ${link}.whole_id = ${place}) AS ${point}`;
}

/**
 * Whether some point the place `place` shows meets `where`, past the joins
 * `joins` from it: an EXISTS per arm, joined by OR, so the own arm is the
 * question as it was asked before parts, which the planner can answer from
 * either side (from a region's placements, from the open candidates), and the
 * parts arm a probe of a table that holds only parts. `point` is bound to the
 * point in both, and `where` reads it.
 */
export function somePointShownSql(place: string, point: string, where: string, joins = ''): string {
  return `(EXISTS (SELECT 1 FROM experience_locations ${point} ${joins}
                  WHERE ${point}.experience_id = ${place} AND ${where})
       OR EXISTS (SELECT 1 FROM experience_parts ${point}_part
                    JOIN experience_locations ${point} ON ${point}.experience_id = ${point}_part.part_id ${joins}
                   WHERE ${point}_part.whole_id = ${place} AND ${where}))`;
}
