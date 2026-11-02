/**
 * Bridges & engineering marvels as a place kind over the place gather (#1860):
 * its trees and pool classes, and its classifier, the rule and the world bars.
 *
 * The world tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`). A guide's mark is what tells the Khaju Bridge in
 * Isfahan from an expressway viaduct as well read, and a canal's lock or boat
 * lift — the Caen Hill flight has 3 editions and 20,000 readers — is read in
 * the same pool as every other work, whatever its editions. The kind's canon
 * is `db/catalogue-coverage/calibration/bridges-and-engineering.jsonl`.
 */

import type { SparqlFn } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByWorldBars } from '../places/worldTier.js';
import type { WorldRead } from '../places/worldBars.js';
import type { WorldHistory } from '../places/worldMemory.js';
import { BRIDGE_ROOTS, BRIDGE_TYPES, fetchBridgeTrees, type BridgeTrees } from './classes.js';
import { bridgeType, bridgeVerdict } from './bridgeTest.js';
import { surroundingsReader, type SurroundingsKind } from '../places/surroundingsTier.js';

/** The source that fills Bridges & engineering marvels, and the kind it fills (migration 150). */
export const BRIDGES_SOURCE_ID = 8;

export const BRIDGES_KIND: PlaceKind<BridgeTrees> = {
  name: 'bridges and engineering works',
  trees: fetchBridgeTrees,
  poolClasses: (trees) => ({ broad: BRIDGE_ROOTS, narrow: trees.work }),
  readsContainers: false,
  admissionPool: true,
};

/** Decide from the kind's share: the rule, then the world bars (`classifyByWorldBars`). */
export const classifyBridges = (share: KindShare<BridgeTrees>, admitted: ReadonlySet<string>, sparql: SparqlFn, read?: WorldRead, history?: WorldHistory) =>
  classifyByWorldBars(share, admitted, { verdict: bridgeVerdict, logPrefix: '[Bridges]' }, sparql, read, history);

/**
 * The kind in the surroundings tier (ADR-0171): every work-class item measured against its
 * surroundings, the rule over the survivors. Its `typeOf` is also the type a
 * coverage survey's entry is filed under within the kind (#2246).
 */
export const BRIDGES_SURROUNDINGS: SurroundingsKind<BridgeTrees> = {
  kind: BRIDGES_KIND,
  classesOf: (trees) => trees.work,
  typeOf: (classes, trees) => bridgeType(classes, trees),
  verdict: (entity, share) => bridgeVerdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
  logPrefix: '[Bridges]',
};

/** The kind's classifier as a source of the place pass reads it (`placeSource`). */
export const BRIDGES_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn, history?: WorldHistory) =>
    classifyBridges(shareOf(gathered, BRIDGES_KIND), admitted, sparql, undefined, history),
  types: BRIDGE_TYPES,
  tag: 'engineering',
  surroundings: surroundingsReader(BRIDGES_SURROUNDINGS),
};
