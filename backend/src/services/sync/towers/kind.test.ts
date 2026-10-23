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
import { belowTowerLine, classifyTowers, towerStanding } from './kind.js';

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
