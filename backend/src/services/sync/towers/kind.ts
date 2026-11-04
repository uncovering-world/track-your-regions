/**
 * Towers as a place kind over the place gather (#1854): built from its
 * declaration (`classes.ts`, #2318), its trees and pool classes, its rule and
 * the world bars.
 *
 * The world tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`): its Wikipedia editions, its readers a year, and its
 * readers where a guide marks the tower. Editions alone mislead for towers —
 * Hoằng Phúc pagoda has 37 editions a bot wrote and 2,700 readers a year — and
 * the readers' bars are what keeps it out; the third bar lets in the Asinelli
 * Tower and the Torrazzo of Cremona, read in few languages and visited by
 * everyone who comes to their towns. The kind's canon is
 * `db/catalogue-coverage/calibration/towers.jsonl`.
 *
 * The verdict, in the order `places/declaredKind.ts` reads it: what is no
 * place to visit (gone, never built, ruins); what another kind
 * holds (a lighthouse, a bridge, a city gate or a gate tower, a sculpture, a
 * skyscraper, #1857, unless it is an observation tower); a candidate no tower
 * class names; the exceptions of `TOWERS_DECLARATION`; a candidate with no
 * point on this planet. Once the tiers have decided, a broadcast mast is filed
 * under its own type from OpenStreetMap's layer (`masts.ts`, #2275), never
 * refused for being one.
 */

import { declaredKind, type DeclaredTrees, type PlaceFacts } from '../places/declaredKind.js';
import type { PlaceClassifier } from '../landmarkSyncService.js';
import { TOWERS_DECLARATION, type TowerType } from './classes.js';
import { fileMasts } from './masts.js';

/** The source that fills Towers, and the kind it fills (migration 148). */
export const TOWERS_SOURCE_ID = 7;

const TOWERS = declaredKind(TOWERS_DECLARATION);

export type TowerTrees = DeclaredTrees<TowerType>;
export type TowerFacts = PlaceFacts;
export const TOWERS_KIND = TOWERS.kind;
export const towerVerdict = TOWERS.verdict;
export const towerType = TOWERS.typeOf;
export const classifyTowers = TOWERS.classify;
export const TOWERS_SURROUNDINGS = TOWERS.surroundings;
export const TOWERS_CLASSIFIER: PlaceClassifier = {
  ...TOWERS.classifier,
  retype: (items, sparql) => fileMasts(items, sparql, TOWERS_DECLARATION.logPrefix),
};
