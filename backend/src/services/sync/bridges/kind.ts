/**
 * Bridges & engineering marvels as a place kind over the place gather (#1860):
 * built from its declaration (`classes.ts`, #2318), its trees and pool classes,
 * its rule and the world bars.
 *
 * The world tier admits by the three bars of ADR-0175 over the kind's own pool
 * (`places/worldBars.ts`). A guide's mark is what tells the Khaju Bridge in
 * Isfahan from an expressway viaduct as well read, and a canal's lock or boat
 * lift — the Caen Hill flight has 3 editions and 20,000 readers — is read in
 * the same pool as every other work, whatever its editions. The kind's canon
 * is `db/catalogue-coverage/calibration/bridges-and-engineering.jsonl`.
  *
 * The verdict, in the order `places/declaredKind.ts` reads it: what is no
 * place to visit (destroyed, proposed, under construction, ruins: the Polcevera
 * Viaduct, the Fehmarn Belt link); what is no engineering work a traveller
 * visits (a river, a railway line); a candidate no class of the kind names (a
 * canal that is nothing else with its own reason, #1948); an archaeological
 * site no bridge class names; a candidate with no point on this planet.
 */

import { declaredKind, type DeclaredTrees, type PlaceFacts } from '../places/declaredKind.js';
import { BRIDGES_DECLARATION, type BridgeType } from './classes.js';

/** The source that fills Bridges & engineering marvels, and the kind it fills (migration 150). */
export const BRIDGES_SOURCE_ID = 8;

const BRIDGES = declaredKind(BRIDGES_DECLARATION);

export type BridgeTrees = DeclaredTrees<BridgeType>;
export type BridgeFacts = PlaceFacts;
export const BRIDGES_KIND = BRIDGES.kind;
export const bridgeVerdict = BRIDGES.verdict;
export const bridgeType = BRIDGES.typeOf;
export const classifyBridges = BRIDGES.classify;
export const BRIDGES_SURROUNDINGS = BRIDGES.surroundings;
export const BRIDGES_CLASSIFIER = BRIDGES.classifier;
