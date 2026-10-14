/**
 * The door a kind's run asks Wikidata through (#1459, #1460): the live
 * service, or, for a source the admin switched to it, the local subset,
 * through a door that refuses any question with no twin there. A subset that
 * is not built stops the run before it asks anything.
 */

import { latestSubset, entitiesAreHeld } from '../../dumps/wikidata/subsetTables.js';
import type { SyncProgress } from '../types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { readsSubset, subsetOnlyDoor, wikidataReaderOf } from './reader.js';

export async function wikidataRunDoor(sourceId: number, progress: SyncProgress, live: () => SparqlFn): Promise<SparqlFn> {
  if (await wikidataReaderOf(sourceId) !== 'subset') return live();
  const built = await latestSubset();
  if (!built || !(await entitiesAreHeld())) {
    throw new Error('This source reads the local Wikidata subset, which is not built (or a database crash emptied it): build it under Public Dumps, or switch the source back to the live service');
  }
  progress.statusMessage = `Reading Wikidata from the local subset of the ${built.dumpDate} dump...`;
  const door = subsetOnlyDoor();
  if (!readsSubset(door)) throw new Error('The subset door lost its mark');
  return door;
}
