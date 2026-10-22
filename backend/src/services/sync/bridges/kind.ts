/**
 * Bridges & engineering marvels as a place kind over the place gather (#1860):
 * its trees and pool classes, and its classifier, the rule and the fame line.
 *
 * The line has two doors, both on 15 Wikipedia editions. A work enters on
 * 50,000 readers a year, or on 10,000 where a Wikivoyage edition uses its
 * item: a guide naming it is what tells the Khaju Bridge in Isfahan from an
 * expressway viaduct as well read. The doors were chosen on this kind's own
 * calibration list (the coverage surveys, World Heritage, the works Wikivoyage
 * names most, the civil engineers' wonders), measured on the dev subset on
 * 2026-10-22: `docs/sources/global/wikidata-bridges.md`. A work the source
 * holds stays while it keeps 12 editions and 35,000 readers, or 7,000 with a
 * guide, so the list does not flicker as the year's reading moves.
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { placeLandmark, yearlyReaders } from '../places/candidates.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';
import { BRIDGE_ROOTS, BRIDGE_TYPES, fetchBridgeTrees, type BridgeTrees } from './classes.js';
import { bridgeVerdict } from './bridgeTest.js';

/** The source that fills Bridges & engineering marvels, and the kind it fills (migration 150). */
export const BRIDGES_SOURCE_ID = 8;

/** One side of the line: the editions, and the readers with and without a guide. */
interface Door {
  editions: number;
  readers: number;
  guidedReaders: number;
}

export interface BridgeLine {
  enter: Door;
  stay: Door;
}

export const BRIDGE_LINE: BridgeLine = {
  enter: { editions: 15, readers: 50_000, guidedReaders: 10_000 },
  stay: { editions: 12, readers: 35_000, guidedReaders: 7_000 },
};

export const BRIDGES_KIND: PlaceKind<BridgeTrees> = {
  name: 'bridges and engineering works',
  trees: fetchBridgeTrees,
  poolClasses: (trees) => ({ broad: BRIDGE_ROOTS, narrow: trees.work }),
  readsContainers: false,
};

type Standing = 'in' | 'out' | 'fell';

const clears = (door: Door, editions: number, readers: number, guided: boolean) =>
  editions >= door.editions && readers >= (guided ? door.guidedReaders : door.readers);

/**
 * Where a candidate stands against the line. `readers` is null when no year of
 * readership can be read: nothing new enters, and a work the source holds
 * keeps its place on the stay line's editions, as Towers does.
 */
export function bridgeStanding(
  editions: number, readers: number | null, guided: boolean, admitted: boolean, line: BridgeLine = BRIDGE_LINE,
): Standing {
  if (readers === null) {
    if (!admitted) return 'out';
    return editions >= line.stay.editions ? 'in' : 'fell';
  }
  if (clears(line.enter, editions, readers, guided)) return 'in';
  if (!admitted) return 'out';
  return clears(line.stay, editions, readers, guided) ? 'in' : 'fell';
}

export function belowBridgeLine(
  editions: number, readers: number | null, guided: boolean, line: BridgeLine = BRIDGE_LINE,
): string {
  const read = readers === null ? 'no year of readers read' : `${readers.toLocaleString('en')} readers a year`;
  const guide = guided ? 'named by a Wikivoyage guide' : 'named by no Wikivoyage guide';
  const { enter, stay } = line;
  return `${editions} Wikipedia editions and ${read}, ${guide}: below the line (${enter.editions} editions and `
    + `${enter.readers.toLocaleString('en')} readers to enter, ${enter.guidedReaders.toLocaleString('en')} with a guide; `
    + `${stay.editions} and ${stay.readers.toLocaleString('en')}, ${stay.guidedReaders.toLocaleString('en')} with a guide, to stay)`;
}

/** The candidates a Wikivoyage edition uses; none while no usage build is in place, which shuts the guide door. */
async function guidedOf(qids: string[]): Promise<ReadonlySet<string>> {
  if (!(await latestUsage())) {
    console.log('[Bridges] No Wikivoyage usage is built: the guide door is shut');
    return new Set();
  }
  return usedByAGuide(qids);
}

/** Decide from the kind's share: the rule, then the line. Items come back most famous first. */
export async function classifyBridges(
  { trees, pool, facts }: KindShare<BridgeTrees>,
  admitted: ReadonlySet<string>,
  read?: { readers: Map<string, number> | null; guided: ReadonlySet<string> },
): Promise<{ items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[] }> {
  const qids = [...pool.keys()];
  const readers = read ? read.readers : await yearlyReaders(qids, '[Bridges]');
  const guided = read ? read.guided : await guidedOf(qids);
  if (readers === null) console.log('[Bridges] No work enters, and the admitted keep their place on editions');
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  for (const entity of [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks)) {
    const classes = facts.get(entity.qid)?.classes ?? [];
    const verdict = bridgeVerdict({ classes, onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const own = readers === null ? null : readers.get(entity.qid) ?? 0;
    const isGuided = guided.has(entity.qid);
    const stands = bridgeStanding(entity.sitelinks, own, isGuided, admitted.has(entity.qid));
    if (stands === 'out') continue;
    if (stands === 'fell') {
      filtered.push({
        externalId: entity.qid, name: entity.label, reason: belowBridgeLine(entity.sitelinks, own, isGuided), type: verdict.type,
      });
      continue;
    }
    items.push(placeLandmark(entity, classes, verdict.type));
  }
  console.log(`[Bridges] Pool of ${pool.size}: ${items.length} admitted, ${filtered.length} refused`);
  return { items, fetched: pool.size, filtered };
}

/** The kind's classifier as a source of the place pass reads it (`placeSource`). */
export const BRIDGES_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>) => classifyBridges(shareOf(gathered, BRIDGES_KIND), admitted),
  types: BRIDGE_TYPES,
  tag: 'engineering',
};
