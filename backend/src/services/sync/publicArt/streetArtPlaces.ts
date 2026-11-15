/**
 * What the street-art places' line reads (#2035), beside the rule in
 * `streetArtTest.ts`. The entrance that names the candidates is the gather's
 * (`entrances.ts`).
 */

import { yearlyReaders, yearlyReadersAtRank } from '../places/candidates.js';
import { guidedOf, type WorldMemory } from '../places/worldBars.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { fetchRootsOfClasses, fetchStreetArtMarks, type StreetArtMarks } from './streetArtQueries.js';
import { NOT_A_STREET_ART_PLACE, READERS_MARK_RANK } from './streetArtTest.js';
import type { EntityFacts } from './queries.js';

const LOG_PREFIX = '[Landmark Sync]';

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
