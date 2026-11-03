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

import type { PoolRoot } from '../places/gather.js';
import type { PlaceKindDeclaration } from '../places/declaredKind.js';
import { typeValues, type PlaceTypeOf } from '@tyr/shared/placeTypes';

const PARK = 'Q22698';
const GARDEN = 'Q1107656';
const BOTANICAL_GARDEN = 'Q167346';

/**
 * A bamboo grove (Q11599236) is asked by itself: the definition names a grove
 * kept for walking in, and Wikidata files Arashiyama's Bamboo Forest as a
 * bamboo grove and nothing under a park or a garden.
 */
const BAMBOO_GROVE = 'Q11599236';

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
export const PARK_TYPES = typeValues('parks-and-gardens');
export type ParkType = PlaceTypeOf<'parks-and-gardens'>;

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
const OTHER_KINDS: PlaceKindDeclaration<ParkType>['others'] = {
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
const SHARED: PlaceKindDeclaration<ParkType>['shared'] = {
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
const ARCHAEOLOGICAL_SITE = 'Q839954';


/**
 * A palace, a historic house or a castle that only the plain `garden` class
 * names is the house, and the garden its grounds: the Alhambra, Balmoral,
 * Blenheim Palace and Castle Howard. One a class of garden names is the
 * garden a visitor goes for (the Generalife, a Historic Garden of Spain;
 * Hamarikyu, a Japanese garden; Stourhead, an English garden), and one
 * Wikidata files as a park is a park ensemble (Tsaritsyno).
 */
const RESIDENCE_ROOTS: readonly string[] = ['Q16560', 'Q5773747', 'Q23413'];

/**
 * Parks & gardens, declared (#2318). What names a park is every class under
 * the park or the garden root, and the bamboo grove; a garden is a garden
 * class that is neither a park class nor a botanical garden's (an urban park,
 * under both, is a park). After the classes of the kind named a candidate,
 * what it shares with another kind (`SHARED`, the archaeological site among
 * them) counts only where a class of the kind's own names it too, and the
 * plain `park` and `garden` classes name a site's or a house's grounds by their
 * use alone: an archaeological site only they name (Alacahöyük), and a palace,
 * house or castle only the plain `garden` names (the Alhambra, Blenheim
 * Palace), are refused. A palace garden is no refusal: the kind's definition
 * names it, and the Generalife and Hamarikyu are palaces to Wikidata too.
 */
export const PARKS_DECLARATION: PlaceKindDeclaration<ParkType> = {
  name: 'parks and gardens',
  what: 'a park or a garden',
  logPrefix: '[Parks]',
  tag: 'park',
  types: PARK_TYPES,
  fallback: 'park',
  pool: PARK_ROOTS,
  place: { roots: [PARK, GARDEN], classes: [BAMBOO_GROVE] },
  typeClasses: {
    'botanical-garden': { roots: [BOTANICAL_GARDEN] },
    garden: { roots: [GARDEN], minus: { roots: [PARK, BOTANICAL_GARDEN] } },
  },
  others: OTHER_KINDS,
  noClass: { reason: 'no park or garden class' },
  shared: SHARED,
  trees: {
    archaeologicalSite: { roots: [ARCHAEOLOGICAL_SITE] },
    residence: { roots: RESIDENCE_ROOTS },
    plain: { classes: [PARK, GARDEN] },
    plainGarden: { classes: [GARDEN] },
  },
  notOwn: ['archaeologicalSite'],
  exceptions: [
    { refuse: 'only', when: 'archaeologicalSite', only: 'plain', reason: 'an archaeological site, not a park' },
    { refuse: 'only', when: 'residence', only: 'plainGarden', reason: 'a palace, a house or a castle with its garden, not a garden' },
  ],
};
