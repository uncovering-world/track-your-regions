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
 * National Archaeological Museum in Madrid) ends as one. A component part of a
 * serial site holds its point's item too (#1250), and folds into the place
 * that holds a kind of its own, whatever their ids: the Temple of Karnak into
 * the Karnak Temple Complex of Places of worship, which becomes the part of
 * Ancient Thebes and keeps its name, its list row and its address. A pair the merge
 * refuses — both places in one kind — is reported and left apart.
 */

import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS, membershipOfferedSql } from '../../db/membership.js';
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
 * the kinds that hold them (`kinds`); for an item a component part holds, the
 * place it folds into (`survivor_id`, `survivor_name`). The place a curator's separation
 * made is left out of the item it was separated on (ADR-0142). Narrowed to the items named by
 * `onlyParam` — a placeholder bound to a `text[]`, or `NULL` for every item.
 * The pass merges what this finds, and the catalogue check
 * `places-sharing-a-wikidata-item` counts what it still finds, so the two ask
 * one question.
 */
export function sharedItemsSql(onlyParam: string): string {
  return `SELECT held.qid,
            array_agg(DISTINCT held.place_id ORDER BY held.place_id) AS place_ids,
            array_agg(held.name ORDER BY held.place_id) AS names,
            array_agg(DISTINCT held.kind ORDER BY held.kind) AS kinds,
            bool_or(NOT held.kinded) AS has_part,
            -- A part folds into a place a kind holds and a reader is shown, never into a
            -- gated arrival nobody has passed: the part's published point would be hidden
            -- with it until a curator answered.
            min(held.place_id) FILTER (WHERE held.kinded AND held.offered) AS survivor_id,
            -- The name of the place a part folds into, or of the one it waits for: the
            -- kept place need not be the lowest id, so names[1] may be the part's.
            (array_agg(held.name ORDER BY held.offered DESC, held.place_id) FILTER (WHERE held.kinded))[1] AS survivor_name
       FROM (
         SELECT ${membershipItemSql('m', 'e')} AS qid, e.id AS place_id, e.name, k.name AS kind, true AS kinded,
                ${membershipOfferedSql('m')} AS offered
           FROM ${MEMBERSHIPS} m
           JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
           JOIN ${KINDS} k ON k.id = m.kind_id
         UNION ALL
         ${partItemsSql()}
       ) held
      WHERE held.qid IS NOT NULL AND (${onlyParam}::text[] IS NULL OR held.qid = ANY(${onlyParam}::text[]))
        -- A curator separated this place out of the one the item names
        -- (ADR-0142): it is no longer that item's place, and another source
        -- bringing the item later joins the original.
        AND NOT EXISTS (SELECT 1 FROM experience_separations sep
                         WHERE sep.wikidata_item = held.qid AND sep.separated_id = held.place_id AND sep.undone_at IS NULL)
      GROUP BY held.qid
     HAVING count(DISTINCT held.place_id) > 1`;
}

/**
 * The item a component part of a serial site is (ADR-0100 decision 4, #1250):
 * its one standing point's item, recorded by the World Heritage run from the
 * component's reference (#1269) or confirmed by a curator (#1272), under its
 * site's kind. A part that holds a kind of its own is read through its
 * membership above. An item two parts hold names their ensemble, not either
 * of them, so it makes no part anyone's: the chapels and the village of the
 * Saint Thaddeus ensemble all carry the monastery's item, and the two Meroe
 * components carry Meroë's.
 */
function partItemsSql(): string {
  return `SELECT point.wikidata_item AS qid, part.id AS place_id, part.name, k.name AS kind, false AS kinded, false AS offered
             FROM experience_parts prt
             JOIN experiences part ON part.id = prt.part_id AND part.merged_into_id IS NULL
             JOIN experience_locations point ON point.experience_id = part.id
              AND point.merged_into_id IS NULL AND point.missing_since IS NULL
             JOIN ${MEMBERSHIPS} site ON site.id = prt.membership_id
             JOIN ${KINDS} k ON k.id = site.kind_id
            WHERE prt.reason = 'component' AND point.wikidata_item IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own WHERE own.experience_id = part.id)
              AND NOT EXISTS (SELECT 1 FROM experience_parts other_prt
                                JOIN experience_locations other ON other.experience_id = other_prt.part_id
                                 AND other.merged_into_id IS NULL AND other.missing_since IS NULL
                               WHERE other_prt.part_id <> part.id AND other.wikidata_item = point.wikidata_item)`;
}

/** The items `sharedItemsSql` finds, in item order. */
type SharedItem = {
  qid: string; place_ids: number[]; names: string[]; has_part: boolean;
  survivor_id: number | null; survivor_name: string | null;
};

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
 * the older row, so the place readers know keeps its id, unless the older row
 * is a serial site's component part: a part folds into the place a kind holds,
 * the newer row then. Read off the run's
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
 * Merge every place that shares a Wikidata item with another into the one a
 * kind holds with the lowest id — every such item, or the ones named. The catalogue's own
 * merge: it names no curator.
 */
export async function mergeEqualItems(only?: string[]): Promise<EqualItemMerges> {
  const report: EqualItemMerges = { merged: [], refused: [] };
  for (const item of await sharedItems(only)) {
    // Among places alone, the lowest id stays. A part needs a place a reader is
    // shown to fold into; until one is published the item waits, and the
    // catalogue check counts it.
    if (item.has_part && item.survivor_id === null) {
      report.refused.push({
        qid: item.qid, placeIds: item.place_ids, name: item.survivor_name ?? item.names[0],
        error: 'A component part waits until the place its item names is published, and merges on the next pass after that',
      });
      continue;
    }
    const survivorId = item.has_part ? item.survivor_id! : item.place_ids[0];
    const name = (item.has_part ? item.survivor_name : null) ?? item.names[0];
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
