/**
 * Places that share a Wikidata item are one place, and merge without a
 * question (ADR-0046 decision 2, ADR-0086).
 *
 * The item is read off the memberships (`membershipItemSql`): a Wikidata
 * source knows a place by its item (`experience_kind_memberships.external_id`),
 * a World Heritage site of one point by the one item its id resolves to
 * (`wikidata_items`, #1248), and two sources that read one item read one place
 * — the Pantheon as a place of worship and as archaeology, Chartres Cathedral as
 * a World Heritage site and as a place of worship. Each item held by several places is merged into the one with
 * the lowest id, one place at a time, so a place in three sources (the
 * National Archaeological Museum in Madrid) ends as one. A pair the merge
 * refuses — both places in one kind — is reported and left apart.
 */

import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import type { EqualItemMerges } from '../../api/responses/admin.js';
import { mergePlaces } from './placeMerge.js';

/**
 * The Wikidata item a membership makes its place, or NULL: a Wikidata source's
 * own id, or, for a source that knows the place by another id, the one item
 * that id resolves to (`wikidata_items`, a World Heritage site's through P757,
 * #1248, ADR-0088) — and only for a place of exactly one standing point, since
 * a serial site's items name its parts and wait for identity per location, and
 * a place whose point was never written is not yet the place its item names. A
 * point its source withdrew is not one of the place's points (#1360).
 */
export function membershipItemSql(membership = 'm', place = 'e'): string {
  return `CASE WHEN ${membership}.external_id ~ '^Q[0-9]+$' THEN ${membership}.external_id
               WHEN cardinality(${membership}.wikidata_items) = 1
                AND (SELECT count(*) FROM experience_locations one_point
                      WHERE one_point.experience_id = ${place}.id AND one_point.merged_into_id IS NULL
                        AND one_point.missing_since IS NULL) = 1
               THEN ${membership}.wikidata_items[1] END`;
}

/**
 * The Wikidata items held by more than one place, one row each: `qid`, its
 * places in id order (`place_ids`), their names in that order (`names`) and
 * the kinds that hold them (`kinds`). Narrowed to the items named by
 * `onlyParam` — a placeholder bound to a `text[]`, or `NULL` for every item.
 * The pass merges what this finds, and the catalogue check
 * `places-sharing-a-wikidata-item` counts what it still finds, so the two ask
 * one question.
 */
export function sharedItemsSql(onlyParam: string): string {
  return `SELECT held.qid,
            array_agg(DISTINCT held.place_id ORDER BY held.place_id) AS place_ids,
            array_agg(held.name ORDER BY held.place_id) AS names,
            array_agg(DISTINCT held.kind ORDER BY held.kind) AS kinds
       FROM (
         SELECT ${membershipItemSql('m', 'e')} AS qid, e.id AS place_id, e.name, k.name AS kind
           FROM ${MEMBERSHIPS} m
           JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
           JOIN ${KINDS} k ON k.id = m.kind_id
       ) held
      WHERE held.qid IS NOT NULL AND (${onlyParam}::text[] IS NULL OR held.qid = ANY(${onlyParam}::text[]))
      GROUP BY held.qid
     HAVING count(DISTINCT held.place_id) > 1`;
}

/** The items `sharedItemsSql` finds, in item order. */
async function sharedItems(only?: string[]): Promise<{ qid: string; place_ids: number[]; names: string[] }[]> {
  const result = await pool.query<{ qid: string; place_ids: number[]; names: string[] }>(
    `${sharedItemsSql('$1')} ORDER BY held.qid`,
    [only ?? null],
  );
  return result.rows;
}

/**
 * What a run does with the places it created (#1247): one that another source
 * already holds as the same Wikidata item is that place, and merges into it —
 * the older row, so the place readers know keeps its id. Read off the run's
 * own changeset, once the run is over: its `created` rows name what it
 * created, and each created place's item is its membership's
 * (`membershipItemSql`) — none for a serial World Heritage site. Only what the
 * run created, never every place it saw: a place a curator took out of a merge
 * would otherwise be merged again by every run of its source. A place that
 * already existed and now shares an item — a site whose item the run first
 * recorded — is the admin's pass's, which the catalogue check counts. A
 * failure is logged and leaves the two apart for the admin's pass and the
 * catalogue check to find.
 */
export async function mergeArrivalsOfRun(syncLogId: number): Promise<EqualItemMerges | null> {
  try {
    // The items the places this run created make theirs: a Wikidata source's
    // own id, or a World Heritage site's one item (#1248).
    const created = await pool.query<{ qid: string }>(
      `SELECT DISTINCT ${membershipItemSql('m', 'e')} AS qid
         FROM experience_sync_changes c
         JOIN experience_sync_logs run ON run.id = c.sync_log_id AND NOT run.is_dry_run
         JOIN ${MEMBERSHIPS} m ON m.source_id = run.source_id AND m.external_id = c.external_id
         JOIN experiences e ON e.id = m.experience_id
        WHERE c.sync_log_id = $1 AND c.change_type = 'created'`,
      [syncLogId],
    );
    if (created.rows.length === 0) return null;
    const items = created.rows.map(row => row.qid).filter((qid): qid is string => qid !== null);
    if (items.length === 0) return null;
    const report = await mergeEqualItems(items);
    for (const refused of report.refused) {
      console.log('[merge] places %s (%s) left apart: %s', refused.placeIds.join(' and '), refused.qid, refused.error);
    }
    return report;
  } catch (error) {
    console.error('[merge] merging the places run %d created failed:', syncLogId, error);
    return null;
  }
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
        report.refused.push({
          qid: item.qid, placeIds: [survivorId, foldedId], name: item.names[0], error: outcome.refusal.error,
        });
      } else {
        report.merged.push({
          qid: item.qid, survivorId, foldedId, mergeId: outcome.result!.mergeId, name: item.names[0],
        });
      }
    }
  }
  return report;
}
