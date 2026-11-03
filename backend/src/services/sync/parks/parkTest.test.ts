/**
 * What Parks & gardens admits and what it leaves to another kind (#2254),
 * asked on real entities with the classes the local Wikidata subset gave them
 * on 2026-11-03.
 */

import { describe, it, expect } from 'vitest';
import type { ParkTrees } from './classes.js';
import { parkVerdict, type ParkFacts } from './parkTest.js';

const PARK = 'Q22698';
const GARDEN = 'Q1107656';
const URBAN_PARK = 'Q22746';
const BOTANICAL_GARDEN = 'Q167346';
const HERBARIUM = 'Q181916';
const URBAN_GARDEN = 'Q56478984';
const DAIMYO_GARDEN = 'Q11433351';
const JAPANESE_STROLLING_GARDEN = 'Q11420231';
const JAPANESE_GARDEN = 'Q15835';
const HISTORIC_GARDEN_SPAIN = 'Q14946335';
const GIARDINO_ALL_ITALIANA = 'Q12781';
const HANGING_GARDEN = 'Q2332212';
const TOKYO_METROPOLITAN_PARK = 'Q95977092';
const LINEAR_PARK = 'Q6553474';
const ELEVATED_PARK = 'Q30326995';
const BAMBOO_GROVE = 'Q11599236';
const GARDEN_SQUARE = 'Q2026833';
const SQUARE = 'Q174782';
const AMUSEMENT_PARK = 'Q194195';
const THEME_PARK = 'Q2416723';
const ZOO = 'Q43501';
const PROTECTED_AREA_OF_RUSSIA = 'Q1959314';
const NATIONAL_PARK = 'Q46169';
const BUDDHIST_TEMPLE = 'Q5393308';
const CEMETERY = 'Q39614';
const ARCHAEOLOGICAL_SITE = 'Q839954';
const TELL = 'Q755017';
const PALACE = 'Q16560';
const DETACHED_PALACE = 'Q11659483';
const HISTORIC_HOUSE_MUSEUM = 'Q2087181';
const ENGLISH_COUNTRY_HOUSE = 'Q1343246';
const MUSEUM = 'Q33506';
const ESTATE = 'Q12292478';
const ARCHITECTURAL_ENSEMBLE = 'Q1497375';
const DESTROYED = 'Q19860854';
const WONDER = 'Q66108498';
const ROAD = 'Q34442';

const none = new Set<string>();
const botanical = new Set([BOTANICAL_GARDEN]);
const gardens = new Set([URBAN_GARDEN, DAIMYO_GARDEN, JAPANESE_STROLLING_GARDEN, JAPANESE_GARDEN, HISTORIC_GARDEN_SPAIN, GIARDINO_ALL_ITALIANA, HANGING_GARDEN, GARDEN]);
const trees: ParkTrees = {
  place: new Set([
    PARK, URBAN_PARK, TOKYO_METROPOLITAN_PARK, LINEAR_PARK, ELEVATED_PARK, BAMBOO_GROVE, GARDEN_SQUARE,
    AMUSEMENT_PARK, THEME_PARK, ZOO, NATIONAL_PARK, ...botanical, ...gardens,
  ]),
  types: { 'botanical-garden': botanical, garden: gardens },
  kills: { destroyed: new Set([DESTROYED]), proposed: none, underConstruction: none },
  others: {
    nationalPark: new Set([NATIONAL_PARK]), statePark: none, provincialPark: none,
    worship: new Set([BUDDHIST_TEMPLE]), cemetery: new Set([CEMETERY]),
  },
  shared: {
    // Wikidata files the linear park under protected areas.
    protectedArea: new Set([PROTECTED_AREA_OF_RUSSIA, LINEAR_PARK, NATIONAL_PARK]),
    zoo: new Set([ZOO]), amusementPark: new Set([AMUSEMENT_PARK, THEME_PARK]), miniaturePark: none,
    square: new Set([SQUARE, GARDEN_SQUARE]), sportsVenue: none, sportsPark: none, outdoorGym: none, golfCourse: none,
    businessPark: none, industrialPark: none, sittingOutArea: none, allotment: none, communityGarden: none,
  },
  archaeologicalSite: new Set([ARCHAEOLOGICAL_SITE, TELL]),
  residence: new Set([PALACE, DETACHED_PALACE, HISTORIC_HOUSE_MUSEUM, ENGLISH_COUNTRY_HOUSE]),
};

const at = (classes: string[]): ParkFacts => ({ classes, onEarth: true, lat: 1, lon: 1 });

describe('parkVerdict', () => {
  it.each([
    ['Central Park, an urban park', [URBAN_PARK], 'park'],
    ['Kew Gardens, a botanical garden and a garden', [BOTANICAL_GARDEN, HERBARIUM, GARDEN], 'botanical-garden'],
    ['the Jardin du Luxembourg, an urban park and an urban garden', [URBAN_PARK, URBAN_GARDEN], 'garden'],
    ['Kenroku-en, a daimyō garden', [DAIMYO_GARDEN, JAPANESE_STROLLING_GARDEN], 'garden'],
    ['Boboli, a garden Wikidata files as a museum too', [GIARDINO_ALL_ITALIANA, MUSEUM], 'garden'],
    ['Gorky Park, an amusement park and a protected area but a park', [AMUSEMENT_PARK, PARK, PROTECTED_AREA_OF_RUSSIA], 'park'],
    ['the High Line, a linear park and an urban park', [URBAN_PARK, LINEAR_PARK, ELEVATED_PARK], 'park'],
    ['the Lustgarten, a square and a park', [SQUARE, PARK], 'park'],
    ['the Generalife, a palace and a Historic Garden of Spain', [PALACE, HISTORIC_GARDEN_SPAIN], 'garden'],
    ['Hamarikyu, a Japanese garden and a detached palace', [JAPANESE_GARDEN, TOKYO_METROPOLITAN_PARK, DETACHED_PALACE], 'garden'],
    ['Tsaritsyno, a palace and a park', [PALACE, ESTATE, PARK], 'park'],
    ['Arashiyama\'s Bamboo Forest, a bamboo grove', [BAMBOO_GROVE], 'park'],
  ])('admits %s', (_name, classes, type) => {
    expect(parkVerdict(at(classes), trees)).toEqual({ pass: true, type });
  });

  it.each([
    ['the Hanging Gardens of Babylon, destroyed', [HANGING_GARDEN, WONDER, DESTROYED], 'destroyed or demolished'],
    ['the Simien Mountains National Park, a national park and a park', [NATIONAL_PARK, PARK], 'a national park: a reserve, not a park'],
    ['Kinkaku-ji, a Japanese garden and a Buddhist temple', [JAPANESE_GARDEN, BUDDHIST_TEMPLE], 'a place of worship, not a garden'],
    ['Ohlsdorf Cemetery, a cemetery and a park', [CEMETERY, PARK], 'a cemetery, not a park'],
    ['Russell Square, a garden square', [GARDEN_SQUARE], 'a square, which Squares & streets offers'],
    ['Disneyland, a theme park', [THEME_PARK], 'an amusement park, not a park'],
    ['the Jardin d\'Acclimatation, an amusement park and a zoo', [AMUSEMENT_PARK, ZOO], 'a zoo, not a park'],
    ['Alacahöyük, a site and a tell Wikidata files as a park', [ARCHAEOLOGICAL_SITE, TELL, PARK], 'an archaeological site, not a park'],
    ['the Alhambra, a palace and a garden', [ARCHITECTURAL_ENSEMBLE, PALACE, GARDEN], 'a palace, a house or a castle with its garden, not a garden'],
    ['Blenheim Palace, a country house and a garden', [HISTORIC_HOUSE_MUSEUM, ENGLISH_COUNTRY_HOUSE, GARDEN], 'a palace, a house or a castle with its garden, not a garden'],
    ['a road no class of the kind names', [ROAD], 'no park or garden class'],
  ])('refuses %s', (_name, classes, reason) => {
    expect(parkVerdict(at(classes), trees)).toEqual({ pass: false, reason });
  });

  it('refuses a place with no point on Earth', () => {
    expect(parkVerdict({ classes: [URBAN_PARK], onEarth: true, lat: null, lon: null }, trees))
      .toEqual({ pass: false, reason: 'no point on Earth' });
  });
});
