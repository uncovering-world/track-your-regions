/**
 * Berlin's squares around Schloßplatz, as the crowded-city window reads them
 * (#2282): the dev catalogue's order of 2026-11-02, cut to the rows the tests
 * need — the ten in the list, Leipziger Platz shadowed, Frankfurter Tor and
 * Schloßplatz new and shadowed by the rule, and the Kulturforum's square
 * holding works, which takes no pin.
 */

import type { CrowdingWindow, CrowdingWindowRow, ShadowedArrivalsGroup } from '../../../api/crowding';

export function squareRow(over: Partial<CrowdingWindowRow> & Pick<CrowdingWindowRow, 'membershipId' | 'name'>): CrowdingWindowRow {
  return {
    experienceId: over.membershipId + 1000,
    latitude: 52.52,
    longitude: 13.4,
    distanceM: 1200,
    readers: 20000,
    guideEditions: 1,
    guideUsed: true,
    wikipediaEditions: 17,
    score: 0.5,
    outrankedBy: 0,
    standing: 'listed',
    crowded: false,
    ruleCrowded: false,
    pin: null,
    holdsWorks: false,
    pinnable: true,
    outranksCentre: true,
    canAnswer: true,
    ...over,
  };
}

const LISTED = [
  'Alexanderplatz', 'Potsdamer Platz', 'Gendarmenmarkt', 'Pariser Platz', 'Bebelplatz',
  'Lustgarten', 'Breitscheidplatz', 'Platz der Republik', 'Nollendorfplatz', 'Hackescher Markt',
];

export const ALEXANDERPLATZ = 1;
export const NOLLENDORFPLATZ = 9;
export const FRANKFURTER_TOR = 11;
export const LEIPZIGER_PLATZ = 12;
export const SCHLOSSPLATZ = 14;
export const KULTURFORUM = 15;

export const berlinSquares: CrowdingWindowRow[] = [
  ...LISTED.map((name, index) => squareRow({
    membershipId: index + 1, name, score: 0.95 - index * 0.02, outrankedBy: index,
  })),
  squareRow({
    membershipId: FRANKFURTER_TOR, name: 'Frankfurter Tor', score: 0.74, outrankedBy: 10,
    standing: 'new', crowded: true, ruleCrowded: true,
  }),
  squareRow({
    membershipId: LEIPZIGER_PLATZ, name: 'Leipziger Platz', score: 0.73, outrankedBy: 11,
    standing: 'shadowed', crowded: true, ruleCrowded: true,
  }),
  squareRow({
    membershipId: SCHLOSSPLATZ, name: 'Schloßplatz', score: 0.7, outrankedBy: 12,
    standing: 'new', crowded: true, ruleCrowded: true, outranksCentre: false,
  }),
  squareRow({
    membershipId: KULTURFORUM, name: 'Kulturforum', score: 0.6, outrankedBy: 14,
    holdsWorks: true, pinnable: false, outranksCentre: false,
  }),
];

/** The window opened on Schloßplatz's card. */
export const aroundSchlossplatz: CrowdingWindow = {
  centre: { membershipId: SCHLOSSPLATZ, experienceId: SCHLOSSPLATZ + 1000, name: 'Schloßplatz', latitude: 52.5169, longitude: 13.4014, type: 'square' },
  kind: { id: 9, name: 'Squares & streets', limit: 10, radiusKm: 10 },
  type: 'square',
  typeExempt: false,
  types: [{ type: 'square', places: 22, exempt: false }, { type: 'street', places: 9, exempt: false }],
  rows: berlinSquares,
};

/** The review page's crowded cities: Berlin's squares, Schloßplatz first, and Rome's churches. */
export const BERLIN_SQUARES: ShadowedArrivalsGroup = {
  regionId: 7, regionName: 'Berlin', worldViewId: 1, kindId: 9, kindName: 'Squares & streets', type: 'square',
  arrivals: 11, membershipIds: [SCHLOSSPLATZ, FRANKFURTER_TOR],
};
export const ROME_CHURCHES: ShadowedArrivalsGroup = {
  regionId: 8, regionName: 'Rome', worldViewId: 1, kindId: 4, kindName: 'Places of worship', type: 'church',
  arrivals: 3, membershipIds: [40, 41, 42],
};
