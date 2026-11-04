/**
 * The surroundings tier over a kind (ADR-0171, #2178): the cut first over the
 * kind's share of the pass's surroundings pool, the kind's rule over the survivors
 * read by id, a landmark of the surroundings tier with the cut's note; nothing
 * where the run read the live service and no pool could be read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const gatherModule = vi.hoisted(() => ({ gatherPlaces: vi.fn(), shareOf: vi.fn() }));
vi.mock('./gather.js', () => gatherModule);
const standingModule = vi.hoisted(() => ({ subsetStandingFacts: vi.fn() }));
vi.mock('../subset/standing.js', () => standingModule);

import { mergeSurroundings, surroundingsGroupKey, surroundingsGroups, surroundingsLandmark, surroundingsReader, type SurroundingsKind } from './surroundingsTier.js';
import { SURROUNDINGS_CUT } from './surroundingsCut.js';
import type { SurroundingsPool } from './surroundingsPool.js';
import type { PoolEntity } from '../publicArt/queries.js';

const TOWER = 'Q12518';
const CHURCH = 'Q16970';
const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
  qid, label, description: null, lat: 44.49, lon: 11.35, onEarth: true, imageUrl: null, itemPictures: [],
  sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
});
const kind = { name: 'towers', trees: vi.fn(), poolClasses: vi.fn(), readsContainers: false };
const BELL = 'Q200334';
const trees = { tower: new Set([TOWER, BELL]), types: { 'bell-tower': new Set([BELL]) } };
const surroundings: SurroundingsKind<typeof trees> = {
  kind: kind as never,
  classesOf: (t) => t.tower,
  // The rule's own type: a bell tower before a plain tower, as towerType files them; a tower of no type is a 'tower'.
  typeOf: (classes, t) => (classes.some((c) => t.types['bell-tower'].has(c)) ? 'bell-tower' : 'tower'),
  verdict: (e, share) => ((share.facts.get(e.qid)?.classes ?? []).includes(TOWER)
    ? { pass: true, type: 'tower' } : { pass: false, reason: 'not a tower: a mast' }),
  logPrefix: '[test]',
};
const run = { sparql: vi.fn(), phase: vi.fn(), step: vi.fn() };
const sparql = vi.fn();
const gathered = { shares: new Map([[kind, { trees }]]), pooled: 0 };
const around = {
  groupSize: 30, topEditions: [40, 30, 28, 26, 25, 22, 20, 18, 16, 15], topGuideEditions: [3, 2, 2, 1, 1],
  topReaders: [60_000, 40_000, 30_000, 20_000, 15_000, 12_000, 10_000, 9_000, 8_500, 8_200],
};
// The pass's pool: four towers and a church; the church is another kind's candidate and sets the references with the rest.
const row = (qid: string, cls: string, editions: number, guideEditions: number, readers = 5_000) => ({
  qid, editions, guideEditions, readers, classes: [cls], lat: 44.49, lon: 11.35,
});
const pool: SurroundingsPool = {
  rows: new Map([
    ['Q1', row('Q1', TOWER, 40, 3, 60_000)], ['Q2', row('Q2', TOWER, 9, 1, 8_000)], ['Q3', row('Q3', TOWER, 7, 0)],
    ['Q4', row('Q4', TOWER, 12, 2, 6_000)], ['Q5', row('Q5', CHURCH, 30, 2, 40_000)],
  ]),
  around: new Map([['all', new Map([['Q1', around], ['Q2', around], ['Q3', around], ['Q4', around], ['Q5', around]])]]),
  seconds: 1,
};
const ON = { ...SURROUNDINGS_CUT, enabled: true };

describe('the surroundings tier over a kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The survivors asked by id: Q2 is a tower, Q4 is typed a mast there.
    gatherModule.gatherPlaces.mockResolvedValue('gathered-by-id');
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q2', entity('Q2', 'Asinelli Tower', 9)], ['Q4', entity('Q4', 'A mast', 12)]]),
        facts: new Map([['Q2', { classes: [TOWER] }], ['Q4', { classes: ['Q5622819'] }]]) }
      : gathered.shares.get(k as never)));
  });

  it('admits by the cut over the kind\'s rows, then by the kind\'s rule over the survivors read by id, and marks the tier', async () => {
    const reader = surroundingsReader(surroundings, ON);
    expect([...reader.classes(gathered as never)]).toEqual([TOWER, BELL]);
    const { items, filtered, skipped } = await reader.arrivals(run, sparql, gathered as never, new Set(['Q1']), pool, new Set());
    expect(skipped).toBeUndefined();
    // The world tier's row was never a candidate; the church is not of this kind; Q3 (7 editions, no guide) is under the cut.
    const [, requests] = gatherModule.gatherPlaces.mock.calls[0];
    expect([...requests[0].admitted]).toEqual(['Q2', 'Q4']);
    expect(requests[0].kind.poolClasses()).toEqual({ broad: [], narrow: [] });
    expect(items.map((i) => [i.qid, i.tier, i.type])).toEqual([['Q2', 'surroundings', 'tower']]);
    expect(items[0].readershipNote).toMatch(/^In the surroundings tier by the guides: within 150 km, 30 places of its density/);
    expect(filtered).toEqual([{ externalId: 'Q4', name: 'A mast', reason: 'not a tower: a mast' }]);
  });

  it('reads nothing where the run read the live service and no pool could be read, and says why', async () => {
    const result = await surroundingsReader(surroundings, ON).arrivals(run, sparql, gathered as never, new Set(), null, new Set());
    expect(result.items).toEqual([]);
    expect(result.skipped).toMatch(/local subset alone/);
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });

  it('reads nothing where no year of readers could be read, and says why, so its rows keep their standing', async () => {
    const unread: SurroundingsPool = { rows: new Map(), around: new Map(), seconds: 0, unread: 'No year of readers is read' };
    const result = await surroundingsReader(surroundings, ON).arrivals(run, sparql, gathered as never, new Set(), unread, new Set(['Q3']));
    expect(result).toEqual({ items: [], filtered: [], skipped: 'No year of readers is read' });
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });

  it('refuses a tunnel the cut admits where no guide uses it, and admits one a guide uses (ADR-0175)', async () => {
    // Rostock's Warnow Tunnel (Q646091) clears the cut by its nine editions, and no Wikivoyage edition uses it;
    // the Finse Tunnel (Q5450940) is used by the English Wikivoyage.
    const tunnels: SurroundingsKind<typeof trees> = { ...surroundings, verdict: () => ({ pass: true, type: 'tunnel' }) };
    const bored: SurroundingsPool = {
      rows: new Map([['Q646091', row('Q646091', TOWER, 9, 0, 12_698)], ['Q5450940', row('Q5450940', TOWER, 5, 1, 5_320)]]),
      around: new Map([['all', new Map([
        ['Q646091', { groupSize: 1_013, topEditions: [12, 12, 11, 11, 9, 9, 9, 7, 7, 6], topGuideEditions: [5, 4, 3, 3, 2, 2, 2, 2, 2, 2],
          topReaders: [20_583, 16_442, 16_301, 14_016, 13_699, 13_665, 13_452, 12_956, 12_698, 11_627] }],
        ['Q5450940', { groupSize: 97, topEditions: [36, 20, 12, 10, 7, 7, 6, 6, 6, 6], topGuideEditions: [3, 2, 2, 1, 1, 1, 1, 1, 1, 1],
          topReaders: [232_735, 41_825, 18_831, 9_521, 7_587, 5_320, 5_293, 3_966, 3_015, 2_758] }],
      ])]]),
      seconds: 0,
    };
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q646091', entity('Q646091', 'Warnow Tunnel', 9)], ['Q5450940', entity('Q5450940', 'Finse Tunnel', 5)]]),
        facts: new Map() }
      : gathered.shares.get(k as never)));
    const { items, filtered } = await surroundingsReader(tunnels, ON).arrivals(run, sparql, gathered as never, new Set(), bored, new Set());
    expect(items.map((i) => [i.qid, i.type])).toEqual([['Q5450940', 'tunnel']]);
    expect(filtered).toEqual([{ externalId: 'Q646091', name: 'Warnow Tunnel', reason: expect.stringMatching(/^a tunnel enters the surroundings tier only while a Wikivoyage edition uses it, and none does/) }]);
  });

  it('refuses a bridge no guide uses unless a heritage designation holds, read of those bridges alone (#2324)', async () => {
    // The Luding Bridge (Q1873911), a protected historic site, and the Astoria–Megler Bridge (Q706082), a crossing:
    // neither is used by a Wikivoyage edition; the Pont des Amours (Q3397523) is.
    const bridges: SurroundingsKind<typeof trees> = { ...surroundings, verdict: () => ({ pass: true, type: 'bridge' }) };
    const around = { groupSize: 500, topEditions: [9, 9, 8, 8, 7, 7, 6, 6, 5, 5], topGuideEditions: [2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
      topReaders: [20_000, 19_000, 18_000, 17_000, 16_000, 15_000, 14_000, 13_000, 12_000, 11_000] };
    const crossings: SurroundingsPool = {
      rows: new Map([['Q1873911', row('Q1873911', TOWER, 13, 0, 23_238)], ['Q706082', row('Q706082', TOWER, 10, 0, 56_301)], ['Q3397523', row('Q3397523', TOWER, 5, 2, 9_000)]]),
      around: new Map([['all', new Map([['Q1873911', around], ['Q706082', around], ['Q3397523', around]])]]),
      seconds: 0,
    };
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q1873911', entity('Q1873911', 'Luding Bridge', 13)], ['Q706082', entity('Q706082', 'Astoria–Megler Bridge', 10)], ['Q3397523', entity('Q3397523', 'Pont des Amours', 5)]]),
        facts: new Map() }
      : gathered.shares.get(k as never)));
    standingModule.subsetStandingFacts.mockResolvedValue(new Map([['Q1873911', { heritage: true }], ['Q706082', { heritage: false }]]));
    const { items, filtered } = await surroundingsReader(bridges, ON).arrivals(run, sparql, gathered as never, new Set(), crossings, new Set());
    expect(items.map((i) => i.qid).sort()).toEqual(['Q1873911', 'Q3397523']);
    expect(filtered).toEqual([{ externalId: 'Q706082', name: 'Astoria–Megler Bridge', reason: expect.stringMatching(/^a bridge enters the surroundings tier only while a Wikivoyage edition uses it, and none does/) }]);
    // Asked of the two no guide uses, never of the one a guide does.
    expect(standingModule.subsetStandingFacts).toHaveBeenCalledWith(['Q1873911', 'Q706082']);
  });

  describe('where no Wikivoyage usage is built (ADR-0175 decision 6)', () => {
    // The Finse Tunnel (Q5450940) and the Eschbach Dam (Q896077), held by the guides alone, with the medians of their
    // admission notes on the dev catalogue (the lists schematic); Rostock's Warnow Tunnel (Q646091), never admitted,
    // clears the editions test. Without the build the pool counts no guide, the neighbours' as the candidates'.
    const FINSE = 'Q5450940';
    const ESCHBACH = 'Q896077';
    const WARNOW = 'Q646091';
    const finseAround = { groupSize: 1_089, topEditions: [36, 30, 24, 20, 17, 15, 12, 10, 9, 8], topGuideEditions: [],
      topReaders: [232_735, 120_000, 80_000, 50_000, 36_000, 30_235, 20_000, 15_000, 10_000, 9_000] };
    const eschbachAround = { groupSize: 28_467, topEditions: [60, 50, 40, 30, 25, 23, 22, 20, 18, 16], topGuideEditions: [],
      topReaders: [2_000_000, 900_000, 500_000, 300_000, 170_000, 156_714, 140_000, 120_000, 110_000, 100_000] };
    const warnowAround = { groupSize: 1_013, topEditions: [12, 12, 11, 11, 9, 9, 9, 7, 7, 6], topGuideEditions: [],
      topReaders: [20_583, 16_442, 16_301, 14_016, 13_699, 13_665, 13_452, 12_956, 12_698, 11_627] };
    const unbuilt: SurroundingsPool = {
      rows: new Map([
        [FINSE, row(FINSE, TOWER, 5, 0, 5_320)], [ESCHBACH, row(ESCHBACH, TOWER, 5, 0, 6_774)], [WARNOW, row(WARNOW, TOWER, 9, 0, 12_698)],
      ]),
      around: new Map([['all', new Map([[FINSE, finseAround], [ESCHBACH, eschbachAround], [WARNOW, warnowAround]])]]),
      seconds: 0,
      unreadGuides: 'No Wikivoyage usage is built',
    };
    // What the Bridges source last read of them: a guide used both held places.
    const memory = { bars: null, readers: new Map(), guided: new Map([[FINSE, true], [ESCHBACH, true], [WARNOW, true]]) };
    const typed: SurroundingsKind<typeof trees> = { ...surroundings, verdict: (e) => ({ pass: true, type: e.qid === ESCHBACH ? 'dam' : 'tunnel' }) };
    beforeEach(() => {
      gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
        ? { trees, pool: new Map([[FINSE, entity(FINSE, 'Finse Tunnel', 5)], [ESCHBACH, entity(ESCHBACH, 'Eschbach Dam', 5)], [WARNOW, entity(WARNOW, 'Warnow Tunnel', 9)]]),
          facts: new Map() }
        : gathered.shares.get(k as never)));
    });

    it('keeps the tunnel and the dam it holds by their guides as last read, and says in its line that it read them from memory', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { items, filtered } = await surroundingsReader(typed, ON)
        .arrivals(run, sparql, gathered as never, new Set(), unbuilt, new Set([FINSE, ESCHBACH]), memory);
      expect(items.map((i) => [i.qid, i.type])).toEqual([[FINSE, 'tunnel'], [ESCHBACH, 'dam']]);
      expect(items[0].readershipNote).toMatch(/^Kept in the surroundings tier, the guides' test unread: within 150 km, 1,089 places of its density: .*a Wikivoyage edition used this place when last read/);
      // The Warnow Tunnel enters by its editions, and is no sight while nothing the run read says a guide uses it.
      expect(filtered).toEqual([{ externalId: WARNOW, name: 'Warnow Tunnel', reason: expect.stringMatching(/^a tunnel enters the surroundings tier only when a Wikivoyage edition uses it, and no Wikivoyage usage is built/) }]);
      expect(log.mock.calls.map(([line]) => String(line)).some((line) => line.includes('no Wikivoyage usage is built, so the guides of the places it holds are as last read'))).toBe(true);
      log.mockRestore();
    });

    it('admits no new place by a guide: the Finse Tunnel, not held, is no candidate the cut passes', async () => {
      const { items, filtered } = await surroundingsReader(typed, ON)
        .arrivals(run, sparql, gathered as never, new Set([WARNOW]), unbuilt, new Set(), memory);
      expect(items).toEqual([]);
      expect(filtered).toEqual([]);
      expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
    });

    it('lets a held tunnel no guide used when last read fall with the cut\'s reason', async () => {
      const { items, filtered } = await surroundingsReader(typed, ON).arrivals(run, sparql, gathered as never, new Set([WARNOW]), unbuilt,
        new Set([FINSE]), { ...memory, guided: new Map([[FINSE, false]]) });
      expect(items).toEqual([]);
      expect(filtered).toEqual([{ externalId: FINSE, name: 'Finse Tunnel', reason: expect.stringMatching(/^below the surroundings tier's cut: .*no Wikivoyage edition used this place when last read$/) }]);
    });

    it('reads the build, not the memory, where the build is in place', async () => {
      // The same places with their guides read: the Warnow Tunnel, guided in memory, is refused by what the build reads.
      const built: SurroundingsPool = {
        rows: new Map([[FINSE, row(FINSE, TOWER, 5, 1, 5_320)], [WARNOW, row(WARNOW, TOWER, 9, 0, 12_698)]]),
        around: new Map([['all', new Map([
          [FINSE, { ...finseAround, topGuideEditions: [5, 4, 4, 3, 3, 3, 3, 2, 2, 2] }],
          [WARNOW, { ...warnowAround, topGuideEditions: [5, 4, 3, 3, 2, 2, 2, 2, 2, 2] }],
        ])]]),
        seconds: 0,
      };
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { items, filtered } = await surroundingsReader(typed, ON).arrivals(run, sparql, gathered as never, new Set(), built, new Set([FINSE]), memory);
      expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([[FINSE, expect.stringMatching(/^In the surroundings tier by the guides: /)]]);
      expect(filtered).toEqual([{ externalId: WARNOW, name: 'Warnow Tunnel', reason: expect.stringMatching(/^a tunnel enters the surroundings tier only while a Wikivoyage edition uses it, and none does/) }]);
      expect(log.mock.calls.map(([line]) => String(line)).some((line) => line.includes('as last read'))).toBe(false);
      log.mockRestore();
    });
  });

  it('reads nothing while the switch is off, and says why', async () => {
    const result = await surroundingsReader(surroundings, { ...ON, enabled: false }).arrivals(run, sparql, gathered as never, new Set(), pool, new Set());
    expect(result.items).toEqual([]);
    expect(result.skipped).toMatch(/switched off/);
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });

  it('names the neighbourhoods the cut reads: the whole pool, the kind, or one group per type the rule files', () => {
    expect(surroundingsGroups(surroundings, trees, ON)).toEqual([{ key: 'all', classes: null }]);
    expect(surroundingsGroups(surroundings, trees, { ...ON, neighbours: 'kind' })).toEqual([{ key: 'towers', classes: trees.tower }]);
    // Each class goes to the type the rule files a place of it under: the plain tower class to 'tower', the bell tower to 'bell-tower'.
    expect(surroundingsGroups(surroundings, trees, { ...ON, neighbours: 'type' })).toEqual([
      { key: 'towers:tower', classes: new Set([TOWER]) }, { key: 'towers:bell-tower', classes: new Set([BELL]) },
    ]);
    // A place of both classes is the rule's: a bell tower, never two groups.
    expect(surroundingsGroupKey(surroundings, trees, [TOWER, BELL], { ...ON, neighbours: 'type' })).toBe('towers:bell-tower');
    // A tower of no named type is measured among the plain towers, as the rule files it.
    expect(surroundingsGroupKey(surroundings, trees, [TOWER], { ...ON, neighbours: 'type' })).toBe('towers:tower');
    expect(surroundingsGroupKey(surroundings, trees, [TOWER], { ...ON, neighbours: 'kind' })).toBe('towers');
  });

  it('refuses a row it admitted before that no longer clears the cut, with the cut\'s reason', async () => {
    // Q3 (7 editions, no guide) was a surroundings-tier row; it is asked about by id for its label and refused by the cut.
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q2', entity('Q2', 'Asinelli Tower', 9)], ['Q3', entity('Q3', 'Torre Prendiparte', 7)], ['Q4', entity('Q4', 'A mast', 12)]]),
        facts: new Map([['Q2', { classes: [TOWER] }], ['Q4', { classes: ['Q5622819'] }]]) }
      : gathered.shares.get(k as never)));
    const { items, filtered } = await surroundingsReader(surroundings, ON).arrivals(run, sparql, gathered as never, new Set(['Q1']), pool, new Set(['Q3']));
    const [, requests] = gatherModule.gatherPlaces.mock.calls[0];
    expect([...requests[0].admitted].sort()).toEqual(['Q2', 'Q3', 'Q4']);
    expect(items.map((i) => i.qid)).toEqual(['Q2']);
    expect(filtered.find((f) => f.externalId === 'Q3')).toEqual({
      externalId: 'Q3', name: 'Torre Prendiparte', reason: expect.stringMatching(/^below the surroundings tier's cut: within 150 km/),
    });
  });

  it('refuses a row it held that has no surroundings any more with the cut\'s reason, not the sweep\'s', async () => {
    // Q6, a held surroundings-tier tower, now has one Wikipedia edition: the pool holds it, no surroundings were read for it.
    const thinned: SurroundingsPool = {
      ...pool,
      rows: new Map([...pool.rows, ['Q6', row('Q6', TOWER, 1, 0)]]),
    };
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q2', entity('Q2', 'Asinelli Tower', 9)], ['Q4', entity('Q4', 'A mast', 12)], ['Q6', entity('Q6', 'Torre Scappi', 1)]]),
        facts: new Map([['Q2', { classes: [TOWER] }], ['Q4', { classes: ['Q5622819'] }]]) }
      : gathered.shares.get(k as never)));
    const { filtered } = await surroundingsReader(surroundings, ON).arrivals(run, sparql, gathered as never, new Set(['Q1']), thinned, new Set(['Q6']));
    expect(filtered.find((f) => f.externalId === 'Q6')).toEqual({
      externalId: 'Q6', name: 'Torre Scappi', reason: '1 Wikipedia editions, under the 2 the surroundings tier asks for',
    });
  });

  it('measures what the kind names beside its classes, and hands its rule which survivors those are (#2171)', async () => {
    // Q9, Mount Rushmore as the pool holds it: typed a mountain, named by the kind's entrance.
    const MOUNTAIN = 'Q8502';
    const named: SurroundingsPool = {
      ...pool,
      rows: new Map([...pool.rows, ['Q9', row('Q9', MOUNTAIN, 20, 2, 30_000)]]),
      around: new Map([['all', new Map([...pool.around.get('all')!, ['Q9', around]])]]),
    };
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q2', entity('Q2', 'Asinelli Tower', 9)], ['Q9', entity('Q9', 'Mount Rushmore', 20)]]),
        facts: new Map([['Q2', { classes: [TOWER] }], ['Q9', { classes: [MOUNTAIN] }]]) }
      : gathered.shares.get(k as never)));
    const context = vi.fn(async (_survivors: readonly PoolEntity[], _share: unknown, _sparql: unknown, filed: ReadonlySet<string>) => filed);
    const byEntrance: SurroundingsKind<typeof trees, ReadonlySet<string>> = {
      ...surroundings,
      named: () => new Set(['Q9']),
      context,
      verdict: (e, _share, filed) => (filed.has(e.qid)
        ? { pass: true, type: 'tower', note: 'Named by a category.' }
        : { pass: true, type: 'tower' }),
    };
    const reader = surroundingsReader(byEntrance, ON);
    expect([...reader.named(gathered as never)]).toEqual(['Q9']);
    const { items } = await reader.arrivals(run, sparql, gathered as never, new Set(['Q1']), named, new Set());
    const [, requests] = gatherModule.gatherPlaces.mock.calls[0];
    expect([...requests[0].admitted].sort()).toEqual(['Q2', 'Q4', 'Q9']);
    expect([...context.mock.calls[0][3]]).toEqual(['Q9']);
    // The rule's note before the cut's.
    expect(items.find((i) => i.qid === 'Q9')?.readershipNote).toMatch(/^Named by a category\. In the surroundings tier by /);
    // Without the entrance, a mountain is no candidate of the kind.
    gatherModule.gatherPlaces.mockClear();
    await surroundingsReader(surroundings, ON).arrivals(run, sparql, gathered as never, new Set(['Q1']), named, new Set());
    expect([...gatherModule.gatherPlaces.mock.calls[0][1][0].admitted].sort()).toEqual(['Q2', 'Q4']);
  });

  it('puts what the kind names beside its classes in the kind\'s group, and in the type of a place of none of its classes', () => {
    const byEntrance = { ...surroundings, named: () => new Set(['Q9']) };
    const items = new Set(['Q9']);
    expect(surroundingsGroups(byEntrance, trees, { ...ON, neighbours: 'kind' }, items))
      .toEqual([{ key: 'towers', classes: trees.tower, items }]);
    expect(surroundingsGroups(byEntrance, trees, { ...ON, neighbours: 'type' }, items)).toEqual([
      { key: 'towers:tower', classes: new Set([TOWER]), items }, { key: 'towers:bell-tower', classes: new Set([BELL]) },
    ]);
  });

  it('asks nothing by id when no candidate clears the cut', async () => {
    const thin: SurroundingsPool = { ...pool, around: new Map([['all', new Map()]]) };
    const result = await surroundingsReader(surroundings, ON).arrivals(run, sparql, gathered as never, new Set(), thin, new Set());
    expect(result).toEqual({ items: [], filtered: [] });
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });
});

describe('merging the surroundings tier into the run', () => {
  const row = (qid: string) => ({ qid });
  const refusal = (qid: string, reason: string) => ({ externalId: qid, name: qid, reason });

  it('never admits and refuses the same place in one pass, and lists a refusal once', () => {
    // The world line refused Q2 ('below the line'); the surroundings tier admits it. Q4 was refused by both.
    const items = [row('Q1')];
    const filtered = [refusal('Q2', 'below the line'), refusal('Q4', 'not a tower: a mast')];
    mergeSurroundings(items, filtered, { items: [row('Q2')], filtered: [refusal('Q4', 'not a tower: a mast'), refusal('Q5', 'below the surroundings tier\'s cut')] }, (i) => i.qid);
    expect(items.map((i) => i.qid)).toEqual(['Q1', 'Q2']);
    expect(filtered.map((f) => f.externalId)).toEqual(['Q4', 'Q5']);
  });

  it('leaves a row the surroundings tier holds as it stands when the run did not read that tier (ADR-0175 decision 6)', () => {
    // Q6, a surroundings-tier tower, is refused by the world rule this run; the surroundings step was switched off.
    const filtered = [refusal('Q6', 'not a tower: a mast'), refusal('Q4', 'not a tower: a mast')];
    mergeSurroundings([row('Q1')], filtered, { items: [], filtered: [], skipped: 'switched off' }, (i) => i.qid, new Set(['Q6']));
    expect(filtered.map((f) => f.externalId)).toEqual(['Q4']);
    // Read, the same refusal stands: the tier that holds the row was asked.
    const read = [refusal('Q6', 'not a tower: a mast')];
    mergeSurroundings([row('Q1')], read, { items: [], filtered: [] }, (i) => i.qid, new Set(['Q6']));
    expect(read.map((f) => f.externalId)).toEqual(['Q6']);
  });
});

describe('a landmark of the surroundings tier', () => {
  it('carries what the kind\'s rule answered beside its type — the artwork answer and the makers — and the tier', () => {
    const row = surroundingsLandmark(entity('Q7', 'Fontana della Terrina', 4), ['Q483453'],
      { pass: true, type: 'fountain', artwork: true, creators: ['Q1'] }, 'In the surroundings tier by the guides: …');
    expect(row).toMatchObject({ qid: 'Q7', type: 'fountain', artwork: true, creators: ['Q1'], tier: 'surroundings', readershipNote: 'In the surroundings tier by the guides: …' });
  });

  it('keeps the place\'s defaults where the rule answers a type alone', () => {
    const row = surroundingsLandmark(entity('Q8', 'Torre Prendiparte', 3), [TOWER], { pass: true, type: 'tower' }, 'note');
    expect(row).toMatchObject({ artwork: false, creators: [], tier: 'surroundings' });
  });
});
