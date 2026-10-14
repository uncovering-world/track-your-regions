/**
 * Which Wikidata a run reads (#1458, #1439): the live query service, or the
 * local subset built from the entities dump (ADR-0105). The fetchers keep
 * their signatures and their callers; a run that reads the subset hands them a
 * door marked so (`subsetDoor`), and each fetcher asks its local twin instead
 * of sending SPARQL. The mark rides on the door itself because every fetcher
 * already takes one, as a bare `SparqlFn` or a runner holding it.
 */

import { pool } from '../../../db/index.js';
import type { SparqlFn } from '../wikidataQueries.js';

export type WikidataReader = 'live' | 'subset';

interface Marked {
  reader?: WikidataReader;
}

/**
 * The same door, marked as one that reads the subset. A wrapper around a
 * marked door (a pacing or tracing layer, a repair's `(query) => door(query)`)
 * does not carry the mark: it is marked again with this, or the fetchers
 * behind it go live without a word.
 */
export function subsetDoor<T extends SparqlFn>(sparql: T): T & Marked {
  return Object.assign(sparql, { reader: 'subset' as const });
}

/** Whether a fetcher handed `door` should read the subset rather than send SPARQL. */
export function readsSubset(door: SparqlFn | { sparql: SparqlFn }): boolean {
  const fn = typeof door === 'function' ? door : door.sparql;
  return (fn as SparqlFn & Marked).reader === 'subset';
}

/**
 * The sources every question of which has a twin in the subset, by id: a run
 * of one of them may read the subset whole. A source is added here in the
 * slice that twins its last question (#1459 Public Art, #1460 Art Museums,
 * #1461 Places of worship, #1462 Archaeology), and only then can the admin
 * switch it.
 */
export const SUBSET_READY_SOURCES: ReadonlySet<number> = new Set([2, 3]);

/**
 * The door a run that reads the subset hands its fetchers: marked, and
 * failing if it is ever asked a SPARQL question, so a question with no twin
 * stops the run by name instead of mixing the live service's Wikidata into
 * the subset's (#1459).
 */
export function subsetOnlyDoor(): SparqlFn & Marked {
  return subsetDoor(async (_query: string, descriptor?: { label?: string }) => {
    throw new Error(`A run reading the local Wikidata subset asked the live service: ${descriptor?.label ?? 'a question with no twin'}`);
  });
}

/** Which Wikidata the source's runs read, as the admin set it (`experience_sources.wikidata_reader`). */
export async function wikidataReaderOf(sourceId: number): Promise<WikidataReader> {
  const result = await pool.query<{ wikidata_reader: WikidataReader }>(
    'SELECT wikidata_reader FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  return result.rows[0]?.wikidata_reader ?? 'live';
}
