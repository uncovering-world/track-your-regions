/**
 * ADR-0175: the world tier of a place kind admits by three quantiles of the
 * kind's own pool, recomputed from that pool at every run — its Wikipedia
 * editions, its readers a year, and its readers where a guide marks the place
 * (a Wikivoyage edition uses it, or it carries an Atlas Obscura place ID). A
 * candidate enters at any one of the three; a place the last run admitted
 * stays while it reaches the stay share of any. The levels are the register's
 * (`admissionRegister.ts`); the numbers are the pool's, so they follow the
 * year's readership rather than a count picked once.
 *
 * The pool is every candidate the kind's rule passes that has a point and that
 * a class question named at the register's floor of sitelinks (`gather.ts`,
 * `PlaceKind.admissionPool`). Each kind's classifier hands in its pool and its
 * candidates; what is read and decided is here, once.
 */

import type { SparqlFn } from '../wikidataQueries.js';
import { chunk } from '../wikidataQueries.js';
import { yearlyReaders } from './candidates.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import { fetchStreetArtMarks } from '../publicArt/streetArtQueries.js';
import { WORLD_FRAME, type WorldFrame } from './admissionRegister.js';

/** A kind's three bars this run, and the pool they were read on. Readers' bars are null when no year is read. */
export interface WorldBars {
  editions: number;
  readers: number | null;
  guidedReaders: number | null;
  pool: number;
}

/**
 * What the run read of the candidates beside their editions: a year's readers
 * (null when none is folded), the items a Wikivoyage edition uses (null when no
 * usage build is in place) and the items Atlas Obscura lists.
 */
export interface WorldRead {
  readers: ReadonlyMap<string, number> | null;
  guided: ReadonlySet<string> | null;
  atlas: ReadonlySet<string>;
}

/** One candidate as the frame reads it. */
export interface WorldCandidate {
  qid: string;
  editions: number;
}

/** The quantile `q` of `values` as the review computed it: sorted ascending, the value at `round(q × (n − 1))`. */
export function quantile(values: readonly number[], q: number): number {
  if (!values.length) throw new Error('The quantile of an empty pool');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/**
 * The kind's bars over its pool, or null for an empty pool, which has none to
 * read. A candidate no year reads counts as read by nobody, as the review read
 * it; with no year at all, only the editions bar is read. A bar is never under
 * one: a pool most of which nobody reads would set a bar of nothing, and a bar
 * of nothing admits the whole pool.
 */
export function worldBars(
  pool: readonly WorldCandidate[], readers: ReadonlyMap<string, number> | null, frame: WorldFrame = WORLD_FRAME,
): WorldBars | null {
  if (!pool.length) return null;
  const read = readers && pool.map((c) => readers.get(c.qid) ?? 0);
  const bar = (values: readonly number[], q: number) => Math.max(1, quantile(values, q));
  return {
    editions: bar(pool.map((c) => c.editions), frame.editionsQuantile),
    readers: read && bar(read, frame.readersQuantile),
    guidedReaders: read && bar(read, frame.guidedQuantile),
    pool: pool.length,
  };
}

/** Which bar let a candidate in. */
export type WorldBar = 'editions' | 'readers' | 'guided';

/**
 * Where a candidate stands: in by a bar (or kept where a held place's bar cannot
 * be read this run, with the note why), out, or fallen with the reason.
 */
export type WorldStanding = { by: WorldBar; kept?: undefined } | { kept: string; by?: undefined } | 'out' | { fell: string };

const fmt = (n: number) => Math.round(n).toLocaleString('en');

/** A candidate's signals, read off the run's reading. */
function signalsOf(c: WorldCandidate, read: WorldRead) {
  const readers = read.readers === null ? null : read.readers.get(c.qid) ?? 0;
  const atlas = read.atlas.has(c.qid);
  // Unknown while no usage build is in place: never read as no guide (ADR-0175 decision 6).
  const guide = read.guided === null ? null : read.guided.has(c.qid);
  return { readers, atlas, guide, marked: atlas || guide === true };
}

/** The bar a candidate clears at `share` of each bar, or null. */
function clears(c: WorldCandidate, read: WorldRead, bars: WorldBars, share: number): WorldBar | null {
  const { readers, marked } = signalsOf(c, read);
  if (c.editions >= share * bars.editions) return 'editions';
  if (readers === null || bars.readers === null || bars.guidedReaders === null) return null;
  if (readers >= share * bars.readers) return 'readers';
  return marked && readers >= share * bars.guidedReaders ? 'guided' : null;
}

/**
 * Where a candidate the kind's rule passed stands against this run's bars. A
 * place the last run admitted (`held`) stays at the stay share of any bar. What
 * the run cannot read never drops a held place: with no bars (no pool read),
 * no year of readers, or no usage build where the guide would decide, it keeps
 * its place with a note naming what was not read, and nothing new enters but
 * by what was read.
 */
export function worldStanding(
  c: WorldCandidate, read: WorldRead, bars: WorldBars | null, held: boolean, frame: WorldFrame = WORLD_FRAME,
): WorldStanding {
  if (!bars) return held ? { kept: 'no pool was read to set the bars this run' } : 'out';
  const enters = clears(c, read, bars, 1);
  if (enters) return { by: enters };
  if (!held) return 'out';
  const stays = clears(c, read, bars, frame.stayShare);
  if (stays) return { by: stays };
  const { readers, guide, atlas } = signalsOf(c, read);
  if (readers === null) return { kept: 'no year of readers is read' };
  if (guide === null && !atlas && bars.guidedReaders !== null && readers >= frame.stayShare * bars.guidedReaders) {
    return { kept: 'no Wikivoyage usage is built to read whether a guide uses it' };
  }
  return { fell: belowWorldBars(c, read, bars, frame) };
}

/** Whether a candidate reaches a bar to enter: a rule's refusal of one that does is news, of one that does not, not. */
export function reachesABar(c: WorldCandidate, read: WorldRead, bars: WorldBars | null): boolean {
  return bars !== null && clears(c, read, bars, 1) !== null;
}

/** The bars in words, for a reason and the run's log. */
export function barsInWords(bars: WorldBars): string {
  const readers = bars.readers === null ? 'no readers\' bar (no year read)'
    : `${fmt(bars.readers)} readers a year, or ${fmt(bars.guidedReaders!)} where a guide uses it or Atlas Obscura lists it`;
  return `${bars.editions} Wikipedia editions, ${readers}`;
}

/** The refusal of a held place under every stay bar, with its signals and the bars named. */
export function belowWorldBars(c: WorldCandidate, read: WorldRead, bars: WorldBars, frame: WorldFrame = WORLD_FRAME): string {
  const { readers, marked, guide } = signalsOf(c, read);
  const read_ = readers === null ? 'no year of readers read' : `${fmt(readers)} readers a year`;
  let marks = 'no guide uses it and Atlas Obscura does not list it';
  if (marked) marks = guide ? 'a Wikivoyage guide uses it' : 'Atlas Obscura lists it';
  return `${c.editions} Wikipedia editions and ${read_}, ${marks}: under the world tier's bars `
    + `(${barsInWords(bars)}; a place held stays at ${frame.stayShare} of any)`;
}

/** The curator's note on a place in by the third bar alone: the guide's mark, the readers, the bar. */
export function guidedBarNote(c: WorldCandidate, read: WorldRead, bars: WorldBars): string {
  const { readers, guide, atlas } = signalsOf(c, read);
  const marks = [...(guide ? ['a Wikivoyage guide uses it'] : []), ...(atlas ? ['Atlas Obscura lists it'] : [])].join(' and ');
  return `In the world tier by a guide's mark (${c.editions} Wikipedia editions, ${fmt(readers ?? 0)} readers a year): `
    + `${marks}, over the bar of ${fmt(bars.guidedReaders ?? 0)} for a marked place. Can a visitor see it there now?`;
}

/** The note on a held place kept because the run could not read what would decide it. */
export function keptNote(c: WorldCandidate, because: string): string {
  return `Kept in the world tier (${c.editions} Wikipedia editions): ${because}`;
}

/** The run's line: the three bars it used as numbers, and the pool they were read on (ADR-0175). */
export function barsLine(logPrefix: string, bars: WorldBars | null, frame: WorldFrame = WORLD_FRAME): string {
  if (!bars) return `${logPrefix} World bars: no pool read this run, so nothing new enters and the held keep their place`;
  return `${logPrefix} World bars over a pool of ${fmt(bars.pool)} (quantiles ${frame.editionsQuantile}, ${frame.readersQuantile}, `
    + `${frame.guidedQuantile}): ${barsInWords(bars)}; a held place stays at ${frame.stayShare} of any`;
}

const READ_BATCH = 5_000;

/**
 * A year's readers and the guide's use of `qids`, read in batches. The Atlas
 * Obscura listings are read after the bars (`readAtlas`), only of the
 * candidates whose readers could clear the third bar.
 */
export async function readWorld(qids: readonly string[], logPrefix: string): Promise<Omit<WorldRead, 'atlas'>> {
  let readers: Map<string, number> | null = new Map();
  for (const batch of chunk([...qids], READ_BATCH)) {
    const got = await yearlyReaders(batch, logPrefix);
    if (got === null) { readers = null; break; }
    for (const [qid, n] of got) readers.set(qid, n);
  }
  if (!(await latestUsage())) {
    console.log(`${logPrefix} No Wikivoyage usage is built: a guide's use is not read, and a held place it would decide keeps its place`);
    return { readers, guided: null };
  }
  const guided = new Set<string>();
  for (const batch of chunk([...qids], READ_BATCH)) for (const qid of await usedByAGuide(batch)) guided.add(qid);
  return { readers, guided };
}

/**
 * The candidates among `qids` that carry an Atlas Obscura place ID (`P7772`),
 * asked only of those a guide does not already mark and whose readers reach
 * the stay share of the third bar: no other candidate's listing can change
 * what the bars decide.
 */
export async function readAtlas(
  sparql: SparqlFn, qids: readonly string[], read: Omit<WorldRead, 'atlas'>, bars: WorldBars | null, frame: WorldFrame = WORLD_FRAME,
): Promise<Set<string>> {
  if (!frame.atlasObscura || !bars || bars.guidedReaders === null || read.readers === null) return new Set();
  const floor = frame.stayShare * bars.guidedReaders;
  const asked = qids.filter((qid) => !read.guided?.has(qid) && (read.readers!.get(qid) ?? 0) >= floor);
  const atlas = new Set<string>();
  for (const [qid, marks] of await fetchStreetArtMarks(sparql, asked)) if (marks.atlasObscura) atlas.add(qid);
  return atlas;
}

/** The candidates a Wikivoyage edition uses; none while no usage build is in place. */
export async function guidedOf(qids: string[], logPrefix: string): Promise<ReadonlySet<string>> {
  if (!(await latestUsage())) {
    console.log(`${logPrefix} No Wikivoyage usage is built: no guide's use is read`);
    return new Set();
  }
  return usedByAGuide(qids);
}
