/**
 * The classes Squares & streets reads (#1867, ADR-0131): what a square, a
 * street, a promenade or a stairway is, the types a reader filters it by,
 * and the classes that make a candidate another kind's.
 *
 * Every id was checked with `wbgetentities` on 2026-10-23. A square or a
 * street is in when a visitor walks it as a sight in itself: Red Square,
 * Piazza Navona, the Spanish Steps, the Champs-Élysées, the Arbat.
 */

import type { PoolRoot } from '../places/gather.js';
import type { PlaceKindDeclaration } from '../places/declaredKind.js';
import { typeValues, type PlaceTypeOf } from '@tyr/shared/placeTypes';

/**
 * A thoroughfare (Q83620) is asked for by itself and not by its tree: Moscow
 * files the Arbat and Tverskaya Street, and Rome the Via Veneto, as a
 * thoroughfare and nothing narrower, while the tree beneath it holds every
 * motorway, railway and bridge.
 */
export const THOROUGHFARE = 'Q83620';

/**
 * A descent (Q3024290), "a descending road or path", asked for by itself as the
 * thoroughfare it sits under is: Kyiv files Andriyivskyy Descent, the cobbled
 * street a visitor walks down from St Andrew's Church to Podil, as a descent and
 * nothing else (#2146). Read off the local subset on 2026-11-08, the class has
 * 28 instances with a point and 22 no other class of the kind names, every one
 * a street: Kyiv's descents, from Andriyivskyy (21 sitelinks) and Saint
 * Volodymyr Descent to Borychiv Descent, others in Kharkiv and Homiel, two lanes
 * of Sulignat in the Ain, and Kinen-zaka, a slope in Nagasaki; Odesa's descents
 * were the kind's already, as streets.
 */
export const DESCENT = 'Q3024290';

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
export const SQUARE_TYPES = typeValues('squares-and-streets');
export type SquareType = PlaceTypeOf<'squares-and-streets'>;

/** Each type and the roots whose trees name it; a bare thoroughfare or a descent is a street. */
const TYPE_ROOTS: Readonly<Record<SquareType, readonly string[]>> = {
  stairway: ['Q12511'],
  square: ['Q174782'],
  promenade: ['Q787113'],
  street: ['Q79007', 'Q369730'],
};

/**
 * What another kind offers, or no square or street a visitor walks, with the
 * sentence a refusal names it by. Wikidata files Al-Aqsa as a square for its
 * esplanade, Nymphenburg Palace as a street, the Charles Bridge as a street and
 * the Roman Forum as a square. A Roman forum is an archaeological site to
 * Wikidata, and an agora is not: the Roman Agora of Athens is a square and an
 * agora, the ancient Greek public space, and Archaeology's to offer (#2136).
 */
const OTHER_KINDS: PlaceKindDeclaration<SquareType>['others'] = {
  worship: { root: 'Q1370598', reason: 'a place of worship, not a square' },
  palace: { root: 'Q16560', reason: 'a palace, not a square' },
  bridge: { root: 'Q12280', reason: 'a bridge, not a street' },
  archaeologicalSite: { root: 'Q839954', reason: 'an archaeological site, not a square' },
  agora: { root: 'Q187909', reason: 'an ancient agora: an archaeological site, not a square' },
  // A bullring is a plaza de toros to Wikidata.
  bullring: { root: 'Q1193438', reason: 'a bullring, not a square' },
  railwayLine: { root: 'Q728937', reason: 'a railway line, not a street' },
  motorway: { root: 'Q46622', reason: 'a motorway, not a street a visitor walks' },
  river: { root: 'Q4022', reason: 'a river, not a street' },
};

/**
 * A canal (Q12284), refused when no class of a square, a street, a promenade
 * or a stairway names it and the bare thoroughfare alone does: Venice's Grand
 * Canal is a canal and a thoroughfare, the city's main waterway, ridden on a
 * vaporetto rather than walked (#2272). A canal a street class names is a
 * quay a visitor walks: Nyhavn is a canal and a street, and Amsterdam files
 * every gracht as a street too.
 */
const CANAL_ROOT = 'Q12284';

/**
 * Squares & streets, declared (#2318): what names a square or a street is
 * every class under a type's roots, the bare thoroughfare and a descent, and a
 * canal is refused where no type names it.
 */
export const SQUARES_DECLARATION: PlaceKindDeclaration<SquareType> = {
  name: 'squares and streets',
  what: 'a square or a street',
  logPrefix: '[Squares]',
  tag: 'square',
  types: SQUARE_TYPES,
  fallback: 'street',
  pool: SQUARE_ROOTS,
  place: { roots: Object.values(TYPE_ROOTS).flat(), classes: [THOROUGHFARE, DESCENT] },
  typeClasses: Object.fromEntries(Object.entries(TYPE_ROOTS).map(([type, roots]) => [type, { roots }])),
  others: OTHER_KINDS,
  noClass: { reason: 'no square or street class' },
  trees: { canal: { roots: [CANAL_ROOT] } },
  exceptions: [{ refuse: 'untyped', when: 'canal', reason: 'a canal, not a street' }],
};
