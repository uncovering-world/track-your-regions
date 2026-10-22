/**
 * The classes Towers reads (#1854, ADR-0131): what a tower is, the types a
 * reader filters it by, and the classes that make a candidate another kind's.
 *
 * Every id was checked with `wbgetentities` on 2026-10-22. A tower is visited
 * to climb or to look at, whatever it was built for: a bell tower, a minaret,
 * a pagoda, a clock tower, a TV tower, a fortified tower standing on its own,
 * a tower tomb.
 */

import { fetchClassTree, type QueryRunner } from '../wikidataQueries.js';
import type { PoolRoot } from '../places/gather.js';

/** The roots the candidates are asked by, in fame bands on the live service. */
export const TOWER_ROOTS: readonly PoolRoot[] = [
  { qid: 'Q12518', label: 'tower' },
  { qid: 'Q200334', label: 'bell tower' },
  { qid: 'Q48356', label: 'minaret' },
  { qid: 'Q199451', label: 'pagoda' },
  { qid: 'Q853854', label: 'clock tower' },
  { qid: 'Q1440300', label: 'observation tower' },
  { qid: 'Q11166728', label: 'television tower' },
  { qid: 'Q1864226', label: 'campanile' },
  { qid: 'Q2455293', label: 'drum tower' },
];

/** The types a tower is filed under, the most telling first (`towerType`). */
export const TOWER_TYPES = ['pagoda', 'minaret', 'clock-tower', 'bell-tower', 'observation-tower', 'fortified-tower', 'tower'] as const;
export type TowerType = (typeof TOWER_TYPES)[number];

/** Each type but the last, and the roots whose trees name it. */
const TYPE_ROOTS: Readonly<Record<Exclude<TowerType, 'tower'>, readonly string[]>> = {
  pagoda: ['Q199451'],
  minaret: ['Q48356'],
  'clock-tower': ['Q853854'],
  // A campanile and a drum tower are bell towers to a reader.
  'bell-tower': ['Q200334', 'Q1864226', 'Q2455293'],
  // A TV tower is climbed for its deck: the CN Tower is both.
  'observation-tower': ['Q1440300', 'Q11166728'],
  'fortified-tower': ['Q81917'],
};

/**
 * What makes a candidate another kind's, or no place to visit, with the
 * sentence a refusal names it by. A lighthouse, a bridge, a city gate and a
 * gate tower have kinds of their own (ADR-0131 decision 2); a statue is a
 * monument or public art; a skyscraper waits for Skyscrapers (#1857).
 */
export const OTHER_KINDS: Readonly<Record<string, { root: string; reason: string }>> = {
  lighthouse: { root: 'Q39715', reason: 'a lighthouse, not a tower' },
  bridge: { root: 'Q12280', reason: 'a bridge, not a tower' },
  gate: { root: 'Q82117', reason: 'a city gate, not a tower' },
  gateTower: { root: 'Q685204', reason: 'a gate tower, not a tower' },
  sculpture: { root: 'Q860861', reason: 'a sculpture, not a tower' },
  skyscraper: { root: 'Q11303', reason: 'a skyscraper, not a tower' },
  officeBuilding: { root: 'Q1021645', reason: 'an office building, not a tower' },
  towerBlock: { root: 'Q18142', reason: 'a tower block, not a tower' },
};

/** Never a place to visit as a tower: gone, never built, or a bare mast. */
export const KILLS: Readonly<Record<string, { root: string; reason: string }>> = {
  destroyed: { root: 'Q19860854', reason: 'destroyed or demolished' },
  proposed: { root: 'Q811683', reason: 'proposed, not built' },
  guyedMast: { root: 'Q5622819', reason: 'a guyed mast, not a tower one visits' },
  ruins: { root: 'Q109607', reason: 'ruins: an archaeological site, not a tower' },
};

/** A place of worship (Q1370598), whose tower classes may name only its part. */
const WORSHIP_ROOT = 'Q1370598';

/**
 * An archaeological site (Q839954): a nuraghe or a broch is a tower of an
 * ended past and stays Archaeology's (ADR-0131 decision 2), while the Minaret
 * of Jam, a site that is a minaret, is a tower too.
 */
const ARCHAEOLOGICAL_SITE_ROOT = 'Q839954';

/**
 * The tower classes that can name a part of a place of worship rather than
 * the place: Hagia Sophia carries `minaret` (Q48356), and the Meenakshi
 * Temple `gopuram` (Q1435771); a church its `steeple` (Q5191724). A worship
 * building that only these name is refused; a bell tower with a chapel in it
 * stays a tower (Ivan the Great).
 */
const WORSHIP_PART_ROOTS = ['Q48356', 'Q1435771', 'Q5191724'];

/** The class trees the rule reads. */
export interface TowerTrees {
  /** Every class under a tower root: what names a candidate. */
  tower: ReadonlySet<string>;
  /** The classes each type is read from. */
  types: Readonly<Record<Exclude<TowerType, 'tower'>, ReadonlySet<string>>>;
  /** The classes that make a candidate another kind's, by key of `OTHER_KINDS`. */
  others: Readonly<Record<string, ReadonlySet<string>>>;
  /** The classes that make a candidate no place to visit, by key of `KILLS`. */
  kills: Readonly<Record<string, ReadonlySet<string>>>;
  worship: ReadonlySet<string>;
  archaeologicalSite: ReadonlySet<string>;
  /** Tower classes that may name a part of a place of worship. */
  worshipParts: ReadonlySet<string>;
}

/** Walk every tree the rule reads: one question per root, each its own step. */
export async function fetchTowerTrees(run: QueryRunner): Promise<TowerTrees> {
  const tree = async (root: string, label: string): Promise<Set<string>> => {
    await run.step();
    return fetchClassTree(run.sparql, root, label);
  };
  run.phase('Reading what a tower is...');
  const tower = new Set<string>();
  for (const root of TOWER_ROOTS) for (const cls of await tree(root.qid, `${root.label} classes`)) tower.add(cls);
  const typeTrees = {} as Record<Exclude<TowerType, 'tower'>, ReadonlySet<string>>;
  for (const [type, roots] of Object.entries(TYPE_ROOTS) as [Exclude<TowerType, 'tower'>, readonly string[]][]) {
    const classes = new Set<string>();
    for (const root of roots) for (const cls of await tree(root, `${type} classes`)) classes.add(cls);
    typeTrees[type] = classes;
  }
  run.phase('Reading what a tower is not...');
  const others: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(OTHER_KINDS)) others[key] = await tree(root, `${key} classes`);
  const kills: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(KILLS)) kills[key] = await tree(root, `${key} classes`);
  const worshipParts = new Set<string>();
  for (const root of WORSHIP_PART_ROOTS) for (const cls of await tree(root, 'tower parts of a place of worship')) worshipParts.add(cls);
  return {
    tower, types: typeTrees, others, kills, worshipParts,
    worship: await tree(WORSHIP_ROOT, 'places of worship'),
    archaeologicalSite: await tree(ARCHAEOLOGICAL_SITE_ROOT, 'archaeological sites'),
  };
}
