/**
 * Whether a candidate is a bridge or an engineering work a traveller visits
 * (#1860), and the type it is filed under. The classes are `classes.ts`'; the
 * fame line is the classifier's (`kind.ts`).
 */

import { BRIDGE_TYPES, CANAL, KILLS, OTHER_KINDS, WATERWAY_TYPES, type BridgeTrees, type BridgeType } from './classes.js';

export interface BridgeFacts {
  classes: readonly string[];
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type BridgeVerdict =
  | { pass: true; type: BridgeType }
  | { pass: false; reason: string };

const carries = (classes: readonly string[], set: ReadonlySet<string>) => classes.some((c) => set.has(c));

/**
 * The verdict, in order:
 * 1. what is no place to visit: destroyed, proposed, under construction,
 *    ruins (the Polcevera Viaduct, the Fehmarn Belt link);
 * 2. what is no engineering work a traveller visits: a river, a railway line;
 * 3. a candidate no class of the kind names: a canal that is nothing else
 *    with its own reason (#1948), anything else as no engineering class;
 * 4. an archaeological site no bridge class names (Aqua Marcia, the tunnel of
 *    Eupalinos): Archaeology offers it;
 * 5. a candidate with no point on this planet.
 *
 * A street is no refusal: Prague files the Charles Bridge as one.
 */
export function bridgeVerdict(facts: BridgeFacts, trees: BridgeTrees): BridgeVerdict {
  const { classes } = facts;
  for (const [key, { reason }] of Object.entries(KILLS)) {
    if (carries(classes, trees.kills[key])) return { pass: false, reason };
  }
  for (const [key, { reason }] of Object.entries(OTHER_KINDS)) {
    if (carries(classes, trees.others[key])) return { pass: false, reason };
  }
  if (!carries(classes, trees.work)) {
    return { pass: false, reason: carries(classes, trees.canal) ? CANAL.reason : 'no bridge or engineering class' };
  }
  if (carries(classes, trees.archaeologicalSite) && !carries(classes, trees.types.bridge)) {
    return { pass: false, reason: 'an archaeological site, not a standing work' };
  }
  if (!facts.onEarth || facts.lat === null || facts.lon === null) return { pass: false, reason: 'no point on Earth' };
  return { pass: true, type: bridgeType(classes, trees) };
}

/** The most telling type its classes name; a power station's dam before its lock. */
export function bridgeType(classes: readonly string[], trees: BridgeTrees): BridgeType {
  const type = BRIDGE_TYPES.find((each) => carries(classes, trees.types[each])) ?? 'bridge';
  const generates = carries(classes, trees.powerStation) && carries(classes, trees.types.dam);
  return generates && WATERWAY_TYPES.includes(type) ? 'dam' : type;
}
