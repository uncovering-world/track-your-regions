/**
 * ADR-0056: a work the world reads opens a second door to the world tier. A
 * work below a kind's sitelinks line whose year of readership (ADR-0055)
 * reaches the median of the works at or over the line is Iconic and admits its
 * holder, as a work at the line does; a work it admitted stays while it reads
 * at the 35th percentile. The bar is a percentile of the tier, never a number.
 *
 * Two things keep it shut. A work another kind already shows a reader opens
 * nothing (#1574): the Uffizi's works never bring in a second venue. And the
 * door is the source's only while its curator gate is on (decision 5): every
 * venue it admits arrives for a person, with the work, its reading and its
 * burst flag named. The caller asks the gate; this module reads the year.
 */

import { pool } from '../../db/index.js';
import { burstsAmong, readershipYear, readWorks } from '../dumps/readership/workReadership.js';
import { toContent } from './museum/worksCollector.js';
import type { PoolWork } from './museum/queries.js';
import { worksShownByOtherSources } from './shownElsewhere.js';
import type { ProcessedContent } from './types.js';

/** ADR-0056 decision 3: the bar is the tier's median. */
export const DOOR_ENTER_PERCENTILE = 0.5;
/** ADR-0056 decision 2: a work the door admitted leaves below the tier's 35th percentile. */
export const DOOR_STAY_PERCENTILE = 0.35;

/** A work the door is asked about: its item and its sitelinks. */
export interface DoorWork { qid: string; sitelinks: number }

/** What the door read of a work it opened for. */
export interface OpenedWork { views: number; burst: boolean }

export interface ReadershipDoor {
  /** The works below the line it opened for, by item. */
  opened: Map<string, OpenedWork>;
  /** This year's bar and exit, in views, for the run's log and the curator's note. */
  bar: number;
  exit: number;
}

/** The `p`-th percentile of ascending values, interpolated between ranks. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.POSITIVE_INFINITY;
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Which works below the line the reading opens the door for. The bar is read
 * over the works at or over the line that were read at all, so a work the door
 * admits never moves it; a work iconic now keeps its badge down to the exit.
 */
export function doorOf(
  works: readonly DoorWork[],
  views: ReadonlyMap<string, number>,
  line: number,
  iconicNow: ReadonlySet<string>,
  shown: ReadonlySet<string>,
): { opened: Map<string, number>; bar: number; exit: number } {
  const tier = works
    .filter(work => work.sitelinks >= line)
    .map(work => views.get(work.qid) ?? 0)
    .filter(read => read > 0)
    .sort((a, b) => a - b);
  const bar = percentile(tier, DOOR_ENTER_PERCENTILE);
  const exit = percentile(tier, DOOR_STAY_PERCENTILE);
  const opened = new Map<string, number>();
  for (const work of works) {
    if (work.sitelinks >= line || shown.has(work.qid)) continue;
    const read = views.get(work.qid) ?? 0;
    if (read >= bar || (iconicNow.has(work.qid) && read >= exit)) opened.set(work.qid, read);
  }
  return { opened, bar, exit };
}

/** The works among `items` the catalogue marks Iconic now, which the exit applies to. */
async function iconicNow(items: readonly string[]): Promise<Set<string>> {
  const result = await pool.query<{ external_id: string }>(
    'SELECT external_id FROM treasures WHERE is_iconic AND external_id = ANY($1::text[])',
    [items],
  );
  return new Set(result.rows.map(row => row.external_id));
}

/**
 * The door for one run of a source, over the works its pool holds, or null
 * when the year cannot be read (none built, or one a rebuild is still folding
 * with the redirects in place): the run then admits by its line alone.
 */
export async function openReadershipDoor(
  sourceId: number,
  works: readonly DoorWork[],
  line: number,
): Promise<ReadershipDoor | null> {
  const year = await readershipYear();
  if (!year) return null;
  const items = works.map(work => work.qid);
  const { views, counted } = await readWorks(year, items);
  const door = doorOf(works, views, line, await iconicNow(items), await worksShownByOtherSources(sourceId));
  const bursts = await burstsAmong(year, [...door.opened.keys()], counted);
  const opened = new Map<string, OpenedWork>();
  for (const [qid, read] of door.opened) opened.set(qid, { views: read, burst: bursts.has(qid) });
  return { opened, bar: door.bar, exit: door.exit };
}

/**
 * The door a run of a source passes its pipeline, or nothing while the
 * source's curator gate is off: every venue the door admits arrives for a
 * person (ADR-0056 decision 5), and an ungated source would publish it unread.
 */
export async function readershipDoorFor(
  sourceId: number,
  line: number,
  logPrefix: string,
): Promise<((works: DoorWork[]) => Promise<ReadershipDoor | null>) | undefined> {
  const gate = await pool.query<{ requires_curation: boolean }>(
    'SELECT requires_curation FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  if (!gate.rows[0]?.requires_curation) {
    console.log(`${logPrefix} The readership door is shut: the source's curator gate is off (ADR-0056 decision 5)`);
    return undefined;
  }
  return async (works) => {
    const door = await openReadershipDoor(sourceId, works, line);
    console.log(door
      ? `${logPrefix} The readership door opened for ${door.opened.size} works below the line `
        + `(bar ${Math.round(door.bar)} views, exit ${Math.round(door.exit)})`
      : `${logPrefix} The readership door is shut: no year of readership is folded with the redirects in place`);
    return door;
  };
}

/**
 * The work that names why a venue is in: one at the line before one the door
 * opened for, then the most famous by sitelinks, and among works of equal
 * sitelinks the most read.
 */
export function admittingWork(
  iconic: readonly string[],
  pool: ReadonlyMap<string, PoolWork>,
  door: ReadershipDoor | null,
): { work: PoolWork; read: OpenedWork | undefined } | undefined {
  const readOf = (work: PoolWork) => door?.opened.get(work.qid);
  const work = iconic
    .map((qid) => pool.get(qid))
    .filter((held): held is PoolWork => !!held)
    .sort((a, b) => Number(!!readOf(a)) - Number(!!readOf(b))
      || b.sitelinks - a.sitelinks
      || (readOf(b)?.views ?? 0) - (readOf(a)?.views ?? 0))[0];
  return work ? { work, read: readOf(work) } : undefined;
}

/** A work as a treasure is written, Iconic by its reading where the door opened for it. */
export function readContent(work: PoolWork, door: ReadershipDoor | null): ProcessedContent {
  return door?.opened.has(work.qid) ? { ...toContent(work), readIconic: true } : toContent(work);
}

/** The curator's question on a venue the door alone admitted: the work, its year and the bar. */
export function doorNote(label: string, work: OpenedWork, door: ReadershipDoor): string {
  const views = (n: number) => Math.round(n).toLocaleString('en-US');
  const burst = work.burst
    ? '; its year is a burst (a quarter in one week, or months that swing), so check the reading holds'
    : '';
  return `Admitted for ${label}, below the sitelinks line but read ${views(work.views)} times this year `
    + `in every counted edition (the world tier's median is ${views(door.bar)})${burst}. `
    + 'Can a visitor see it there now?';
}
