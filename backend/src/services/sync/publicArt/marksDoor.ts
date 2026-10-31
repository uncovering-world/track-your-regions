/**
 * ADR-0169: Public art's marks door. A work under the editions line that a
 * Wikivoyage guide uses or that carries an Atlas Obscura place ID (`P7772`,
 * Wikidata's CC0 statement, read from the dump), and that a year of readers
 * puts at 20,000 or over, enters whatever its count of editions, for a curator
 * (#2034). Cadillac Ranch has 10 editions, the Crown Fountain 13, The Spirit
 * of Detroit 2, and each is read by tens of thousands a year and listed by the
 * guides. Either mark says a traveller goes there; the readers say how many.
 *
 * A work the door admitted stays while a mark stands and the year reads it
 * over the exit, and falls with the marks named once it does not. The door is
 * shut while the source's curator gate is off (ADR-0056 decision 5) and while
 * no year of readers is read: nothing enters by it, and a held work under the
 * stay line keeps its place with a note saying so. With no Wikivoyage usage
 * build the guide's half is silent and Atlas Obscura's still speaks.
 */

import { curatorGateOn } from '../readershipDoor.js';
import { readershipYear } from '../../dumps/readership/workReadership.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import { belowLineReason, type LinePair, type LineStanding } from '../sourceLine.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { KindShare } from '../places/gather.js';
import { yearlyReaders } from '../places/candidates.js';
import type { PublicArtTrees } from './classes.js';
import { fetchStreetArtMarks } from './streetArtQueries.js';
import { collectWorksUnderFloor } from './underFloor.js';

/** The door's readers: the bar to enter, and the exit a work it admitted stays over. */
export interface MarksDoorBars {
  enterReaders: number;
  stayReaders: number;
}

/**
 * The maintainer's bar of 2026-10-30, sized on the #1997 report: 20,000 readers
 * a year reaches 15 of the canon's missing tops in 207 places, 25,000 only 9.
 * The exit is the editions line's own ratio of stay to enter (18 to 22). #2145
 * restates every readers' bar as a rule that follows the year, and changes
 * this line.
 */
export const PUBLIC_ART_MARKS_DOOR: MarksDoorBars = { enterReaders: 20_000, stayReaders: 16_400 };

/** What the door read: the candidates each mark names, and the year's readers. */
export interface MarksRead {
  guided: ReadonlySet<string>;
  atlas: ReadonlySet<string>;
  readers: ReadonlyMap<string, number>;
}

/** The door over the candidates; null while it is shut — the gate off, or no year of readers read. */
export type MarksDoor = MarksRead | null;

/** The marks a candidate carries, in the words a curator reads. */
export function marksOf(door: MarksRead, qid: string): string[] {
  return [
    ...(door.guided.has(qid) ? ['a Wikivoyage guide uses it'] : []),
    ...(door.atlas.has(qid) ? ['Atlas Obscura lists it'] : []),
  ];
}

const readersOf = (readers: number) => `${readers.toLocaleString('en')} readers a year`;

/** The curator's question on a work the marks door alone admitted or keeps. */
export function marksDoorNote(
  sitelinks: number, readers: number, marks: readonly string[], line: LinePair, bars: MarksDoorBars = PUBLIC_ART_MARKS_DOOR,
): string {
  const against = readers >= bars.enterReaders
    ? `over the marks door's bar of ${bars.enterReaders.toLocaleString('en')}`
    : `over the marks door's exit of ${bars.stayReaders.toLocaleString('en')} that keeps a work the source holds`;
  return `Admitted below the sitelinks line (${sitelinks} Wikipedia editions, ${line.enterSitelinks} to enter; `
    + `${readersOf(readers)}): ${marks.join(' and ')}, and the year reads it ${against}. Can a visitor see it there now?`;
}

/** The note on a held work under the stay line, kept while the door cannot be asked. */
export function keptMarksNote(sitelinks: number, readers: number | null, line: LinePair): string {
  const read = readers === null ? 'no year of readers read' : readersOf(readers);
  return `Kept below the sitelinks line (${sitelinks} Wikipedia editions, ${line.staySitelinks} to stay; ${read}): `
    + "the marks door is shut (the source's curator gate is off, or no year of readers is read)";
}

/** Why a held work under the stay line falls once no mark stands or the year reads it under the exit. */
export function belowLineUnmarkedReason(
  sitelinks: number, readers: number, marks: readonly string[], line: LinePair, bars: MarksDoorBars = PUBLIC_ART_MARKS_DOOR,
): string {
  const marked = marks.length
    ? `${marks.join(' and ')}, but ${readersOf(readers)} is under the marks door's exit of ${bars.stayReaders.toLocaleString('en')}`
    : `no Wikivoyage guide uses it and Atlas Obscura does not list it (${readersOf(readers)})`;
  return `${belowLineReason(sitelinks, line)}, and ${marked}`;
}

export type MarksEntry = { readershipNote: string } | { fell: string } | null;

/**
 * What the marks door says of a candidate the line did not keep: in with the
 * curator's question where a mark stands and the year reads it over the bar
 * (or, held, over the exit), fallen with the marks named where the source held
 * it, kept while the door is shut — and nothing (null) for a candidate never
 * in that the door does not admit, which the line's own answer decides.
 */
export function marksDoorEntry(
  door: MarksDoor, qid: string, sitelinks: number, standing: LineStanding, line: LinePair,
  bars: MarksDoorBars = PUBLIC_ART_MARKS_DOOR,
): MarksEntry {
  if (door === null) return standing === 'fell' ? { readershipNote: keptMarksNote(sitelinks, null, line) } : null;
  const marks = marksOf(door, qid);
  const readers = door.readers.get(qid) ?? 0;
  if (marks.length && readers >= bars.enterReaders) return { readershipNote: marksDoorNote(sitelinks, readers, marks, line, bars) };
  if (standing !== 'fell') return null;
  if (marks.length && readers >= bars.stayReaders) return { readershipNote: marksDoorNote(sitelinks, readers, marks, line, bars) };
  return { fell: belowLineUnmarkedReason(sitelinks, readers, marks, line, bars) };
}

/** The candidates the door is asked about: every one under the line, the held ones included; a candidate the entrance alone brought is the street-art rule's. */
export function marksDoorCandidates(share: KindShare<PublicArtTrees>, line: LinePair): string[] {
  return [...share.pool.values()]
    .filter((entity) => !share.enteredOnly.has(entity.qid) && entity.sitelinks < line.enterSitelinks)
    .map((entity) => entity.qid);
}

/**
 * The share with the marks door read over it: the works under the pool's floor
 * the door may open for join the pool with their facts, containers and
 * subjects, and the marks and the year's readers are read for every candidate
 * under the line. Shut — the gate off, or no year — nothing is read under the
 * floor and the door is null; the held keep their place.
 */
export async function shareWithMarksDoor(
  sourceId: number, share: KindShare<PublicArtTrees>, sparql: SparqlFn, line: LinePair, logPrefix: string,
  bars: MarksDoorBars = PUBLIC_ART_MARKS_DOOR,
): Promise<{ share: KindShare<PublicArtTrees>; marks: MarksDoor }> {
  if (!(await curatorGateOn(sourceId))) {
    console.log(`${logPrefix} The marks door is shut: the source's curator gate is off (ADR-0056 decision 5), and the held keep their place`);
    return { share, marks: null };
  }
  if (!(await readershipYear())) {
    console.log(`${logPrefix} The marks door is shut: no year of readership is folded, and the held keep their place`);
    return { share, marks: null };
  }
  const guideSpeaks = Boolean(await latestUsage());
  if (!guideSpeaks) console.log(`${logPrefix} No Wikivoyage usage is built: the marks door reads Atlas Obscura alone`);
  const under = await collectWorksUnderFloor(sparql, share, bars.enterReaders, guideSpeaks, logPrefix);
  const pool = new Map(share.pool);
  const facts = new Map(share.facts);
  for (const entity of under.entities) pool.set(entity.qid, entity);
  for (const [qid, known] of under.facts) facts.set(qid, known);
  const containers = {
    nodes: new Map([...share.containers.nodes, ...under.containers.nodes]),
    unknown: new Set([...share.containers.unknown, ...under.containers.unknown]),
  };
  const subjects = new Map([...share.subjects, ...under.subjects]);
  const joined: KindShare<PublicArtTrees> = { ...share, pool, facts, containers, subjects };
  const qids = marksDoorCandidates(joined, line);
  const readers = await yearlyReaders(qids, logPrefix);
  if (readers === null) return { share: joined, marks: null };
  const guided = guideSpeaks ? await usedByAGuide(qids) : new Set<string>();
  const atlas = new Set<string>();
  for (const [qid, mark] of await fetchStreetArtMarks(sparql, qids)) if (mark.atlasObscura) atlas.add(qid);
  return { share: joined, marks: { guided, atlas, readers } };
}
