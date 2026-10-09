/**
 * The rules a World Heritage component's candidate item is chosen by (#1272),
 * on components of real serial sites and the items Wikidata holds for them.
 */

import { describe, it, expect } from 'vitest';
import {
  admittedClasses, bestMatch, distanceM, nameSimilarity, ofTheSitesKind, type CandidateItem,
} from './componentItemMatching.js';

/** Aalto Works' Villa Mairea in Noormarkku (component 1700-007). */
const MAIREA = { locationId: 1, name: 'Villa Mairea', lat: 61.5947, lon: 21.8728 };

describe('nameSimilarity', () => {
  it('folds case, accents and punctuation', () => {
    expect(nameSimilarity('Château de Chambord', 'chateau de chambord')).toBe(1);
  });
  it('is low for unrelated names', () => {
    expect(nameSimilarity('Villa Mairea', 'Noormarkku')).toBeLessThan(0.1);
  });
});

describe('distanceM', () => {
  it('measures a kilometre of latitude', () => {
    expect(distanceM(61, 21, 61.009, 21)).toBeCloseTo(1000, -1);
  });
});

describe('bestMatch', () => {
  const mairea: CandidateItem = { item: 'Q1414131', labels: ['Villa Mairea', 'Mairea'], coords: [[61.5949, 21.8731]] };
  const noormarkku: CandidateItem = { item: 'Q1946658', labels: ['Noormarkku'], coords: [[61.5925, 21.8697]] };

  it('takes the item of the same name at the point, marked exact', () => {
    const match = bestMatch(MAIREA, [noormarkku, mairea], 'near');
    expect(match).toMatchObject({ item: 'Q1414131', label: 'Villa Mairea', exact: true, basis: 'near' });
    expect(match!.distanceM).toBeLessThan(50);
  });

  it('never offers what a curator refused for this point', () => {
    expect(bestMatch(MAIREA, [mairea], 'near', new Set(['Q1414131']))).toBeNull();
  });

  it('offers nothing near when no name is like the point\'s', () => {
    expect(bestMatch(MAIREA, [noormarkku], 'near')).toBeNull();
  });

  it("takes one of the site's own parts a few hundred metres off, with a similar name", () => {
    // Omaha Beach is a long beach: the item's coordinate lies 1.4 km from UNESCO's point.
    const omaha = { locationId: 2, name: 'Omaha Beach sector', lat: 49.3691, lon: -0.8735 };
    const item: CandidateItem = { item: 'Q207979', labels: ['Omaha Beach'], coords: [[49.3683, -0.8541]] };
    expect(bestMatch(omaha, [item], 'part_of')).toMatchObject({ item: 'Q207979', basis: 'part_of', exact: false });
    expect(bestMatch(omaha, [item], 'near')).toBeNull();
  });

  it("takes one of the site's own parts of the same name a few kilometres off, but never marks it exact", () => {
    const far: CandidateItem = { item: 'Q1414131', labels: ['Villa Mairea'], coords: [[61.62, 21.87]] };
    expect(bestMatch(MAIREA, [far], 'part_of')).toMatchObject({ exact: false, basis: 'part_of' });
    // A near item's names are read only within 2 km, so one this far is never known to share it.
    expect(bestMatch(MAIREA, [far], 'near')).toBeNull();
  });

  it('offers nothing for a point with no name unless one of its parts stands on it', () => {
    const unnamed = { ...MAIREA, name: null };
    expect(bestMatch(unnamed, [mairea], 'near')).toBeNull();
    expect(bestMatch(unnamed, [mairea], 'part_of')).toMatchObject({ item: 'Q1414131' });
  });
});

describe('the classes a near candidate may be of', () => {
  const FORT = 'Q1785071';
  const CASTRUM = 'Q88205';
  const VILLAGE = 'Q532';
  const fortOfVillage: CandidateItem = { item: 'Q1', labels: ['Bologa'], coords: [], classes: [VILLAGE] };
  const castrum: CandidateItem = { item: 'Q2', labels: ['Castra of Bologa'], coords: [], classes: [CASTRUM] };

  it("are the site's own, where its components resolve", () => {
    const admitted = admittedClasses(new Set([CASTRUM]), new Set([FORT]));
    expect(ofTheSitesKind(castrum, admitted)).toBe(true);
    expect(ofTheSitesKind({ ...castrum, classes: [FORT] }, admitted)).toBe(false);
  });

  it('fall back to the catalogue-wide ones, never settlements, for a site with none resolved', () => {
    const admitted = admittedClasses(new Set(), new Set([CASTRUM, VILLAGE]));
    expect(ofTheSitesKind(castrum, admitted)).toBe(true);
    expect(ofTheSitesKind(fortOfVillage, admitted)).toBe(false);
  });

  it("refuse a settlement that is also of the site's kind, unless the site's parts are settlements", () => {
    const both = { ...castrum, classes: [CASTRUM, VILLAGE] };
    expect(ofTheSitesKind(both, admittedClasses(new Set([CASTRUM]), new Set()))).toBe(false);
    expect(ofTheSitesKind(both, admittedClasses(new Set([CASTRUM, VILLAGE]), new Set()))).toBe(true);
  });
});
