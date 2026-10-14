/**
 * Which Wikidata a run reads (#1458, #1439): the live query service, or the
 * local subset built from the entities dump (ADR-0105). The fetchers keep
 * their signatures and their callers; a run that reads the subset hands them a
 * door marked so (`subsetDoor`), and each fetcher asks its local twin instead
 * of sending SPARQL. The mark rides on the door itself because every fetcher
 * already takes one, as a bare `SparqlFn` or a runner holding it.
 */

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
