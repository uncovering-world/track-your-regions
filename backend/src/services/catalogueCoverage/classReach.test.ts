/**
 * A top's class reach is the place gather's own test over each kind's own
 * classes (#2146). These hold that the report reads the kinds the pass gathers
 * by, asks the subset for each item's classes once, names the classes of an
 * item no kind's classes reach, and reads nothing where no subset is built.
 * The classes are the subset's own for the items named: Neptune's Staircase is
 * typed only "built structure" (Q811979), the Charles Bridge an arch bridge
 * (Q158438) among others, the Trevi Fountain a sculpture (Q860861) and a
 * fountain (Q483453); the Bushwick Collective's item is not kept by the subset.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../dumps/wikidata/subsetTables.js', () => ({ latestSubset: vi.fn(), entitiesAreHeld: vi.fn() }));
vi.mock('../sync/publicArt/queries.js', async original => ({ ...(await original<object>()), fetchEntityFacts: vi.fn() }));
vi.mock('../sync/subset/entities.js', async original => ({ ...(await original<object>()), termsOf: vi.fn() }));
vi.mock('../sync/places/placePass.js', () => ({ gatheredPlaceKinds: vi.fn() }));

import { entitiesAreHeld, latestSubset } from '../dumps/wikidata/subsetTables.js';
import { emptyFacts, fetchEntityFacts, type EntityFacts } from '../sync/publicArt/queries.js';
import { termsOf } from '../sync/subset/entities.js';
import { gatheredPlaceKinds } from '../sync/places/placePass.js';
import type { PlaceKind } from '../sync/places/gather.js';
import { reachedBy, readClassReach } from './classReach.js';

const mockedLatest = latestSubset as unknown as ReturnType<typeof vi.fn>;
const mockedHeld = entitiesAreHeld as unknown as ReturnType<typeof vi.fn>;
const mockedFacts = fetchEntityFacts as unknown as ReturnType<typeof vi.fn>;
const mockedTerms = termsOf as unknown as ReturnType<typeof vi.fn>;
const mockedKinds = gatheredPlaceKinds as unknown as ReturnType<typeof vi.fn>;

const NEPTUNES_STAIRCASE = 'Q674307';
const CHARLES_BRIDGE = 'Q204871';
const TREVI_FOUNTAIN = 'Q185382';
const NOT_KEPT = 'Q120629542';

/** A kind whose trees are read once, its broad roots and its narrow classes asked as the gather asks them. */
function kind(name: string, broad: string[], narrow: string[]): PlaceKind<string[]> & { walks: number } {
  const declared = {
    name,
    walks: 0,
    trees: async () => { declared.walks += 1; return narrow; },
    poolClasses: (trees: string[]) => ({ broad: broad.map(qid => ({ qid, label: qid })), narrow: trees }),
    readsContainers: false,
  };
  return declared;
}

describe('which kinds\' classes reach an item', () => {
  const kinds = [
    { kindIds: [3, 6], classes: new Set(['Q860861', 'Q483453']) },
    { kindIds: [8], classes: new Set(['Q12280', 'Q474']) },
  ];

  it('is every kind one of whose classes the item carries itself, with the catalogue kinds it fills', () => {
    expect(reachedBy(kinds, ['Q860861', 'Q483453'])).toEqual([3, 6]);
    expect(reachedBy(kinds, ['Q474', 'Q483453'])).toEqual([3, 6, 8]);
    expect(reachedBy(kinds, ['Q811979'])).toEqual([]);
  });
});

describe('reading class reach off the subset', () => {
  const art = kind('public art and monuments', ['Q860861'], ['Q483453']);
  const bridges = kind('bridges', ['Q12280'], ['Q158438']);

  beforeEach(() => {
    vi.clearAllMocks();
    art.walks = 0;
    bridges.walks = 0;
    mockedLatest.mockResolvedValue({ dumpDate: '2026-10-01' });
    mockedHeld.mockResolvedValue(true);
    mockedKinds.mockReturnValue([{ kindIds: [3, 6], kind: art }, { kindIds: [8], kind: bridges }]);
    const classes: Record<string, string[]> = {
      [NEPTUNES_STAIRCASE]: ['Q811979'], [CHARLES_BRIDGE]: ['Q158438'], [TREVI_FOUNTAIN]: ['Q860861', 'Q483453'], [NOT_KEPT]: [],
    };
    mockedFacts.mockImplementation(async (_sparql: unknown, ids: string[]) =>
      new Map<string, EntityFacts>(ids.map(id => [id, { ...emptyFacts(), classes: classes[id] ?? [] }])));
    mockedTerms.mockResolvedValue(new Map([['Q811979', { label: 'built structure', description: null }]]));
  });

  it('names for each item the kinds whose classes reach it, and the classes it carries', async () => {
    const reach = await readClassReach([NEPTUNES_STAIRCASE, CHARLES_BRIDGE, TREVI_FOUNTAIN, CHARLES_BRIDGE]);

    expect(reach?.kinds).toEqual(new Set([3, 6, 8]));
    expect(reach?.items.get(TREVI_FOUNTAIN)?.reachedBy).toEqual([3, 6]);
    expect(reach?.items.get(CHARLES_BRIDGE)?.reachedBy).toEqual([8]);
    expect(reach?.items.get(NEPTUNES_STAIRCASE)).toEqual({ reachedBy: [], classes: [{ qid: 'Q811979', label: 'built structure' }] });
    expect([art.walks, bridges.walks]).toEqual([1, 1]);
    expect(mockedFacts).toHaveBeenCalledTimes(1);
    expect(mockedFacts.mock.calls[0][1]).toEqual([NEPTUNES_STAIRCASE, CHARLES_BRIDGE, TREVI_FOUNTAIN]);
  });

  it('says nothing of an item whose classes the subset does not hold', async () => {
    const reach = await readClassReach([NOT_KEPT]);
    expect(reach?.items.has(NOT_KEPT)).toBe(false);
  });

  it('reads nothing where no subset is built', async () => {
    mockedLatest.mockResolvedValue(null);
    expect(await readClassReach([TREVI_FOUNTAIN])).toBeNull();
    expect(mockedKinds).not.toHaveBeenCalled();
    expect(mockedFacts).not.toHaveBeenCalled();
  });
});
