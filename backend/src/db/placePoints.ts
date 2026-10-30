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

import { COMPONENTS_KIND_ID, MEMBERSHIPS, placeHoldsRealKindSql } from './membership.js';

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
 * The name of the serial site the place `place` (an id expression) is a part
 * of, or NULL: what a part is read by where it is in no kind of its own, on
 * the near-places card and its catalogue check (#1250). The same whole as
 * `wholeOfSql`.
 */
export function partOfNameSql(place: string): string {
  return `(SELECT whole_name.name FROM experiences whole_name WHERE whole_name.id = ${wholeOfSql(place)})`;
}

/**
 * The same whole as `partOfNameSql`, as a jsonb object a queue card names it
 * by (#2158), or NULL: its name, the World Heritage id its site's run knows it
 * by and its page on the World Heritage list, and the reference the list gives
 * the part ("1209-002"). A part found through Wikidata's "part of" or named by
 * a curator carries no reference and no site membership, so those are null.
 */
export function partOfFactsSql(place: string): string {
  return `(SELECT jsonb_build_object(
             'name', whole_facts.name,
             'unesco_id', site_facts.external_id,
             'unesco_url', whole_facts.metadata->>'unescoUrl',
             'component_ref', part_facts.external_ref)
           FROM experience_parts part_facts
           JOIN experiences whole_facts ON whole_facts.id = part_facts.whole_id
           LEFT JOIN ${MEMBERSHIPS} site_facts ON site_facts.id = part_facts.membership_id
          WHERE part_facts.part_id = ${place} AND part_facts.whole_id = ${wholeOfSql(place)})`;
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
  return `COALESCE(CASE WHEN NOT ${placeHoldsRealKindSql(place)}
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
 * What a reader calls the point `point`. A serial site's part is a place, and
 * its point is called what the part is (ADR-0156): Beffroi de Mons, or the
 * name a curator gave the part. Where the list names the component nothing
 * (`names_nothing()`: it calls two parts of Tarraco "The ") the part is named
 * for its own Wikipedia article, "Roman villa of Centcelles", and where it has
 * none for its site with the reference, which beside the site's other points
 * would repeat both, so the point keeps a null, which the web labels by the
 * reference or the coordinate (`locationLabel`): "1708-003" for a section of
 * the Via Appia. A part another kind brought and a merge made a site's part
 * names itself (#1250), and its point is called by its own name where it has
 * one and the part's otherwise (#1924): Etchmiadzin Cathedral's point was
 * listed by its coordinates. Any other point is called by its own name.
 */
export function pointNameSql(point = 'el'): string {
  const own = `CASE WHEN NOT names_nothing(${point}.name) THEN ${point}.name END`;
  return `CASE WHEN ${pointOfPartSql(point)}
               THEN (SELECT CASE WHEN ${placeHoldsRealKindSql('prt_name.id')} THEN COALESCE(${own}, prt_name.name)
                                 WHEN NOT names_nothing(${point}.name) OR prt_name.curated_fields ? 'name'
                                      OR prt_name.metadata ? 'wikipediaUrl'
                                 THEN prt_name.name END
                       FROM experiences prt_name WHERE prt_name.id = ${point}.experience_id)
               ELSE ${own} END`;
}

/**
 * The picture a reader sees on the point `point`, as two select-list columns
 * `image_url` and `image_credit`: a serial site's part's own, off the part row
 * (ADR-0156 decision 3), and the point's own for a point of any other place. A
 * part another kind brought holds its picture there as every place does: the
 * Church of the Intercession on the Nerl shows its own, not its site's montage
 * (#1946). The credit is taken from the row the picture is. A point with no
 * picture keeps its null, which the web fills with the site's picture and says
 * so (`pointPicture`).
 */
export function pointPictureSql(point = 'el'): string {
  const ofPart = (column: string) => `(SELECT ${column} FROM experiences prt_pic WHERE prt_pic.id = ${point}.experience_id)`;
  return `CASE WHEN ${pointOfPartSql(point)} THEN ${ofPart("NULLIF(prt_pic.image_url, '')")} ELSE NULLIF(${point}.image_url, '') END AS image_url,
          CASE WHEN ${pointOfPartSql(point)} THEN ${ofPart("prt_pic.metadata -> 'imageCredit'")}
               ELSE ${point}.metadata -> 'imageCredit' END AS image_credit`;
}

/**
 * The English Wikipedia article a reader follows from the point `point`, as
 * the select-list column `wikipedia_url` (#1963): a serial site's part's own,
 * off the part row (ADR-0156 decision 3), else the point's own, as
 * `pointPictureSql` reads the picture. Never the site's: a part's article is
 * the part's. Null where it holds none.
 */
export function pointArticleSql(point = 'el'): string {
  return `CASE WHEN ${pointOfPartSql(point)}
               THEN (SELECT NULLIF(prt_art.metadata ->> 'wikipediaUrl', '') FROM experiences prt_art
                      WHERE prt_art.id = ${point}.experience_id)
               ELSE NULLIF(${point}.metadata ->> 'wikipediaUrl', '') END AS wikipedia_url`;
}

/**
 * The line under a point's name (#1270): a serial site's part's subtitle, off
 * the part row (ADR-0156 decision 3), else the point's own description, as
 * the select-list column `description`.
 */
export function pointSubtitleSql(point = 'el'): string {
  return `CASE WHEN ${pointOfPartSql(point)}
               THEN (SELECT NULLIF(prt_sub.subtitle, '') FROM experiences prt_sub WHERE prt_sub.id = ${point}.experience_id)
               ELSE NULLIF(${point}.description, '') END AS description`;
}

/**
 * What a curator has claimed on the point `point`, as a point's read names it:
 * the point's own claims, and for a serial site's part the claims on its row's
 * picture, subtitle and article (ADR-0156 decision 3), the subtitle's under the
 * name a point's read gives the line, `description`, and on its name where the
 * point is called by it: a part that holds a kind of its own names itself, and
 * its point keeps its own name and claim (`pointNameSql`).
 */
export function pointClaimsSql(point = 'el'): string {
  return `CASE WHEN ${pointOfPartSql(point)}
               THEN (SELECT COALESCE(jsonb_agg(DISTINCT claim), '[]'::jsonb)
                       FROM (SELECT jsonb_array_elements_text(${point}.curated_fields) AS claim
                             UNION
                             SELECT CASE prt_claim WHEN 'subtitle' THEN 'description' ELSE prt_claim END
                               FROM experiences prt_own,
                                    jsonb_array_elements_text(COALESCE(prt_own.curated_fields, '[]'::jsonb)) AS prt_claim
                              WHERE prt_own.id = ${point}.experience_id
                                AND (prt_claim IN ('image_url', 'subtitle', 'metadata.wikipediaUrl')
                                     OR (prt_claim = 'name' AND NOT ${placeHoldsRealKindSql('prt_own.id')}))) claims)
               ELSE ${point}.curated_fields END`;
}

/**
 * The Wikidata item the point `point` is, as an SQL expression: a serial
 * site's part's off its record in World Heritage components (ADR-0156
 * decision 2), any other point's its own.
 */
export function pointItemSql(point = 'el'): string {
  return `CASE WHEN ${pointOfPartSql(point)}
               THEN (SELECT pi_rec.wikidata_items[1] FROM ${MEMBERSHIPS} pi_rec
                      WHERE pi_rec.experience_id = ${point}.experience_id AND pi_rec.kind_id = ${COMPONENTS_KIND_ID})
               ELSE ${point}.wikidata_item END`;
}

/**
 * A curator chose the item of the point `point` (#1272): on a part's record
 * (`wikidata_items` among its claims), else on the point itself.
 */
export function pointItemClaimedSql(point = 'el'): string {
  return `CASE WHEN ${pointOfPartSql(point)}
               THEN COALESCE((SELECT pc_rec.curated_fields ? 'wikidata_items' FROM ${MEMBERSHIPS} pc_rec
                               WHERE pc_rec.experience_id = ${point}.experience_id AND pc_rec.kind_id = ${COMPONENTS_KIND_ID}), false)
               ELSE COALESCE(${point}.curated_fields ? 'wikidata_item', false) END`;
}

/**
 * Some component already is the item `item` (an SQL expression): a part's
 * record or a point carries it, since a component is one item and an item one
 * component.
 */
export function itemHeldSql(item: string): string {
  return `(EXISTS (SELECT 1 FROM experience_locations held_point WHERE held_point.wikidata_item = ${item})
           OR EXISTS (SELECT 1 FROM ${MEMBERSHIPS} held_rec
                       WHERE held_rec.kind_id = ${COMPONENTS_KIND_ID} AND held_rec.wikidata_items @> ARRAY[(${item})::text]))`;
}

/**
 * The point `point` is the point of a serial site's part, whose own row holds
 * its picture, subtitle and article (ADR-0156 decision 3): what a reader shows
 * and a writer writes for such a point is the part row's, never the point's.
 */
export function pointOfPartSql(point = 'el'): string {
  return `EXISTS (SELECT 1 FROM experience_parts pop WHERE pop.part_id = ${point}.experience_id AND pop.reason = 'component')`;
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
