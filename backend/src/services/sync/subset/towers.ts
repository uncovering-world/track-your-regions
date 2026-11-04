/**
 * What the subset's compact entities say of a tower that tells a mast from a
 * tower people go up (#2275), as `fetchMastStatements` (`towers/masts.ts`)
 * answers it on the live service: the OpenStreetMap objects the item says it
 * is mapped as, and which of the statements of a visited tower it carries.
 */

import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';
import { entitiesOf } from './entities.js';
import { bestStatements, isNoValue, textOf } from './values.js';

/** Wikidata's OpenStreetMap node ID (`P11693`) and way ID (`P10689`), by the kind of object each names. */
export const OSM_ID_PROPERTIES = { P11693: 'node', P10689: 'way' } as const;

/**
 * What a tower people go up states and a mast does not: its elevators
 * (`P1301`), a Commons category of the view from it (`P8933`), an Atlas
 * Obscura place ID (`P7772`), an official website (`P856`) and its floors above
 * ground (`P1101`).
 */
export const VISIT_PROPERTIES = ['P1301', 'P8933', 'P7772', 'P856', 'P1101'] as const;

/** What an item states of the map and of a visit. */
export interface MastStatements {
  /** The objects it says it is mapped as, as an OSM reference is quoted: `node/358814807`. */
  refs: string[];
  /** Which of `VISIT_PROPERTIES` it states, a value of no value aside. */
  visit: string[];
}

const DIGITS = /^\d+$/;

/** The statements of an item, as `wdt:` reads them: its best rank, never a no-value. */
export function mastStatementsOf(claims: Readonly<Record<string, CompactStatement[] | undefined>>): MastStatements {
  const stated = (property: string) => bestStatements(claims[property]).filter((statement) => !isNoValue(statement.value));
  const refs = Object.entries(OSM_ID_PROPERTIES).flatMap(([property, kind]) => stated(property)
    .map((statement) => textOf(statement.value))
    .filter((id): id is string => id !== null && DIGITS.test(id))
    .map((id) => `${kind}/${id}`));
  return { refs, visit: VISIT_PROPERTIES.filter((property) => stated(property).length > 0) };
}

/** Each kept item's statements of the map and of a visit; an item the subset did not keep has none. */
export async function subsetMastStatements(ids: string[]): Promise<Map<string, MastStatements>> {
  const out = new Map<string, MastStatements>();
  for (const [id, { entity }] of await entitiesOf(ids)) out.set(id, mastStatementsOf(entity.claims));
  return out;
}
