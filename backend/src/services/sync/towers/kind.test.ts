/**
 * Towers' line (#1854): editions and a year's readers, to enter and to stay,
 * on the towers the line was chosen from.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import { emptyContainment } from '../places/containment.js';
import type { TowerTrees } from './classes.js';
import { belowTowerDoor, belowTowerLine, classifyTowers, keptTowerNote, TOWER_LINE, towerDoorNote, towerStanding } from './kind.js';

describe('towerStanding', () => {
  it('lets in a tower that clears both measures', () => {
    // The Galata Tower: 56 editions, about 120,000 readers a year.
    expect(towerStanding(56, 120_000, false)).toBe('in');
  });

  it('keeps out a tower bots wrote many editions of and few read', () => {
    // Hoằng Phúc pagoda: 37 editions, under 3,000 readers a year.
    expect(towerStanding(37, 2_766, false)).toBe('out');
  });

  it('keeps a tower the source holds while it clears the lower line, and lets it fall below it', () => {
    expect(towerStanding(13, 20_000, false)).toBe('out');
    expect(towerStanding(13, 20_000, true)).toBe('in');
    expect(towerStanding(13, 17_000, true)).toBe('fell');
    expect(towerStanding(11, 50_000, true)).toBe('fell');
  });

  it('lets nothing new in when no year of readers can be read, and keeps what the source holds on editions', () => {
    // Hoằng Phúc pagoda's 37 editions are what the readers are there to see through.
    expect(towerStanding(37, null, false)).toBe('out');
    expect(towerStanding(12, null, true)).toBe('in');
    expect(towerStanding(11, null, true)).toBe('fell');
  });
});

describe('belowTowerLine', () => {
  it('names both measures and both lines', () => {
    expect(belowTowerLine(13, 17_000)).toBe(
      '13 Wikipedia editions and 17,000 readers a year: below Towers\' line (15 editions and 25,000 readers to enter, 12 and 18,000 to stay)',
    );
  });
});

describe('classifyTowers', () => {
  const TOWER = 'Q12518';
  const SKYSCRAPER = 'Q11303';
  const none = new Set<string>();
  const trees: TowerTrees = {
    tower: new Set([TOWER]),
    types: {
      pagoda: none, minaret: none, 'clock-tower': none, 'bell-tower': none,
      'observation-tower': none, 'fortified-tower': none,
    },
    others: {
      lighthouse: none, bridge: none, gate: none, gateTower: none, sculpture: none,
      skyscraper: new Set([SKYSCRAPER]), officeBuilding: none, towerBlock: none,
    },
    kills: { destroyed: none, proposed: none, guyedMast: none, ruins: none },
    worship: none, archaeologicalSite: none, worshipParts: none,
  };
  const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
    qid, label, description: null, lat: 41, lon: 29, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  const share = (rows: [PoolEntity, string[]][]): KindShare<TowerTrees> => ({
    trees,
    pool: new Map(rows.map(([e]) => [e.qid, e])),
    byId: new Set(),
    facts: new Map(rows.map(([e, classes]) => [e.qid, { classes }])) as never,
    containers: emptyContainment(),
    subjects: new Map(),
    entered: new Set(),
    enteredOnly: new Set(),
  });

  it('admits by the rule and the line, refuses what the rule refuses, and names a fallen tower', async () => {
    const result = await classifyTowers(share([
      [entity('Q91274', 'Galata Tower', 56), [TOWER]],
      [entity('Q12495', 'Burj Khalifa', 160), [SKYSCRAPER]],
      [entity('Q20025373', 'Hoằng Phúc pagoda', 37), [TOWER]],
      [entity('Q1', 'A held tower', 13), [TOWER]],
    ]), new Set(['Q1']), new Map([['Q91274', 120_000], ['Q20025373', 2_766], ['Q1', 17_000]]));

    expect(result.items.map((item) => [item.qid, item.type])).toEqual([['Q91274', 'tower']]);
    expect(result.fetched).toBe(4);
    expect(result.filtered).toEqual([
      { externalId: 'Q12495', name: 'Burj Khalifa', reason: 'a skyscraper, not a tower' },
      { externalId: 'Q1', name: 'A held tower', reason: belowTowerLine(13, 17_000), type: 'tower' },
    ]);
  });
});

describe('the guide door (ADR-0168)', () => {
  it('lets a guided tower in at the door\'s bar whatever its editions, and keeps it over the exit', () => {
    // The Asinelli Tower: 9 editions, used by a guide, read 51,000 times a year.
    expect(towerStanding(9, 51_000, false, TOWER_LINE, true)).toBe('door');
    // The Torrazzo of Cremona: 14 editions, a guide, 17,000 readers — over the bar, under the line.
    expect(towerStanding(14, 17_000, false, TOWER_LINE, true)).toBe('door');
    // The same tower no guide uses stays out; under the bar it stays out even guided.
    expect(towerStanding(14, 17_000, false, TOWER_LINE, false)).toBe('out');
    expect(towerStanding(14, 12_000, false, TOWER_LINE, true)).toBe('out');
    // A held tower the door admitted stays over the exit and falls under it, or when no guide uses it.
    expect(towerStanding(9, 12_000, true, TOWER_LINE, true)).toBe('door');
    expect(towerStanding(9, 9_000, true, TOWER_LINE, true)).toBe('fell');
    expect(towerStanding(9, 12_000, true, TOWER_LINE, false)).toBe('fell');
    // The line keeps what it keeps, whatever the guide says.
    expect(towerStanding(13, 20_000, true, TOWER_LINE, false)).toBe('in');
    // No year of readers: the door opens for nothing.
    expect(towerStanding(9, null, false, TOWER_LINE, true)).toBe('out');
  });

  it('writes the curator\'s question, and names the guide when a held tower falls', () => {
    expect(towerDoorNote(9, 51_000)).toBe(
      "Admitted below Towers' line (9 Wikipedia editions, 51,000 readers a year): a Wikivoyage guide uses it, "
      + "and the year reads it over the guide door's bar of 15,000. Is it a tower a visitor goes to see?",
    );
    expect(belowTowerDoor(9, 9_000, true)).toBe(`${belowTowerLine(9, 9_000)}, a Wikivoyage guide uses it, but under the guide door's exit of 10,800 readers`);
    expect(belowTowerDoor(9, 12_000, false)).toBe(`${belowTowerLine(9, 12_000)}, and no Wikivoyage guide uses it`);
    expect(keptTowerNote(9, 12_000, 'shut')).toBe(
      "Kept below Towers' line (9 Wikipedia editions, 12,000 readers a year): "
      + "the guide door is shut (the source's curator gate is off, or no Wikivoyage usage is built)",
    );
  });

  const TOWER = 'Q12518';
  const none = new Set<string>();
  const trees: TowerTrees = {
    tower: new Set([TOWER]),
    types: { pagoda: none, minaret: none, 'clock-tower': none, 'bell-tower': none, 'observation-tower': none, 'fortified-tower': none },
    others: { lighthouse: none, bridge: none, gate: none, gateTower: none, sculpture: none, skyscraper: none, officeBuilding: none, towerBlock: none },
    kills: { destroyed: none, proposed: none, guyedMast: none, ruins: none },
    worship: none, archaeologicalSite: none, worshipParts: none,
  };
  const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
    qid, label, description: null, lat: 44.49, lon: 11.35, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  const share = (): KindShare<TowerTrees> => {
    const rows: PoolEntity[] = [
      entity('Q16511590', 'Asinelli Tower', 9),
      entity('Q2', 'Unguided', 14),
      entity('Q3', 'Held, no guide any more', 9),
      entity('Q4', 'Held, guided', 9),
    ];
    return {
      trees, pool: new Map(rows.map((e) => [e.qid, e])), byId: new Set(),
      facts: new Map(rows.map((e) => [e.qid, { classes: [TOWER] }])) as never,
      containers: emptyContainment(), subjects: new Map(), entered: new Set(), enteredOnly: new Set(),
    };
  };
  const readers = new Map([['Q16511590', 51_000], ['Q2', 17_000], ['Q3', 12_000], ['Q4', 12_000]]);
  const held = new Set(['Q3', 'Q4']);

  it('admits by the door with the question, keeps or drops a held tower by the guide', async () => {
    const { items, filtered } = await classifyTowers(share(), held, readers, new Set(['Q16511590', 'Q4']));
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      ['Q16511590', towerDoorNote(9, 51_000)],
      ['Q4', towerDoorNote(9, 12_000)],
    ]);
    expect(filtered).toEqual([{ externalId: 'Q3', name: 'Held, no guide any more', reason: belowTowerDoor(9, 12_000, false), type: 'tower' }]);
  });

  it('shut, lets nothing in and keeps the held towers with a note saying why', async () => {
    const { items, filtered } = await classifyTowers(share(), held, readers, null);
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      ['Q3', keptTowerNote(9, 12_000, 'shut')],
      ['Q4', keptTowerNote(9, 12_000, 'shut')],
    ]);
    expect(filtered).toEqual([]);
  });

  it('with no door opened, the line alone decides', async () => {
    const { items, filtered } = await classifyTowers(share(), held, readers);
    expect(items).toEqual([]);
    expect(filtered.map((f) => [f.externalId, f.reason])).toEqual([
      ['Q3', belowTowerLine(9, 12_000)],
      ['Q4', belowTowerLine(9, 12_000)],
    ]);
  });
});

describe('the guide door when the year cannot be read, and the note a held tower carries', () => {
  it('names the exit, not the bar, on a held tower the door keeps between the two', () => {
    expect(towerDoorNote(9, 12_000)).toBe(
      "Admitted below Towers' line (9 Wikipedia editions, 12,000 readers a year): a Wikivoyage guide uses it, "
      + "and the year reads it over the guide door's exit of 10,800 that keeps a tower the source holds. Is it a tower a visitor goes to see?",
    );
  });

  it('keeps a held tower a guide uses while no year of readers is read, whatever its editions', () => {
    // The Asinelli Tower, held, 9 editions: the door that admitted it cannot be asked without a year.
    expect(towerStanding(9, null, true, TOWER_LINE, true)).toBe('door');
    expect(towerStanding(9, null, true, TOWER_LINE, false)).toBe('fell');
    expect(towerStanding(9, null, false, TOWER_LINE, true)).toBe('out');
    expect(keptTowerNote(9, null, 'no-year')).toBe(
      "Kept below Towers' line (9 Wikipedia editions, no year of readers read): "
      + 'a Wikivoyage guide uses it, and no year of readers is read to ask the guide door',
    );
  });

  it('through classifyTowers, a held guided tower under the line is kept with that note, not refused', async () => {
    const TOWER = 'Q12518';
    const none = new Set<string>();
    const trees: TowerTrees = {
      tower: new Set([TOWER]),
      types: { pagoda: none, minaret: none, 'clock-tower': none, 'bell-tower': none, 'observation-tower': none, 'fortified-tower': none },
      others: { lighthouse: none, bridge: none, gate: none, gateTower: none, sculpture: none, skyscraper: none, officeBuilding: none, towerBlock: none },
      kills: { destroyed: none, proposed: none, guyedMast: none, ruins: none },
      worship: none, archaeologicalSite: none, worshipParts: none,
    };
    const asinelli: PoolEntity = {
      qid: 'Q16511590', label: 'Asinelli Tower', description: null, lat: 44.49, lon: 11.35, onEarth: true, imageUrl: null,
      itemPictures: [], sitelinks: 9, countryLabel: null, articleUrl: null, website: null, year: null,
    };
    const share: KindShare<TowerTrees> = {
      trees, pool: new Map([[asinelli.qid, asinelli]]), byId: new Set(), facts: new Map([[asinelli.qid, { classes: [TOWER] }]]) as never,
      containers: emptyContainment(), subjects: new Map(), entered: new Set(), enteredOnly: new Set(),
    };
    const { items, filtered } = await classifyTowers(share, new Set([asinelli.qid]), null, new Set([asinelli.qid]));
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([['Q16511590', keptTowerNote(9, null, 'no-year')]]);
    expect(filtered).toEqual([]);
  });
});
