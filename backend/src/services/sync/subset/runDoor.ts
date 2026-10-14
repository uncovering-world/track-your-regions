/**
 * The door a kind's run asks Wikidata through (#1459, #1460): the live
 * service, or, for a source the admin switched to it, the local subset,
 * through a door that refuses any question with no twin there. A subset that
 * is not built stops the run before it asks anything.
 */

import { pool } from '../../../db/index.js';
import { MEMBERSHIPS } from '../../../db/membership.js';
import { latestSubset, entitiesAreHeld } from '../../dumps/wikidata/subsetTables.js';
import type { SyncProgress } from '../types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { readsSubset, subsetOnlyDoor, wikidataReaderOf } from './reader.js';

export async function wikidataRunDoor(sourceId: number, progress: SyncProgress, live: () => SparqlFn): Promise<SparqlFn> {
  return (await subsetRunDoor(sourceId, progress)) ?? live();
}

/** The subset's door for a source switched to it, or null for one that reads the live service. */
export async function subsetRunDoor(sourceId: number, progress: SyncProgress): Promise<SparqlFn | null> {
  if (await wikidataReaderOf(sourceId) !== 'subset') return null;
  const built = await latestSubset();
  if (!built || !(await entitiesAreHeld())) {
    throw new Error('This source reads the local Wikidata subset, which is not built (or a database crash emptied it): build it under Public Dumps, or switch the source back to the live service');
  }
  progress.statusMessage = `Reading Wikidata from the local subset of the ${built.dumpDate} dump...`;
  const door = subsetOnlyDoor();
  if (!readsSubset(door)) throw new Error('The subset door lost its mark');
  return door;
}

/**
 * The source's rows whose items the subset does not keep, with their names:
 * a run on the subset can read nothing about them, which is not the same as
 * their having gone (`FetchResult.unread`). Only a row a run listed on or
 * after the dump's date counts: its item may have been created, or given a
 * coordinate, since. A row last listed before that date whose item the dump
 * lacks had gone by then (merged, deleted or stripped of its coordinate), and
 * missing detection reads it as the live run would.
 */
export async function unreadOnSubset(sourceId: number): Promise<Array<{ externalId: string; name: string }>> {
  const result = await pool.query<{ externalId: string; name: string }>(
    `SELECT m.external_id AS "externalId", e.name
       FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
      WHERE m.source_id = $1
        AND m.last_seen_at >= (SELECT dump_date FROM wikidata_subset_builds ORDER BY swapped_at DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM wikidata_entities w WHERE w.id = m.external_id)
      ORDER BY m.external_id`,
    [sourceId],
  );
  return result.rows;
}
