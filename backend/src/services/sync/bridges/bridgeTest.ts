/**
 * Whether a candidate is a bridge or an engineering work a traveller visits
 * (#1860), and the type it is filed under. The classes are `classes.ts`'; the
 * fame line is the classifier's (`kind.ts`).
 */

import { BRIDGE_TYPES, KILLS, OTHER_KINDS, type BridgeTrees, type BridgeType } from './classes.js';

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
 * 3. a candidate no class of the kind names;
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
  if (!carries(classes, trees.work)) return { pass: false, reason: 'no bridge or engineering class' };
  if (carries(classes, trees.archaeologicalSite) && !carries(classes, trees.types.bridge)) {
    return { pass: false, reason: 'an archaeological site, not a standing work' };
  }
  if (!facts.onEarth || facts.lat === null || facts.lon === null) return { pass: false, reason: 'no point on Earth' };
  return { pass: true, type: bridgeType(classes, trees) };
}

/** The most telling type its classes name. */
export function bridgeType(classes: readonly string[], trees: BridgeTrees): BridgeType {
  return BRIDGE_TYPES.find((type) => carries(classes, trees.types[type])) ?? 'bridge';
}
