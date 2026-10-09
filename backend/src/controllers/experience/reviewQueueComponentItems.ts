/**
 * The review queue's card for a serial World Heritage site some component of
 * which has a candidate Wikidata item (#1272): one card per site, a row per
 * candidate, grouped by the point it is proposed for — the item by its label
 * and id, how far from the point it stands and where, how alike the names are,
 * whether they are the same name at the same spot (`exact`), and the rule that
 * found it (`basis`).
 *
 * Which candidates are asked is `openProposalSql` (`reviewQueuePredicates.ts`),
 * the one rule the keys phase and the answer (`componentItemController.ts`)
 * read too. The card names the membership that places the points, so an
 * answer from the batch is scoped by that membership's source as the keys
 * phase scoped the question.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS, rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { componentItemsOpenSql, openProposalSql } from './reviewQueuePredicates.js';

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
           'basis', p.basis,
           'itemLatitude', ST_Y(p.item_location),
           'itemLongitude', ST_X(p.item_location),
           'proposedAt', p.proposed_at)
         ORDER BY el.ordinal NULLS LAST, el.id, p.exact DESC, p.distance_m, p.id)
       FROM experience_component_item_proposals p
       JOIN experience_locations el ON el.id = p.location_id
      WHERE el.experience_id = e.id AND ${openProposalSql('p', 'el')})`;

/** The membership that places a point with an open candidate: whose source the answer is scoped by. */
const PLACING_MEMBERSHIP = `(SELECT pl.membership_id
       FROM experience_component_item_proposals p
       JOIN experience_locations el ON el.id = p.location_id
       JOIN experience_location_placements pl ON pl.location_id = el.id
       JOIN ${MEMBERSHIPS} m ON m.id = pl.membership_id
      WHERE el.experience_id = e.id AND ${openProposalSql('p', 'el')}
      ORDER BY m.id LIMIT 1)`;

export async function queryComponentItems(ids: number[]): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, e.source_id, mk.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'component-items' AS kind, NULL::jsonb AS proposed,
           ${PLACING_MEMBERSHIP} AS membership_id,
           ${CANDIDATES} AS component_items
      FROM experiences e
      ${rowKindJoinSql('e', 'mk', 'kd')}
     WHERE e.id = ANY($1::int[])
       AND ${componentItemsOpenSql('e')}
     ORDER BY e.id
  `, [ids]);
}
