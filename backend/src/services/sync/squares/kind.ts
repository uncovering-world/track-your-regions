/**
 * Squares & streets as a place kind over the place gather (#1867): its trees
 * and pool classes, and its classifier, the rule and the fame line.
 *
 * The line has two doors on 15 Wikipedia editions (`places/guidedLine.ts`): a
 * place enters on 30,000 readers a year, or on 5,000 where a Wikivoyage
 * edition uses its item. The readers' door stays low because guides often
 * name the monument on a square rather than the square, so Havana's Malecón
 * and the Piazza della Rotonda come in on their readers alone. The doors were
 * chosen on the reading in `docs/sources/global/wikidata-squares.md`, measured
 * on the dev subset on 2026-10-23; the line is checked against the kind's
 * canon in `db/catalogue-coverage/calibration/squares-and-streets.jsonl`. A place the source
 * holds stays while it keeps 12 editions and 21,000 readers, or 3,500 with a
 * guide.
 */

import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByGuidedLine, type GuidedLine } from '../places/guidedLine.js';
import { fetchSquareTrees, SQUARE_ROOTS, SQUARE_TYPES, type SquareTrees } from './classes.js';
import { squareVerdict } from './squareTest.js';
import { regionalReader } from '../places/regionalTier.js';

/** The source that fills Squares & streets, and the kind it fills (migration 151). */
export const SQUARES_SOURCE_ID = 9;

export const SQUARE_LINE: GuidedLine = {
  enter: { editions: 15, readers: 30_000, guidedReaders: 5_000 },
  stay: { editions: 12, readers: 21_000, guidedReaders: 3_500 },
};

export const SQUARES_KIND: PlaceKind<SquareTrees> = {
  name: 'squares and streets',
  trees: fetchSquareTrees,
  // The thoroughfare is a root asked by itself; its tree is not asked (`THOROUGHFARE`).
  poolClasses: (trees) => ({ broad: SQUARE_ROOTS, narrow: trees.place }),
  readsContainers: false,
};

/** Decide from the kind's share: the rule, then the line (`classifyByGuidedLine`). */
export const classifySquares = (
  share: KindShare<SquareTrees>,
  admitted: ReadonlySet<string>,
  read?: { readers: Map<string, number> | null; guided: ReadonlySet<string> },
) => classifyByGuidedLine(share, admitted, { verdict: squareVerdict, line: SQUARE_LINE, logPrefix: '[Squares]' }, read);

/** The kind's classifier as a source of the place pass reads it (`placeSource`). */
export const SQUARES_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>) => classifySquares(shareOf(gathered, SQUARES_KIND), admitted),
  types: SQUARE_TYPES,
  tag: 'square',
  // The regional tier (ADR-0171): every place-class item measured against its surroundings, the rule over the survivors.
  regional: regionalReader<SquareTrees>({
    kind: SQUARES_KIND,
    classesOf: (trees) => trees.place,
    typesOf: (trees) => new Map(Object.entries(trees.types)),
    verdict: (entity, share) => squareVerdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
    logPrefix: '[Squares]',
  }),
};
