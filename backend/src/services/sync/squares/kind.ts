/**
 * Squares & streets as a place kind over the place gather (#1867): its trees
 * and pool classes, and its classifier, the rule and the world bars.
 *
 * The world tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`). The third bar — readers where a guide marks the
 * place — matters most here: guides often name the monument on a square
 * rather than the square, and an expressway can be read as much as a street a
 * traveller crosses a city for. The kind's canon is
 * `db/catalogue-coverage/calibration/squares-and-streets.jsonl`.
 */

import type { SparqlFn } from '../wikidataQueries.js';
import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByWorldBars } from '../places/worldTier.js';
import type { WorldRead } from '../places/worldBars.js';
import { fetchSquareTrees, SQUARE_ROOTS, SQUARE_TYPES, type SquareTrees } from './classes.js';
import { squareType, squareVerdict } from './squareTest.js';
import { regionalReader, type RegionalKind } from '../places/regionalTier.js';

/** The source that fills Squares & streets, and the kind it fills (migration 151). */
export const SQUARES_SOURCE_ID = 9;

export const SQUARES_KIND: PlaceKind<SquareTrees> = {
  name: 'squares and streets',
  trees: fetchSquareTrees,
  // The thoroughfare is a root asked by itself; its tree is not asked (`THOROUGHFARE`).
  poolClasses: (trees) => ({ broad: SQUARE_ROOTS, narrow: trees.place }),
  readsContainers: false,
  admissionPool: true,
};

/** Decide from the kind's share: the rule, then the world bars (`classifyByWorldBars`). */
export const classifySquares = (share: KindShare<SquareTrees>, admitted: ReadonlySet<string>, sparql: SparqlFn, read?: WorldRead) =>
  classifyByWorldBars(share, admitted, { verdict: squareVerdict, logPrefix: '[Squares]' }, sparql, read);

/**
 * The kind in the regional tier (ADR-0171): every place-class item measured against its
 * surroundings, the rule over the survivors. Its `typeOf` is also the type a
 * coverage survey's entry is filed under within the kind (#2246).
 */
export const SQUARES_REGIONAL: RegionalKind<SquareTrees> = {
  kind: SQUARES_KIND,
  classesOf: (trees) => trees.place,
  typeOf: (classes, trees) => squareType(classes, trees),
  verdict: (entity, share) => squareVerdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
  logPrefix: '[Squares]',
};

/** The kind's classifier as a source of the place pass reads it (`placeSource`). */
export const SQUARES_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn) =>
    classifySquares(shareOf(gathered, SQUARES_KIND), admitted, sparql),
  types: SQUARE_TYPES,
  tag: 'square',
  regional: regionalReader(SQUARES_REGIONAL),
};
