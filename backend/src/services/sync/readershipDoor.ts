/**
 * ADR-0056: a work the world reads opens a second door to the world tier. A
 * work below a kind's sitelinks line whose year of readership (ADR-0055)
 * reaches a percentile of the works at or over the line is Iconic and admits
 * its holder, as a work at the line does; a work it admitted stays while it
 * reads at a lower one. The percentiles are the median and the 35th
 * (`DOOR_PERCENTILES`) unless a source states its own: Art Museums enters at
 * the 12th and stays at the 8th (ADR-0162, `ART_MUSEUM_DOOR`). The bar is a
 * percentile of the tier, never a number.
 *
 * Two things keep it shut. A work another kind already shows a reader opens
 * nothing (#1574): the Uffizi's works never bring in a second venue. And the
 * door is the source's only while its curator gate is on (decision 5): every
 * venue it admits arrives for a person, with the work, its reading and its
 * burst flag named. The caller asks the gate; this module reads the year.
 *
 * ADR-0165 widens what the finds door reads to the finds under the pool's
 * floor the world reads at the bar (`readUnderFloor`): the readership names
 * them first, and only those are asked of Wikidata.
 */

import { pool } from '../../db/index.js';
import { burstsAmong, readAtLeast, readershipYear, readWorks } from '../dumps/readership/workReadership.js';
import { toContent } from './museum/worksCollector.js';
import type { PoolWork } from './museum/queries.js';
import { worksShownByOtherSources } from './shownElsewhere.js';
import type { ProcessedContent } from './types.js';

/** ADR-0056 decision 3: the bar is the tier's median. */
export const DOOR_ENTER_PERCENTILE = 0.5;
/** ADR-0056 decision 2: a work the door admitted leaves below the tier's 35th percentile. */
export const DOOR_STAY_PERCENTILE = 0.35;

/** Where in the world tier's reading a work door enters and stays: ADR-0056's, unless a source states its own. */
export interface DoorPercentiles { enter: number; stay: number }
export const DOOR_PERCENTILES: DoorPercentiles = { enter: DOOR_ENTER_PERCENTILE, stay: DOOR_STAY_PERCENTILE };

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
  percentiles: DoorPercentiles = DOOR_PERCENTILES,
): { opened: Map<string, number>; bar: number; exit: number } {
  const tier = works
    .filter(work => work.sitelinks >= line)
    .map(work => views.get(work.qid) ?? 0)
    .filter(read => read > 0)
    .sort((a, b) => a - b);
  const bar = percentile(tier, percentiles.enter);
  const exit = percentile(tier, percentiles.stay);
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
  percentiles: DoorPercentiles = DOOR_PERCENTILES,
): Promise<ReadershipDoor | null> {
  return readDoor(works, async (views, items) => (
    doorOf(works, views, line, await iconicNow(items), await worksShownByOtherSources(sourceId), percentiles)
  ));
}

/**
 * The items under a pool's floor a readership door may open for: the bar read
 * over `items` as the door reads it, then every item the year reads at that
 * bar in fewer than `floor` editions — the finds door's (ADR-0165), at the
 * door's own percentiles. None where the door is shut — no year to read, or
 * an empty tier — since it then opens for nothing. Each caller opens its door
 * first and passes this read only while it is open.
 */
export async function readUnderFloor(
  items: readonly DoorWork[], line: number, floor: number, percentiles: DoorPercentiles = DOOR_PERCENTILES,
): Promise<string[]> {
  const year = await readershipYear();
  if (!year) return [];
  const { views } = await readWorks(year, items.map(item => item.qid));
  const { bar } = doorOf(items, views, line, new Set(), new Set(), percentiles);
  if (!Number.isFinite(bar)) return [];
  return readAtLeast(year, bar, floor);
}

/** The items under the pool's floor a run's door may open for (`readUnderFloor`), over the items the pool holds. */
export type UnderFloorReader = (items: DoorWork[]) => Promise<string[]>;

/** The year's reading of the items, the door it opens, and the burst flag on what it opened for. */
async function readDoor(
  items: readonly DoorWork[],
  open: (views: ReadonlyMap<string, number>, qids: string[]) => Promise<ReturnType<typeof doorOf>>,
): Promise<ReadershipDoor | null> {
  const year = await readershipYear();
  if (!year) return null;
  const qids = items.map(item => item.qid);
  const { views, counted } = await readWorks(year, qids);
  const door = await open(views, qids);
  const bursts = await burstsAmong(year, [...door.opened.keys()], counted);
  const opened = new Map<string, OpenedWork>();
  for (const [qid, read] of door.opened) opened.set(qid, { views: read, burst: bursts.has(qid) });
  return { opened, bar: door.bar, exit: door.exit };
}

/**
 * Whether the source's curator gate is on (ADR-0056 decision 5): every door
 * that admits below a kind's line is the source's only while it is, since each
 * arrival through one is for a person to read.
 */
async function curatorGateOn(sourceId: number): Promise<boolean> {
  const gate = await pool.query<{ requires_curation: boolean }>(
    'SELECT requires_curation FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  return gate.rows[0]?.requires_curation === true;
}

/** Whether the source's curator gate is on, saying so in the run's log when it is not. */
async function gateIsOn(sourceId: number, logPrefix: string): Promise<boolean> {
  if (await curatorGateOn(sourceId)) return true;
  console.log(`${logPrefix} The readership door is shut: the source's curator gate is off (ADR-0056 decision 5)`);
  return false;
}

const shutForYear = (logPrefix: string) => console.log(
  `${logPrefix} The readership door is shut: no year of readership is folded with the redirects in place`,
);

/**
 * The door a run of a source passes its pipeline, or nothing while the
 * source's curator gate is off: every venue the door admits arrives for a
 * person (ADR-0056 decision 5), and an ungated source would publish it unread.
 */
export async function readershipDoorFor(
  sourceId: number,
  line: number,
  logPrefix: string,
  percentiles: DoorPercentiles = DOOR_PERCENTILES,
): Promise<((works: DoorWork[]) => Promise<ReadershipDoor | null>) | undefined> {
  if (!await gateIsOn(sourceId, logPrefix)) return undefined;
  return async (works) => {
    const door = await openReadershipDoor(sourceId, works, line, percentiles);
    if (door) {
      console.log(`${logPrefix} The readership door opened for ${door.opened.size} works below the line `
        + `(bar ${Math.round(door.bar)} views, exit ${Math.round(door.exit)})`);
    } else shutForYear(logPrefix);
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

const roundViews = (n: number) => Math.round(n).toLocaleString('en-US');
const BURST_CLAUSE = '; its year is a burst (a quarter in one week, or months that swing), so check the reading holds';

/** The curator's question on a venue the door alone admitted: the work, its year and the bar. */
export function doorNote(label: string, work: OpenedWork, door: ReadershipDoor): string {
  return `Admitted for ${label}, below the sitelinks line but read ${roundViews(work.views)} times this year `
    + `in every counted edition (the readership door's bar is ${roundViews(door.bar)})${work.burst ? BURST_CLAUSE : ''}. `
    + 'Can a visitor see it there now?';
}
