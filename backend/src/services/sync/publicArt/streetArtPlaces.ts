/**
 * The street-art places' entrance and what their line reads (#2035), beside
 * the rule in `streetArtTest.ts`.
 *
 * The entrance names the places Public art's classes cannot: every article
 * filed directly under an English Wikipedia category of street art or
 * graffiti, read from the copy of the category structure (ADR-0121); every
 * item filed under the genre street art or graffiti; every item typed a wall
 * of graffiti paintings (#2055), which is all that says the East Side Gallery
 * is street art; and every street-art place the source already holds, so a
 * place a category stops naming is judged by this rule rather than refused
 * for its lack of a sculpture class.
 */

import { admittedExternalIds } from '../admission.js';
import { latestStructure } from '../../dumps/wikipedia/structureTables.js';
import { structureItemsInCategories } from '../wikipediaStructure.js';
import { yearlyReaders, yearlyReadersAtRank } from '../places/candidates.js';
import { guidedOf, type WorldMemory } from '../places/worldBars.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import {
  fetchItemsOfClasses, fetchItemsOfGenres, fetchRootsOfClasses, fetchStreetArtMarks, type StreetArtMarks,
} from './streetArtQueries.js';
import {
  NOT_A_PLACE_CATEGORY, NOT_A_STREET_ART_PLACE, READERS_MARK_RANK, STREET_ART_CATEGORY, GRAFFITI_WALL_CLASSES, STREET_ART_GENRES,
} from './streetArtTest.js';
import type { EntityFacts } from './queries.js';

const LOG_PREFIX = '[Landmark Sync]';

/** The source that holds street-art places: Public art's (`LANDMARK_SOURCE_ID`). */
const PUBLIC_ART_SOURCE_ID = 3;

/** The entrance's name on the kind's share (`KindShare.enteredBy`). */
export const STREET_ART_ENTRANCE = 'street art';

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
  // The gather steps before the entrance's first question; this is its second.
  await run.step();
  for (const qid of await fetchItemsOfClasses(run.sparql, GRAFFITI_WALL_CLASSES)) named.add(qid);
  const held = await admittedExternalIds(PUBLIC_ART_SOURCE_ID, 'street-art');
  for (const qid of held) named.add(qid);
  console.log(`${LOG_PREFIX} The street-art entrance named ${named.size} items: ${fromCategories} by an English Wikipedia `
    + `category, the rest by the genre, the class or held as street-art places (${held.size})`);
  return [...named];
}

/** What the street-art line and rule read of the candidates they decide. */
export interface StreetArtReading {
  marks: Map<string, StreetArtMarks>;
  /** The candidates a guide uses; null when no usage build is in place. */
  guided: ReadonlySet<string> | null;
  /**
   * Each place's guide's mark as the source last read it (`membership_fame`,
   * #2253), for a run that cannot read it (ADR-0175 decision 6).
   */
  guidedAsLastRead?: ReadonlyMap<string, boolean>;
  /** A year's readers; null when no year can be read, or the mark the year yields cannot. */
  readers: Map<string, number> | null;
  /** The readers a mark of fame takes this year (`READERS_MARK_RANK`, ADR-0184); 0 where no year is read. */
  readersMark: number;
  /** Which of `NOT_A_STREET_ART_PLACE` each of their classes is a kind of. */
  roots: Map<string, string[]>;
}

/**
 * Read what the line and the rule ask of `qids`, the candidates the street-art
 * rule decides. `memory` is what the source's world tier last read, which
 * answers a guide's mark this run cannot read.
 */
export async function readStreetArt(
  sparql: SparqlFn, qids: string[], facts: ReadonlyMap<string, EntityFacts>, memory?: WorldMemory,
): Promise<StreetArtReading> {
  const classes = qids.flatMap((qid) => facts.get(qid)?.classes ?? []);
  const guided = await guidedOf(qids, LOG_PREFIX);
  // A year whose mark cannot be read is no year read: readers are no mark against nothing.
  const readersMark = await yearlyReadersAtRank(READERS_MARK_RANK);
  return {
    marks: await fetchStreetArtMarks(sparql, qids),
    guided,
    ...(guided === null && memory ? { guidedAsLastRead: memory.guided } : {}),
    readers: readersMark === null ? null : await yearlyReaders(qids, LOG_PREFIX),
    readersMark: readersMark ?? 0,
    roots: await fetchRootsOfClasses(sparql, classes, Object.keys(NOT_A_STREET_ART_PLACE)),
  };
}

/** Whether a guide uses a candidate: this run's usage build, or as last read, or unknown — never no guide. */
export function streetArtGuideOf(qid: string, reading: Pick<StreetArtReading, 'guided' | 'guidedAsLastRead'>): boolean | null {
  if (reading.guided !== null) return reading.guided.has(qid);
  return reading.guidedAsLastRead?.get(qid) ?? null;
}
