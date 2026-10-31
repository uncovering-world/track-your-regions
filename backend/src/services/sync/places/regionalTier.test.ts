/**
 * The regional tier over a kind (ADR-0171, #2178): the cut first over the
 * kind's share of the pass's regional pool, the kind's rule over the survivors
 * read by id, a landmark of the regional tier with the cut's note; nothing
 * where the run read the live service and no pool could be read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const gatherModule = vi.hoisted(() => ({ gatherPlaces: vi.fn(), shareOf: vi.fn() }));
vi.mock('./gather.js', () => gatherModule);

import { mergeRegional, regionalGroupKey, regionalGroups, regionalLandmark, regionalReader, type RegionalKind } from './regionalTier.js';
import { REGIONAL_CUT } from './regionalCut.js';
import type { RegionalPool } from './regionalPool.js';
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
const regional: RegionalKind<typeof trees> = {
  kind: kind as never,
  classesOf: (t) => t.tower,
  typesOf: (t) => new Map(Object.entries(t.types)),
  verdict: (e, share) => ((share.facts.get(e.qid)?.classes ?? []).includes(TOWER)
    ? { pass: true, type: 'tower' } : { pass: false, reason: 'not a tower: a mast' }),
  logPrefix: '[test]',
};
const run = { sparql: vi.fn(), phase: vi.fn(), step: vi.fn() };
const sparql = vi.fn();
const gathered = { shares: new Map([[kind, { trees }]]), pooled: 0 };
const around = { groupSize: 30, topEditions: [40, 30, 28, 26, 25, 22, 20, 18, 16, 15], topGuideEditions: [3, 2, 2, 1, 1] };
// The pass's pool: four towers and a church; the church is another kind's candidate and sets the references with the rest.
const row = (qid: string, cls: string, editions: number, guideEditions: number) => ({ qid, editions, guideEditions, classes: [cls], lat: 44.49, lon: 11.35 });
const pool: RegionalPool = {
  rows: new Map([
    ['Q1', row('Q1', TOWER, 40, 3)], ['Q2', row('Q2', TOWER, 9, 1)], ['Q3', row('Q3', TOWER, 7, 0)],
    ['Q4', row('Q4', TOWER, 12, 2)], ['Q5', row('Q5', CHURCH, 30, 2)],
  ]),
  around: new Map([['all', new Map([['Q1', around], ['Q2', around], ['Q3', around], ['Q4', around], ['Q5', around]])]]),
  seconds: 1,
};
const ON = { ...REGIONAL_CUT, enabled: true };

describe('the regional tier over a kind', () => {
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
    const reader = regionalReader(regional, ON);
    expect([...reader.classes(gathered as never)]).toEqual([TOWER, BELL]);
    const { items, filtered, skipped } = await reader.arrivals(run, sparql, gathered as never, new Set(['Q1']), pool, new Set());
    expect(skipped).toBeUndefined();
    // The world tier's row was never a candidate; the church is not of this kind; Q3 (7 editions, no guide) is under the cut.
    const [, requests] = gatherModule.gatherPlaces.mock.calls[0];
    expect([...requests[0].admitted]).toEqual(['Q2', 'Q4']);
    expect(requests[0].kind.poolClasses()).toEqual({ broad: [], narrow: [] });
    expect(items.map((i) => [i.qid, i.tier, i.type])).toEqual([['Q2', 'regional', 'tower']]);
    expect(items[0].readershipNote).toMatch(/^In the regional tier by the guides: within 50 km, 30 places/);
    expect(filtered).toEqual([{ externalId: 'Q4', name: 'A mast', reason: 'not a tower: a mast' }]);
  });

  it('reads nothing where the run read the live service and no pool could be read, and says why', async () => {
    const result = await regionalReader(regional, ON).arrivals(run, sparql, gathered as never, new Set(), null, new Set());
    expect(result.items).toEqual([]);
    expect(result.skipped).toMatch(/local subset alone/);
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });

  it('reads nothing while the switch is off, and says why', async () => {
    const result = await regionalReader(regional).arrivals(run, sparql, gathered as never, new Set(), pool, new Set());
    expect(result.items).toEqual([]);
    expect(result.skipped).toMatch(/switched off/);
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });

  it('names the neighbourhoods the cut reads: the whole pool, the kind, or one group per type', () => {
    expect(regionalGroups(regional, trees, ON)).toEqual([{ key: 'all', classes: null }]);
    expect(regionalGroups(regional, trees, { ...ON, neighbours: 'kind' })).toEqual([{ key: 'towers', classes: trees.tower }]);
    expect(regionalGroups(regional, trees, { ...ON, neighbours: 'type' })).toEqual([{ key: 'towers:bell-tower', classes: trees.types['bell-tower'] }]);
    expect(regionalGroupKey(regional, trees, [BELL], { ...ON, neighbours: 'type' })).toBe('towers:bell-tower');
    // A tower of no type is measured among nobody when types decide.
    expect(regionalGroupKey(regional, trees, [TOWER], { ...ON, neighbours: 'type' })).toBeNull();
    expect(regionalGroupKey(regional, trees, [TOWER], { ...ON, neighbours: 'kind' })).toBe('towers');
  });

  it('refuses a row it admitted before that no longer clears the cut, with the cut\'s reason', async () => {
    // Q3 (7 editions, no guide) was a regional row; it is asked about by id for its label and refused by the cut.
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q2', entity('Q2', 'Asinelli Tower', 9)], ['Q3', entity('Q3', 'Torre Prendiparte', 7)], ['Q4', entity('Q4', 'A mast', 12)]]),
        facts: new Map([['Q2', { classes: [TOWER] }], ['Q4', { classes: ['Q5622819'] }]]) }
      : gathered.shares.get(k as never)));
    const { items, filtered } = await regionalReader(regional, ON).arrivals(run, sparql, gathered as never, new Set(['Q1']), pool, new Set(['Q3']));
    const [, requests] = gatherModule.gatherPlaces.mock.calls[0];
    expect([...requests[0].admitted].sort()).toEqual(['Q2', 'Q3', 'Q4']);
    expect(items.map((i) => i.qid)).toEqual(['Q2']);
    expect(filtered.find((f) => f.externalId === 'Q3')).toEqual({
      externalId: 'Q3', name: 'Torre Prendiparte', reason: expect.stringMatching(/^below the regional tier's cut: within 50 km/),
    });
  });

  it('refuses a row it held that has no surroundings any more with the cut\'s reason, not the sweep\'s', async () => {
    // Q6, a held regional tower, now has one Wikipedia edition: the pool holds it, no surroundings were read for it.
    const thinned: RegionalPool = {
      ...pool,
      rows: new Map([...pool.rows, ['Q6', row('Q6', TOWER, 1, 0)]]),
    };
    gatherModule.shareOf.mockImplementation((g: unknown, k: { name?: string }) => (g === 'gathered-by-id'
      ? { trees, pool: new Map([['Q2', entity('Q2', 'Asinelli Tower', 9)], ['Q4', entity('Q4', 'A mast', 12)], ['Q6', entity('Q6', 'Torre Scappi', 1)]]),
        facts: new Map([['Q2', { classes: [TOWER] }], ['Q4', { classes: ['Q5622819'] }]]) }
      : gathered.shares.get(k as never)));
    const { filtered } = await regionalReader(regional, ON).arrivals(run, sparql, gathered as never, new Set(['Q1']), thinned, new Set(['Q6']));
    expect(filtered.find((f) => f.externalId === 'Q6')).toEqual({
      externalId: 'Q6', name: 'Torre Scappi', reason: '1 Wikipedia editions, under the 2 the regional tier asks for',
    });
  });

  it('asks nothing by id when no candidate clears the cut', async () => {
    const thin: RegionalPool = { ...pool, around: new Map([['all', new Map()]]) };
    const result = await regionalReader(regional, ON).arrivals(run, sparql, gathered as never, new Set(), thin, new Set());
    expect(result).toEqual({ items: [], filtered: [] });
    expect(gatherModule.gatherPlaces).not.toHaveBeenCalled();
  });
});

describe('merging the regional tier into the run', () => {
  const row = (qid: string) => ({ qid });
  const refusal = (qid: string, reason: string) => ({ externalId: qid, name: qid, reason });

  it('never admits and refuses the same place in one pass, and lists a refusal once', () => {
    // The world line refused Q2 ('below the line'); the regional tier admits it. Q4 was refused by both.
    const items = [row('Q1')];
    const filtered = [refusal('Q2', 'below the line'), refusal('Q4', 'not a tower: a mast')];
    mergeRegional(items, filtered, { items: [row('Q2')], filtered: [refusal('Q4', 'not a tower: a mast'), refusal('Q5', 'below the regional tier\'s cut')] }, (i) => i.qid);
    expect(items.map((i) => i.qid)).toEqual(['Q1', 'Q2']);
    expect(filtered.map((f) => f.externalId)).toEqual(['Q4', 'Q5']);
  });
});

describe('a landmark of the regional tier', () => {
  it('carries what the kind\'s rule answered beside its type — the artwork answer and the makers — and the tier', () => {
    const row = regionalLandmark(entity('Q7', 'Fontana della Terrina', 4), ['Q483453'],
      { pass: true, type: 'fountain', artwork: true, creators: ['Q1'] }, 'In the regional tier by the guides: …');
    expect(row).toMatchObject({ qid: 'Q7', type: 'fountain', artwork: true, creators: ['Q1'], tier: 'regional', readershipNote: 'In the regional tier by the guides: …' });
  });

  it('keeps the place\'s defaults where the rule answers a type alone', () => {
    const row = regionalLandmark(entity('Q8', 'Torre Prendiparte', 3), [TOWER], { pass: true, type: 'tower' }, 'note');
    expect(row).toMatchObject({ artwork: false, creators: [], tier: 'regional' });
  });
});
