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
 * so the list does not flicker as the year's reading moves.
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import { readershipYear, readWorks } from '../../dumps/readership/workReadership.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import type { PoolEntity } from '../publicArt/queries.js';
import { fetchTowerTrees, TOWER_ROOTS, TOWER_TYPES, type TowerTrees } from './classes.js';
import { towerVerdict } from './towerTest.js';

/** The line: Wikipedia editions and a year's readers, to enter and to stay. */
export interface TowerLine {
  enterEditions: number;
  enterReaders: number;
  stayEditions: number;
  stayReaders: number;
}

/** The source that fills Towers, and the kind it fills (migration 148). */
export const TOWERS_SOURCE_ID = 7;

export const TOWER_LINE: TowerLine = { enterEditions: 15, enterReaders: 25_000, stayEditions: 12, stayReaders: 18_000 };

export const TOWERS_KIND: PlaceKind<TowerTrees> = {
  name: 'towers',
  trees: fetchTowerTrees,
  poolClasses: (trees) => ({ broad: TOWER_ROOTS, narrow: trees.tower }),
  readsContainers: false,
};

type Standing = 'in' | 'out' | 'fell';

/**
 * Where a candidate stands against the line. `readers` is null when no year of
 * readership can be read: editions alone would let in the pagodas bots wrote,
 * so nothing new enters, and a tower the source holds keeps its place on the
 * stay line's editions until a year can be read again. The run says so in its
 * log.
 */
export function towerStanding(
  editions: number, readers: number | null, admitted: boolean, line: TowerLine = TOWER_LINE,
): Standing {
  if (readers === null) {
    if (!admitted) return 'out';
    return editions >= line.stayEditions ? 'in' : 'fell';
  }
  if (editions >= line.enterEditions && readers >= line.enterReaders) return 'in';
  if (!admitted) return 'out';
  return editions >= line.stayEditions && readers >= line.stayReaders ? 'in' : 'fell';
}

export function belowTowerLine(editions: number, readers: number | null, line: TowerLine = TOWER_LINE): string {
  const read = readers === null ? 'no year of readers read' : `${readers.toLocaleString('en')} readers a year`;
  return `${editions} Wikipedia editions and ${read}: below Towers' line (${line.enterEditions} editions and `
    + `${line.enterReaders.toLocaleString('en')} readers to enter, ${line.stayEditions} and `
    + `${line.stayReaders.toLocaleString('en')} to stay)`;
}

/** A year's readers of each candidate, or null when no year can be read. */
async function readersOf(qids: string[]): Promise<Map<string, number> | null> {
  const year = await readershipYear();
  if (!year) {
    console.log('[Towers] No year of readership is folded with the redirects in place: no tower enters, and the admitted keep their place on editions');
    return null;
  }
  return (await readWorks(year, qids)).views;
}

const landmarkOf = (entity: PoolEntity, classes: string[], type: (typeof TOWER_TYPES)[number]): WikidataLandmark => ({
  qid: entity.qid,
  label: entity.label,
  description: entity.description,
  lat: entity.lat!,
  lon: entity.lon!,
  imageUrl: entity.imageUrl,
  itemPictures: entity.itemPictures,
  creators: [],
  year: entity.year,
  sitelinks: entity.sitelinks,
  countryLabel: entity.countryLabel,
  type,
  classes,
  artwork: false,
  articleUrl: entity.articleUrl,
  website: entity.website,
});

/** Decide from the kind's share: the rule, then the line. Items come back most famous first. */
export async function classifyTowers(
  { trees, pool, facts }: KindShare<TowerTrees>,
  admitted: ReadonlySet<string>,
  readers?: Map<string, number> | null,
): Promise<{ items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[] }> {
  const read = readers === undefined ? await readersOf([...pool.keys()]) : readers;
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  for (const entity of [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks)) {
    const classes = facts.get(entity.qid)?.classes ?? [];
    const verdict = towerVerdict({ classes, onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const readers = read === null ? null : read.get(entity.qid) ?? 0;
    const stands = towerStanding(entity.sitelinks, readers, admitted.has(entity.qid));
    if (stands === 'out') continue;
    if (stands === 'fell') {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: belowTowerLine(entity.sitelinks, readers), type: verdict.type });
      continue;
    }
    items.push(landmarkOf(entity, classes, verdict.type));
  }
  console.log(`[Towers] Pool of ${pool.size}: ${items.length} admitted, ${filtered.length} refused`);
  return { items, fetched: pool.size, filtered };
}

/** Towers' classifier as a source of the place pass reads it (`placeSource`). */
export const TOWERS_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>) => classifyTowers(shareOf(gathered, TOWERS_KIND), admitted),
  types: TOWER_TYPES,
  tag: 'tower',
};
