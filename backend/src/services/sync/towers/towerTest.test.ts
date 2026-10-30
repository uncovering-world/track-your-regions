/**
 * What Towers admits and what it leaves to another kind (#1854), asked on real
 * entities with the classes Wikidata gave them on 2026-10-22 (the clocks and
 * the building complexes on 2026-10-30, #2136), so a rule that passes here has
 * been tried on the places a traveller would name.
 */

import { describe, it, expect } from 'vitest';
import type { TowerTrees } from './classes.js';
import { towerVerdict, type TowerFacts } from './towerTest.js';

const TOWER = 'Q12518';
const BELL_TOWER = 'Q200334';
const CHURCH_TOWER = 'Q72926449';
const STEEPLE = 'Q5191724';
const FREE_STANDING_TOWER = 'Q127038589';
const INCLINED_TOWER = 'Q797765';
const MINARET = 'Q48356';
const PAGODA = 'Q199451';
const CLOCK_TOWER = 'Q853854';
const OBSERVATION_TOWER = 'Q1440300';
const TELEVISION_TOWER = 'Q11166728';
const FORTIFIED_TOWER = 'Q81917';
const NURAGHE = 'Q688292';
const SKYSCRAPER = 'Q11303';
const LIGHTHOUSE = 'Q39715';
const ANCIENT_LIGHTHOUSE = 'Q3378136';
const GUYED_MAST = 'Q5622819';
const DESTROYED = 'Q19860854';
const MUSEUM = 'Q33506';
const RELIGIOUS_MUSEUM = 'Q92755865';
const CHURCH_BUILDING = 'Q16970';
const MOSQUE = 'Q32815';
const MINOR_BASILICA = 'Q120560';
const ARCHAEOLOGICAL_SITE = 'Q839954';
const MONUMENT = 'Q4989906';
const LANDMARK = 'Q2319498';
const BUILDING_COMPLEX = 'Q1497364';
const ASTRONOMICAL_CLOCK = 'Q5275';
const CARILLON = 'Q505174';
const TWIN_TOWERS = 'Q118896406';

const none = new Set<string>();
const MAUSOLEUM = 'Q162875';

const trees: TowerTrees = {
  tower: new Set([
    TOWER, BELL_TOWER, CHURCH_TOWER, STEEPLE, FREE_STANDING_TOWER, INCLINED_TOWER, MINARET, PAGODA,
    CLOCK_TOWER, OBSERVATION_TOWER, TELEVISION_TOWER, FORTIFIED_TOWER, NURAGHE,
  ]),
  types: {
    pagoda: new Set([PAGODA]),
    minaret: new Set([MINARET]),
    'clock-tower': new Set([CLOCK_TOWER]),
    'bell-tower': new Set([BELL_TOWER, CHURCH_TOWER, STEEPLE]),
    'observation-tower': new Set([OBSERVATION_TOWER, TELEVISION_TOWER]),
    'fortified-tower': new Set([FORTIFIED_TOWER]),
  },
  others: {
    lighthouse: new Set([LIGHTHOUSE, ANCIENT_LIGHTHOUSE]),
    bridge: none, gate: none, gateTower: none, sculpture: none,
    skyscraper: new Set([SKYSCRAPER]),
    officeBuilding: none, towerBlock: none,
  },
  kills: { destroyed: new Set([DESTROYED]), proposed: none, guyedMast: new Set([GUYED_MAST]), ruins: none },
  // Wikidata files a minaret under structures of worship.
  worship: new Set([CHURCH_BUILDING, MOSQUE, MINOR_BASILICA, MINARET]),
  archaeologicalSite: new Set([ARCHAEOLOGICAL_SITE]),
  worshipParts: new Set([MINARET, STEEPLE]),
};

const at = (classes: string[]): TowerFacts => ({ classes, onEarth: true, lat: 1, lon: 1 });

describe('towerVerdict', () => {
  it.each([
    ['the Eiffel Tower', [LANDMARK, OBSERVATION_TOWER], 'observation-tower'],
    ['the Leaning Tower of Pisa, a museum too', [MUSEUM, RELIGIOUS_MUSEUM, CHURCH_TOWER, INCLINED_TOWER, FREE_STANDING_TOWER], 'bell-tower'],
    ['Big Ben, a clock tower before a steeple', [CLOCK_TOWER, STEEPLE, INCLINED_TOWER], 'clock-tower'],
    ['the Giralda, a steeple no church class names', [STEEPLE, MONUMENT], 'bell-tower'],
    ['the Galata Tower, a museum too', [TOWER, MUSEUM], 'tower'],
    ['Ivan the Great, a bell tower with a church in it', [CHURCH_BUILDING, BELL_TOWER, LANDMARK], 'bell-tower'],
    ['the Minaret of Jam, a site that is a minaret', [MINARET, ARCHAEOLOGICAL_SITE], 'minaret'],
    ['the Qutb Minar, a minaret and nothing else', [MINARET], 'minaret'],
    ['Monar Jonban, a mausoleum with minarets', [MAUSOLEUM, MINARET], 'minaret'],
    ['the Oriental Pearl Tower, a TV tower Wikidata also calls a skyscraper', [SKYSCRAPER, OBSERVATION_TOWER, TELEVISION_TOWER], 'observation-tower'],
    ['Hoằng Phúc pagoda, whose fame is the line\'s to judge', [PAGODA], 'pagoda'],
  ])('admits %s', (_name, classes, type) => {
    expect(towerVerdict(at(classes), trees)).toEqual({ pass: true, type });
  });

  it.each([
    ['Bologna\'s Two Towers, a complex of inclined towers', [INCLINED_TOWER, BUILDING_COMPLEX], 'tower'],
    ['the Kharaqan Towers, twin tower tombs', [MAUSOLEUM, TOWER, TWIN_TOWERS], 'tower'],
    ['an astronomical clock that is a clock tower', [ASTRONOMICAL_CLOCK, CARILLON, CLOCK_TOWER], 'clock-tower'],
  ])('admits %s, which a building complex or a public clock class does not refuse', (_name, classes, type) => {
    expect(towerVerdict(at(classes), trees)).toEqual({ pass: true, type });
  });

  it.each([
    ['the Warsaw radio mast, collapsed in 1991', [TOWER, GUYED_MAST, DESTROYED], 'destroyed or demolished'],
    ['the Tower of Hercules, a lighthouse', [ANCIENT_LIGHTHOUSE, MONUMENT, FORTIFIED_TOWER, LIGHTHOUSE], 'a lighthouse, not a tower'],
    ['the Burj Khalifa, a skyscraper', [SKYSCRAPER, LANDMARK], 'a skyscraper, not a tower'],
    ['Hagia Sophia, a mosque with minarets', [MINOR_BASILICA, MOSQUE, MUSEUM, CHURCH_BUILDING, MINARET], 'a place of worship with a tower, not a tower'],
    ['Su Nuraxi, a nuraghe', [ARCHAEOLOGICAL_SITE, NURAGHE, MUSEUM], 'an archaeological site, not a tower'],
    ['a monument no tower class names', [MONUMENT], 'no tower class'],
    ['Cœur Défense, a complex of office towers', [TOWER, BUILDING_COMPLEX], 'a building complex, not a tower'],
    ['the Prague Astronomical Clock, filed as a bell tower for its bells', [ASTRONOMICAL_CLOCK, BELL_TOWER], 'a public clock, which Public art offers, not a tower'],
  ])('refuses %s', (_name, classes, reason) => {
    expect(towerVerdict(at(classes), trees)).toEqual({ pass: false, reason });
  });

  it('refuses a tower with no point on Earth', () => {
    expect(towerVerdict({ classes: [TOWER], onEarth: true, lat: null, lon: null }, trees))
      .toEqual({ pass: false, reason: 'no point on Earth' });
    expect(towerVerdict({ classes: [TOWER], onEarth: false, lat: 1, lon: 1 }, trees))
      .toEqual({ pass: false, reason: 'no point on Earth' });
  });
});
