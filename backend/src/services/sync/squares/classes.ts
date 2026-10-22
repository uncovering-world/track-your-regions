/**
 * The classes Squares & streets reads (#1867, ADR-0131): what a square, a
 * street, a promenade or a stairway is, the types a reader filters it by,
 * and the classes that make a candidate another kind's.
 *
 * Every id was checked with `wbgetentities` on 2026-10-23. A square or a
 * street is in when a visitor walks it as a sight in itself: Red Square,
 * Piazza Navona, the Spanish Steps, the Champs-Élysées, the Arbat.
 */

import { fetchClassTree, type QueryRunner } from '../wikidataQueries.js';
import type { PoolRoot } from '../places/gather.js';

/**
 * A thoroughfare (Q83620) is asked for by itself and not by its tree: Moscow
 * files the Arbat and Tverskaya Street, and Rome the Via Veneto, as a
 * thoroughfare and nothing narrower, while the tree beneath it holds every
 * motorway, railway and bridge.
 */
export const THOROUGHFARE = 'Q83620';

/**
 * The roots the candidates are asked by, in fame bands on the live service.
 * A label is singular: the progress line adds the plural.
 */
export const SQUARE_ROOTS: readonly PoolRoot[] = [
  { qid: 'Q174782', label: 'square' },
  { qid: 'Q79007', label: 'street' },
  { qid: 'Q787113', label: 'promenade' },
  { qid: 'Q12511', label: 'stairway' },
  { qid: 'Q369730', label: 'pedestrian zone' },
  { qid: THOROUGHFARE, label: 'thoroughfare' },
];

/**
 * The types a place is filed under, the most telling first (`squareType`):
 * the Spanish Steps are a stairway, the National Mall a square though it is
 * an avenue too, the Promenade des Anglais a promenade though it is a street.
 */
export const SQUARE_TYPES = ['stairway', 'square', 'promenade', 'street'] as const;
export type SquareType = (typeof SQUARE_TYPES)[number];

/** Each type and the roots whose trees name it; a bare thoroughfare is a street. */
const TYPE_ROOTS: Readonly<Record<SquareType, readonly string[]>> = {
  stairway: ['Q12511'],
  square: ['Q174782'],
  promenade: ['Q787113'],
  street: ['Q79007', 'Q369730'],
};

/** Never a place to visit: gone, or not built yet. */
export const KILLS: Readonly<Record<string, { root: string; reason: string }>> = {
  destroyed: { root: 'Q19860854', reason: 'destroyed or demolished' },
  proposed: { root: 'Q811683', reason: 'proposed, not built' },
  underConstruction: { root: 'Q12377751', reason: 'under construction' },
};

/**
 * What another kind offers, or no square or street a visitor walks, with the
 * sentence a refusal names it by. Wikidata files Al-Aqsa as a square for its
 * esplanade, Nymphenburg Palace as a street, the Charles Bridge as a street and
 * the Roman Forum as a square.
 */
export const OTHER_KINDS: Readonly<Record<string, { root: string; reason: string }>> = {
  worship: { root: 'Q1370598', reason: 'a place of worship, not a square' },
  palace: { root: 'Q16560', reason: 'a palace, not a square' },
  bridge: { root: 'Q12280', reason: 'a bridge, not a street' },
  archaeologicalSite: { root: 'Q839954', reason: 'an archaeological site, not a square' },
  // A bullring is a plaza de toros to Wikidata.
  bullring: { root: 'Q1193438', reason: 'a bullring, not a square' },
  railwayLine: { root: 'Q728937', reason: 'a railway line, not a street' },
  motorway: { root: 'Q46622', reason: 'a motorway, not a street a visitor walks' },
  river: { root: 'Q4022', reason: 'a river, not a street' },
};

/** The class trees the rule reads. */
export interface SquareTrees {
  /** Every class under a root but the thoroughfare's, and the thoroughfare itself: what names a candidate. */
  place: ReadonlySet<string>;
  /** The classes each type is read from. */
  types: Readonly<Record<SquareType, ReadonlySet<string>>>;
  /** The classes that make a candidate no place to visit, by key of `KILLS`. */
  kills: Readonly<Record<string, ReadonlySet<string>>>;
  /** The classes that make a candidate another kind's, by key of `OTHER_KINDS`. */
  others: Readonly<Record<string, ReadonlySet<string>>>;
}

/** Walk every tree the rule reads: one question per root, each its own step. */
export async function fetchSquareTrees(run: QueryRunner): Promise<SquareTrees> {
  const tree = async (root: string, label: string): Promise<Set<string>> => {
    await run.step();
    return fetchClassTree(run.sparql, root, label);
  };
  run.phase('Reading what a square or a street is...');
  const types = {} as Record<SquareType, ReadonlySet<string>>;
  const place = new Set<string>([THOROUGHFARE]);
  for (const type of SQUARE_TYPES) {
    const classes = new Set<string>();
    for (const root of TYPE_ROOTS[type]) for (const cls of await tree(root, `${type} classes`)) classes.add(cls);
    types[type] = classes;
    for (const cls of classes) place.add(cls);
  }
  run.phase('Reading what a square or a street is not...');
  const kills: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(KILLS)) kills[key] = await tree(root, `${key} classes`);
  const others: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(OTHER_KINDS)) others[key] = await tree(root, `${key} classes`);
  return { place, types, kills, others };
}
