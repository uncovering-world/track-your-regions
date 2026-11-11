/**
 * Berlin's squares as Berlin's region page holds them, as the crowded-city
 * window reads them (#2282, #2358): the dev catalogue's order of 2026-11-02,
 * cut to the places the tests need — the ten on the page, Leipziger Platz
 * shadowed, Frankfurter Tor and Schloßplatz new and shadowed by the rule,
 * Rosa-Luxemburg-Platz new and shown by it, and the Kulturforum's square
 * holding works, which takes no pin — and Schloßplatz in its own circle.
 */

import type {
  CrowdingAroundPlace, CrowdingGroup, CrowdingGroupPlace, CrowdingPlaceView, ShadowedArrivalsGroup,
} from '../../../api/crowding';

export function squarePlace(over: Partial<CrowdingGroupPlace> & Pick<CrowdingGroupPlace, 'membershipId' | 'name'>): CrowdingGroupPlace {
  return {
    experienceId: over.membershipId + 1000,
    latitude: 52.52,
    longitude: 13.4,
    wikipediaUrl: null,
    imageUrl: null,
    imageCredit: null,
    readers: 20000,
    wikipediaEditions: 17,
    guideUsed: true,
    score: 0.5,
    standing: 'shown',
    crowded: false,
    outrankedBy: null,
    betterKnown: [],
    ruleCrowded: false,
    pin: null,
    holdsWorks: false,
    pinnable: true,
    canAnswer: true,
    ...over,
  };
}

const LISTED = [
  'Alexanderplatz', 'Potsdamer Platz', 'Gendarmenmarkt', 'Pariser Platz', 'Bebelplatz',
  'Lustgarten', 'Breitscheidplatz', 'Platz der Republik', 'Nollendorfplatz', 'Hackescher Markt',
];
const TOP_THREE = LISTED.slice(0, 3);

export const ALEXANDERPLATZ = 1;
export const NOLLENDORFPLATZ = 9;
export const FRANKFURTER_TOR = 11;
export const LEIPZIGER_PLATZ = 12;
export const ROSA_LUXEMBURG_PLATZ = 13;
export const SCHLOSSPLATZ = 14;
export const KULTURFORUM = 15;

/** Alexanderplatz's article and picture, as the dev catalogue holds them (#2345); the other squares hold none here. */
export const ALEXANDERPLATZ_LOOK: Pick<CrowdingGroupPlace, 'wikipediaUrl' | 'imageUrl' | 'imageCredit'> = {
  wikipediaUrl: 'https://en.wikipedia.org/wiki/Alexanderplatz',
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg',
  imageCredit: {
    author: 'Wladyslaw Sojka',
    license: 'FAL',
    licenseUrl: 'http://artlibre.org/licence/lal/en',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Berlin_-_Alexanderplatz1.jpg',
  },
};

export const berlinSquares: CrowdingGroupPlace[] = [
  ...LISTED.map((name, index) => squarePlace({
    membershipId: index + 1, name, score: 0.95 - index * 0.02,
    ...(index === 0 ? { ...ALEXANDERPLATZ_LOOK, readers: 209401, wikipediaEditions: 47 } : {}),
  })),
  squarePlace({
    membershipId: FRANKFURTER_TOR, name: 'Frankfurter Tor', score: 0.74, outrankedBy: 10, betterKnown: TOP_THREE,
    standing: 'new', crowded: true, ruleCrowded: true,
  }),
  squarePlace({
    membershipId: LEIPZIGER_PLATZ, name: 'Leipziger Platz', score: 0.73, outrankedBy: 11, betterKnown: TOP_THREE,
    standing: 'shadowed', crowded: true, ruleCrowded: true,
    // Before its readers and its guides are first read.
    readers: null, guideUsed: null, wikipediaEditions: 18,
  }),
  squarePlace({ membershipId: ROSA_LUXEMBURG_PLATZ, name: 'Rosa-Luxemburg-Platz', score: 0.71, standing: 'new' }),
  squarePlace({
    membershipId: SCHLOSSPLATZ, name: 'Schloßplatz', score: 0.7, outrankedBy: 13, betterKnown: TOP_THREE,
    standing: 'new', crowded: true, ruleCrowded: true,
  }),
  squarePlace({ membershipId: KULTURFORUM, name: 'Kulturforum', score: 0.6, holdsWorks: true, pinnable: false }),
];

/** Berlin's squares as its region page shows them. */
export const berlinGroup: CrowdingGroup = {
  group: { regionId: 7, regionName: 'Berlin', kindId: 9, type: 'square' },
  kind: { id: 9, name: 'Squares & streets', limit: 10, radiusKm: 10 },
  typeExempt: false,
  places: berlinSquares,
  truncated: false,
};

function around(place: CrowdingGroupPlace, compared: boolean, distanceM: number): CrowdingAroundPlace {
  const { membershipId, experienceId, name, latitude, longitude, standing, readers, wikipediaEditions, guideUsed, score } = place;
  return {
    membershipId, experienceId, name, latitude, longitude, standing, distanceM, compared,
    readers, wikipediaEditions, guideUsed, score, holdsWorks: false, pin: null,
  };
}

/** Schloßplatz in its own circle: the thirteen better known above it, and the rest of the squares around. */
export const schlossplatzCircle: CrowdingPlaceView = {
  place: berlinSquares.find(place => place.membershipId === SCHLOSSPLATZ)!,
  group: berlinGroup.group,
  kind: berlinGroup.kind,
  typeExempt: false,
  around: berlinSquares
    .filter(place => place.membershipId !== SCHLOSSPLATZ)
    .map((place, index) => around(place, place.score !== null && place.score > 0.7 && !place.holdsWorks, 700 + index * 300)),
  comparedUnlisted: 0,
  measuringRun: null,
  measurable: true,
};

/** The review page's crowded cities: Berlin's squares and Rome's churches. */
export const BERLIN_SQUARES: ShadowedArrivalsGroup = {
  regionId: 7, regionName: 'Berlin', worldViewId: 1, kindId: 9, kindName: 'Squares & streets', type: 'square', arrivals: 11,
};
export const ROME_CHURCHES: ShadowedArrivalsGroup = {
  regionId: 8, regionName: 'Rome', worldViewId: 1, kindId: 4, kindName: 'Places of worship', type: 'church', arrivals: 3,
};
