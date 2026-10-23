/**
 * The line of Squares & streets (#1867): 15 editions, then 30,000 readers a
 * year or 5,000 with a Wikivoyage guide naming the place.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));
vi.mock('../../dumps/wikivoyage/usageTables.js', () => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import { emptyContainment } from '../places/containment.js';
import type { SquareTrees } from './classes.js';
import { classifySquares } from './kind.js';

describe('classifySquares', () => {
  const SQUARE = 'Q174782';
  const BULLRING = 'Q1193438';
  const none = new Set<string>();
  const trees: SquareTrees = {
    place: new Set([SQUARE]),
    types: { stairway: none, square: new Set([SQUARE]), promenade: none, street: none },
    kills: { destroyed: none, proposed: none, underConstruction: none },
    others: {
      worship: none, palace: none, bridge: none, archaeologicalSite: none, bullring: new Set([BULLRING]),
      railwayLine: none, motorway: none, river: none,
    },
  };
  const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
    qid, label, description: null, lat: 41, lon: 12, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  const share = (rows: [PoolEntity, string[]][]): KindShare<SquareTrees> => ({
    trees,
    pool: new Map(rows.map(([e]) => [e.qid, e])),
    byId: new Set(),
    facts: new Map(rows.map(([e, classes]) => [e.qid, { classes }])) as never,
    containers: emptyContainment(),
    subjects: new Map(),
  });

  it('admits on readers or on a guide, and refuses what the rule refuses', async () => {
    const result = await classifySquares(share([
      [entity('Q41116', 'Red Square', 98), [SQUARE]],
      // Read as much as Havana's Malecón, which no guide names: its readers carry it.
      [entity('Q3', 'An unguided square read widely', 19), [SQUARE]],
      // Read little, but a guide names it.
      [entity('Q4', 'A guided square', 15), [SQUARE]],
      [entity('Q5', 'An unguided square read little', 20), [SQUARE]],
      [entity('Q756621', 'Las Ventas', 40), [BULLRING]],
    ]), new Set(), {
      readers: new Map([['Q41116', 520_123], ['Q3', 36_088], ['Q4', 7_423], ['Q5', 12_000], ['Q756621', 90_000]]),
      guided: new Set(['Q41116', 'Q4']),
    });

    expect(result.items.map((item) => [item.qid, item.type])).toEqual([['Q41116', 'square'], ['Q3', 'square'], ['Q4', 'square']]);
    expect(result.filtered).toEqual([{ externalId: 'Q756621', name: 'Las Ventas', reason: 'a bullring, not a square' }]);
  });
});
