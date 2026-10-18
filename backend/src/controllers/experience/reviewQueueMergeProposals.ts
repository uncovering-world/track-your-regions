/**
 * The review queue's card for two near places with similar names (#1249,
 * ADR-0046 decisions 2 to 4): one card per place that would stay if the pair
 * were made one — the lower id, `place_a` — with a row per open pair, the
 * other place beside it: its name, the kinds it is in, its picture, its point
 * and its Wikidata item, how far apart the two stand and how alike their names
 * are, whether they are *exact* (one and the same folded name within fifty
 * metres), and the reach the pass found them under.
 *
 * Which pairs are asked is `mergeProposalOpenSql` (`reviewQueuePredicates.ts`),
 * the one rule the keys phase and the answer (`mergeProposalController.ts`)
 * read too. The card names the anchor's first membership, so an answer from
 * the batch is scoped as the keys phase scoped the question: by a source of
 * either place.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS, rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { membershipItemSql } from './equalItemMerges.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { mergeProposalOpenSql } from './reviewQueuePredicates.js';

/**
 * The names of the kinds a place's memberships put it in, in display order, as
 * a jsonb array. Read by the card's row and by Jev's question about the same
 * pair (`mergeProposalSuggestionController.ts`), so the two name one fact.
 */
export function kindNamesSql(place: string): string {
  return `(SELECT COALESCE(jsonb_agg(k.name ORDER BY k.display_priority, k.id), '[]'::jsonb)
             FROM ${MEMBERSHIPS} km JOIN ${KINDS} k ON k.id = km.kind_id
            WHERE km.experience_id = ${place}.id)`;
}

/** The Wikidata item a place's memberships make it, or null (`membershipItemSql`); read by the card and by Jev's question alike. */
export function itemSql(place: string): string {
  return `(SELECT ${membershipItemSql('km', place)} FROM ${MEMBERSHIPS} km
            WHERE km.experience_id = ${place}.id AND ${membershipItemSql('km', place)} IS NOT NULL
            ORDER BY km.id LIMIT 1)`;
}

/** Every open pair of the anchor, as a jsonb array, the most alike first. */
const PAIRS = `(SELECT jsonb_agg(jsonb_build_object(
           'proposalId', p.id,
           'otherId', b.id,
           'otherName', b.name,
           'otherKinds', ${kindNamesSql('b')},
           'otherImageUrl', b.image_url,
           'otherImageCredit', b.metadata -> 'imageCredit',
           'otherLatitude', ST_Y(b.location),
           'otherLongitude', ST_X(b.location),
           'otherWikidataItem', ${itemSql('b')},
           'anchorWikidataItem', ${itemSql('e')},
           'distanceM', p.distance_m,
           'nameSimilarity', p.name_similarity,
           'exact', p.exact,
           'reachM', p.reach_m,
           'foundBy', p.found_by,
           'proposedAt', p.proposed_at)
         ORDER BY p.name_similarity DESC, p.distance_m, p.id)
       FROM experience_merge_proposals p
       JOIN experiences b ON b.id = p.place_b
      WHERE p.place_a = e.id AND ${mergeProposalOpenSql('p', 'e', 'b')})`;

/** The anchor's first membership: whose source a batch answer names, as the keys phase scoped the row. */
const ANCHOR_MEMBERSHIP = `(SELECT m.id FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id ORDER BY m.id LIMIT 1)`;

export async function queryMergeProposals(ids: number[]): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, e.source_id, mk.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'merge-proposals' AS kind, NULL::jsonb AS proposed,
           ${ANCHOR_MEMBERSHIP} AS membership_id,
           ${PAIRS} AS merge_pairs
      FROM experiences e
      ${rowKindJoinSql('e', 'mk', 'kd')}
     WHERE e.id = ANY($1::int[])
       AND EXISTS (SELECT 1 FROM experience_merge_proposals p JOIN experiences b ON b.id = p.place_b
                    WHERE p.place_a = e.id AND ${mergeProposalOpenSql('p', 'e', 'b')})
     ORDER BY e.id
  `, [ids]);
}
