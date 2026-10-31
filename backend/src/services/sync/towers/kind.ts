/**
 * Towers as a place kind over the place gather (#1854, #1820): its trees and
 * pool classes, and its classifier, the rule and the fame line.
 *
 * The line reads two measures, Wikipedia editions and a year's readers.
 * Editions alone mislead for towers: Hoằng Phúc pagoda has 37 editions a bot
 * wrote and 2,700 readers a year. It was chosen from this kind's own evidence
 * (the coverage surveys' towers and the World Federation of Great Towers'
 * members, measured on the dev subset on 2026-10-22; the record is
 * `docs/sources/global/wikidata-towers.md`): 15 editions and 25,000 readers
 * a year to enter. A tower the source holds stays while it keeps 12 and 18,000,
 * so the list does not flicker as the year's reading moves. The line is
 * checked against the kind's canon in
 * `db/catalogue-coverage/calibration/towers.jsonl`.
 *
 * Beside the line stands one door (ADR-0168, `TOWER_GUIDE_DOOR`): a tower a
 * Wikivoyage guide uses that a year of readers puts at 15,000 or over enters,
 * whatever its count of editions, for a curator — the Asinelli Tower and the
 * Torrazzo of Cremona are read in few languages and visited by everyone who
 * comes to their towns. The door reads the pool and the towers under its
 * floor (`underFloor.ts`).
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { placeLandmark, yearlyReaders } from '../places/candidates.js';
import { guideDoorOpen, type GuideDoor } from '../places/guideDoor.js';
import type { PoolEntity } from '../publicArt/queries.js';
import { usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import { fetchTowerTrees, TOWER_ROOTS, TOWER_TYPES, type TowerTrees } from './classes.js';
import { towerVerdict } from './towerTest.js';
import { collectTowersUnderFloor } from './underFloor.js';

/** The line: Wikipedia editions and a year's readers, to enter and to stay. */
export interface TowerLine {
  enterEditions: number;
  enterReaders: number;
  stayEditions: number;
  stayReaders: number;
}

/** The source that fills Towers, and the kind it fills (migration 148). */
export const TOWERS_SOURCE_ID = 7;

const LOG_PREFIX = '[Towers]';

export const TOWER_LINE: TowerLine = { enterEditions: 15, enterReaders: 25_000, stayEditions: 12, stayReaders: 18_000 };

/** The guide door's readers: the bar to enter, and the exit a tower it admitted stays over. */
export interface TowerGuideDoor {
  enterReaders: number;
  stayReaders: number;
}

/**
 * ADR-0168: a tower a Wikivoyage guide uses enters at 15,000 readers a year,
 * whatever its editions, and stays over 10,800 — the line's own ratio of stay
 * to enter (18,000 to 25,000), so a tower the door admitted flickers no more
 * than one the line did. The count is the maintainer's of 2026-10-30, sized
 * on the #1997 report; #2145 restates every readers' bar as a rule that
 * follows the year, and changes this line.
 */
export const TOWER_GUIDE_DOOR: TowerGuideDoor = { enterReaders: 15_000, stayReaders: 10_800 };

export const TOWERS_KIND: PlaceKind<TowerTrees> = {
  name: 'towers',
  trees: fetchTowerTrees,
  poolClasses: (trees) => ({ broad: TOWER_ROOTS, narrow: trees.tower }),
  readsContainers: false,
};

/** In by the line; in by the guide door, with the curator's question; out; or fallen below both. */
export type TowerStanding = 'in' | 'door' | 'out' | 'fell';

/**
 * Where a candidate stands while no year of readers can be read: nothing new
 * enters, a held tower keeps its place on the stay line's editions, and a held
 * tower a guide uses keeps it through the door, whatever its editions.
 */
function standingWithoutYear(editions: number, admitted: boolean, guided: boolean, line: TowerLine): TowerStanding {
  if (!admitted) return 'out';
  if (editions >= line.stayEditions) return 'in';
  return guided ? 'door' : 'fell';
}

/**
 * Where a candidate stands against the line and the door. `readers` is null
 * when no year of readership can be read: editions alone would let in the
 * pagodas bots wrote, so nothing new enters, and a tower the source holds
 * keeps its place on the stay line's editions until a year can be read again.
 * The run says so in its log. `guided` says a Wikivoyage guide uses the
 * candidate while the door is open; the door reads readers as the line does,
 * so it opens for nothing while no year is read — and a held tower a guide
 * uses keeps its place then too, whatever its editions, since the door that
 * admitted it cannot be asked (the Asinelli Tower has 9).
 */
export function towerStanding(
  editions: number, readers: number | null, admitted: boolean, line: TowerLine = TOWER_LINE,
  guided = false, door: TowerGuideDoor = TOWER_GUIDE_DOOR,
): TowerStanding {
  if (readers === null) return standingWithoutYear(editions, admitted, guided, line);
  if (editions >= line.enterEditions && readers >= line.enterReaders) return 'in';
  if (admitted && editions >= line.stayEditions && readers >= line.stayReaders) return 'in';
  if (guided && readers >= door.enterReaders) return 'door';
  if (!admitted) return 'out';
  return guided && readers >= door.stayReaders ? 'door' : 'fell';
}

export function belowTowerLine(editions: number, readers: number | null, line: TowerLine = TOWER_LINE): string {
  const read = readers === null ? 'no year of readers read' : `${readers.toLocaleString('en')} readers a year`;
  return `${editions} Wikipedia editions and ${read}: below Towers' line (${line.enterEditions} editions and `
    + `${line.enterReaders.toLocaleString('en')} readers to enter, ${line.stayEditions} and `
    + `${line.stayReaders.toLocaleString('en')} to stay)`;
}

/** The refusal of a held tower that fell below the line while the door was open: the guide's word, or its absence, named. */
export function belowTowerDoor(
  editions: number, readers: number | null, guided: boolean, line: TowerLine = TOWER_LINE, door: TowerGuideDoor = TOWER_GUIDE_DOOR,
): string {
  const guide = guided
    ? `a Wikivoyage guide uses it, but under the guide door's exit of ${door.stayReaders.toLocaleString('en')} readers`
    : 'and no Wikivoyage guide uses it';
  return `${belowTowerLine(editions, readers, line)}, ${guide}`;
}

/**
 * The curator's question on a tower the guide door alone admitted or keeps:
 * over the door's bar, or — a held tower — over the exit that keeps it.
 */
export function towerDoorNote(editions: number, readers: number, door: TowerGuideDoor = TOWER_GUIDE_DOOR): string {
  const against = readers >= door.enterReaders
    ? `over the guide door's bar of ${door.enterReaders.toLocaleString('en')}`
    : `over the guide door's exit of ${door.stayReaders.toLocaleString('en')} that keeps a tower the source holds`;
  return `Admitted below Towers' line (${editions} Wikipedia editions, ${readers.toLocaleString('en')} readers a year): `
    + `a Wikivoyage guide uses it, and the year reads it ${against}. Is it a tower a visitor goes to see?`;
}

/** Why a held tower under the line is kept without the door's reading: the door is shut, or no year of readers is read. */
export type KeptBecause = 'shut' | 'no-year';

const KEPT_BECAUSE: Record<KeptBecause, string> = {
  shut: "the guide door is shut (the source's curator gate is off, or no Wikivoyage usage is built)",
  'no-year': 'a Wikivoyage guide uses it, and no year of readers is read to ask the guide door',
};

/** The note on a held tower under the line, kept while the guide door cannot be asked. */
export function keptTowerNote(editions: number, readers: number | null, because: KeptBecause): string {
  const read = readers === null ? 'no year of readers read' : `${readers.toLocaleString('en')} readers a year`;
  return `Kept below Towers' line (${editions} Wikipedia editions, ${read}): ${KEPT_BECAUSE[because]}`;
}

/** A row, marked where the door and not the line let it in; a refusal by name; or nothing for a candidate never in. */
type Decision = { item: WikidataLandmark; byDoor?: true } | { refused: FilteredEntity } | null;

/**
 * Where a tower the rule passes comes to, by the line and the door: a row (with
 * the door's question where the door alone admitted it, or the note that keeps
 * a held tower while the door cannot be asked), a refusal by name, or nothing
 * for a candidate never in.
 */
function lineOrDoor(
  entity: PoolEntity, classes: string[], type: WikidataLandmark['type'],
  readers: number | null, held: boolean, guide: GuideDoor | undefined,
): Decision {
  const guided = guide?.has(entity.qid) ?? false;
  const stands = towerStanding(entity.sitelinks, readers, held, TOWER_LINE, guided);
  if (stands === 'out') return null;
  const landmark = placeLandmark(entity, classes, type);
  if (stands === 'in') return { item: landmark };
  if (stands === 'door') {
    // No year to read: the guide still speaks for the held tower, and the door keeps it where it is.
    if (readers === null) return { item: { ...landmark, readershipNote: keptTowerNote(entity.sitelinks, null, 'no-year') } };
    return { item: { ...landmark, readershipNote: towerDoorNote(entity.sitelinks, readers) }, byDoor: true };
  }
  // Shut, the door keeps a held tower where it is until the guide can be read
  // again, as the line keeps one while no year of readers can be read.
  if (guide === null) return { item: { ...landmark, readershipNote: keptTowerNote(entity.sitelinks, readers, 'shut') } };
  const reason = guide === undefined ? belowTowerLine(entity.sitelinks, readers) : belowTowerDoor(entity.sitelinks, readers, guided);
  return { refused: { externalId: entity.qid, name: entity.label, reason, type } };
}

/**
 * Decide from the kind's share: the rule, then the line and the door. Items
 * come back most famous first. `readers` hands a year's readers in, for a
 * test; a run reads them itself. `guide` is the guide door over the pool
 * (`GuideDoor`): the candidates a guide uses, null while the door is shut,
 * undefined where no door is opened — a test of the line alone.
 */
export async function classifyTowers(
  { trees, pool, facts }: KindShare<TowerTrees>,
  admitted: ReadonlySet<string>,
  readers?: Map<string, number> | null,
  guide?: GuideDoor,
): Promise<{ items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[] }> {
  const read = readers === undefined ? await yearlyReaders([...pool.keys()], LOG_PREFIX) : readers;
  if (read === null) console.log(`${LOG_PREFIX} No tower enters, and the admitted keep their place on editions`);
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  const byDoor: string[] = [];
  for (const entity of [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks)) {
    const classes = facts.get(entity.qid)?.classes ?? [];
    const verdict = towerVerdict({ classes, onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const own = read === null ? null : read.get(entity.qid) ?? 0;
    const decision = lineOrDoor(entity, classes, verdict.type, own, admitted.has(entity.qid), guide);
    if (decision && 'item' in decision) {
      items.push(decision.item);
      if (decision.byDoor) byDoor.push(decision.item.label);
    } else if (decision) {
      filtered.push(decision.refused);
    }
  }
  console.log(`${LOG_PREFIX} Pool of ${pool.size}: ${items.length} admitted, ${filtered.length} refused`
    + (byDoor.length ? `; the guide door admitted ${byDoor.join(', ')}` : ''));
  return { items, fetched: pool.size, filtered };
}

/**
 * The share with the guide door read over it (ADR-0168): the towers under the
 * floor the door may open for join the pool with their facts, and the guide is
 * asked about every candidate. Shut, nothing is read under the floor and the
 * door is null; the held keep their place.
 */
async function shareWithGuideDoor(
  gathered: GatheredPlaces, sparql: SparqlFn,
): Promise<{ share: KindShare<TowerTrees>; guide: GuideDoor }> {
  const share = shareOf(gathered, TOWERS_KIND);
  if (!(await guideDoorOpen(TOWERS_SOURCE_ID, LOG_PREFIX))) return { share, guide: null };
  const under = await collectTowersUnderFloor(sparql, share.pool, share.trees, TOWER_GUIDE_DOOR.enterReaders, LOG_PREFIX);
  const pool = new Map(share.pool);
  const facts = new Map(share.facts);
  for (const entity of under.entities) pool.set(entity.qid, entity);
  for (const [qid, known] of under.facts) facts.set(qid, known);
  return { share: { ...share, pool, facts }, guide: await usedByAGuide([...pool.keys()]) };
}

/** Towers' classifier as a source of the place pass reads it (`placeSource`). */
export const TOWERS_CLASSIFIER = {
  classify: async (gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn) => {
    const { share, guide } = await shareWithGuideDoor(gathered, sparql);
    return classifyTowers(share, admitted, undefined, guide);
  },
  types: TOWER_TYPES,
  tag: 'tower',
};
