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
 * either place. Each place's item carries its label and description from the
 * local Wikidata subset (`termsOf`), so a curator tells two items apart on the
 * card (#1970): Babylon's city, Q5684, from its World Heritage listing,
 * Q100329356.
 */

import type { QueryResult } from 'pg';
import type { MergePair } from '../../api/responses/reviewQueue.js';
import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS, rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { termsOf } from '../../services/sync/subset/entities.js';
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

/**
 * The Wikidata item a membership makes its place, or NULL: a Wikidata source's
 * own id, or, for a source that knows the place by another id, the one item
 * that id resolves to (`wikidata_items`, a World Heritage site's through P757,
 * #1248, ADR-0088) — and only for a place of exactly one standing point, since
 * a serial site's items name its parts and wait for identity per location, and
 * a place whose point was never written is not yet the place its item names. A
 * point its source withdrew is not one of the place's points (#1360). The
 * registry's `site-items` claim states the same rule (`place_identifier_claims()`).
 */
function membershipItemSql(membership: string, place: string): string {
  return `CASE WHEN ${membership}.external_id ~ '^Q[0-9]+$' THEN ${membership}.external_id
               WHEN cardinality(${membership}.wikidata_items) = 1
                AND (SELECT count(*) FROM experience_locations one_point
                      WHERE one_point.experience_id = ${place}.id AND one_point.merged_into_id IS NULL
                        AND one_point.missing_since IS NULL) = 1
               THEN ${membership}.wikidata_items[1] END`;
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
           'anchorKinds', ${kindNamesSql('e')},
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

/** A pair as the statement builds it, before its items' terms are read. */
type BarePair = Omit<MergePair, 'otherWikidataLabel' | 'otherWikidataDescription' | 'anchorWikidataLabel' | 'anchorWikidataDescription'>;

export async function queryMergeProposals(ids: number[]): Promise<QueryResult> {
  const result = await pool.query<{ merge_pairs: BarePair[] | null }>(`
    SELECT e.id, e.external_id, e.name, mk.kind_id, kd.name AS kind_name,
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
  const pairs = result.rows.flatMap(row => row.merge_pairs ?? []);
  const terms = await termsOf([...new Set(pairs.flatMap(pair => [pair.otherWikidataItem, pair.anchorWikidataItem])
    .filter((item): item is string => item !== null))]);
  const of = (item: string | null) => (item === null ? undefined : terms.get(item));
  for (const pair of pairs as MergePair[]) {
    pair.otherWikidataLabel = of(pair.otherWikidataItem)?.label ?? null;
    pair.otherWikidataDescription = of(pair.otherWikidataItem)?.description ?? null;
    pair.anchorWikidataLabel = of(pair.anchorWikidataItem)?.label ?? null;
    pair.anchorWikidataDescription = of(pair.anchorWikidataItem)?.description ?? null;
  }
  return result;
}
