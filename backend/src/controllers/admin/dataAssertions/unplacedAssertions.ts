/**
 * The objects and the places no region holds, and for an object, the region a
 * curator would put it in (#469).
 *
 * Placement puts a point in the regions whose geometry contains it, and a point
 * a few metres outside every boundary gets no region at all: the Island of
 * Gorée 14 m off Senegal's coastline, the Sea organ on the Zadar quay, Dublin's
 * centre, which no GADM division of Ireland reaches. The object then vanishes
 * from every region page while search and the map still have it.
 *
 * The nearest region is a good suggestion and not an answer, so this suggests
 * and decides nothing, as a place near a border is decided (#1054): a curator
 * adds the object to the region by hand, and that row is told apart from a
 * containment by its `assignment_type`. Measured on world view 5 on 2026-10-18,
 * 33 offered objects held no region. For 28 a leaf lies within
 * `SUGGEST_WITHIN_M`, and read as a traveller the nearest one is right for all
 * of them but Ha Long Bay, whose point lies 6.4 km from Hải Phòng and 10.1 km
 * from Quảng Ninh, the province the bay is in. The next region and its distance
 * are what tell that row from Gorée's, where the next region is 28 km away.
 * The other five are the open ocean, Phoenix Islands at 86 km to Malpelo at
 * 355 km, and their nearest leaf names nothing a traveller would recognise as
 * theirs (#470).
 */

import { experienceOfferedToReaderSql, hideLostSql, offeredLocationSql } from '../../../db/readerPredicates.js';
import { answeringPlaceSql } from '../../../db/placePoints.js';
import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';

/**
 * How far outside every region a point may lie for its nearest leaf to be
 * suggested: past every coastline and gap measured, and short of the oceanic
 * sites, whose nearest leaf is a guess.
 */
export const SUGGEST_WITHIN_M = 30_000;

/** A distance the way a curator reads it: metres up close, kilometres past one. */
const distance = (metres: number) =>
  metres < 1000 ? `${metres} m` : `${Number((metres / 1000).toFixed(1))} km`;

/**
 * The search radius in degrees of latitude: `SUGGEST_WITHIN_M` over the
 * shortest a degree of latitude gets (110.57 km at the equator), so it never
 * falls short. A degree of longitude shrinks with latitude, so the query widens
 * it by the point's latitude, as the border check does.
 */
const SEARCH_DEGREES = SUGGEST_WITHIN_M / 110_000;

/**
 * The nearest leaf of a world view within `SUGGEST_WITHIN_M`, and the next one
 * within it. Every piece placement reads (ADR-0054) within the radius is a
 * candidate, and the leaves are ranked by their distance on the sphere. Ranked
 * by degrees, a leaf 13 km north of a point in Dublin would come before one
 * 10 km east, since a degree of longitude there is 0.6 of a degree of latitude.
 * Asked only of a world view that holds some placement, since a world view no
 * run has placed into has nothing to compare.
 */
const nearestLeavesSql = `
  SELECT jsonb_agg(jsonb_build_object(
           'view', w.name, 'region', n.names[1], 'metres', round(n.metres[1])::int,
           'next', n.names[2], 'next_metres', round(n.metres[2])::int) ORDER BY n.metres[1]) AS suggestions,
         min(n.metres[1]) AS nearest_metres
    FROM world_views w
   CROSS JOIN LATERAL (
     SELECT array_agg(d.name ORDER BY d.metres) AS names, array_agg(d.metres ORDER BY d.metres) AS metres
       FROM (SELECT o.name, min(ST_Distance(e.location::geography, p.geom::geography)) AS metres
               FROM region_geom_pieces p JOIN regions o ON o.id = p.region_id
              WHERE o.world_view_id = w.id AND o.is_leaf
                AND ST_DWithin(p.geom, e.location, ${SEARCH_DEGREES} / greatest(cos(radians(ST_Y(e.location))), 0.05))
              GROUP BY o.id, o.name
             HAVING min(ST_Distance(e.location::geography, p.geom::geography)) <= ${SUGGEST_WITHIN_M}
              ORDER BY 2 LIMIT 2) d) n
   WHERE n.names IS NOT NULL
     AND EXISTS (SELECT 1 FROM experience_regions placed JOIN regions pr ON pr.id = placed.region_id
                  WHERE pr.world_view_id = w.id)`;

/** One world view's suggestion, said with the next region when one is near enough to doubt the first. */
function suggestion(s: AssertionRow): string {
  const next = text(s, 'next')
    ? `next ${text(s, 'next')} at ${distance(count(s, 'next_metres'))}`
    : `nothing else within ${distance(SUGGEST_WITHIN_M)}`;
  return `nearest ${text(s, 'region')} (${text(s, 'view')}) at ${distance(count(s, 'metres'))}, ${next}`;
}

/**
 * An object a reader is offered that no region holds.
 *
 * The first assertion this lane carries about *where things are* rather than
 * about the places themselves, and the first one the catalogue does not pass:
 * 28 objects on the dev catalogue the day it was written. It is here for both
 * reasons — the fact is worth reporting, and a lane whose whole design rests
 * on carrying known debt should be proved against real debt rather than
 * against an empty result.
 *
 * What it means on the ground: the object is in search and on the map, and
 * browsing cannot reach it. Every region page a traveller opens is a list of
 * what is there, and this object is in none of them, so the only way to find
 * it is to already know its name.
 *
 * The known cause is a matching gap rather than a defect in the roll-up — a
 * point that falls just outside every region's boundary (#469) or lies
 * offshore (#470) is placed nowhere at all. That is why the remedy is a
 * curator's manual claim or a better match, and why this number is expected to
 * be worked down rather than to be zero tomorrow. Each row names the nearest
 * leaf of every placed world view within `SUGGEST_WITHIN_M` and the next one,
 * the nearest first, so a curator starts with the rows that are quickest to settle.
 *
 * Membership is read whole here, not through `readerRegionMembershipSql`. That
 * fragment answers "may this reader be shown this object *in this region*",
 * which needs a region to be about; the question here is whether **any** row
 * puts the object anywhere, and an object held only by a row a reader cannot
 * see is `listed-with-nowhere-to-go`'s business rather than this one's.
 */
const heldByNoRegion: CatalogueAssertion = {
  id: 'held-by-no-region',
  area: 'regions',
  title: 'An object offered to readers that no region holds',
  kind: 'invariant',
  meaning:
    'The object cannot be found by browsing: no region page lists it, though search and the map '
    + 'still have it. Usually a point that fell outside every boundary (#469) or lies offshore '
    + `(#470). Where a region lies within ${SUGGEST_WITHIN_M / 1000} km the row names the nearest and the next: a curator `
    + 'who agrees adds the object to that region by hand, and one who does not adds it to the right one. '
    + 'Nothing is placed without a curator.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               e.external_id AS external_id,
               array_to_string(e.country_names, ', ') AS countries,
               near.suggestions
          FROM experiences e
          LEFT JOIN LATERAL (${nearestLeavesSql}) near ON true
         WHERE ${hideLostSql()}
           AND ${experienceOfferedToReaderSql()}
           AND NOT EXISTS (SELECT 1 FROM experience_regions er
                            WHERE er.experience_id = e.id)
         ORDER BY near.nearest_metres NULLS LAST, e.name`,
  describe: row => {
    const where = text(row, 'countries') || 'no country named';
    const near = Array.isArray(row.suggestions) && row.suggestions.length
      ? (row.suggestions as AssertionRow[]).map(suggestion).join('; ')
      : `no region within ${distance(SUGGEST_WITHIN_M)}`;
    return `${text(row, 'experience_name')} (${text(row, 'external_id')}): in ${where}, `
      + `and in no region; ${near} (experience ${count(row, 'experience_id')})`;
  },
};

/**
 * A place the source still offers that no region holds.
 *
 * The point-level half of the assertion above, and where its 28 objects come
 * from: 173 offered points carry no `experience_location_regions` row at all.
 * Both are worth asking. An object no region holds cannot be browsed to; a
 * point no region holds is a pin that votes nowhere, and an object with several
 * places can be perfectly findable while one of its components is not counted
 * anywhere.
 *
 * The predicate is placement's own, not a reader's, and that is the point:
 * placement writes from every *offered* point, unread ones included, precisely
 * so a region curator's queue is not empty (ADR-0025 decision 5). So an offered
 * point missing from the roll-up is placement not having reached it, whatever a
 * reader may see of it. One exception, and it is placement's own too: a point a
 * curator turned down (ADR-0053) is still offered on the source's terms but
 * never to be published, so placement gives it no row on purpose — carried here
 * as `refused_at IS NULL`, or every refusal would read as a failed run.
 *
 * Read as a traveller would: Aldabra Atoll, the Great Barrier Reef, Bikini
 * Atoll, Cordouan Lighthouse standing in the Gironde estuary. What these have
 * in common is water — a boundary set built from land polygons has nowhere to
 * put them (#470), and a point a few metres outside a coastline has the same
 * problem for a different reason (#469).
 */
const offeredPlaceInNoRegion: CatalogueAssertion = {
  id: 'offered-place-in-no-region',
  area: 'regions',
  title: 'A place the source still offers that no region holds',
  kind: 'invariant',
  meaning:
    'Placement never put this point anywhere, so it counts towards no region and votes on no '
    + 'membership. Offshore and just-outside-the-boundary points are the known causes (#470, #469); '
    + 'a jump in this number means a placement run failed rather than a coastline being awkward.',
  sql: `SELECT el.id AS location_id,
               el.name AS place_name,
               e.id AS experience_id,
               e.name AS experience_name
          FROM experience_locations el
          -- Named by the object a reader finds it under: a part's site (ADR-0100).
          JOIN experiences e ON e.id = ${answeringPlaceSql()}
         WHERE ${offeredLocationSql()}
           AND el.refused_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM experience_location_regions r
                            WHERE r.location_id = el.id)
         ORDER BY e.name, el.id`,
  describe: row => {
    const place = text(row, 'place_name') || `location ${count(row, 'location_id')}`;
    return `${text(row, 'experience_name')} — ${place}: on offer and in no region `
      + `(location ${count(row, 'location_id')})`;
  },
};


export const unplacedAssertions: CatalogueAssertion[] = [heldByNoRegion, offeredPlaceInNoRegion];
