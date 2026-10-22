/**
 * The classes Bridges & engineering marvels reads (#1860, ADR-0131): what a
 * bridge or an engineering work is, the types a reader filters it by, and the
 * classes that make a candidate no place to visit or another kind's.
 *
 * Every id was checked with `wbgetentities` on 2026-10-22. A bridge, an
 * aqueduct, a dam, a canal or a tunnel is in when a traveller would go to it
 * or through it for itself: the Charles Bridge, the Pont du Gard, the Hoover
 * Dam, the Panama Canal, the Channel Tunnel.
 */

import { fetchClassTree, type QueryRunner } from '../wikidataQueries.js';
import type { PoolRoot } from '../places/gather.js';

/** The roots the candidates are asked by, in fame bands on the live service. */
export const BRIDGE_ROOTS: readonly PoolRoot[] = [
  { qid: 'Q12280', label: 'bridge' },
  { qid: 'Q474', label: 'aqueduct' },
  { qid: 'Q12323', label: 'dam' },
  { qid: 'Q12284', label: 'canal' },
  { qid: 'Q44377', label: 'tunnel' },
];

/**
 * The types a work is filed under, the most telling first (`bridgeType`): the
 * Pont du Gard is an aqueduct that is also a bridge, and the Hong Kong–Zhuhai–
 * Macau link a bridge that is also a tunnel.
 */
export const BRIDGE_TYPES = ['aqueduct', 'bridge', 'dam', 'canal', 'tunnel'] as const;
export type BridgeType = (typeof BRIDGE_TYPES)[number];

const TYPE_ROOT: Readonly<Record<BridgeType, string>> = {
  aqueduct: 'Q474', bridge: 'Q12280', dam: 'Q12323', canal: 'Q12284', tunnel: 'Q44377',
};

/** Never a place to visit: gone, not built yet, or ruins. */
export const KILLS: Readonly<Record<string, { root: string; reason: string }>> = {
  destroyed: { root: 'Q19860854', reason: 'destroyed or demolished' },
  proposed: { root: 'Q811683', reason: 'proposed, not built' },
  proposedTunnel: { root: 'Q27464969', reason: 'proposed, not built' },
  underConstruction: { root: 'Q12377751', reason: 'under construction' },
  ruins: { root: 'Q109607', reason: 'ruins: an archaeological site, not a standing work' },
};

/**
 * What is no engineering work a traveller visits, with the sentence a refusal
 * names it by. A river Wikidata also files as a canal (the Amstel) is a river;
 * a transit line that runs in a tunnel (the Waterloo & City line) is a way to
 * get about, not a sight.
 */
export const OTHER_KINDS: Readonly<Record<string, { root: string; reason: string }>> = {
  river: { root: 'Q4022', reason: 'a river, not an engineering work' },
  railwayLine: { root: 'Q728937', reason: 'a railway line, not a sight' },
};

/**
 * An archaeological site (Q839954): an aqueduct or a tunnel of an ended past
 * that only stands as a site, Aqua Marcia or the tunnel of Eupalinos, is
 * Archaeology's (ADR-0131 decision 2), while a Roman bridge still standing
 * and crossed is a bridge.
 */
const ARCHAEOLOGICAL_SITE_ROOT = 'Q839954';

/** The class trees the rule reads. */
export interface BridgeTrees {
  /** Every class under a root: what names a candidate. */
  work: ReadonlySet<string>;
  /** The classes each type is read from. */
  types: Readonly<Record<BridgeType, ReadonlySet<string>>>;
  /** The classes that make a candidate no place to visit, by key of `KILLS`. */
  kills: Readonly<Record<string, ReadonlySet<string>>>;
  /** The classes that make a candidate something else, by key of `OTHER_KINDS`. */
  others: Readonly<Record<string, ReadonlySet<string>>>;
  archaeologicalSite: ReadonlySet<string>;
}

/** Walk every tree the rule reads: one question per root, each its own step. */
export async function fetchBridgeTrees(run: QueryRunner): Promise<BridgeTrees> {
  const tree = async (root: string, label: string): Promise<Set<string>> => {
    await run.step();
    return fetchClassTree(run.sparql, root, label);
  };
  run.phase('Reading what a bridge or an engineering work is...');
  const types = {} as Record<BridgeType, ReadonlySet<string>>;
  const work = new Set<string>();
  for (const type of BRIDGE_TYPES) {
    types[type] = await tree(TYPE_ROOT[type], `${type} classes`);
    for (const cls of types[type]) work.add(cls);
  }
  run.phase('Reading what is no engineering work to visit...');
  const kills: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(KILLS)) kills[key] = await tree(root, `${key} classes`);
  const others: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(OTHER_KINDS)) others[key] = await tree(root, `${key} classes`);
  return { work, types, kills, others, archaeologicalSite: await tree(ARCHAEOLOGICAL_SITE_ROOT, 'archaeological sites') };
}
