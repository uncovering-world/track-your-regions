/**
 * Squares & streets' world tier (ADR-0175): the rule, then the three bars
 * read off the kind's own pool.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));
vi.mock('../../dumps/wikivoyage/usageTables.js', () => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import type { SparqlFn } from '../wikidataQueries.js';
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
      worship: none, palace: none, bridge: none, archaeologicalSite: none, agora: none, bullring: new Set([BULLRING]),
      railwayLine: none, motorway: none, river: none,
    },
  };
  const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
    qid, label, description: null, lat: 41, lon: 12, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  // 51 squares the rule passes: the bars are the second highest editions and readers, the sixth highest readers.
  const RED_SQUARE = entity('Q41116', 'Red Square', 98);
  const WIDE = entity('Q9000003', 'An unguided square read widely', 19);
  const GUIDED = entity('Q9000004', 'A square a guide names', 15);
  const LITTLE = entity('Q9000005', 'An unguided square read little', 20);
  const TAIL = Array.from({ length: 47 }, (_, i) => entity(`Q9100${100 + i}`, "A square in the pool's tail", 3));
  const LAS_VENTAS = entity('Q756621', 'Las Ventas', 40);
  const rows: [PoolEntity, string[]][] = [
    [RED_SQUARE, [SQUARE]], [WIDE, [SQUARE]], [GUIDED, [SQUARE]], [LITTLE, [SQUARE]], [LAS_VENTAS, [BULLRING]],
    ...TAIL.map((e): [PoolEntity, string[]] => [e, [SQUARE]]),
  ];
  const share: KindShare<SquareTrees> = {
    trees,
    pool: new Map(rows.map(([e]) => [e.qid, e])),
    byId: new Set(),
    facts: new Map(rows.map(([e, classes]) => [e.qid, { classes }])) as never,
    containers: emptyContainment(),
    subjects: new Map(),
    entered: new Set(),
    enteredOnly: new Set(),
    admissionPool: new Set(rows.map(([e]) => e.qid)),
  };
  const sparql: SparqlFn = () => Promise.reject(new Error('no question reaches Wikidata here'));

  it('admits on editions, on readers or on a guide\'s mark, and refuses what the rule refuses', async () => {
    const result = await classifySquares(share, new Set(), sparql, {
      readers: new Map([
        ['Q41116', 520_123], ['Q9000003', 36_088], ['Q9000004', 7_423], ['Q9000005', 2_000], ['Q756621', 90_000],
        ...TAIL.map((e): [string, number] => [e.qid, 1_000]),
      ]),
      guided: new Set(['Q41116', 'Q9000004']),
      atlas: new Set(),
    });
    // Bars: 20 editions (the second highest), 36,088 readers, 1,000 for a marked square.
    expect(result.items.map((item) => [item.qid, item.type])).toEqual([
      ['Q41116', 'square'], ['Q9000005', 'square'], ['Q9000003', 'square'], ['Q9000004', 'square'],
    ]);
    expect(result.filtered).toEqual([{ externalId: 'Q756621', name: 'Las Ventas', reason: 'a bullring, not a square' }]);
  });
});
