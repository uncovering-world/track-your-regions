/**
 * The rules a World Heritage component's candidate item is chosen by (#1272),
 * on components of real serial sites and the items Wikidata holds for them.
 */

import { describe, it, expect } from 'vitest';
import {
  admittedClasses, bestMatch, distanceM, nameReadings, nameSimilarity, numberedMatches, ofTheSitesKind, placeAsCandidate,
  standsAtTheComponent, standsForWholeSite,
  type CandidateItem,
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

  it('names a candidate by its English label, whichever label it matched by (#1358)', () => {
    // Bahjí (1220-005) and the Shrine of Bahá'u'lláh, a part of the site standing at the point. No label is
    // much like "Bahjí", so the most name-alike one was a Turkish label picked by trigrams.
    const bahji = { locationId: 3, name: 'Bahjí', lat: 32.9434, lon: 35.0920 };
    const shrine: CandidateItem = {
      item: 'Q187499', labels: ["Bahaullah'ın Makamı", "Shrine of Bahá'u'lláh"], coords: [[32.9433, 35.0919]],
    };
    expect(bestMatch(bahji, [{ ...shrine, englishLabel: "Shrine of Bahá'u'lláh" }], 'part_of'))
      .toMatchObject({ item: 'Q187499', label: "Shrine of Bahá'u'lláh" });
    // An item with no English label keeps the one most like the component's name.
    expect(bestMatch(MAIREA, [{ ...mairea, labels: ['Mairea', 'Villa Mairea'], englishLabel: null }], 'near'))
      .toMatchObject({ label: 'Villa Mairea' });
  });
});

describe("a component's descriptive tail (#1672)", () => {
  // Rusovce's Gerulata (1608ter-091) and its castrum, Castra Gerulata, 63 m from the point.
  const rusovce = { locationId: 4, name: 'Rusovce – Gerulata, rímsky vojenský tábor (kastel)', lat: 48.0556083333, lon: 17.1493305555 };
  const gerulata: CandidateItem = {
    item: 'Q1309632', labels: ['Kastell Gerulata', 'Gerulata', 'Castra Gerulata'], coords: [[48.05611111, 17.14972222]],
    englishLabel: 'Castra Gerulata',
  };

  it('reads a name before its first comma as well as whole', () => {
    expect(nameReadings(rusovce.name)).toEqual([rusovce.name, 'Rusovce – Gerulata']);
    expect(nameReadings('Historic Centre of Siena (Cathedral)')).toEqual(['Historic Centre of Siena (Cathedral)']);
  });

  it("matches the component's own item that the description kept below the floor", () => {
    expect(nameSimilarity(rusovce.name, 'Gerulata')).toBeLessThan(0.3);
    expect(bestMatch(rusovce, [gerulata], 'near')).toMatchObject({ item: 'Q1309632', similarity: 0.44, label: 'Castra Gerulata' });
  });
});

describe('the classes a near candidate may be of', () => {
  const FORT = 'Q1785071';
  const CASTRUM = 'Q88205';
  const VILLAGE = 'Q532';
  // What the class tree says (settlementsAmong): a village is a
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

  it('never fall back to a hotel or a station, which only a site about them admits', () => {
    // The Mercure Wien Zentrum offered for Vindobona's legionary fortress, and
    // Tulln's station for its Roman tower (#1671).
    const HOTEL = 'Q27686';
    const STATION = 'Q55488';
    // What the class tree says (classesUnder) of the roots NEVER_BY_THE_CATALOGUE names.
    const never = new Set([HOTEL, STATION]);
    const fallback = admittedClasses(new Set(), new Set([CASTRUM, HOTEL, STATION]), settlementKinds, never);
    expect([...fallback]).toEqual([CASTRUM]);
    expect(admittedClasses(new Set([STATION]), new Set(), settlementKinds, never).has(STATION)).toBe(true);
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

describe('a thing at the component, on a site none of whose components resolve (#1349)', () => {
  const at = (name: string, label: string, places: string[]) => standsAtTheComponent(
    { locationId: 1, name, lat: 0, lon: 0 }, { item: 'Q1', labels: [label], coords: [] }, places);

  it('is set aside where it stands in a place named like the component', () => {
    // Moravian Church Settlements: the component is the settlement, the candidates are in it.
    expect(at('Herrnhut', 'Heimatmuseum Herrnhut', ['Herrnhut'])).toBe(true);
    expect(at('Christiansfeld', 'Christiansfeld Pharmacy', ['Kolding Municipality', 'Christiansfeld'])).toBe(true);
    expect(at('Moroni', 'Moroni Old Friday Mosque', ['Moroni'])).toBe(true);
    // Naval Port of Karlskrona: the islet, spelled one letter apart on Wikidata.
    expect(at('Mjölnarholmen', 'Kruthuset och våghuset på Mjölnarholmen', ['Mjölnareholmen'])).toBe(true);
  });

  it('stays a candidate where it is named like the component itself', () => {
    expect(at('Pompeii', 'Pompeii', ['Pompei'])).toBe(false);
    expect(at('Panhala Fort', 'Panhala Fort', ['Panhala'])).toBe(false);
    // Abu Simbel's item stands in the village of Abu Simbel and is named like it, as the component is.
    expect(at('Abu Simbel', 'Abu Simbel', ['Abu Simbel'])).toBe(false);
  });

  it('stays a candidate where the place is only the town a fort is named after', () => {
    // The Danube Limes: the castrum is the component, Straubing the town around it.
    expect(at('Straubing – Ostkastell', 'Castrum Sorviodurum', ['Straubing'])).toBe(false);
    expect(at('Klosterneuburg – Kastell und Vicus', 'Castra of Klosterneuburg', ['Klosterneuburg'])).toBe(false);
  });

  it('stays a candidate where it names no place, or the component has no name', () => {
    expect(at('Herrnhut', 'Heimatmuseum Herrnhut', [])).toBe(false);
    expect(standsAtTheComponent({ locationId: 1, name: null, lat: 0, lon: 0 },
      { item: 'Q1', labels: ['Heimatmuseum Herrnhut'], coords: [] }, ['Herrnhut'])).toBe(false);
  });
});

describe('the place a thing at the component stands in, offered in its stead (#1349)', () => {
  const herrnhut = { locationId: 8669, name: 'Herrnhut', lat: 51.0155555556, lon: 14.7441666666 };

  it('is a candidate the near rule then measures like any other', () => {
    // Naval Port of Karlskrona: the islet the gunpowder house stands on, 30 m from the point.
    const mjolnarholmen = { locationId: 7910, name: 'Mjölnarholmen', lat: 56.1654463692, lon: 15.6039170196 };
    const place = { item: 'Q32294768', names: ['Mjölnareholmen'], coords: [[56.1652, 15.6038]] as Array<[number, number]>, referenced: false };
    const whole = placeAsCandidate(mjolnarholmen, place);
    expect(whole).toEqual({ item: 'Q32294768', labels: ['Mjölnareholmen'], coords: place.coords });
    expect(bestMatch(mjolnarholmen, [whole!], 'near')).toMatchObject({ item: 'Q32294768', label: 'Mjölnareholmen' });
  });

  it('is not offered where it carries a World Heritage reference, or is named otherwise', () => {
    // Christiansfeld carries 1468, the reference of the inscription it was before the extension.
    const christiansfeld = { locationId: 8672, name: 'Christiansfeld', lat: 55.3555555556, lon: 9.4813888889 };
    expect(placeAsCandidate(christiansfeld, { item: 'Q3197288', names: ['Christiansfeld'], coords: [[55.356667, 9.483056]], referenced: true })).toBeNull();
    expect(placeAsCandidate(herrnhut, { item: 'Q21101', names: ['Görlitz District'], coords: [], referenced: false })).toBeNull();
  });
});

describe("an item carrying the component's number under another inscription (#1394)", () => {
  // Mozu-Furuichi: the list numbers the kofun 1593bis-006, Wikidata 1593-006.
  const OSAMEZUKA = { locationId: 11, name: 'Osamezuka Kofun', lat: 34.55886, lon: 135.48808 };
  const osamezuka: CandidateItem = { item: 'Q11410610', labels: ['Osamezuka Kofun'], coords: [[34.55878, 135.48806]] };
  // Beech Forests: the list's 1133quinquies-039 is Abruzzo, Wikidata's 1133ter-039 Paklenica, renumbered.
  const ABRUZZO = { locationId: 12, name: 'Abruzzo', lat: 41.75, lon: 13.88333 };
  const paklenica: CandidateItem = { item: 'Q732723', labels: ['Paklenica'], coords: [[44.36667, 15.43333]] };
  // Frederiksoord stands 2.1 km from its component's point, past the part rule's 2 km.
  const COLONY = { locationId: 13, name: 'Frederiksoord-Wilhelminaoord', lat: 52.85729, lon: 6.16717 };
  const frederiksoord: CandidateItem = { item: 'Q2483434', labels: ['Frederiksoord'], coords: [[52.8431, 6.1872]] };

  it('takes the item where the name agrees, as far as the same-name radius', () => {
    expect(numberedMatches(OSAMEZUKA, [osamezuka])).toMatchObject([{ item: 'Q11410610', basis: 'numbered', exact: true }]);
    const [colony] = numberedMatches(COLONY, [frederiksoord]);
    expect(colony).toMatchObject({ item: 'Q2483434', basis: 'numbered', exact: false });
    expect(colony.distanceM).toBeGreaterThan(2000);
  });

  it('leaves a renumbered part whose name is another place, and a refused one', () => {
    expect(numberedMatches(ABRUZZO, [{ ...paklenica, coords: [[41.75, 13.88333]] }])).toEqual([]);
    expect(numberedMatches(OSAMEZUKA, [osamezuka], new Set(['Q11410610']))).toEqual([]);
  });

  it('leaves an item farther than the same-name radius, and one with no coordinate', () => {
    expect(numberedMatches(OSAMEZUKA, [{ ...osamezuka, coords: [[34.62, 135.48808]] }])).toEqual([]);
    expect(numberedMatches(OSAMEZUKA, [{ ...osamezuka, coords: [] }])).toEqual([]);
  });

  it('answers every candidate the rule admits, not the best one', () => {
    const second: CandidateItem = { item: 'Q1881045', labels: ['Wilhelminaoord'], coords: [[52.8561, 6.1639]] };
    expect(numberedMatches(COLONY, [frederiksoord, second]).map(m => m.item)).toEqual(['Q2483434', 'Q1881045']);
  });
});

describe('a candidate whose coordinate is the approximate point copied (#1853)', () => {
  // Echmiatsin: the cathedral, Saint Gayaneh and the Cemetery of Congregation
  // share the property's point, and Wikidata's item for ancient Zvartnots
  // carries that point too.
  const cemetery = { locationId: 1, name: 'Cemetery of Congregation', lat: 40.1593055556, lon: 44.2951388889 };
  const zvartnots = {
    item: 'Q-zvartnots-fixture', labels: ['Cemetery of Congregation'], coords: [[40.1593055556, 44.2951388889]] as Array<[number, number]>,
  };

  it('is no candidate "1 m away" for a component on that shared point', () => {
    expect(bestMatch({ ...cemetery, approximate: true }, [zvartnots], 'near')).toBeNull();
  });

  it('is measured as before where the point was given to the second', () => {
    expect(bestMatch(cemetery, [zvartnots], 'near')).toMatchObject({ item: 'Q-zvartnots-fixture', distanceM: 0 });
  });

  it('is measured by its other coordinates where it states more', () => {
    const twoPoints = { ...zvartnots, coords: [...zvartnots.coords, [40.1597, 44.2955]] as Array<[number, number]> };
    expect(bestMatch({ ...cemetery, approximate: true }, [twoPoints], 'near')).toMatchObject({ distanceM: 54 });
  });
});
