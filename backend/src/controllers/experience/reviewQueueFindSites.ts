/**
 * The review queue's card for a site a run proposed finds for (#2304): the
 * finds a museum holds whose own Wikidata point stands on the site, which a
 * curator confirms as from this site or turns down, one find at a time
 * (`findSiteProposals.ts`, #2242). The card's questions are the place
 * dialog's own (`SiteFindQuestions`, `findSiteLinksController.ts`); the row
 * carries how many are open, so the list says it without reading them.
 *
 * Which sites are asked about is `openFindProposalsSql` (`siteFinds.ts`), the
 * rule the keys phase reads too.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { openFindProposalsSql } from './siteFinds.js';

/** The cards of `ids`, each with the number of its finds still asked about. */
export async function queryFindSites(ids: number[]): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, mk.kind_id, kd.name AS kind_name, mk.type AS kind_type,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'find-sites' AS kind, NULL::jsonb AS proposed,
           ${openFindProposalsSql('e')} AS find_proposals
      FROM experiences e
      ${rowKindJoinSql('e', 'mk', 'kd')}
     WHERE e.id = ANY($1::int[])
       AND ${openFindProposalsSql('e')} > 0
     ORDER BY e.id
  `, [ids]);
}
