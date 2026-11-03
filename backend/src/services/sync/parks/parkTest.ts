/**
 * Whether a candidate is a park or a garden a visitor walks in (#2254), and
 * the type it is filed under. The classes are `classes.ts`'; the world bars
 * are the classifier's (`kind.ts`).
 */

import { ARCHAEOLOGICAL_SITE, KILLS, OTHER_KINDS, PARK_TYPES, PLAIN, SHARED, type ParkTrees, type ParkType } from './classes.js';

export interface ParkFacts {
  classes: readonly string[];
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type ParkVerdict =
  | { pass: true; type: ParkType }
  | { pass: false; reason: string };

const carries = (classes: readonly string[], set: ReadonlySet<string>) => classes.some((c) => set.has(c));

const isPlain = (cls: string) => cls === PLAIN.park || cls === PLAIN.garden;

/**
 * Why a candidate the park tree names is something else, or null: a class of
 * `SHARED` that no park or garden class of its own answers, an archaeological
 * site that only the plain classes name, or a residence that only the plain
 * `garden` names.
 */
function notAPark(classes: readonly string[], trees: ParkTrees): string | null {
  const shared = Object.entries(SHARED).filter(([key]) => carries(classes, trees.shared[key]));
  const ownClasses = classes.filter((c) => trees.place.has(c)
    && !Object.values(trees.shared).some((set) => set.has(c)) && !trees.archaeologicalSite.has(c));
  if (shared.length && ownClasses.length === 0) return shared[0][1].reason;
  if (carries(classes, trees.archaeologicalSite) && ownClasses.every(isPlain)) return ARCHAEOLOGICAL_SITE.reason;
  if (carries(classes, trees.residence) && ownClasses.every((c) => c === PLAIN.garden)) {
    return 'a palace, a house or a castle with its garden, not a garden';
  }
  return null;
}

/**
 * The verdict, in order:
 * 1. what is no place to visit: destroyed, proposed, under construction;
 * 2. what another kind offers whatever else it is: a national, state or
 *    provincial park, a place of worship, a cemetery;
 * 3. a candidate no class of the kind names;
 * 4. what the park tree holds that is no park a visitor walks in, unless a
 *    park or garden class of its own names it: a protected area, a zoo, an
 *    amusement or miniature park, a garden square (Squares & streets'), a
 *    sports ground, a business park, an allotment. Gorky Park, an amusement
 *    park and a park, stays;
 * 5. an archaeological site only the plain `park` or `garden` names
 *    (Alacahöyük), and a palace, house or castle only the plain `garden`
 *    names (the Alhambra, Blenheim Palace);
 * 6. a candidate with no point on this planet.
 *
 * A palace garden is no refusal: the kind's definition names it, and the
 * Generalife and Hamarikyu are palaces to Wikidata too.
 */
export function parkVerdict(facts: ParkFacts, trees: ParkTrees): ParkVerdict {
  const { classes } = facts;
  for (const [key, { reason }] of Object.entries(KILLS)) {
    if (carries(classes, trees.kills[key])) return { pass: false, reason };
  }
  for (const [key, { reason }] of Object.entries(OTHER_KINDS)) {
    if (carries(classes, trees.others[key])) return { pass: false, reason };
  }
  if (!carries(classes, trees.place)) return { pass: false, reason: 'no park or garden class' };
  const other = notAPark(classes, trees);
  if (other) return { pass: false, reason: other };
  if (!facts.onEarth || facts.lat === null || facts.lon === null) return { pass: false, reason: 'no point on Earth' };
  return { pass: true, type: parkType(classes, trees) };
}

/** The most telling type its classes name; every other park class is a park. */
export function parkType(classes: readonly string[], trees: ParkTrees): ParkType {
  for (const type of PARK_TYPES) {
    if (type === 'park') break;
    if (carries(classes, trees.types[type])) return type;
  }
  return 'park';
}
