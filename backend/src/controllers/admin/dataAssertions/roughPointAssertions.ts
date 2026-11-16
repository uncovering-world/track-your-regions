/**
 * The World Heritage points the list placed only roughly and nobody has placed
 * since (#1853, #1903): those something says where they may stand, which the
 * *Where is it?* card asks about, and those nothing does, which the queue
 * lists apart to be kept or placed by hand. Both are `watch`: the list gives
 * these points, so their count is expected, and what carries the meaning is
 * the number coming down as curators place them, or one moving from the
 * second list to the first when a pass finds a hint. A third compares the
 * mark the run stored on a point with what the line's record says, while
 * both exist (#2123).
 */

import { MEMBERSHIPS } from '../../../db/membership.js';
import { answeringPlaceSql, pointRecordSql, pointRoughSql } from '../../../db/placePoints.js';
import { approximatePointAskedSql, approximatePointsOpenSql } from '../../experience/reviewQueuePredicates.js';
import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';

/**
 * The open rough points, `hinted` or not, on the site whose card asks about
 * them, under the card's own guards: what the queue asks, and only that.
 */
const roughPointsSql = (hinted: boolean) => `
  SELECT el.id AS location_id, el.name AS point_name, el.external_ref, ${pointRoughSql('el')} AS reason,
         site.id AS site_id, site.name AS site_name
    FROM experience_locations el
    JOIN experiences site ON site.id = ${answeringPlaceSql('el')}
   WHERE ${approximatePointAskedSql(hinted, 'el')}
     AND ${approximatePointsOpenSql('site', hinted)}
   ORDER BY site.name, el.external_ref, el.id`;

const describeRoughPoint = (row: AssertionRow): string => {
  const why = text(row, 'reason') === 'shared' ? 'on a point other components share' : 'given to the whole minute';
  return `${text(row, 'site_name')}: ${text(row, 'point_name') || text(row, 'external_ref')} `
    + `(${text(row, 'external_ref')}), ${why}`;
};

const roughPointsWithAHint: CatalogueAssertion = {
  id: 'rough-points-with-a-hint',
  area: 'objects',
  title: 'A World Heritage point placed only roughly, with a hint of where it stands',
  kind: 'watch',
  meaning:
    'The World Heritage list gives these components only to the whole minute, a cell about two kilometres '
    + 'across, or on one point several components share, and something says where they may really stand: '
    + 'an OpenStreetMap object carrying the component\'s number, its own Wikidata item, a candidate, or a '
    + 'namesake nearby. Each is asked on the review page\'s *Where is it?* card. Watch the number come down '
    + 'as curators place them; a jump means a Find component items pass found new hints.',
  sql: roughPointsSql(true),
  describe: describeRoughPoint,
};

const roughPointsWithNoHint: CatalogueAssertion = {
  id: 'rough-points-with-no-hint',
  area: 'objects',
  title: 'A World Heritage point placed only roughly that nothing says more about',
  kind: 'watch',
  meaning:
    'The World Heritage list gives these components only roughly, and nothing the catalogue reads says '
    + 'where else they stand: no map object carries their number, no Wikidata entry or namesake stands '
    + 'near. Readers see the list\'s point. The review page lists them apart, to be kept where the point '
    + 'serves a large area well enough or placed by hand; a point leaves this list when a pass finds it '
    + 'a hint, for the one above.',
  sql: roughPointsSql(false),
  describe: describeRoughPoint,
};

/**
 * A point whose stored mark and its line's record disagree about whether it
 * stands only roughly (ADR-0213 decision 5, #2123).
 *
 * "Approximate" moved from a mark the run stored on each point
 * (`experience_locations.approximate`) to the precision the line's record
 * holds (`pointRoughSql`). The run still writes the mark, so while both exist
 * they must agree on every point the list still gives: a row is a point a
 * reader is told is rough by one and not the other, or for another reason.
 * The mark goes with the points (#2124), and this check with it.
 */
const pointRoughOutOfStep: CatalogueAssertion = {
  id: 'point-rough-out-of-step',
  area: 'objects',
  title: 'A World Heritage point whose record and stored mark disagree about whether it is placed only roughly',
  kind: 'invariant',
  meaning:
    'The World Heritage run marks a rough point, and the line\'s record must say the same until the points go. '
    + 'A row that stays needs nothing where the point stands away from the list\'s coordinate, or in another country than its record\'s. '
    + 'Tell the admin who runs the World Heritage list about any other row that stays.',
  sql: `SELECT site.id AS site_id, site.name AS site_name, el.id AS location_id, el.name AS point_name,
               el.external_ref, mark.by_point, mark.by_record
          FROM experience_locations el
          JOIN experiences site ON site.id = ${answeringPlaceSql('el')}
         CROSS JOIN LATERAL (
           SELECT CASE WHEN NOT el.curated_fields ? 'location' THEN el.approximate END AS by_point,
                  ${pointRoughSql('el')} AS by_record) mark
         WHERE el.merged_into_id IS NULL AND el.missing_since IS NULL
           AND ${pointRecordSql('el', 'any_rec', '1')} IS NOT NULL
           AND (el.approximate IS NOT NULL
                OR EXISTS (SELECT 1 FROM ${MEMBERSHIPS} rough
                            WHERE rough.experience_id = el.experience_id AND rough.reported_location_rough IS NOT NULL))
           AND mark.by_point IS DISTINCT FROM mark.by_record
         ORDER BY site.name, el.external_ref, el.id`,
  describe: (row: AssertionRow) => `${text(row, 'site_name')}: ${text(row, 'point_name') || text(row, 'external_ref')} `
    + `(${text(row, 'external_ref')}, point ${count(row, 'location_id')}) is ${text(row, 'by_point') || 'not rough'} `
    + `by its mark and ${text(row, 'by_record') || 'not rough'} by its record`,
};

/** The rough points, asked and listed apart, and the two readings of rough compared. */
export const roughPointAssertions: CatalogueAssertion[] = [roughPointsWithAHint, roughPointsWithNoHint, pointRoughOutOfStep];
