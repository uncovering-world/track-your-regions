/**
 * The review queue's card for a serial World Heritage site some component of
 * which has a candidate Wikidata item (#1272): one card per site, a row per
 * candidate, grouped by the point it is proposed for — the item by its label
 * and id, how far from the point it stands and where, how alike the names are,
 * whether they are the same name at the same spot (`exact`), the rule that
 * found it (`basis`), and its national register code with whether the code's
 * group disagrees with the site's (#1340), a disagreeing candidate below the
 * ones that agree.
 *
 * Which candidates are asked is `openProposalSql` (`reviewQueuePredicates.ts`),
 * the one rule the keys phase and the answer (`componentItemController.ts`)
 * read too. The card names the membership that places the points, so an
 * answer from the batch is scoped by that membership's source as the keys
 * phase scoped the question.
 *
 * The card also carries every place the site is made of (#1342), each with its
 * own picture where it has one: whether a cave 11 m from a component's point
 * is that component or its neighbour is read from where the other components
 * stand, so the card draws them all on its map.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS, rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql, placeOfObjectSql } from './reviewQueueContext.js';
import { componentItemsOpenSql, openProposalSql } from './reviewQueuePredicates.js';
import { pointOfPartSql, pointsShownSql } from '../../db/placePoints.js';

/** Every open candidate of the site's points, as a jsonb array, the points in the source's order. */
const CANDIDATES = `(SELECT jsonb_agg(jsonb_build_object(
           'proposalId', p.id,
           'locationId', el.id,
           'pointName', el.name,
           'pointRef', el.external_ref,
           'latitude', ST_Y(el.location),
           'longitude', ST_X(el.location),
           'item', p.wikidata_item,
           'label', p.item_label,
           'distanceM', p.distance_m,
           'similarity', p.name_similarity,
           'exact', p.exact,
           'takenBack', p.taken_back_at IS NOT NULL,
           'basis', p.basis,
           'itemLatitude', ST_Y(p.item_location),
           'itemLongitude', ST_X(p.item_location),
           'registerCode', p.register_code,
           'registerDisagrees', p.register_disagrees,
           'proposedAt', p.proposed_at)
         ORDER BY el.ordinal NULLS LAST, el.id, p.exact DESC, p.register_disagrees, p.distance_m, p.id)
       FROM ${pointsShownSql('e.id', 'el')}
       JOIN experience_component_item_proposals p ON p.location_id = el.id
      WHERE ${openProposalSql('p', 'el')})`;

/**
 * Every place the site is made of, in the source's order: what its map draws
 * around the candidates, and around a point the list placed only roughly
 * (`reviewQueueApproximatePoints.ts`).
 */
export const SITE_POINTS = `(SELECT jsonb_agg(jsonb_build_object(
           'locationId', sp.id,
           'name', sp.name,
           'ref', sp.external_ref,
           'latitude', ST_Y(sp.location),
           'longitude', ST_X(sp.location),
           -- A part's picture is its own row's (ADR-0156 decision 3).
           'imageUrl', CASE WHEN ${pointOfPartSql('sp')}
                            THEN (SELECT sp_part.image_url FROM experiences sp_part WHERE sp_part.id = sp.experience_id)
                            ELSE sp.image_url END,
           'imageCredit', CASE WHEN ${pointOfPartSql('sp')}
                               THEN (SELECT sp_part.metadata -> 'imageCredit' FROM experiences sp_part WHERE sp_part.id = sp.experience_id)
                               ELSE sp.metadata -> 'imageCredit' END)
         ORDER BY sp.ordinal NULLS LAST, sp.id)
       FROM ${pointsShownSql('e.id', 'sp')}
      WHERE ${placeOfObjectSql('sp')})`;

/** The membership that places a point with an open candidate: whose source the answer is scoped by. */
const PLACING_MEMBERSHIP = `(SELECT pl.membership_id
       FROM ${pointsShownSql('e.id', 'el')}
       JOIN experience_component_item_proposals p ON p.location_id = el.id
       JOIN experience_location_placements pl ON pl.location_id = el.id
       JOIN ${MEMBERSHIPS} m ON m.id = pl.membership_id
      WHERE ${openProposalSql('p', 'el')}
      ORDER BY m.id LIMIT 1)`;

export async function queryComponentItems(ids: number[]): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, mk.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'component-items' AS kind, NULL::jsonb AS proposed,
           ${PLACING_MEMBERSHIP} AS membership_id,
           ${CANDIDATES} AS component_items,
           ${SITE_POINTS} AS site_points
      FROM experiences e
      ${rowKindJoinSql('e', 'mk', 'kd')}
     WHERE e.id = ANY($1::int[])
       AND ${componentItemsOpenSql('e')}
     ORDER BY e.id
  `, [ids]);
}
