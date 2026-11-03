/**
 * Parks & gardens as a place kind over the place gather (#2254): its trees and
 * pool classes, and its classifier, the rule and the world bars.
 *
 * A proposed kind, declared in the six kinds' shape to test whether the
 * admission frame takes a kind from its declaration alone. It has no source and
 * no kind of its own yet, and no pass reads it: a dry run calls it. The world
 * tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`), the surroundings tier by ADR-0171's cut
 * (`places/surroundingsTier.ts`). The kind's canon is
 * `db/catalogue-coverage/calibration/parks-and-gardens.jsonl`.
 */

import type { SparqlFn } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByWorldBars } from '../places/worldTier.js';
import type { WorldRead } from '../places/worldBars.js';
import type { WorldHistory } from '../places/worldMemory.js';
import { fetchParkTrees, PARK_ROOTS, PARK_TYPES, type ParkTrees } from './classes.js';
import { parkType, parkVerdict } from './parkTest.js';
import { surroundingsReader, type SurroundingsKind } from '../places/surroundingsTier.js';

const LOG_PREFIX = '[Parks]';

export const PARKS_KIND: PlaceKind<ParkTrees> = {
  name: 'parks and gardens',
  trees: fetchParkTrees,
  // The bamboo grove is in `place` and asked by itself; it is no tree of a root (`BAMBOO_GROVE`).
  poolClasses: (trees) => ({ broad: PARK_ROOTS, narrow: trees.place }),
  readsContainers: false,
  admissionPool: true,
};

/** Decide from the kind's share: the rule, then the world bars (`classifyByWorldBars`). */
export const classifyParks = (share: KindShare<ParkTrees>, admitted: ReadonlySet<string>, sparql: SparqlFn, read?: WorldRead, history?: WorldHistory) =>
  classifyByWorldBars(share, admitted, { verdict: parkVerdict, logPrefix: LOG_PREFIX }, sparql, read, history);

/**
 * The kind in the surroundings tier (ADR-0171): every park-class item measured
 * against its surroundings, the rule over the survivors. Its `typeOf` becomes
 * the type a coverage survey's entry is filed under (#2246) once the kind has
 * a kind row (#2317); until then no survey entry reads it.
 */
export const PARKS_SURROUNDINGS: SurroundingsKind<ParkTrees> = {
  kind: PARKS_KIND,
  classesOf: (trees) => trees.place,
  typeOf: (classes, trees) => parkType(classes, trees),
  verdict: (entity, share) => parkVerdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
  logPrefix: LOG_PREFIX,
};

/** The kind's classifier in the shape a source of the place pass reads (`placeSource`). */
export const PARKS_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn, history?: WorldHistory) =>
    classifyParks(shareOf(gathered, PARKS_KIND), admitted, sparql, undefined, history),
  types: PARK_TYPES,
  tag: 'park',
  surroundings: surroundingsReader(PARKS_SURROUNDINGS),
};
