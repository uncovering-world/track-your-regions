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
 * `withWholesSql` adds the wholes of given places, `wholeOfSql` names the
 * whole of a part, and `answeringPlaceSql` names the one place a curator's
 * write on a point is judged and locked under.
 *
 * A traveller's record reads the same rule: `visitedPointsSql` is the points
 * a traveller has been at, a visit to the point itself or to the part place
 * it is the point of (ADR-0100 decision 5).
 */

import { MEMBERSHIPS } from './membership.js';

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
 * The points a merge folded into the points the places `places` show, as a
 * derived table of (id, kept_id): each folded point and the point a reader
 * sees in its place (ADR-0088 decision 3, #1662). A folded point is hidden from
 * every reader (`offeredLocationSql`) and stays on the place that was folded, so
 * no reader composes this. A run does: the folded point still carries the
 * reference its source knows it by, and without it the source's next run finds
 * nothing to pair its point with and adds it to the place again. That is how the
 * Mogao Caves gained a second point 10.7 km from the first after their World
 * Heritage and Archaeology rows were merged.
 *
 * Followed down a chain of merges: a point folded into one that a later merge
 * folded in turn is the kept point's too. A point whose reference is the kept
 * point's own is left out, since the run finds the kept point by it.
 */
export function foldedPointsSql(places: string): string {
  return `(WITH RECURSIVE folded (id, kept_id, external_ref) AS (
      SELECT f.id, kept.id, f.external_ref FROM experience_locations kept
        JOIN experience_locations f ON f.merged_into_id = kept.id
       WHERE kept.experience_id = ANY(${madeOfSql(places)}) AND kept.merged_into_id IS NULL
      UNION
      SELECT f.id, folded.kept_id, f.external_ref FROM folded
        JOIN experience_locations f ON f.merged_into_id = folded.id)
    SELECT folded.id, folded.kept_id FROM folded JOIN experience_locations kept ON kept.id = folded.kept_id
     WHERE folded.external_ref IS DISTINCT FROM kept.external_ref)`;
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
 * The whole the place `place` is a part of, or NULL when it is a part of
 * none: the site a component belongs to (ADR-0100). A part of two wholes
 * answers the lower id, so every lookup names the same one.
 */
export function wholeOfSql(place: string): string {
  return `(SELECT min(prt.whole_id) FROM experience_parts prt WHERE prt.part_id = ${place})`;
}

/**
 * The place a curator answers for a point under, as an expression over the
 * point `point`: the site that shows it when the point's own place is one of
 * its parts and holds no kind of its own (ADR-0100), and its own place
 * otherwise. Its scope, its source and its lock are the ones a write on the
 * point is judged and taken under, as the site's are for a component. A part
 * that holds a kind of its own is a place in its own right (ADR-0100 decision
 * 2): the Karnak Temple Complex, once the Temple of Karnak is merged into it,
 * answers for its own point under its own source, regions and history (#1250).
 * A part of two sites answers to the lower id, so every lookup names the same
 * one.
 */
export function answeringPlaceSql(point = 'el'): string {
  return answeringPlaceOfSql(`${point}.experience_id`);
}

/**
 * The same rule for a place: the site it is a part of where it holds no kind
 * of its own, and itself otherwise. What a curator's scope over the place is
 * asked through, as a write on its point is.
 */
export function answeringPlaceOfSql(place: string): string {
  return `COALESCE(CASE WHEN NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} kinded WHERE kinded.experience_id = ${place})
                        THEN ${wholeOfSql(place)} END, ${place})`;
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

/**
 * What a reader calls the point `point`: its own name, else what the part
 * place it is the point of is called (#1924). A place another kind brought and
 * a merge made a site's part carries its name on the part row, and its point,
 * which that kind placed, none of its own: Etchmiadzin Cathedral's point was
 * listed by its coordinates. A name that names nothing (`names_nothing()`: the
 * World Heritage list calls two parts of Tarraco "The ") counts as none (#2065).
 * A part with no kind of its own lends the title of its point's Wikipedia
 * article, "Roman villa of Centcelles", rather than its name: where there is no
 * article that name is the site's with the reference, which beside the site's
 * other points would repeat both. Any other point keeps its null, which the web
 * labels by the reference or the coordinate (`locationLabel`): "1708-003" for a
 * section of the Via Appia. The title is read only off a point that has an
 * article, since this runs on every row of the world layer's markers. The
 * curator's reads keep `name` as the source wrote it, since what the source
 * listed is what a curator corrects.
 */
export function pointNameSql(point = 'el'): string {
  return `COALESCE(CASE WHEN NOT names_nothing(${point}.name) THEN ${point}.name END,
          (SELECT CASE WHEN EXISTS (SELECT 1 FROM experience_kind_memberships prt_kind
                                     WHERE prt_kind.experience_id = pop.part_id)
                       THEN prt_name.name
                       WHEN ${point}.metadata ? 'wikipediaUrl'
                       THEN wikipedia_article_title(${point}.metadata->>'wikipediaUrl') END
             FROM experience_parts pop
             JOIN experiences prt_name ON prt_name.id = pop.part_id
            WHERE pop.part_id = ${point}.experience_id LIMIT 1))`;
}

/**
 * The picture a reader sees on the point `point`, as two select-list columns
 * `image_url` and `image_credit`: its own, else the picture of the part place
 * it is the point of (ADR-0100 decision 3, #1946). A place another kind
 * brought holds its picture on the place row, and its point none: once a merge
 * makes it a site's part, the component's point that carried the picture is
 * folded into that empty one, and the Church of the Intercession on the Nerl
 * showed its site's montage. The credit is taken from the row the picture is,
 * never one from each. A point of no part keeps its null, which the web fills
 * with the site's picture and says so (`pointPicture`). `tellingOfPart` adds
 * `image_of_part`, true where the picture served is the part place's, for the
 * object's own read a curator corrects the point from.
 */
export function pointPictureSql(point = 'el', options: { tellingOfPart?: boolean } = {}): string {
  const own = `NULLIF(${point}.image_url, '') IS NOT NULL`;
  const ofPart = (column: string) => `(SELECT ${column} FROM experiences prt_pic
            WHERE prt_pic.id = ${point}.experience_id AND NULLIF(prt_pic.image_url, '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM experience_parts pop WHERE pop.part_id = prt_pic.id))`;
  // Where a curator corrects the point, the picture served has to be told
  // from the point's own: the form edits the point's column, which is empty.
  const tell = options.tellingOfPart
    ? `,
          (NOT ${own} AND ${ofPart('prt_pic.image_url')} IS NOT NULL) AS image_of_part`
    : '';
  return `CASE WHEN ${own} THEN ${point}.image_url ELSE ${ofPart('prt_pic.image_url')} END AS image_url,
          CASE WHEN ${own} THEN ${point}.metadata -> 'imageCredit'
               ELSE ${ofPart("prt_pic.metadata -> 'imageCredit'")} END AS image_credit${tell}`;
}

/**
 * The English Wikipedia article a reader follows from the point `point`, as
 * the select-list column `wikipedia_url` (#1963): its own, which a World
 * Heritage run reads off the component's item, else the article of the part
 * place it is the point of, which another kind brought with the place (ADR-0100
 * decision 3), as `pointPictureSql` reads the picture. Never the site's: a
 * part's article is the part's. Null where neither holds one.
 */
export function pointArticleSql(point = 'el'): string {
  return `COALESCE(NULLIF(${point}.metadata ->> 'wikipediaUrl', ''), ${partPlaceArticleSql(point)}) AS wikipedia_url`;
}

/**
 * The article of the part place the point `point` is the point of, which a
 * reader is shown where the point holds none (`pointArticleSql`); NULL where
 * its place is no part or holds none. The run's content writer asks it too, so
 * a gated run holds a change to the article a reader actually sees.
 */
export function partPlaceArticleSql(point = 'el'): string {
  return `(SELECT NULLIF(prt_art.metadata ->> 'wikipediaUrl', '') FROM experiences prt_art
            WHERE prt_art.id = ${point}.experience_id
              AND EXISTS (SELECT 1 FROM experience_parts pop WHERE pop.part_id = prt_art.id))`;
}

/**
 * The part place the point `point` is the point of, or NULL where its own
 * place is no part (ADR-0100): a visit to such a point is recorded on the
 * part.
 */
export function partOfPointSql(point = 'el'): string {
  return `CASE WHEN EXISTS (SELECT 1 FROM experience_parts pop WHERE pop.part_id = ${point}.experience_id)
          THEN ${point}.experience_id END`;
}

/**
 * The points the traveller `user` has been at, as a derived table of
 * (location_id, visited_at, notes): a visit to the point itself, and the
 * point of every part place they visited (ADR-0100 decision 5). A visit to a
 * component is recorded on its part, as a place visit, so a merge with
 * another kind's place reconciles it as any two places' visits; the site
 * reads it as the part's point visited, as it read the point's own visit
 * before. A visit to a place that is no part counts for none of its points:
 * having been to a place of two coordinates is not having been at both.
 * `user` is an int expression, a bound parameter.
 */
export function visitedPointsSql(user: string): string {
  return `(SELECT uvl.location_id, uvl.visited_at, uvl.notes
             FROM user_visited_locations uvl WHERE uvl.user_id = ${user}
           UNION ALL
           SELECT pel.id, upv.visited_at, upv.notes
             FROM user_visited_experiences upv
             JOIN experience_locations pel ON pel.experience_id = upv.experience_id
            WHERE upv.user_id = ${user}
              AND EXISTS (SELECT 1 FROM experience_parts vprt WHERE vprt.part_id = upv.experience_id)
              -- One row per point, should a visit to the point itself outlive its parting.
              AND NOT EXISTS (SELECT 1 FROM user_visited_locations vuvl
                               WHERE vuvl.user_id = ${user} AND vuvl.location_id = pel.id))`;
}

/**
 * Every visit to a point, by nobody in particular, as a derived table of
 * (location_id): a visit to the point itself, and one to the part place it is
 * the point of (ADR-0100 decision 5). What a maintainer's count of visits
 * reads, which names a place and never a person.
 */
export function pointVisitsSql(): string {
  return `(SELECT pvl.location_id FROM user_visited_locations pvl
           UNION ALL
           SELECT ppel.id FROM user_visited_experiences ppv
             JOIN experience_locations ppel ON ppel.experience_id = ppv.experience_id
            WHERE EXISTS (SELECT 1 FROM experience_parts pprt WHERE pprt.part_id = ppv.experience_id))`;
}

/**
 * Whether any traveller has been at the point `point`: a visit to it, or to
 * the part place it is the point of. What a curator's card about a point
 * weighs, since a visit outlives either answer (ADR-0022). Two probes by the
 * point and by its own place.
 */
export function someoneVisitedPointSql(point = 'el'): string {
  return `(EXISTS (SELECT 1 FROM user_visited_locations sv WHERE sv.location_id = ${point}.id)
       OR EXISTS (SELECT 1 FROM user_visited_experiences spv
                    JOIN experience_parts sprt ON sprt.part_id = spv.experience_id
                   WHERE spv.experience_id = ${point}.experience_id))`;
}
