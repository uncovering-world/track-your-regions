/**
 * Whether a candidate is a square, a street, a promenade or a stairway a
 * visitor walks as a sight (#1867), and the type it is filed under. The
 * classes are `classes.ts`'; the world bars are the classifier's (`kind.ts`).
 */

import { KILLS, OTHER_KINDS, SQUARE_TYPES, type SquareTrees, type SquareType } from './classes.js';

export interface SquareFacts {
  classes: readonly string[];
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type SquareVerdict =
  | { pass: true; type: SquareType }
  | { pass: false; reason: string };

const carries = (classes: readonly string[], set: ReadonlySet<string>) => classes.some((c) => set.has(c));

/**
 * The verdict, in order:
 * 1. what is no place to visit: destroyed, proposed, under construction;
 * 2. what another kind offers, or no square or street a visitor walks: a
 *    place of worship, a palace, a bridge, an archaeological site or an
 *    ancient agora, a bullring, a railway line, a motorway, a river;
 * 3. a candidate no class of the kind names;
 * 4. a canal only the bare thoroughfare names: Venice's Grand Canal is a
 *    waterway, while Nyhavn, a canal and a street, is a quay a visitor walks;
 * 5. a candidate with no point on this planet.
 *
 * A neighbourhood is no refusal: Wikidata files a shopping street under
 * neighbourhoods, and Oxford Street and Fifth Avenue are streets a visitor
 * walks.
 */
export function squareVerdict(facts: SquareFacts, trees: SquareTrees): SquareVerdict {
  const { classes } = facts;
  for (const [key, { reason }] of Object.entries(KILLS)) {
    if (carries(classes, trees.kills[key])) return { pass: false, reason };
  }
  for (const [key, { reason }] of Object.entries(OTHER_KINDS)) {
    if (carries(classes, trees.others[key])) return { pass: false, reason };
  }
  if (!carries(classes, trees.place)) return { pass: false, reason: 'no square or street class' };
  if (carries(classes, trees.canal) && !SQUARE_TYPES.some((type) => carries(classes, trees.types[type]))) {
    return { pass: false, reason: 'a canal, not a street' };
  }
  if (!facts.onEarth || facts.lat === null || facts.lon === null) return { pass: false, reason: 'no point on Earth' };
  return { pass: true, type: squareType(classes, trees) };
}

/** The most telling type its classes name; a bare thoroughfare is a street. */
export function squareType(classes: readonly string[], trees: SquareTrees): SquareType {
  return SQUARE_TYPES.find((type) => carries(classes, trees.types[type])) ?? 'street';
}
