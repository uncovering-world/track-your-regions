/**
 * Parks & gardens' world tier (ADR-0175): the rule, then the three bars read
 * off the kind's own pool, as for the live kinds (#2254).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));
vi.mock('../../dumps/wikivoyage/usageTables.js', () => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { emptyContainment } from '../places/containment.js';
import type { ParkTrees } from './classes.js';
import { classifyParks } from './kind.js';

describe('classifyParks', () => {
  const URBAN_PARK = 'Q22746';
  const CEMETERY = 'Q39614';
  const none = new Set<string>();
  const trees: ParkTrees = {
    place: new Set([URBAN_PARK]),
    types: { 'botanical-garden': none, garden: none },
    kills: { destroyed: none, proposed: none, underConstruction: none },
    others: { nationalPark: none, statePark: none, provincialPark: none, worship: none, cemetery: new Set([CEMETERY]) },
    shared: {
      protectedArea: none, zoo: none, amusementPark: none, miniaturePark: none, square: none, sportsVenue: none,
      sportsPark: none, outdoorGym: none, golfCourse: none, businessPark: none, industrialPark: none,
      sittingOutArea: none, allotment: none, communityGarden: none,
    },
    archaeologicalSite: none,
    residence: none,
  };
  const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
    qid, label, description: null, lat: 41, lon: 12, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  // 51 parks the rule passes: the bars are the second highest editions and readers, the sixth highest readers.
  const CENTRAL_PARK = entity('Q160409', 'Central Park', 87);
  const WIDE = entity('Q9000003', 'An unguided park read widely', 19);
  const GUIDED = entity('Q9000004', 'A park a guide names', 15);
  const LITTLE = entity('Q9000005', 'An unguided park read little', 20);
  const TAIL = Array.from({ length: 47 }, (_, i) => entity(`Q9100${100 + i}`, "A park in the pool's tail", 3));
  const OHLSDORF = entity('Q562211', 'Ohlsdorf Cemetery', 40);
  const rows: [PoolEntity, string[]][] = [
    [CENTRAL_PARK, [URBAN_PARK]], [WIDE, [URBAN_PARK]], [GUIDED, [URBAN_PARK]], [LITTLE, [URBAN_PARK]], [OHLSDORF, [CEMETERY, URBAN_PARK]],
    ...TAIL.map((e): [PoolEntity, string[]] => [e, [URBAN_PARK]]),
  ];
  const share: KindShare<ParkTrees> = {
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
    const result = await classifyParks(share, new Set(), sparql, {
      readers: new Map([
        ['Q160409', 520_123], ['Q9000003', 36_088], ['Q9000004', 7_423], ['Q9000005', 2_000], ['Q562211', 90_000],
        ...TAIL.map((e): [string, number] => [e.qid, 1_000]),
      ]),
      guided: new Set(['Q160409', 'Q9000004']),
      atlas: new Set(),
    });
    // Bars: 20 editions (the second highest), 36,088 readers, 1,000 for a marked park.
    expect(result.items.map((item) => [item.qid, item.type])).toEqual([
      ['Q160409', 'park'], ['Q9000005', 'park'], ['Q9000003', 'park'], ['Q9000004', 'park'],
    ]);
    expect(result.filtered).toEqual([{ externalId: 'Q562211', name: 'Ohlsdorf Cemetery', reason: 'a cemetery, not a park' }]);
  });
});
