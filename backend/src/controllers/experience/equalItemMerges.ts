/**
 * Places that share a Wikidata item are one place, and merge without a
 * question (ADR-0046 decision 2, ADR-0086).
 *
 * The item is read off the memberships: a Wikidata source knows a place by its
 * item (`experience_kind_memberships.external_id`), and two sources that read
 * one item read one place — the Pantheon as a place of worship and as
 * archaeology. Each item held by several places is merged into the one with
 * the lowest id, one place at a time, so a place in three sources (the
 * National Archaeological Museum in Madrid) ends as one. A pair the merge
 * refuses — both places in one kind — is reported and left apart.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import type { EqualItemMerges } from '../../api/responses/admin.js';
import { mergePlaces } from './placeMerge.js';

/** The memberships' Wikidata items held by more than one place, each with its places in id order. */
async function sharedItems(only?: string[]): Promise<{ qid: string; place_ids: number[]; names: string[] }[]> {
  const result = await pool.query<{ qid: string; place_ids: number[]; names: string[] }>(
    `SELECT m.external_id AS qid,
            array_agg(DISTINCT e.id ORDER BY e.id) AS place_ids,
            array_agg(e.name ORDER BY e.id) AS names
       FROM ${MEMBERSHIPS} m
       JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
      WHERE m.external_id ~ '^Q[0-9]+$' AND ($1::text[] IS NULL OR m.external_id = ANY($1::text[]))
      GROUP BY m.external_id
     HAVING count(DISTINCT e.id) > 1
      ORDER BY m.external_id`,
    [only ?? null],
  );
  return result.rows;
}

/**
 * Merge every place that shares a Wikidata item with another into the one
 * with the lowest id — every such item, or the ones named. The catalogue's own
 * merge: it names no curator.
 */
export async function mergeEqualItems(only?: string[]): Promise<EqualItemMerges> {
  const report: EqualItemMerges = { merged: [], refused: [] };
  for (const item of await sharedItems(only)) {
    const [survivorId, ...folded] = item.place_ids;
    for (const foldedId of folded) {
      let outcome: Awaited<ReturnType<typeof mergePlaces>>;
      try {
        outcome = await mergePlaces({
          survivorId, foldedId, mergedBy: null, reason: 'equal_wikidata_item', detail: { qid: item.qid },
        });
      } catch (error) {
        // Each merge is its own transaction, so one that threw changed nothing,
        // and the ones before it are committed: the pass goes on and the report
        // says which pair failed, rather than losing what it already did.
        console.error('[merge] places %d and %d sharing %s could not be merged:', survivorId, foldedId, item.qid, error);
        outcome = { refusal: { status: 500, error: 'The merge failed and changed nothing; run the pass again' } };
      }
      if (outcome.refusal) {
        report.refused.push({ qid: item.qid, placeIds: [survivorId, foldedId], error: outcome.refusal.error });
      } else {
        report.merged.push({
          qid: item.qid, survivorId, foldedId, mergeId: outcome.result!.mergeId, name: item.names[0],
        });
      }
    }
  }
  return report;
}
