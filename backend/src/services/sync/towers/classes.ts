/**
 * The classes Towers reads (#1854, ADR-0131): what a tower is, the types a
 * reader filters it by, and the classes that make a candidate another kind's.
 *
 * Every id was checked with `wbgetentities` on 2026-10-22. A tower is visited
 * to climb or to look at, whatever it was built for: a bell tower, a minaret,
 * a pagoda, a clock tower, a TV tower, a fortified tower standing on its own,
 * a tower tomb.
 */

import type { PoolRoot } from '../places/gather.js';
import type { PlaceKindDeclaration } from '../places/declaredKind.js';
import { PUBLIC_CLOCK_CLASSES } from '../publicArt/classes.js';
import { typeValues, type PlaceTypeOf } from '@tyr/shared/placeTypes';

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
export const TOWER_TYPES = typeValues('towers');
export type TowerType = PlaceTypeOf<'towers'>;

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
const OTHER_KINDS: PlaceKindDeclaration<TowerType>['others'] = {
  lighthouse: { root: 'Q39715', reason: 'a lighthouse, not a tower' },
  bridge: { root: 'Q12280', reason: 'a bridge, not a tower' },
  gate: { root: 'Q82117', reason: 'a city gate, not a tower' },
  gateTower: { root: 'Q685204', reason: 'a gate tower, not a tower' },
  sculpture: { root: 'Q860861', reason: 'a sculpture, not a tower' },
  // A TV or observation tower Wikidata also calls a skyscraper is still a tower
  // (the Oriental Pearl Tower): its type names what it is visited for.
  skyscraper: { root: 'Q11303', reason: 'a skyscraper, not a tower', unlessTyped: ['observation-tower'] },
  officeBuilding: { root: 'Q1021645', reason: 'an office building, not a tower', unlessTyped: ['observation-tower'] },
  towerBlock: { root: 'Q18142', reason: 'a tower block, not a tower', unlessTyped: ['observation-tower'] },
};

/** Never a place to visit as a tower, beside the gone and the unbuilt: a bare mast, ruins. */
const KILLS: PlaceKindDeclaration<TowerType>['kills'] = {
  guyedMast: { root: 'Q5622819', reason: 'a guyed mast, not a tower one visits' },
  ruins: { root: 'Q109607', reason: 'ruins: an archaeological site, not a tower' },
};

/**
 * A building complex (Q1497364), the class alone and not its tree: Wikidata
 * files Cœur Défense, a complex of office towers, as a building complex and a
 * tower. The tree holds twin towers, monasteries and convents, and Kharaqan's
 * twin tower tombs are towers a traveller visits (#2136).
 */
const BUILDING_COMPLEX = 'Q1497364';

/** The plain `tower` class, which names a complex's towers by their height alone. */
const PLAIN_TOWER = 'Q12518';

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

/**
 * A sea fort (Q20097897), whose tree reaches the tower tree through the
 * Maunsell fort (Q1911186), filed under `fortified tower` for its legs: HM
 * Fort Roughs, the platform of "Sealand", and the Red Sands and Shivering
 * Sands forts in the Thames Estuary are gun platforms out at sea, not towers
 * a visitor climbs or stands under (#2272). A sea fort another tower class
 * names stays a tower: Fort Denison in Sydney Harbour is a Martello tower.
 */
const SEA_FORT_ROOT = 'Q20097897';

/**
 * Towers, declared (#2318). After the classes of a tower named a candidate,
 * the exceptions, in order:
 * - a public clock no clock-tower class names: Wikidata files the Prague
 *   Astronomical Clock as a bell tower for its bells, and Public art offers it
 *   (#2136). Big Ben and the Tower of the Winds are clock towers;
 * - a building complex that only the plain `tower` class names: Cœur
 *   Défense's office towers (#2136). Bologna's Two Towers, a complex of
 *   inclined towers, stay;
 * - a place of worship whose only tower class names its part (Hagia Sophia's
 *   minarets): Places of worship offers it. A worship class that is itself a
 *   tower class does not make one, since Wikidata files a minaret under
 *   structures of worship and the Qutb Minar is nothing but a minaret;
 * - a sea fort whose only tower class is a sea fort's: HM Fort Roughs is a gun
 *   platform at sea, and Fort Denison, a Martello tower too, stays;
 * - an archaeological site no type of tower names (a nuraghe, a broch):
 *   Archaeology offers it.
 */
export const TOWERS_DECLARATION: PlaceKindDeclaration<TowerType> = {
  name: 'towers',
  what: 'a tower',
  logPrefix: '[Towers]',
  tag: 'tower',
  types: TOWER_TYPES,
  fallback: 'tower',
  pool: TOWER_ROOTS,
  place: { roots: TOWER_ROOTS.map((root) => root.qid) },
  typeClasses: Object.fromEntries(Object.entries(TYPE_ROOTS).map(([type, roots]) => [type, { roots }])),
  kills: KILLS,
  others: OTHER_KINDS,
  noClass: { reason: 'no tower class' },
  trees: {
    publicClock: { classes: Object.keys(PUBLIC_CLOCK_CLASSES) },
    buildingComplex: { classes: [BUILDING_COMPLEX] },
    plainTower: { classes: [PLAIN_TOWER] },
    worship: { roots: [WORSHIP_ROOT] },
    worshipParts: { roots: WORSHIP_PART_ROOTS },
    seaFort: { roots: [SEA_FORT_ROOT] },
    archaeologicalSite: { roots: [ARCHAEOLOGICAL_SITE_ROOT] },
  },
  exceptions: [
    { refuse: 'untyped', when: 'publicClock', unlessTyped: ['clock-tower'], reason: 'a public clock, which Public art offers, not a tower' },
    { refuse: 'only', when: 'buildingComplex', only: 'plainTower', reason: 'a building complex, not a tower' },
    { refuse: 'only', when: 'worship', outsideKind: true, only: 'worshipParts', reason: 'a place of worship with a tower, not a tower' },
    { refuse: 'only', only: 'seaFort', reason: 'a sea fort, not a tower' },
    { refuse: 'untyped', when: 'archaeologicalSite', reason: 'an archaeological site, not a tower' },
  ],
};
