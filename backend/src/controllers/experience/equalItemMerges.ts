/**
 * Places that share a Wikidata item are one place, and merge without a
 * question (ADR-0046 decision 2, ADR-0086).
 *
 * Which places share an item is the place identifier registry's word
 * (ADR-0143 decision 2, #1892): a value two live places each claim as their
 * own — `place_identifiers.claims_identity` on both, `identifies` on neither —
 * through a Wikidata source's own id, a World Heritage site's one item on a
 * place of one standing point (#1248) or a standing point's item (#1250), and
 * never an item two parts carry, which names their ensemble, nor one a
 * curator said only refers to the place (#1896): the registry states those
 * rules once, and the catalogue check `identifiers-on-several-places` lists
 * the same rows. Each such item is merged into one place, one place at a
 * time, so a place in three sources (the National Archaeological Museum in
 * Madrid) ends as one. The place a reader is shown, with the lowest id, keeps
 * its id and its address: the Temple of Karnak folds into the Karnak Temple
 * Complex of Places of worship, which becomes the part of Ancient Thebes and
 * keeps its name, its list row and its address. Where no kind offers any of
 * them — a serial site's component part is shown through its whole and holds
 * no kind of its own — the part keeps its row and the arrival nobody has
 * passed folds into it, the state the resolver reaches when a run finds the
 * part by its item (ADR-0143 decision 3): the Tower of Belem holding its
 * pending Towers membership; otherwise the lowest id stays. A pair the merge
 * refuses — both places in one kind — is reported and left apart.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS, placeOfferedSql } from '../../db/membership.js';
import type { EqualItemMerges } from '../../api/responses/admin.js';
import { mergePlaces } from './placeMerge.js';

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
export function membershipItemSql(membership = 'm', place = 'e'): string {
  return `CASE WHEN ${membership}.external_id ~ '^Q[0-9]+$' THEN ${membership}.external_id
               WHEN cardinality(${membership}.wikidata_items) = 1
                AND (SELECT count(*) FROM experience_locations one_point
                      WHERE one_point.experience_id = ${place}.id AND one_point.merged_into_id IS NULL
                        AND one_point.missing_since IS NULL) = 1
               THEN ${membership}.wikidata_items[1] END`;
}

/**
 * The Wikidata items two or more live places each claim as their own, one
 * row each: `qid`, its places in id order (`place_ids`), their names in that
 * order (`names`) and the place that keeps its id (`survivor_id`). Narrowed
 * to the items named by `onlyParam` — a placeholder bound to a `text[]`, or
 * `NULL` for every item. The rows are the registry's, the ones
 * `identifiers-on-several-places` lists, so the check and the pass ask one
 * question.
 */
function sharedItemsSql(onlyParam: string): string {
  return `SELECT held.qid,
            array_agg(held.place_id ORDER BY held.place_id) AS place_ids,
            array_agg(held.name ORDER BY held.place_id) AS names,
            -- The place that keeps its id: one some kind offers, whose address is
            -- known, with the lowest id; where none is, a serial site's component
            -- part — shown through its whole, of no kind — which a run would have
            -- found by its item (ADR-0143 decision 3); else the lowest id.
            COALESCE(min(held.place_id) FILTER (WHERE held.offered),
                     min(held.place_id) FILTER (WHERE NOT held.kinded),
                     min(held.place_id)) AS survivor_id
       FROM (
         SELECT pi.value AS qid, e.id AS place_id, e.name,
                EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own WHERE own.experience_id = e.id) AS kinded,
                ${placeOfferedSql('e')} AS offered
           FROM place_identifiers pi
           JOIN experiences e ON e.id = pi.experience_id
          WHERE pi.scheme = 'wikidata' AND pi.claims_identity AND NOT pi.identifies
            AND (${onlyParam}::text[] IS NULL OR pi.value = ANY(${onlyParam}::text[]))
       ) held
      GROUP BY held.qid
     HAVING count(*) > 1`;
}

/** The items `sharedItemsSql` finds, in item order. */
type SharedItem = { qid: string; place_ids: number[]; names: string[]; survivor_id: number };

async function sharedItems(only?: string[]): Promise<SharedItem[]> {
  const result = await pool.query<SharedItem>(
    `${sharedItemsSql('$1')} ORDER BY held.qid`,
    [only ?? null],
  );
  return result.rows;
}

/**
 * What a run does with the places it created (#1247): one that another source
 * already holds as the same Wikidata item is that place, and merges into it —
 * the place a reader is shown keeps its id (`sharedItemsSql`). Read off the
 * run's own changeset, once the run is over: its `created` rows name what it
 * created, and each created place's item is its membership's
 * (`membershipItemSql`) — none for a serial World Heritage site. Only what the
 * run created, never every place it saw: a place a curator took out of a merge
 * would otherwise be merged again by every run of its source. A place that
 * already existed and now shares an item — a site whose item the run first
 * recorded — is the admin's pass's, which the catalogue check
 * `identifiers-on-several-places` counts. A failure is logged and leaves the
 * two apart for the admin's pass and the catalogue check to find.
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
 * that keeps its id (`sharedItemsSql`) — every such item, or the ones named.
 * The catalogue's own merge: it names no curator.
 */
export async function mergeEqualItems(only?: string[]): Promise<EqualItemMerges> {
  const report: EqualItemMerges = { merged: [], refused: [] };
  for (const item of await sharedItems(only)) {
    const survivorId = item.survivor_id;
    const name = item.names[item.place_ids.indexOf(survivorId)];
    for (const foldedId of item.place_ids.filter(id => id !== survivorId)) {
      await mergeOnePair(report, { qid: item.qid, survivorId, foldedId, name });
    }
  }
  return report;
}

/** Merge one place into the one its item keeps, and write the outcome into the report. */
async function mergeOnePair(
  report: EqualItemMerges,
  { qid, survivorId, foldedId, name }: { qid: string; survivorId: number; foldedId: number; name: string },
): Promise<void> {
  let outcome: Awaited<ReturnType<typeof mergePlaces>>;
  try {
    outcome = await mergePlaces({
      survivorId, foldedId, mergedBy: null, reason: 'equal_wikidata_item', detail: { qid },
    });
  } catch (error) {
    // Each merge is its own transaction, so one that threw changed nothing,
    // and the ones before it are committed: the pass goes on and the report
    // says which pair failed, rather than losing what it already did.
    console.error('[merge] places %d and %d sharing %s could not be merged:', survivorId, foldedId, qid, error);
    outcome = { refusal: { status: 500, error: 'The merge failed and changed nothing; run the pass again' } };
  }
  if (outcome.refusal) {
    report.refused.push({ qid, placeIds: [survivorId, foldedId], name, error: outcome.refusal.error });
  } else {
    report.merged.push({ qid, survivorId, foldedId, mergeId: outcome.result!.mergeId, name });
  }
}
