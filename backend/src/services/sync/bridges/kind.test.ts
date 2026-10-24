/**
 * The line of Bridges & engineering marvels (#1860): two doors on 15 editions,
 * 50,000 readers a year or 10,000 with a Wikivoyage guide naming the work.
 */

import { describe, it, expect, vi } from 'vitest';
import { readershipYear, readWorks } from '../../dumps/readership/workReadership.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));
vi.mock('../../dumps/wikivoyage/usageTables.js', () => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import { emptyContainment } from '../places/containment.js';
import type { BridgeTrees } from './classes.js';
import { belowGuidedLine, guidedStanding } from '../places/guidedLine.js';
import { BRIDGE_LINE, WATERWAY_LINE, classifyBridges } from './kind.js';

describe('guidedStanding, on Bridges\' line', () => {
  it('lets in a work read widely, guided or not', () => {
    // The Lake Pontchartrain Causeway: 36 editions, 435,000 readers, one guide.
    expect(guidedStanding(BRIDGE_LINE, 36, 435_000, false, false)).toBe('in');
  });

  it('lets in a work a guide names on fewer readers, and keeps out one no guide names', () => {
    // The Khaju Bridge in Isfahan: 25 editions, 43,000 readers, three guides.
    expect(guidedStanding(BRIDGE_LINE, 25, 43_351, true, false)).toBe('in');
    expect(guidedStanding(BRIDGE_LINE, 25, 43_351, false, false)).toBe('out');
    // Ponte Sisto: 21 editions, under 19,000 readers, named by guides.
    expect(guidedStanding(BRIDGE_LINE, 21, 18_668, true, false)).toBe('in');
  });

  it('keeps out a work under 15 editions however read', () => {
    expect(guidedStanding(BRIDGE_LINE, 14, 900_000, true, false)).toBe('out');
  });

  it('keeps a work the source holds on the stay line, and lets it fall below it', () => {
    expect(guidedStanding(BRIDGE_LINE, 13, 40_000, false, true)).toBe('in');
    expect(guidedStanding(BRIDGE_LINE, 13, 30_000, false, true)).toBe('fell');
    expect(guidedStanding(BRIDGE_LINE, 13, 8_000, true, true)).toBe('in');
    expect(guidedStanding(BRIDGE_LINE, 11, 900_000, true, true)).toBe('fell');
  });

  it('lets nothing new in when no year of readers can be read, and keeps what the source holds on editions', () => {
    expect(guidedStanding(BRIDGE_LINE, 60, null, true, false)).toBe('out');
    expect(guidedStanding(BRIDGE_LINE, 12, null, false, true)).toBe('in');
    expect(guidedStanding(BRIDGE_LINE, 11, null, true, true)).toBe('fell');
  });
});

describe('guidedStanding, on the waterway line (#1947)', () => {
  it('lets in a lock read in few languages but by many', () => {
    // The Caen Hill flight: 3 editions, 20,500 readers, no guide.
    expect(guidedStanding(WATERWAY_LINE, 3, 20_544, false, false)).toBe('in');
    // Seattle's Ballard Locks: 4 editions, 24,000 readers, two guides.
    expect(guidedStanding(WATERWAY_LINE, 4, 24_221, true, false)).toBe('in');
  });

  it('lets in a lift a guide names on fewer readers, and keeps out one no guide names', () => {
    // The Fontinettes boat lift: 4 editions, 4,700 readers, one guide.
    expect(guidedStanding(WATERWAY_LINE, 4, 4_658, true, false)).toBe('in');
    // The Rhine's Kembs-Niffer lock: 2 editions, 3,800 readers, no guide.
    expect(guidedStanding(WATERWAY_LINE, 2, 3_843, false, false)).toBe('out');
  });
});

describe('belowGuidedLine, on Bridges\' line', () => {
  it('names the measures, the guide and both lines', () => {
    expect(belowGuidedLine(BRIDGE_LINE, 13, 30_000, false)).toBe(
      '13 Wikipedia editions and 30,000 readers a year, named by no Wikivoyage guide: below the line '
      + '(15 editions and 50,000 readers to enter, 10,000 with a guide; 12 and 35,000, 7,000 with a guide, to stay)',
    );
  });
});

describe('classifyBridges', () => {
  const BRIDGE = 'Q12280';
  const DESTROYED = 'Q19860854';
  const none = new Set<string>();
  const trees: BridgeTrees = {
    work: new Set([BRIDGE]),
    types: {
      aqueduct: none, bridge: new Set([BRIDGE]), dam: none, 'inclined-plane': none, 'boat-lift': none,
      'lock-flight': none, lock: none, tunnel: none,
    },
    kills: { destroyed: new Set([DESTROYED]), proposed: none, proposedTunnel: none, underConstruction: none, ruins: none },
    others: { river: none, railwayLine: none },
    archaeologicalSite: none,
    canal: none,
    powerStation: none,
  };
  const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
    qid, label, description: null, lat: 50, lon: 14, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  const share = (rows: [PoolEntity, string[]][]): KindShare<BridgeTrees> => ({
    trees,
    pool: new Map(rows.map(([e]) => [e.qid, e])),
    byId: new Set(),
    facts: new Map(rows.map(([e, classes]) => [e.qid, { classes }])) as never,
    containers: emptyContainment(),
    subjects: new Map(),
  });

  it('admits by the rule and both doors, refuses what the rule refuses, and names a fallen work', async () => {
    const result = await classifyBridges(share([
      [entity('Q204871', 'Charles Bridge', 61), [BRIDGE]],
      [entity('Q1740490', 'Khaju Bridge', 25), [BRIDGE]],
      [entity('Q3907993', 'Polcevera Viaduct', 37), [BRIDGE, DESTROYED]],
      [entity('Q1', 'An expressway viaduct', 27), [BRIDGE]],
      [entity('Q2', 'A held bridge', 13), [BRIDGE]],
    ]), new Set(['Q2']), {
      readers: new Map([['Q204871', 518_395], ['Q1740490', 43_351], ['Q1', 42_872], ['Q2', 30_000]]),
      guided: new Set(['Q204871', 'Q1740490']),
    });

    expect(result.items.map((item) => [item.qid, item.type])).toEqual([['Q204871', 'bridge'], ['Q1740490', 'bridge']]);
    expect(result.fetched).toBe(5);
    expect(result.filtered).toEqual([
      { externalId: 'Q3907993', name: 'Polcevera Viaduct', reason: 'destroyed or demolished' },
      { externalId: 'Q2', name: 'A held bridge', reason: belowGuidedLine(BRIDGE_LINE, 13, 30_000, false), type: 'bridge' },
    ]);
  });
  it('shuts the guide door while no Wikivoyage usage is built', async () => {
    vi.mocked(readershipYear).mockResolvedValue({ months: ['2026-09-01'], editions: ['enwiki'] } as never);
    vi.mocked(readWorks).mockResolvedValue({ views: new Map([['Q1740490', 43_351]]) } as never);
    vi.mocked(latestUsage).mockResolvedValue(null);
    const result = await classifyBridges(share([[entity('Q1740490', 'Khaju Bridge', 25), [BRIDGE]]]), new Set());
    expect(result.items).toEqual([]);
    expect(usedByAGuide).not.toHaveBeenCalled();
  });
});
