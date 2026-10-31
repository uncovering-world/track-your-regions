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
 * guide, so the list does not flicker as the year's reading moves. A canal's
 * works are held to a line of their own (`WATERWAY_LINE`), and asked below the
 * pool's floor to meet it.
 */

import { shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from '../places/gather.js';
import { classifyByGuidedLine, type GuidedLine } from '../places/guidedLine.js';
import { BRIDGE_ROOTS, BRIDGE_TYPES, WATERWAY_TYPES, fetchBridgeTrees, type BridgeTrees } from './classes.js';
import { bridgeType, bridgeVerdict } from './bridgeTest.js';
import { regionalReader } from '../places/regionalTier.js';

/** The source that fills Bridges & engineering marvels, and the kind it fills (migration 150). */
export const BRIDGES_SOURCE_ID = 8;

export const BRIDGE_LINE: GuidedLine = {
  enter: { editions: 15, readers: 50_000, guidedReaders: 10_000 },
  stay: { editions: 12, readers: 35_000, guidedReaders: 7_000 },
};

/**
 * The line of a canal's works (#1947): a lock, a flight of locks, a boat lift
 * or an inclined plane enters on 3 Wikipedia editions and 15,000 readers a
 * year, or 4,000 where a Wikivoyage edition uses its item. A lock is read in
 * few languages however many people stop at it — the Caen Hill flight has 3
 * editions and 20,000 readers, Seattle's Ballard Locks 4 and 24,000 — so the
 * kind's own line, on 15 editions, let in only the Falkirk Wheel and
 * Strépy-Thieu. Chosen on the kind's canon of these works, measured on the
 * dev subset on 2026-10-24: `docs/sources/global/wikidata-bridges.md`. It
 * stays on 3 editions and 10,000 readers, or 3,000 with a guide.
 */
export const WATERWAY_LINE: GuidedLine = {
  enter: { editions: 3, readers: 15_000, guidedReaders: 4_000 },
  stay: { editions: 3, readers: 10_000, guidedReaders: 3_000 },
};

/** Every class a canal's lock, flight, lift or inclined plane is filed under. */
const waterwayClasses = (trees: BridgeTrees) => new Set(WATERWAY_TYPES.flatMap((type) => [...trees.types[type]]));

/** Whether a candidate is filed as one of a canal's works (`bridgeType`): the waterway line holds it. */
const isWaterwayWork = (classes: readonly string[], trees: BridgeTrees) => WATERWAY_TYPES.includes(bridgeType(classes, trees));

export const BRIDGES_KIND: PlaceKind<BridgeTrees> = {
  name: 'bridges and engineering works',
  trees: fetchBridgeTrees,
  poolClasses: (trees) => ({ broad: BRIDGE_ROOTS, narrow: trees.work }),
  readsContainers: false,
  // A canal's works are read in few languages; their own line decides them.
  belowFloor: (trees) => ({ classes: [...waterwayClasses(trees)], floor: WATERWAY_LINE.stay.editions }),
};

/** Decide from the kind's share: the rule, then the line (`classifyByGuidedLine`). */
export const classifyBridges = (
  share: KindShare<BridgeTrees>,
  admitted: ReadonlySet<string>,
  read?: { readers: Map<string, number> | null; guided: ReadonlySet<string> },
) => classifyByGuidedLine(share, admitted, {
  verdict: bridgeVerdict,
  line: BRIDGE_LINE,
  lineFor: (classes, trees) => (isWaterwayWork(classes, trees) ? WATERWAY_LINE : BRIDGE_LINE),
  logPrefix: '[Bridges]',
}, read);

/** The kind's classifier as a source of the place pass reads it (`placeSource`). */
export const BRIDGES_CLASSIFIER = {
  classify: (gathered: GatheredPlaces, admitted: ReadonlySet<string>) => classifyBridges(shareOf(gathered, BRIDGES_KIND), admitted),
  types: BRIDGE_TYPES,
  tag: 'engineering',
  // The regional tier (ADR-0171): every work-class item measured against its surroundings, the rule over the survivors.
  regional: regionalReader<BridgeTrees>({
    kind: BRIDGES_KIND,
    classesOf: (trees) => trees.work,
    typeOf: (classes, trees) => bridgeType(classes, trees),
    verdict: (entity, share) => bridgeVerdict({ classes: share.facts.get(entity.qid)?.classes ?? [], onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, share.trees),
    logPrefix: '[Bridges]',
  }),
};
