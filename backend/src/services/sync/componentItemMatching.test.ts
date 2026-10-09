/**
 * The rules a World Heritage component's candidate item is chosen by (#1272),
 * on components of real serial sites and the items Wikidata holds for them.
 */

import { describe, it, expect } from 'vitest';
import {
  admittedClasses, bestMatch, distanceM, nameSimilarity, ofTheSitesKind, standsForWholeSite, type CandidateItem,
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
    // A near item's names are read only within 1 km, so one this far is never known to share it.
    expect(bestMatch(MAIREA, [far], 'near')).toBeNull();
  });

  it('offers nothing for a point with no name unless one of its parts stands on it', () => {
    // The item's coordinate, 26 m from UNESCO's point: within the 25 m only once moved onto it.
    const unnamed = { ...MAIREA, name: null };
    expect(bestMatch(unnamed, [mairea], 'near')).toBeNull();
    expect(bestMatch(unnamed, [mairea], 'part_of')).toBeNull();
    expect(bestMatch({ ...unnamed, lat: 61.5949, lon: 21.8731 }, [mairea], 'part_of')).toMatchObject({ item: 'Q1414131' });
  });
});

describe('the classes a near candidate may be of', () => {
  const FORT = 'Q1785071';
  const CASTRUM = 'Q88205';
  const VILLAGE = 'Q532';
  // What the class tree says (settlementsAmong on QLever): a village is a
  // settlement kind, a castrum is not, though Wikidata files it under one too.
  const settlementKinds = new Set([VILLAGE]);
  const village: CandidateItem = { item: 'Q1', labels: ['Bologa'], coords: [], classes: [VILLAGE] };
  const castrum: CandidateItem = { item: 'Q2', labels: ['Castra of Bologa'], coords: [], classes: [CASTRUM] };

  it("are the site's own, where its components resolve", () => {
    const admitted = admittedClasses(new Set([CASTRUM]), new Set([FORT]), settlementKinds);
    expect(ofTheSitesKind(castrum, admitted, false, false)).toBe(true);
    expect(ofTheSitesKind({ ...castrum, classes: [FORT] }, admitted, false, false)).toBe(false);
  });

  it('fall back to the catalogue-wide ones less the settlement kinds, for a site with none resolved', () => {
    const admitted = admittedClasses(new Set(), new Set([CASTRUM, VILLAGE]), settlementKinds);
    expect(admitted.has(VILLAGE)).toBe(false);
    expect(ofTheSitesKind(castrum, admitted, false, false)).toBe(true);
    expect(ofTheSitesKind(village, admitted, true, false)).toBe(false);
  });

  it("refuse a settlement of the site's kind unless the site's parts are settlements", () => {
    const admitted = admittedClasses(new Set([CASTRUM, VILLAGE]), new Set(), settlementKinds);
    const both = { ...castrum, classes: [CASTRUM, VILLAGE] };
    // The tree says it is a settlement; only a site admitting settlements keeps it.
    expect(ofTheSitesKind(both, admitted, true, false)).toBe(false);
    expect(ofTheSitesKind(both, admitted, true, true)).toBe(true);
  });
});

describe('what is not searched or not taken', () => {
  it('reads a component that stands for its whole site as the site, not as something inside it', () => {
    expect(standsForWholeSite('Historic Centre of Siena', 'Historic Centre of Siena', 3)).toBe(true);
    expect(standsForWholeSite('Pilgrimage Church of Wies', 'Pilgrimage Church of Wies', 1)).toBe(true);
    expect(standsForWholeSite('Via Appia. Regina Viarum', 'Via Appia. <em>Regina Viarum</em>', 22)).toBe(true);
    expect(standsForWholeSite('Bologa - Grădiște', 'Frontiers of the Roman Empire – Dacia', 277)).toBe(false);
    // Named after its site and similar to it at 0.71, and still a part of it.
    expect(standsForWholeSite('Historic Centre of Siena (Cathedral)', 'Historic Centre of Siena', 3)).toBe(false);
  });

  it('compares a label without the town in its trailing brackets', () => {
    // A house in Žatec is not the component named after the town.
    const zatec = { locationId: 5, name: 'Žatec', lat: 50.3271, lon: 13.5458 };
    const house: CandidateItem = { item: 'Q1', labels: ['Dům čp. 7 (Žatec)'], coords: [[50.3275, 13.5470]] };
    expect(bestMatch(zatec, [house], 'near')).toBeNull();
  });

  it("takes one of the site's parts with an unlike name only at the same spot", () => {
    // Voislova's component is named after its railway halt; its item is the fort of Pons Augusti.
    const voislova = { locationId: 6, name: 'Voislova - Gara CFR', lat: 45.5275, lon: 22.4544 };
    const fort: CandidateItem = { item: 'Q2', labels: ['Castrul roman Pons Augusti'], coords: [[45.5275, 22.4544]] };
    expect(bestMatch(voislova, [fort], 'part_of')).toMatchObject({ item: 'Q2' });
    // The 1901 exhibition grounds of Mathildenhöhe are not its Wedding Tower, 78 m off.
    const grounds = { locationId: 7, name: 'Exhibition grounds 1901', lat: 49.8771, lon: 8.6670 };
    const tower: CandidateItem = { item: 'Q3', labels: ['Hochzeitsturm'], coords: [[49.8774, 8.6680]] };
    expect(bestMatch(grounds, [tower], 'part_of')).toBeNull();
  });
});
