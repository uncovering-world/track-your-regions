/**
 * What Squares & streets admits and what it leaves to another kind (#1867),
 * asked on real entities with the classes Wikidata gave them on 2026-10-23
 * (the canals on the subset of 2026-11-02, #2272).
 */

import { describe, it, expect } from 'vitest';
import { squareVerdict, type SquareFacts, type SquareTrees } from './kind.js';
import { DESCENT, SQUARES_DECLARATION } from './classes.js';

const SQUARE = 'Q174782';
const STREET = 'Q79007';
const THOROUGHFARE = 'Q83620';
const PEDESTRIAN_ZONE = 'Q369730';
const MONUMENTAL_STAIRCASE = 'Q28662786';
const STAIRS = 'Q12511';
const PROMENADE_CLASS = 'Q88372';
const SHOPPING_STREET = 'Q21000333';
const ROAD = 'Q34442';
const AVENUE = 'Q207934';
const PARK = 'Q22698';
const NEIGHBOURHOOD = 'Q123705';
const STONE_BRIDGE = 'Q3397526';
const MOSQUE = 'Q32815';
const ARCHAEOLOGICAL_SITE = 'Q839954';
const AGORA = 'Q187909';
const BULLRING = 'Q1193438';
const MOTORWAY = 'Q2154027';
const DESTROYED = 'Q19860854';
const AVENUE_CLASS = 'Q7543083';
const BOULEVARD = 'Q54114';
const RAMBLA = 'Q29518746';
const URBAN_ENSEMBLE = 'Q66626342';
const CANAL = 'Q12284';
const GRACHT = 'Q523166';
const HISTORIC_DISTRICT = 'Q15243209';
const TOURIST_ATTRACTION = 'Q570116';

const none = new Set<string>();
const stairways = new Set([STAIRS, MONUMENTAL_STAIRCASE]);
const squares = new Set([SQUARE]);
const promenades = new Set([PROMENADE_CLASS]);
const streets = new Set([STREET, PEDESTRIAN_ZONE, SHOPPING_STREET, AVENUE, AVENUE_CLASS, BOULEVARD, RAMBLA]);
const trees: SquareTrees = {
  place: new Set([THOROUGHFARE, DESCENT, ...stairways, ...squares, ...promenades, ...streets]),
  types: { stairway: stairways, square: squares, promenade: promenades, street: streets },
  kills: { destroyed: new Set([DESTROYED]), proposed: none, underConstruction: none },
  others: {
    worship: new Set([MOSQUE]), palace: none, bridge: new Set([STONE_BRIDGE]),
    archaeologicalSite: new Set([ARCHAEOLOGICAL_SITE]), agora: new Set([AGORA]), bullring: new Set([BULLRING]),
    railwayLine: none, motorway: new Set([MOTORWAY]), river: none,
  },
  noClass: {}, shared: {}, named: { canal: new Set([CANAL, GRACHT]) },
};

const at = (classes: string[]): SquareFacts => ({ classes, onEarth: true, lat: 1, lon: 1 });

describe('what Squares & streets asks by', () => {
  it('names a descent by itself, as it names the bare thoroughfare it sits under (#2146)', () => {
    expect(SQUARES_DECLARATION.place.classes).toEqual([THOROUGHFARE, DESCENT]);
  });
});

describe('squareVerdict', () => {
  it.each([
    ['Red Square', [SQUARE], 'square'],
    ['the Spanish Steps, a monumental staircase', [MONUMENTAL_STAIRCASE], 'stairway'],
    ['the Promenade des Anglais, a promenade before a street', [PROMENADE_CLASS, STREET], 'promenade'],
    ['the Arbat, a bare thoroughfare and a pedestrian zone', [THOROUGHFARE, PEDESTRIAN_ZONE], 'street'],
    ['Tverskaya Street, a bare thoroughfare', [THOROUGHFARE], 'street'],
    ['Andriyivskyy Descent, a descent and nothing else (#2146)', [DESCENT], 'street'],
    ['Oxford Street, a shopping street that is also a road', [SHOPPING_STREET, ROAD], 'street'],
    ['the National Mall, a square though an avenue and a park too', [AVENUE, SQUARE, PARK], 'square'],
    ['Times Square, though a neighbourhood too', [SQUARE, NEIGHBOURHOOD], 'square'],
    ['the Champs-Élysées, an avenue and a boulevard', [AVENUE_CLASS, BOULEVARD], 'street'],
    ['La Rambla, a street and a rambla', [STREET, URBAN_ENSEMBLE, RAMBLA], 'street'],
    ['Nyhavn, a canal and a street', [CANAL, HISTORIC_DISTRICT, TOURIST_ATTRACTION, STREET], 'street'],
    ['the Prinsengracht, a gracht and a street', [GRACHT, STREET], 'street'],
  ])('admits %s', (_name, classes, type) => {
    expect(squareVerdict(at(classes), trees)).toEqual({ pass: true, type });
  });

  it.each([
    ['the Gemonian stairs, gone', [STAIRS, ARCHAEOLOGICAL_SITE, DESTROYED], 'destroyed or demolished'],
    ['the Charles Bridge, which Prague files as a street', [STONE_BRIDGE, STREET], 'a bridge, not a street'],
    ['Al-Aqsa, a mosque Wikidata files under squares', [MOSQUE], 'a place of worship, not a square'],
    ['the Roman Forum', [SQUARE, ARCHAEOLOGICAL_SITE], 'an archaeological site, not a square'],
    ['the Roman Agora of Athens, a square and an agora', [SQUARE, AGORA], 'an ancient agora: an archaeological site, not a square'],
    ['Las Ventas, a plaza de toros', [BULLRING], 'a bullring, not a square'],
    ['the M25', [MOTORWAY], 'a motorway, not a street a visitor walks'],
    ['a road no class of the kind names', [ROAD], 'no square or street class'],
    ['Venice\'s Grand Canal, a canal and a bare thoroughfare', [CANAL, THOROUGHFARE], 'a canal, not a street'],
  ])('refuses %s', (_name, classes, reason) => {
    expect(squareVerdict(at(classes), trees)).toEqual({ pass: false, reason });
  });

  it('refuses a place with no point on Earth', () => {
    expect(squareVerdict({ classes: [SQUARE], onEarth: true, lat: null, lon: null }, trees))
      .toEqual({ pass: false, reason: 'no point on Earth' });
  });
});
