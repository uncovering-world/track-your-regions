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
 * Placement now takes the nearest leaf itself where it is plain: within 25 km,
 * with no other leaf within 1.5 times that distance (`place_shape_regions_expected()`,
 * ADR-0207), so Gorée is in Dakar and the Golden Gate Bridge in California.
 * What is left here is what that rule leaves: a point between two leaves
 * nearly as near, which is usually a place on both sides (the Øresund Bridge,
 * 3.1 km from Copenhagen and 4.5 km from Skåne, until its line places it), and
 * the open sea, the Phoenix Islands at 86 km to Malpelo at 355 km, whose
 * nearest leaf names nothing a traveller would recognise as theirs (#470).
 * Those a curator decides, as a place near a border is decided (#1054): the
 * curator adds the object to the region by hand, and that row is told apart
 * from a containment by its `assignment_type`. The next region and its
 * distance are what say which of the two a row is.
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
 * point between two leaves nearly as near, or far out at sea (#470), which the
 * nearest-leaf rule leaves unplaced on purpose. That is why the remedy is a
 * curator's manual claim or a line that places it, and why this number is
 * expected to be worked down rather than to be zero tomorrow. Each row names the nearest
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
    + 'still have it. Placement takes the nearest region of a point within 25 km when no other region is '
    + 'nearly as near, so what is left is a point between two regions nearly as near, or far out at sea '
    + `(#470). Where a region lies within ${SUGGEST_WITHIN_M / 1000} km the row names the nearest and the next: a curator `
    + 'adds the object to the right one by hand.',
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

/**
 * A place whose outline lies more than a kilometre from its point.
 *
 * Such an outline is another object of the same name, which the site door
 * matched by its item: the Pergamon Altar stands in Berlin and its outline is
 * the ancient city's in Izmir, 1,827 km away; Trelleborg's is the Swedish
 * town's, 119 km from the Danish fortress. It places nothing
 * (`outline_reaches_place()`, ADR-0207), so the place keeps the regions its
 * point gives, but it is still drawn around a place it is not. 100 places on
 * the development catalogue (2026-11-15).
 */
const outlineAwayFromItsPlace: CatalogueAssertion = {
  id: 'outline-away-from-its-place',
  area: 'regions',
  title: 'A place whose outline lies away from its point',
  kind: 'invariant',
  meaning:
    'The outline drawn for this place lies more than 1 km from its point, so it is most likely the outline '
    + 'of another place of the same name. It does not decide the regions the place is listed in, but it is '
    + 'still drawn. A developer looks at how the site door matched it.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               round(ST_Distance(e.boundary::geography, e.location::geography))::int AS metres
          FROM experiences e
         WHERE e.boundary IS NOT NULL AND NOT outline_reaches_place(e.boundary, e.location)
         ORDER BY metres DESC, e.name`,
  describe: row => `${text(row, 'experience_name')}: its outline lies ${distance(count(row, 'metres'))} `
    + `from its point (experience ${count(row, 'experience_id')})`,
};

/**
 * A place's automatic region row its points no longer give, a row they give
 * that the place lacks, or a row whose listing says otherwise.
 *
 * Nothing writes a place's automatic rows but `refresh_place_regions()`, which
 * placement and the triggers on a point's state and a part relation call
 * (ADR-0197); a write that skipped them (a trigger disabled for a bulk load,
 * placement failing after its point rows) leaves a place listed where its
 * points are not, or missing where they are. The expected rows are the
 * refresh's own (`place_regions_expected()`) over every place it covers
 * (`places_with_regions()`). A curator's manual row is never out of step.
 */
const placeRegionsOutOfStep: CatalogueAssertion = {
  id: 'place-regions-out-of-step',
  area: 'regions',
  title: 'A place whose regions no longer match where it lies',
  kind: 'invariant',
  meaning:
    'The regions this place is listed in no longer match where its points and its outline lie, or what '
    + 'readers may see of them. A change skipped the update that keeps the two together. Running Region Assignment for '
    + 'the world view brings them back.',
  sql: `WITH expected AS (
          SELECT x.experience_id, x.region_id, x.listing
            FROM place_regions_expected(places_with_regions()) x
        )
        SELECT COALESCE(x.experience_id, er.experience_id) AS experience_id,
               e.name AS experience_name,
               r.name AS region_name,
               x.listing AS expected_listing,
               er.listing AS held_listing
          FROM expected x
          FULL JOIN experience_regions er
            ON er.experience_id = x.experience_id AND er.region_id = x.region_id
          JOIN experiences e ON e.id = COALESCE(x.experience_id, er.experience_id)
          JOIN regions r ON r.id = COALESCE(x.region_id, er.region_id)
         WHERE er.experience_id IS NULL
            OR (er.assignment_type IS DISTINCT FROM 'manual'
                AND (x.experience_id IS NULL OR x.listing IS DISTINCT FROM er.listing))
         ORDER BY e.name, r.name`,
  describe: row => {
    const held = { '': 'is not listed', offered: 'is listed for readers' }[text(row, 'held_listing')]
      ?? 'is listed for curators only';
    const expected = { '': 'where it lies does not put it there', offered: 'where it lies lists it for readers' }[
      text(row, 'expected_listing')] ?? 'where it lies lists it for curators only';
    return `${text(row, 'experience_name')} in ${text(row, 'region_name')} ${held}, but ${expected} `
      + `(experience ${count(row, 'experience_id')})`;
  },
};

/**
 * A whole's leaf row its parts no longer give, a leaf they give that the
 * whole lacks, or a leaf whose offered flag says otherwise.
 *
 * Nothing writes `whole_leaves` but `refresh_whole_leaves()`, which the
 * triggers on a part relation and a point's state call (ADR-0206); a write
 * that skipped them (a trigger disabled for a bulk load) leaves a whole
 * counting a place that is no longer under it, missing one that is, or
 * counting a place as shown that readers are not shown. The expected rows are
 * the refresh's own (`whole_leaves_expected()`) over every whole.
 */
const wholeLeavesOutOfStep: CatalogueAssertion = {
  id: 'whole-leaves-out-of-step',
  area: 'places',
  title: 'A place made of parts whose count of places no longer matches its parts',
  kind: 'invariant',
  meaning:
    'This site counts a place its parts no longer give, misses one they do, or counts one readers are '
    + 'not shown. Its count of places is then wrong. A developer running refresh_whole_leaves for the site '
    + 'settles it.',
  sql: `WITH expected AS (
          SELECT x.whole_id, x.leaf_id, x.offered FROM whole_leaves_expected(NULL) x
        )
        SELECT COALESCE(x.whole_id, wl.whole_id) AS whole_id,
               whole.name AS whole_name,
               COALESCE(x.leaf_id, wl.leaf_id) AS leaf_id,
               leaf.name AS leaf_name,
               x.offered AS expected_offered,
               wl.offered AS held_offered
          FROM expected x
          FULL JOIN whole_leaves wl ON wl.whole_id = x.whole_id AND wl.leaf_id = x.leaf_id
          JOIN experiences whole ON whole.id = COALESCE(x.whole_id, wl.whole_id)
          JOIN experiences leaf ON leaf.id = COALESCE(x.leaf_id, wl.leaf_id)
         WHERE x.whole_id IS NULL OR wl.whole_id IS NULL OR x.offered IS DISTINCT FROM wl.offered
         ORDER BY whole.name, leaf.name`,
  describe: row => {
    const shown = (key: string) => (row[key] === true ? 'shown to readers' : 'not shown to readers');
    const ids = `(experience ${count(row, 'whole_id')}, place ${count(row, 'leaf_id')})`;
    const [whole, leaf] = [text(row, 'whole_name'), text(row, 'leaf_name')];
    if (row.held_offered === null || row.held_offered === undefined) {
      return `${whole} does not count ${leaf}, a place of its parts ${shown('expected_offered')} ${ids}`;
    }
    if (row.expected_offered === null || row.expected_offered === undefined) {
      return `${whole} counts ${leaf}, which is no longer a place of its parts ${ids}`;
    }
    return `${whole} counts ${leaf} as ${shown('held_offered')}, but it is ${shown('expected_offered')} ${ids}`;
  },
};

export const unplacedAssertions: CatalogueAssertion[] = [
  heldByNoRegion, offeredPlaceInNoRegion, outlineAwayFromItsPlace, placeRegionsOutOfStep, wholeLeavesOutOfStep,
];
