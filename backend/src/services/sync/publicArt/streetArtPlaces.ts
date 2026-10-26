/**
 * The street-art places' entrance and what their line reads (#2035), beside
 * the rule in `streetArtTest.ts`.
 *
 * The entrance names the places Public art's classes cannot: every article
 * filed directly under an English Wikipedia category of street art or
 * graffiti, read from the copy of the category structure (ADR-0121); every
 * item filed under the genre street art or graffiti; and every street-art
 * place the source already holds, so a place a category stops naming is
 * judged by this rule rather than refused for its lack of a sculpture class.
 */

import { admittedExternalIds } from '../admission.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureItemsInCategories } from '../wikipediaStructure.js';
import { yearlyReaders } from '../places/candidates.js';
import { guidedOf } from '../places/guidedLine.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import { fetchItemsOfGenres, fetchRootsOfClasses, fetchStreetArtMarks, type StreetArtMarks } from './streetArtQueries.js';
import { NOT_A_PLACE_CATEGORY, NOT_A_STREET_ART_PLACE, STREET_ART_CATEGORY, STREET_ART_GENRES } from './streetArtTest.js';
import type { EntityFacts } from './queries.js';

const LOG_PREFIX = '[Landmark Sync]';

/** The source that holds street-art places: Public art's (`LANDMARK_SOURCE_ID`). */
const PUBLIC_ART_SOURCE_ID = 3;

/** Every item the street-art entrance names. */
export async function enterStreetArtPlaces(run: QueryRunner): Promise<string[]> {
  const named = new Set<string>();
  if (await latestStructure()) {
    for (const qid of await structureItemsInCategories(STREET_ART_CATEGORY, NOT_A_PLACE_CATEGORY)) named.add(qid);
  } else {
    // The live API lists a category's members, not the categories whose title
    // matches: without the copy this half reads nothing.
    console.log(`${LOG_PREFIX} No copy of English Wikipedia's categories is built: the street-art categories are not read`);
  }
  const fromCategories = named.size;
  for (const qid of await fetchItemsOfGenres(run.sparql, STREET_ART_GENRES)) named.add(qid);
  const held = await admittedExternalIds(PUBLIC_ART_SOURCE_ID, 'street-art');
  for (const qid of held) named.add(qid);
  console.log(`${LOG_PREFIX} The street-art entrance named ${named.size} items: ${fromCategories} by an English Wikipedia `
    + `category, the rest by the genre or held as street-art places (${held.size})`);
  return [...named];
}

/** What the street-art line and rule read of the candidates they decide. */
export interface StreetArtReading {
  marks: Map<string, StreetArtMarks>;
  guided: ReadonlySet<string>;
  /** A year's readers; null when no year can be read. */
  readers: Map<string, number> | null;
  /** Which of `NOT_A_STREET_ART_PLACE` each of their classes is a kind of. */
  roots: Map<string, string[]>;
}

/** Read what the line and the rule ask of `qids`, the candidates the street-art rule decides. */
export async function readStreetArt(
  sparql: SparqlFn, qids: string[], facts: ReadonlyMap<string, EntityFacts>,
): Promise<StreetArtReading> {
  const classes = qids.flatMap((qid) => facts.get(qid)?.classes ?? []);
  return {
    marks: await fetchStreetArtMarks(sparql, qids),
    guided: await guidedOf(qids, LOG_PREFIX),
    readers: await yearlyReaders(qids, LOG_PREFIX),
    roots: await fetchRootsOfClasses(sparql, classes, Object.keys(NOT_A_STREET_ART_PLACE)),
  };
}
