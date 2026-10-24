/**
 * Bridges & engineering marvels as a place kind over the place gather (#1860):
 * its trees and pool classes, and its classifier, the rule and the fame line.
 *
 * The line has two doors, both on 15 Wikipedia editions. A work enters on
 * 50,000 readers a year, or on 10,000 where a Wikivoyage edition uses its
 * item: a guide naming it is what tells the Khaju Bridge in Isfahan from an
 * expressway viaduct as well read. The doors were chosen on the reading in
 * `docs/sources/global/wikidata-bridges.md`, measured on the dev subset on
 * 2026-10-22; the line is checked against the kind's canon in
 * `db/catalogue-coverage/calibration/bridges-and-engineering.jsonl`. A work the source
 * holds stays while it keeps 12 editions and 35,000 readers, or 7,000 with a
 * guide, so the list does not flicker as the year's reading moves.
 */

import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByGuidedLine, type GuidedLine } from '../places/guidedLine.js';
import { BRIDGE_ROOTS, BRIDGE_TYPES, fetchBridgeTrees, type BridgeTrees } from './classes.js';
import { bridgeVerdict } from './bridgeTest.js';

/** The source that fills Bridges & engineering marvels, and the kind it fills (migration 150). */
export const BRIDGES_SOURCE_ID = 8;

export const BRIDGE_LINE: GuidedLine = {
  enter: { editions: 15, readers: 50_000, guidedReaders: 10_000 },
  stay: { editions: 12, readers: 35_000, guidedReaders: 7_000 },
};

export const BRIDGES_KIND: PlaceKind<BridgeTrees> = {
  name: 'bridges and engineering works',
  trees: fetchBridgeTrees,
  poolClasses: (trees) => ({ broad: BRIDGE_ROOTS, narrow: trees.work }),
  readsContainers: false,
};

/** Decide from the kind's share: the rule, then the line (`classifyByGuidedLine`). */
export const classifyBridges = (
  share: KindShare<BridgeTrees>,
  admitted: ReadonlySet<string>,
  read?: { readers: Map<string, number> | null; guided: ReadonlySet<string> },
) => classifyByGuidedLine(share, admitted, { verdict: bridgeVerdict, line: BRIDGE_LINE, logPrefix: '[Bridges]' }, read);

/** The kind's classifier as a source of the place pass reads it (`placeSource`). */
export const BRIDGES_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>) => classifyBridges(shareOf(gathered, BRIDGES_KIND), admitted),
  types: BRIDGE_TYPES,
  tag: 'engineering',
};
