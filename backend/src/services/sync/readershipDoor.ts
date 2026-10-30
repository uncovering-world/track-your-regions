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
 * ADR-0127 opens the same door for a place admitted for its own sake: a site
 * below Archaeology's line that the world reads at the median of the kind's
 * own sites at the line. The measure, the bar, the exit and the gate are the
 * work door's. ADR-0128 adds one condition for a place: two independent
 * witnesses say a visitor goes there (`visit/witnesses.ts`), so a place read
 * as much as the Roman Baths with nothing to see (Stapleton International
 * Airport, Rungholt) stays out.
 *
 * Public art opens the place door too (#2033), for a place that is itself a
 * work: the Kelpies, *Maman*. It asks no witnesses. Its rule admits a work by
 * an artwork class and refuses one that is lost or stands indoors, which is
 * what the witnesses ask of a place, so the reading is the only question left.
 *
 * ADR-0152 widens what a place door reads to the places under the pool's floor
 * the world reads at the bar (`readUnderFloor`): the readership names them
 * first, and only those are asked of Wikidata.
 */

import { pool } from '../../db/index.js';
import { burstsAmong, readAtLeast, readershipYear, readWorks } from '../dumps/readership/workReadership.js';
import { latestUsage } from '../dumps/wikivoyage/usageTables.js';
import { WITNESSES, WITNESSES_NEEDED, witnessWords, type Witness } from './visit/witnesses.js';
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

/** A work or a place the door is asked about: its item and its sitelinks. */
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

/**
 * The readership door over a pool of places (ADR-0127): the places below the
 * line it opens for, with the bar read over the places at the line, and the
 * exit holding the ones in `held`. Absent while the source's curator gate is
 * off, and in a test that asks no readership.
 */
export type PlaceDoor = (places: DoorWork[], held: ReadonlySet<string>) => Promise<ReadershipDoor | null>;

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
 * The door over the places a source's pool holds (ADR-0127), or null when the
 * year cannot be read. The exit holds a place the source admits now, as it
 * holds a work Iconic now; no other kind's card shuts it, since a place is
 * shared and another kind offering it says nothing about this one.
 */
export async function openPlaceDoor(
  places: readonly DoorWork[],
  line: number,
  held: ReadonlySet<string>,
): Promise<ReadershipDoor | null> {
  return readDoor(places, async (views) => doorOf(places, views, line, held, new Set()));
}

/**
 * The places under a pool's floor the place door may open for (ADR-0152): the
 * bar read over `places` as `openPlaceDoor` reads it, then every item the year
 * reads at that bar in fewer than `floor` editions. None where the door is
 * shut — no Wikivoyage usage built for its witnesses (`placeReadershipDoorFor`),
 * no year to read, or an empty tier — since it then opens for nothing.
 */
export async function readUnderFloor(places: readonly DoorWork[], line: number, floor: number): Promise<string[]> {
  if (!await latestUsage()) return [];
  const year = await readershipYear();
  if (!year) return [];
  const { views } = await readWorks(year, places.map(place => place.qid));
  const { bar } = doorOf(places, views, line, new Set(), new Set());
  return Number.isFinite(bar) ? readAtLeast(year, bar, floor) : [];
}

/** The places under the pool's floor a run's place door may open for (`readUnderFloor`), over the places it holds. */
export type UnderFloorReader = (places: DoorWork[]) => Promise<string[]>;

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

/** Whether the source's curator gate is on, saying so in the run's log when it is not. */
async function gateIsOn(sourceId: number, logPrefix: string): Promise<boolean> {
  const gate = await pool.query<{ requires_curation: boolean }>(
    'SELECT requires_curation FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  if (gate.rows[0]?.requires_curation) return true;
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
 * The place door a run of a source passes its pipeline (ADR-0127), or nothing
 * while the source's curator gate is off, for the reason the work door's is.
 * With no Wikivoyage usage built the door opens for nothing, as with no year
 * of readership: the travel guide is one of the witnesses a place it opens
 * for needs (ADR-0128), and without it a place would be held to the other
 * three.
 */
export async function placeReadershipDoorFor(
  sourceId: number,
  line: number,
  logPrefix: string,
): Promise<PlaceDoor | undefined> {
  if (!await gateIsOn(sourceId, logPrefix)) return undefined;
  return async (places, held) => {
    if (!await latestUsage()) {
      console.log(`${logPrefix} The readership door is shut: no Wikivoyage usage is built (ADR-0128)`);
      return null;
    }
    return openLoggedPlaceDoor(places, line, held, logPrefix);
  };
}

/**
 * The place door a run of a kind whose places are works passes its pipeline
 * (#2033), or nothing while the source's curator gate is off. It needs no
 * Wikivoyage usage, since it asks no witnesses.
 */
export async function artworkReadershipDoorFor(
  sourceId: number,
  line: number,
  logPrefix: string,
): Promise<PlaceDoor | undefined> {
  if (!await gateIsOn(sourceId, logPrefix)) return undefined;
  return (places, held) => openLoggedPlaceDoor(places, line, held, logPrefix);
}

/** The place door, with what it opened for or why it is shut in the run's log. */
async function openLoggedPlaceDoor(
  places: readonly DoorWork[],
  line: number,
  held: ReadonlySet<string>,
  logPrefix: string,
): Promise<ReadershipDoor | null> {
  const door = await openPlaceDoor(places, line, held);
  if (door) {
    console.log(`${logPrefix} The readership door opened for ${door.opened.size} places below the line `
      + `(bar ${Math.round(door.bar)} views, exit ${Math.round(door.exit)})`);
  } else shutForYear(logPrefix);
  return door;
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

/** Where a place's reading stands against the door: over the bar, or over the exit that keeps a place held. */
function readingAgainst(place: OpenedWork, door: ReadershipDoor): string {
  return place.views >= door.bar
    ? `over the readership door's bar of ${roundViews(door.bar)}`
    : `over the exit of ${roundViews(door.exit)} that keeps a place the source holds`;
}

/**
 * The curator's question on a place the door alone admitted (ADR-0127): its
 * year, the bar, and the witnesses that say a visitor goes there (ADR-0128).
 */
export function placeDoorNote(place: OpenedWork, door: ReadershipDoor, witnesses: readonly Witness[] = []): string {
  const said = witnesses.length > 0 ? ` ${capitalised(witnessWords(witnesses))} say a visitor goes there.` : '';
  return `Admitted below the sitelinks line, read ${roundViews(place.views)} times this year in every counted `
    + `edition (the median of this kind's places at the line is ${roundViews(door.bar)})`
    + `${place.burst ? BURST_CLAUSE : ''}.${said} Is it a place a visitor goes to see?`;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The curator's question on a work the place door alone admitted (#2033): its
 * year and where it stands against the door. Whether it still stands where it
 * did is what the reading cannot say.
 */
export function artworkDoorNote(work: OpenedWork, door: ReadershipDoor): string {
  return `Admitted below the sitelinks line, read ${roundViews(work.views)} times this year in every counted `
    + `edition, ${readingAgainst(work, door)}${work.burst ? BURST_CLAUSE : ''}. Can a visitor see it there now?`;
}

/**
 * Why a place the year opens the door for stays out (ADR-0128): its year,
 * where it stands against the door, and the witnesses it has of the
 * `WITNESSES_NEEDED` it needs.
 */
export function fewWitnessesReason(place: OpenedWork, door: ReadershipDoor, witnesses: readonly Witness[]): string {
  const count = witnesses.length === 1 ? 'one witness says' : `${witnesses.length} witnesses say`;
  const said = witnesses.length === 0
    ? 'no witness says a visitor goes there'
    : `only ${count} a visitor goes there (${witnessWords(witnesses)})`;
  return `Read ${roundViews(place.views)} times this year in every counted edition, ${readingAgainst(place, door)}, `
    + `but ${said}; the door asks for ${WITNESSES_NEEDED} of ${WITNESSES.length}: ${witnessWords(WITNESSES)}`;
}
