/**
 * A component's place name as a name match, and a candidate's register code
 * as a second key (#1340), on the Frontiers of the Roman Empire – Dacia: its
 * points are written to an arc-minute, and its castra are labelled "Castrul
 * roman de la Gresia", which the trigram similarity scores 0.21 against
 * "Gresia - La Biserică". Coordinates and codes as Wikidata held them on
 * 2026-10-10.
 */

import { describe, it, expect } from 'vitest';
import {
  bestMatch, holdsToponym, namesMoreThanTheTown, ownToponymsOf, toponymsOf, type CandidateItem, type ComponentMatch,
} from './componentItemMatching.js';
import { withRegisterCodes } from './componentItemRegisters.js';

const GRESIA = { locationId: 9884, name: 'Gresia - La Biserică', lat: 44.1666666667, lon: 24.9166666667 };
const POTAISSA = { locationId: 10056, name: 'Turda - Potaissa / Dealul Cetății', lat: 46.5666666667, lon: 23.7666666667 };
const LOZNA = { locationId: 9923, name: 'Lozna - Curmăturița 1', lat: 47.3166666667, lon: 23.4666666667 };

const castra = (item: string, label: string, lat: number, lon: number): CandidateItem => ({ item, labels: [label], coords: [[lat, lon]] });
const CASTRA_GRESIA = castra('Q2792131', 'Castrul roman de la Gresia', 44.166667, 24.916667);
const CASTRA_POTAISSA = castra('Q7234612', 'Castrul roman Potaissa', 46.5705, 23.7724);
const LOZNA_CHURCH = castra('Q18541556', 'Biserica de lemn din Lozna', 47.321841, 23.46376);

describe('the place names a component is read for', () => {
  it('splits on a dash with a space before it and on a slash, never inside a town', () => {
    expect(toponymsOf('Turda - Potaissa / Dealul Cetății')).toEqual(['turda', 'potaissa', 'dealul cetatii']);
    // "Iaz" is three letters: a word, not a place the rule reads.
    expect(toponymsOf('Iaz – Tibiscum / Traianu')).toEqual(['tibiscum', 'traianu']);
    expect(toponymsOf('Drobeta-Turnu Severin -Drobeta')).toEqual(['drobeta turnu severin', 'drobeta']);
  });

  it('reads nothing in a name of one piece: every building in a town holds the town\'s name', () => {
    expect(toponymsOf('Žatec')).toEqual([]);
    expect(holdsToponym('Žatec', 'Dům čp. 7 (Žatec)')).toBe(false);
  });

  it('finds one as whole words in a label, folded, and not inside another word', () => {
    expect(holdsToponym('Gresia - La Biserică', 'Castrul roman de la Gresia')).toBe(true);
    expect(holdsToponym('Turda - Potaissa / Dealul Cetății', 'Castra Potaissa')).toBe(true);
    expect(holdsToponym('Reci - Cetate', 'Cetatea Reci')).toBe(true);
    expect(holdsToponym('Reci - Cetate', 'Cetatea dacică')).toBe(false);
  });
});

describe('the place-name rule', () => {
  it('takes a castrum the name rule misses, at the point and 611 m off', () => {
    expect(bestMatch(GRESIA, [CASTRA_GRESIA], 'near')).toBeNull();
    expect(bestMatch(GRESIA, [CASTRA_GRESIA], 'toponym')).toMatchObject({ item: 'Q2792131', basis: 'toponym', distanceM: 0 });
    const potaissa = bestMatch(POTAISSA, [CASTRA_POTAISSA], 'toponym');
    expect(potaissa).toMatchObject({ item: 'Q7234612', basis: 'toponym' });
    expect(potaissa!.distanceM).toBeGreaterThan(500);
  });

  it('reads a label without its trailing qualifier, as the name rule does', () => {
    const point = { locationId: 1, name: 'Žatec - Chmelařská čtvrť', lat: 50.3272, lon: 13.5458 };
    const house = castra('Q1', 'Dům čp. 7 (Žatec)', 50.3275, 13.5462);
    expect(bestMatch(point, [house], 'toponym')).toBeNull();
  });

  it('reads no further than the same-name radius', () => {
    const far = castra('Q7234612', 'Castrul roman Potaissa', 46.5666666667 + 0.012, 23.7666666667);
    expect(bestMatch(POTAISSA, [far], 'toponym')).toBeNull();
  });

  it('would take the village church for the fort by its place name: what the site\'s kind and the register code are for', () => {
    // The church is no candidate of a Roman frontier's kind, so the near search
    // never offers it; where a site's kind admits one, its register code sorts it down.
    expect(bestMatch(LOZNA, [LOZNA_CHURCH], 'toponym')).toMatchObject({ item: 'Q18541556' });
  });
});

describe('a candidate\'s register code', () => {
  const match = (locationId: number, item: string): ComponentMatch => ({
    locationId, item, label: item, distanceM: 0, similarity: 0, exact: false, basis: 'toponym', itemLat: null, itemLon: null,
  });
  const codes = new Map([
    ['Q42841496', [{ property: 'P1770', code: 'CJ-I-m-A-06975.01' }]],
    ['Q12723861', [{ property: 'P1770', code: 'CJ-II-m-B-07533' }]],
    ['Q7234612', [{ property: 'P1770', code: 'CJ-I-s-A-07208' }]],
    ['Q1414131', [{ property: 'P4009', code: '1393' }]],
  ]);

  it('is shown with its register, and an architecture entry on a site of archaeology entries disagrees', () => {
    const coded = withRegisterCodes(
      [match(9860, 'Q42841496'), match(9860, 'Q12723861'), match(10056, 'Q7234612'), match(1, 'Q7227965')],
      codes, () => 1718,
    );
    expect(coded.map(m => [m.item, m.registerCode, m.registerDisagrees])).toEqual([
      ['Q42841496', 'LMI CJ-I-m-A-06975.01', false],
      ['Q12723861', 'LMI CJ-II-m-B-07533', true],
      ['Q7234612', 'LMI CJ-I-s-A-07208', false],
      ['Q7227965', null, false],
    ]);
  });

  it('disagrees with nothing where the register writes no group, or the site\'s codes split evenly', () => {
    const aalto = withRegisterCodes([match(1, 'Q1414131')], codes, () => 1755);
    expect(aalto[0]).toMatchObject({ registerCode: 'RKY 1393', registerDisagrees: false });
    const even = withRegisterCodes([match(9860, 'Q42841496'), match(9860, 'Q12723861')], codes, () => 1718);
    expect(even.map(m => m.registerDisagrees)).toEqual([false, false]);
  });
});

describe("a component's own place names past its town (#1689)", () => {
  const POCHLARN_WEST = { locationId: 6817, name: 'Pöchlarn – Kastell Hufeisenturm West', lat: 48.2121, lon: 15.2076 };
  const ENNS_LAURENZ = { locationId: 6757, name: 'Enns – St. Laurenz', lat: 48.2087, lon: 14.4734 };
  const item = (label: string): CandidateItem => ({ item: 'Q1', labels: [label], coords: [] });

  it('leaves out the town the name leads with', () => {
    expect(ownToponymsOf(POCHLARN_WEST.name)).toEqual(['kastell hufeisenturm west']);
    expect(ownToponymsOf(POTAISSA.name)).toEqual(['potaissa', 'dealul cetatii']);
    expect(ownToponymsOf(GRESIA.name)).toEqual(['la biserica']);
  });

  it('reads a label sharing a word of them, never the town alone, nor a short word', () => {
    expect(namesMoreThanTheTown(POCHLARN_WEST, item('Spätantiker Hufeisenturm im Kommunalzentrum Pöchlarn'))).toBe(true);
    expect(namesMoreThanTheTown(POCHLARN_WEST, item('Pfarrkirche Pöchlarn'))).toBe(false);
    // "West" is in many a label, and "St." names a saint before it names the basilica.
    expect(namesMoreThanTheTown(POCHLARN_WEST, item('Westbahnhof West Pöchlarn'))).toBe(false);
    expect(namesMoreThanTheTown(ENNS_LAURENZ, item('Pfarrkirche Enns'))).toBe(false);
    expect(namesMoreThanTheTown(POTAISSA, item('Castrul roman Potaissa'))).toBe(true);
    expect(namesMoreThanTheTown(GRESIA, item('Castrul roman de la Gresia'))).toBe(false);
  });
});
