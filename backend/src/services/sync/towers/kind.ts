/**
 * Towers as a place kind over the place gather (#1854, #1820): its trees and
 * pool classes, and its classifier, the rule and the world bars.
 *
 * The world tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`): its Wikipedia editions, its readers a year, and its
 * readers where a guide marks the tower. Editions alone mislead for towers —
 * Hoằng Phúc pagoda has 37 editions a bot wrote and 2,700 readers a year — and
 * the readers' bars are what keeps it out; the third bar lets in the Asinelli
 * Tower and the Torrazzo of Cremona, read in few languages and visited by
 * everyone who comes to their towns. The kind's canon is
 * `db/catalogue-coverage/calibration/towers.jsonl`.
 */

import type { SparqlFn } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByWorldBars } from '../places/worldTier.js';
import type { WorldRead } from '../places/worldBars.js';
import type { WorldHistory } from '../places/worldMemory.js';
import { fetchTowerTrees, TOWER_ROOTS, TOWER_TYPES, type TowerTrees } from './classes.js';
import { towerType, towerVerdict } from './towerTest.js';
import { regionalReader, type RegionalKind } from '../places/regionalTier.js';

/** The source that fills Towers, and the kind it fills (migration 148). */
export const TOWERS_SOURCE_ID = 7;

const LOG_PREFIX = '[Towers]';

export const TOWERS_KIND: PlaceKind<TowerTrees> = {
  name: 'towers',
  trees: fetchTowerTrees,
  poolClasses: (trees) => ({ broad: TOWER_ROOTS, narrow: trees.tower }),
  readsContainers: false,
  admissionPool: true,
};

/** Decide from the kind's share: the rule, then the world bars (`classifyByWorldBars`). */
export const classifyTowers = (share: KindShare<TowerTrees>, admitted: ReadonlySet<string>, sparql: SparqlFn, read?: WorldRead, history?: WorldHistory) =>
  classifyByWorldBars(share, admitted, { verdict: towerVerdict, logPrefix: LOG_PREFIX }, sparql, read, history);

/**
 * The kind in the regional tier (ADR-0171): every tower-class item measured against its
 * surroundings, the rule over the survivors. Its `typeOf` is also the type a
 * coverage survey's entry is filed under within the kind (#2246).
 */
export const TOWERS_REGIONAL: RegionalKind<TowerTrees> = {
  kind: TOWERS_KIND,
  classesOf: (trees) => trees.tower,
  typeOf: (classes, trees) => towerType(classes, trees),
  verdict: (entity, share) => towerVerdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
  logPrefix: LOG_PREFIX,
};

/** Towers' classifier as a source of the place pass reads it (`placeSource`). */
export const TOWERS_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn, history?: WorldHistory) =>
    classifyTowers(shareOf(gathered, TOWERS_KIND), admitted, sparql, undefined, history),
  types: TOWER_TYPES,
  tag: 'tower',
  regional: regionalReader(TOWERS_REGIONAL),
};
