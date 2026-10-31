/**
 * The towers under the pool's floor the guide door may open for (ADR-0168):
 * the readership names them, the guide narrows them, Wikidata is asked only
 * about those, and the pool's own rows are never asked about again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const readership = vi.hoisted(() => ({ readershipYear: vi.fn(), readAtLeast: vi.fn() }));
const usage = vi.hoisted(() => ({ usedByAGuide: vi.fn() }));
const placed = vi.hoisted(() => ({ fetchPlacedAmong: vi.fn() }));
const entities = vi.hoisted(() => ({ fetchEntitiesByIds: vi.fn(), fetchEntityFacts: vi.fn(), POOL_MIN_SITELINKS: 15 }));
vi.mock('../../dumps/readership/workReadership.js', () => readership);
vi.mock('../../dumps/wikivoyage/usageTables.js', () => usage);
vi.mock('../archaeology/queries.js', () => placed);
vi.mock('../publicArt/queries.js', () => entities);

import { collectTowersUnderFloor } from './underFloor.js';
import type { TowerTrees } from './classes.js';
import type { PoolEntity } from '../publicArt/queries.js';

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
const sparql = vi.fn();

describe('collectTowersUnderFloor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readership.readershipYear.mockResolvedValue({ editions: ['en'], months: ['2026-09-01'] });
    // The year reads four items over the bar in fewer than 15 editions: a tower
    // the pool holds, a guided tower, an unguided tower and a guided town.
    readership.readAtLeast.mockResolvedValue(['Q1', 'Q16511590', 'Q2', 'Q3']);
    usage.usedByAGuide.mockResolvedValue(new Set(['Q16511590', 'Q3']));
    placed.fetchPlacedAmong.mockResolvedValue(['Q16511590']);
    entities.fetchEntitiesByIds.mockResolvedValue([entity('Q16511590', 'Asinelli Tower', 9)]);
    entities.fetchEntityFacts.mockResolvedValue(new Map([['Q16511590', { classes: [TOWER] }]]));
  });

  it('names the guided towers the year reads at the bar, asking Wikidata about those alone', async () => {
    const pool = new Map([['Q1', entity('Q1', 'Already in the pool', 14)]]);
    const { entities: found, facts } = await collectTowersUnderFloor(sparql, pool, trees, 15_000, '[test]');
    expect(readership.readAtLeast).toHaveBeenCalledWith({ editions: ['en'], months: ['2026-09-01'] }, 15_000, 15);
    // The pool's own row is never asked about again.
    expect(usage.usedByAGuide).toHaveBeenCalledWith(['Q16511590', 'Q2', 'Q3']);
    expect(placed.fetchPlacedAmong).toHaveBeenCalledWith(sparql, ['Q16511590', 'Q3'], trees.tower);
    expect(entities.fetchEntitiesByIds).toHaveBeenCalledWith(sparql, ['Q16511590'], 'towers the world reads under the pool floor');
    expect(found.map((e) => e.qid)).toEqual(['Q16511590']);
    expect(facts.get('Q16511590')).toEqual({ classes: [TOWER] });
  });

  it('reads nothing while no year of readership is folded', async () => {
    readership.readershipYear.mockResolvedValue(null);
    expect(await collectTowersUnderFloor(sparql, new Map(), trees, 15_000, '[test]')).toEqual({ entities: [], facts: new Map() });
    expect(readership.readAtLeast).not.toHaveBeenCalled();
  });

  it('asks Wikidata nothing when no guided item is read at the bar', async () => {
    usage.usedByAGuide.mockResolvedValue(new Set());
    expect(await collectTowersUnderFloor(sparql, new Map(), trees, 15_000, '[test]')).toEqual({ entities: [], facts: new Map() });
    expect(placed.fetchPlacedAmong).not.toHaveBeenCalled();
  });
});
