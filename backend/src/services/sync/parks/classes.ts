/**
 * The classes Parks & gardens reads (#2254, a proposed kind's declaration
 * run as a dry run): what a park or a garden is, the types a reader filters
 * it by, and the classes that make a candidate another kind's or no park a
 * visitor walks in.
 *
 * Every id was checked on the local Wikidata subset on 2026-11-03. A park or a
 * garden is in when a visitor goes to walk in it: Central Park, Kew, the
 * Jardin du Luxembourg, Kenroku-en, the Generalife, Gorky Park.
 */

import { fetchClassTree, type QueryRunner } from '../wikidataQueries.js';
import type { PoolRoot } from '../places/gather.js';

const PARK = 'Q22698';
const GARDEN = 'Q1107656';
const BOTANICAL_GARDEN = 'Q167346';

/**
 * A bamboo grove (Q11599236) is asked by itself: the definition names a grove
 * kept for walking in, and Wikidata files Arashiyama's Bamboo Forest as a
 * bamboo grove and nothing under a park or a garden.
 */
export const BAMBOO_GROVE = 'Q11599236';

/**
 * The roots the candidates are asked by, in fame bands on the live service.
 * A label is singular: the progress line adds the plural. On the subset of
 * 2026-11-03, 98,812 items are a park and 6,685 an urban park, which sits
 * under both a park and a garden; 4,802 a garden and 2,713 a botanical garden.
 */
export const PARK_ROOTS: readonly PoolRoot[] = [
  { qid: PARK, label: 'park' },
  { qid: GARDEN, label: 'garden' },
  { qid: 'Q22746', label: 'urban park' },
  { qid: BOTANICAL_GARDEN, label: 'botanical garden' },
];

/**
 * The types a place is filed under, the most telling first (`parkType`): Kew
 * is a botanical garden though a garden too, the Jardin du Luxembourg a garden
 * though an urban park too (an urban garden), Central Park a park.
 */
export const PARK_TYPES = ['botanical-garden', 'garden', 'park'] as const;
export type ParkType = (typeof PARK_TYPES)[number];

/** Never a place to visit: gone, or not built yet. The Hanging Gardens of Babylon are destroyed. */
export const KILLS: Readonly<Record<string, { root: string; reason: string }>> = {
  destroyed: { root: 'Q19860854', reason: 'destroyed or demolished' },
  proposed: { root: 'Q811683', reason: 'proposed, not built' },
  underConstruction: { root: 'Q12377751', reason: 'under construction' },
};

/**
 * What another kind offers whatever park or garden class it carries, with the
 * sentence a refusal names it by. A national, state or provincial park is a
 * reserve a visitor enters to be in nature, which National parks & reserves
 * names: Wikidata files the Simien Mountains National Park as a national park
 * and a park, and the national park class sits under the park tree. A temple
 * Wikidata files as a Japanese garden is Places of worship's (Kinkaku-ji,
 * Saihō-ji), as a square's mosque is; a cemetery park is Cemeteries'
 * (Ohlsdorf, Munich's Waldfriedhof).
 */
export const OTHER_KINDS: Readonly<Record<string, { root: string; reason: string }>> = {
  nationalPark: { root: 'Q46169', reason: 'a national park: a reserve, not a park' },
  statePark: { root: 'Q1761072', reason: 'a state park: a reserve, not a park' },
  provincialPark: { root: 'Q52063214', reason: 'a provincial park: a reserve, not a park' },
  worship: { root: 'Q1370598', reason: 'a place of worship, not a garden' },
  cemetery: { root: 'Q39614', reason: 'a cemetery, not a park' },
};

/**
 * What the park tree also holds that is no park a visitor walks in, or what
 * another kind offers, refused only where no park or garden class outside all
 * of these trees names it — the plain `park` and `garden` classes counting.
 * On the subset, 11,670 park-tree items are protected areas, and 1,464 carry a
 * park class of their own: Gorky Park (an amusement park, a protected area and
 * a park), Richmond Park, Hampstead Heath, the High Line (a linear park, which
 * Wikidata files under protected areas, and an urban park) stay. A garden
 * square is a square and a garden, which Squares & streets offers as a square:
 * Russell Square is refused here, the Lustgarten, a square and a park, stays.
 * Tivoli Gardens, an amusement park and a pleasure garden, stays; Disneyland,
 * a theme park, does not.
 */
export const SHARED: Readonly<Record<string, { root: string; reason: string }>> = {
  protectedArea: { root: 'Q473972', reason: 'a protected area, not a park' },
  zoo: { root: 'Q43501', reason: 'a zoo, not a park' },
  amusementPark: { root: 'Q194195', reason: 'an amusement park, not a park' },
  miniaturePark: { root: 'Q974968', reason: 'a miniature park, not a park' },
  square: { root: 'Q174782', reason: 'a square, which Squares & streets offers' },
  sportsVenue: { root: 'Q1076486', reason: 'a sports venue, not a park' },
  sportsPark: { root: 'Q16363669', reason: 'a sports park, not a park' },
  outdoorGym: { root: 'Q692630', reason: 'an outdoor gym, not a park' },
  golfCourse: { root: 'Q1048525', reason: 'a golf course, not a park' },
  businessPark: { root: 'Q338313', reason: 'a business park, not a park' },
  industrialPark: { root: 'Q1662100', reason: 'an industrial park, not a park' },
  sittingOutArea: { root: 'Q125573159', reason: 'a sitting-out area, not a park' },
  allotment: { root: 'Q4404694', reason: 'an allotment, not a garden a visitor walks in' },
  communityGarden: { root: 'Q251958', reason: 'a community garden, not a garden a visitor walks in' },
};

/**
 * An archaeological site (Q839954), refused where no park or garden class but
 * the plain `park` and `garden` names it: Wikidata files Alacahöyük and the
 * Pyramids of Güímar as a site and a park, and Archaeology offers them, while
 * its 530 archaeological parks are the site tree's too.
 */
export const ARCHAEOLOGICAL_SITE = { root: 'Q839954', reason: 'an archaeological site, not a park' };

/** The plain classes, which name a site's or a house's grounds by their use alone. */
export const PLAIN = { park: PARK, garden: GARDEN };

/**
 * A palace, a historic house or a castle that only the plain `garden` class
 * names is the house, and the garden its grounds: the Alhambra, Balmoral,
 * Blenheim Palace and Castle Howard. One a class of garden names is the
 * garden a visitor goes for (the Generalife, a Historic Garden of Spain;
 * Hamarikyu, a Japanese garden; Stourhead, an English garden), and one
 * Wikidata files as a park is a park ensemble (Tsaritsyno).
 */
export const RESIDENCE_ROOTS: readonly string[] = ['Q16560', 'Q5773747', 'Q23413'];

/** The class trees the rule reads. */
export interface ParkTrees {
  /** Every class under the park or the garden root, and the bamboo grove: what names a candidate. */
  place: ReadonlySet<string>;
  /** The classes each type is read from; `park` is every place class the other two leave. */
  types: Readonly<Record<Exclude<ParkType, 'park'>, ReadonlySet<string>>>;
  /** The classes that make a candidate no place to visit, by key of `KILLS`. */
  kills: Readonly<Record<string, ReadonlySet<string>>>;
  /** The classes that make a candidate another kind's, by key of `OTHER_KINDS`. */
  others: Readonly<Record<string, ReadonlySet<string>>>;
  /** The classes that make a candidate no park unless a class of its own names it, by key of `SHARED`. */
  shared: Readonly<Record<string, ReadonlySet<string>>>;
  /** The archaeological site tree (`ARCHAEOLOGICAL_SITE`). */
  archaeologicalSite: ReadonlySet<string>;
  /** The palace, historic house and castle trees together (`RESIDENCE_ROOTS`). */
  residence: ReadonlySet<string>;
}

/** Walk every tree the rule reads: one question per root, each its own step. */
export async function fetchParkTrees(run: QueryRunner): Promise<ParkTrees> {
  const tree = async (root: string, label: string): Promise<Set<string>> => {
    await run.step();
    return fetchClassTree(run.sparql, root, label);
  };
  run.phase('Reading what a park or a garden is...');
  const park = await tree(PARK, 'park classes');
  const garden = await tree(GARDEN, 'garden classes');
  const botanical = await tree(BOTANICAL_GARDEN, 'botanical garden classes');
  const place = new Set<string>([...park, ...garden, BAMBOO_GROVE]);
  // A garden class that is no park class: an urban park is under both, and is a park.
  const gardenOnly = new Set([...garden].filter((cls) => !park.has(cls) && !botanical.has(cls)));
  run.phase('Reading what a park or a garden is not...');
  const kills: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(KILLS)) kills[key] = await tree(root, `${key} classes`);
  const others: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(OTHER_KINDS)) others[key] = await tree(root, `${key} classes`);
  const shared: Record<string, ReadonlySet<string>> = {};
  for (const [key, { root }] of Object.entries(SHARED)) shared[key] = await tree(root, `${key} classes`);
  const residence = new Set<string>();
  for (const root of RESIDENCE_ROOTS) for (const cls of await tree(root, 'palaces, houses and castles')) residence.add(cls);
  return {
    place, types: { 'botanical-garden': botanical, garden: gardenOnly }, kills, others, shared, residence,
    archaeologicalSite: await tree(ARCHAEOLOGICAL_SITE.root, 'archaeological sites'),
  };
}
