/**
 * A region's tail: the places a crowded city crowds out of its list (ADR-0172,
 * #2201), read on their own, never mixed into the list. Two statements over
 * the same set the list reads, a region and its subregions where the caller
 * asks for them, less what a curator rejected from the region:
 *
 * - how many each kind and type crowds out, which the region's list answers
 *   beside its rows, so the list can offer "40 more churches in the shade";
 * - the places themselves, the best known first within each kind, each row
 *   carrying the kind it is crowded out of.
 *
 * A place is in a kind's tail by its membership there, whatever other kind
 * shows it: a church crowded out of Rome's places of worship and offered as a
 * tower is in the towers' list and in the churches' tail.
 */

import {
  CROWDING, KINDS, MEMBERSHIPS, membershipCrowdedSql, membershipOfferedSql,
} from '../../db/membership.js';
import { experienceOfferedToReaderSql, readerRegionMembershipSql } from '../../db/readerPredicates.js';
import { canCurateExperienceSql } from '../../middleware/auth.js';
import { rowColumnsSql } from './experienceRegionQuery.js';

/** The region, or the region and every region under it, as `scope_regions`. */
function regionScopeSql(includeChildren: boolean): string {
  return includeChildren
    ? `scope_regions AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r JOIN scope_regions s ON r.parent_region_id = s.id
      )`
    : 'scope_regions AS (SELECT $1::int AS id)';
}

/**
 * The places of the region a reader may be shown there, before crowding: in
 * the region by a point the reader may see, not rejected from it, and offered.
 * Over `e`, `er` and `rej`. A place that no longer stands is no candidate, so
 * no crowding row names one (`recount_crowding()`), and the tail asks nothing
 * of existence.
 */
const placeInRegionSql = `er.region_id IN (SELECT id FROM scope_regions)
        AND rej.id IS NULL
        AND ${readerRegionMembershipSql()}
        AND ${experienceOfferedToReaderSql()}`;

const REJECTION_JOIN = 'LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id IN (SELECT id FROM scope_regions)';

/**
 * How many places each kind and type crowds out of the region's list: one row
 * per kind and type with any. `$1` is the region.
 */
export function regionTailCountsQuery(includeChildren: boolean): string {
  return `
    WITH RECURSIVE ${regionScopeSql(includeChildren)}
    SELECT m.kind_id, m.type, COUNT(DISTINCT e.id)::int AS count
      FROM ${CROWDING} c
      JOIN ${MEMBERSHIPS} m ON m.id = c.membership_id
      JOIN experiences e ON e.id = m.experience_id
      JOIN experience_regions er ON er.experience_id = e.id
      ${REJECTION_JOIN}
     WHERE ${membershipOfferedSql('m')}
       AND ${placeInRegionSql}
     GROUP BY m.kind_id, m.type
     ORDER BY m.kind_id, m.type`;
}

/**
 * The statements of one page of the region's tail, in one kind or every kind,
 * and their parameters. `$1` is the region, `$2` and `$3` the page; then the
 * reader as `$4` where there is one, as the New chip and a curator's column
 * read it, and the kind or null after it.
 */
export function buildRegionTailQueries(opts: {
  regionId: number;
  includeChildren: boolean;
  kindId: number | null;
  limit: number;
  offset: number;
  userId?: number;
  curateAs?: 'admin' | 'curator';
}): { query: string; countQuery: string; params: Array<number | null>; countParams: Array<number | null> } {
  const { regionId, includeChildren, kindId, limit, offset, userId, curateAs } = opts;
  let canCurateSelect = '';
  if (curateAs === 'admin') canCurateSelect = ', TRUE AS can_curate';
  else if (curateAs === 'curator' && userId) canCurateSelect = `, ${canCurateExperienceSql('$4')} AS can_curate`;
  const kindParam = userId ? '$5' : '$4';
  const query = `
    WITH RECURSIVE ${regionScopeSql(includeChildren)},${tailPlacesSql(kindParam)}
    ${rowColumnsSql(userId ? '$4' : 'NULL', '', canCurateSelect, true)}
      FROM places p
      JOIN experiences e ON e.id = p.id
      -- The kind it is crowded out of, the first in display order where it is
      -- crowded out of several: the row the tail lists it under.
      JOIN LATERAL (SELECT tm.* FROM ${MEMBERSHIPS} tm JOIN ${KINDS} tk ON tk.id = tm.kind_id
                     WHERE tm.experience_id = e.id AND ${crowdedInSql(kindParam)}
                     ORDER BY tk.display_priority, tm.kind_id
                     LIMIT 1) m ON true
      JOIN ${KINDS} k ON k.id = m.kind_id
      LEFT JOIN membership_fame f ON f.membership_id = m.id
     -- The best known first within each kind, whatever its type: a reader
     -- looks down one list, and a well-known temple does not belong under
     -- forty churches. The name and the id break a tie, so a page never
     -- repeats one.
     ORDER BY k.display_priority, m.kind_id, f.score DESC NULLS LAST, e.name, e.id
     LIMIT $2 OFFSET $3`;
  const countQuery = `
    WITH RECURSIVE ${regionScopeSql(includeChildren)},${tailPlacesSql('$2')}
    SELECT COUNT(*)::int AS total FROM places`;
  const params: Array<number | null> = userId ? [regionId, limit, offset, userId, kindId] : [regionId, limit, offset, kindId];
  return { query, countQuery, params, countParams: [regionId, kindId] };
}

/** A membership `tm` crowded out of the kind `kindParam` names, or of any kind where it is null. */
function crowdedInSql(kindParam: string): string {
  return `${membershipOfferedSql('tm')} AND ${membershipCrowdedSql('tm')}
              AND (${kindParam}::int IS NULL OR tm.kind_id = ${kindParam})`;
}

/** The region's places in the tail of the kind `kindParam` names, or of any, as `places`. */
function tailPlacesSql(kindParam: string): string {
  return `
      places AS (
        SELECT DISTINCT e.id
          FROM experiences e
          JOIN experience_regions er ON er.experience_id = e.id
          ${REJECTION_JOIN}
         WHERE ${placeInRegionSql}
           AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} tm WHERE tm.experience_id = e.id AND ${crowdedInSql(kindParam)})
      )`;
}
