/**
 * One gather for every place kind (#1820): each kind's share is exactly the
 * candidates its own classes name and the rows it admits, every question is
 * asked once however many kinds need it, and only a kind that reads
 * containers has them asked.
 *
 * The Wikidata questions are mocked: their own spec is `publicArt/queries.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../publicArt/queries.js', () => ({
  fetchAdmissionPool: vi.fn(async () => []),
  fetchBroadPool: vi.fn(),
  fetchClassPool: vi.fn(),
  fetchEntitiesByIds: vi.fn(),
  fetchEntityFacts: vi.fn(),
  fetchContainerFacts: vi.fn(),
}));

vi.mock('../subset/reader.js', () => ({ readsSubset: vi.fn(() => false) }));

import { readsSubset } from '../subset/reader.js';
import {
  fetchAdmissionPool,
  fetchBroadPool,
  fetchClassPool,
  fetchContainerFacts,
  fetchEntitiesByIds,
  fetchEntityFacts,
  type EntityFacts,
  type PoolEntity,
} from '../publicArt/queries.js';
import { gatherPlaces, shareOf, type PlaceKind } from './gather.js';

const STATUE = 'Q179700';
const CHURCH = 'Q16970';
const BELL_TOWER = 'Q200334';
const MONUMENT = 'Q4989906';

function entity(qid: string, sitelinks = 30): PoolEntity {
  return {
    qid, label: qid, description: null, lat: 1, lon: 1, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  };
}

function facts(classes: string[], locations: string[] = []): EntityFacts {
  return { classes, locations, parents: [], collections: [], creators: [], commemorates: [], depicts: [], genres: [] } as EntityFacts;
}

/** Public art: statues in bands, monuments whole, and what holds a candidate. */
const ART: PlaceKind<{ admitting: string[] }> = {
  name: 'public art',
  trees: vi.fn(async () => ({ admitting: [STATUE, MONUMENT] })),
  poolClasses: (trees) => ({ broad: [{ qid: STATUE, label: 'statue' }], narrow: trees.admitting }),
  readsContainers: true,
};

/** Places of worship: churches in bands, bell towers whole, no containers. */
const WORSHIP: PlaceKind<{ worship: string[] }> = {
  name: 'places of worship',
  trees: vi.fn(async () => ({ worship: [CHURCH, BELL_TOWER] })),
  poolClasses: (trees) => ({ broad: [{ qid: CHURCH, label: 'church' }, { qid: STATUE, label: 'statue' }], narrow: trees.worship }),
  readsContainers: false,
};

const KNOWN: Record<string, EntityFacts> = {
  // The Bronze Horseman, a statue standing on Senate Square.
  Q1: facts([STATUE], ['Q100']),
  // Notre-Dame, a church.
  Q2: facts([CHURCH]),
  // A church with a monument class too: a candidate of both.
  Q3: facts([CHURCH, MONUMENT]),
  // A bell tower only worship asks about.
  Q4: facts([BELL_TOWER]),
  // A row public art admits that the pool no longer names.
  Q5: facts(['Q5']),
};

const run = { sparql: vi.fn(), phase: vi.fn(), step: vi.fn(async () => undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchBroadPool).mockImplementation(async (_run, root) => (
    root.qid === STATUE ? [entity('Q1')] : [entity('Q2'), entity('Q3')]
  ));
  vi.mocked(fetchClassPool).mockImplementation(async (_door, classes) => (
    classes.includes(BELL_TOWER) ? [entity('Q4')] : []
  ));
  vi.mocked(fetchEntitiesByIds).mockImplementation(async (_door, qids) => qids.map((qid) => entity(qid, 3)));
  vi.mocked(fetchEntityFacts).mockImplementation(async (_sparql, qids) => (
    new Map(qids.filter((qid) => KNOWN[qid]).map((qid) => [qid, KNOWN[qid]]))
  ));
  vi.mocked(fetchContainerFacts).mockImplementation(async (_sparql, qids) => (
    new Map(qids.map((qid) => [qid, { label: 'Senate Square', classes: ['Q174782'], parents: [] }]))
  ));
});

async function gatherBoth() {
  return gatherPlaces(run, [
    { kind: ART as PlaceKind<unknown>, admitted: new Set(['Q5']) },
    { kind: WORSHIP as PlaceKind<unknown>, admitted: new Set() },
  ]);
}

describe('gatherPlaces', () => {
  it('hands each kind the candidates its own classes name, and the rows it admits', async () => {
    const gathered = await gatherBoth();

    expect([...shareOf(gathered, ART).pool.keys()].sort()).toEqual(['Q1', 'Q3', 'Q5']);
    expect([...shareOf(gathered, WORSHIP).pool.keys()].sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(shareOf(gathered, ART).trees).toEqual({ admitting: [STATUE, MONUMENT] });
    // The admitted row no class question named is marked as asked for by id.
    expect(shareOf(gathered, ART).byId).toEqual(new Set(['Q5']));
    expect(shareOf(gathered, WORSHIP).byId.size).toBe(0);
    expect(gathered.pooled).toBe(4);
  });

  it('asks every question once, however many kinds need it', async () => {
    await gatherBoth();

    // The statue root both kinds ask by, in bands once; the church root once.
    expect(vi.mocked(fetchBroadPool).mock.calls.map(([, root]) => root.qid)).toEqual([STATUE, CHURCH]);
    // Every narrow class once, and no broad root again among them.
    expect(vi.mocked(fetchClassPool).mock.calls.flatMap(([, classes]) => classes).sort()).toEqual([BELL_TOWER, MONUMENT].sort());
    // The admitted row the pool did not name, by id, and the facts of every entity once.
    expect(vi.mocked(fetchEntitiesByIds).mock.calls.map(([, qids]) => qids)).toEqual([['Q5']]);
    expect(vi.mocked(fetchEntityFacts).mock.calls.flatMap(([, qids]) => qids).sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
  });

  it('asks about containers only for the candidates of a kind that reads them', async () => {
    const gathered = await gatherBoth();

    expect(vi.mocked(fetchContainerFacts).mock.calls.flatMap(([, qids]) => qids)).toEqual(['Q100']);
    expect(shareOf(gathered, ART).containers.nodes.get('Q100')?.label).toBe('Senate Square');
    expect(shareOf(gathered, WORSHIP).containers.nodes.size).toBe(0);
  });

  it('marks a row a kind admits as asked for by id when none of its classes names it, whoever fetched it', async () => {
    // Notre-Dame, which worship's church root names, admitted by public art.
    const gathered = await gatherPlaces(run, [
      { kind: ART as PlaceKind<unknown>, admitted: new Set(['Q2']) },
      { kind: WORSHIP as PlaceKind<unknown>, admitted: new Set() },
    ]);

    expect(shareOf(gathered, ART).pool.has('Q2')).toBe(true);
    expect(shareOf(gathered, ART).byId).toEqual(new Set(['Q2']));
    expect(shareOf(gathered, WORSHIP).byId.size).toBe(0);
  });

  it('keeps a row a kind does not admit, and its classes do not name, out of that kind', async () => {
    const gathered = await gatherPlaces(run, [
      { kind: ART as PlaceKind<unknown>, admitted: new Set() },
      { kind: WORSHIP as PlaceKind<unknown>, admitted: new Set(['Q5']) },
    ]);

    expect(shareOf(gathered, ART).pool.has('Q5')).toBe(false);
    expect(shareOf(gathered, WORSHIP).pool.has('Q5')).toBe(true);
  });

  // A kind of a canal's works, which admits by the world bars (ADR-0175); public art names locks too.
  const LOCK = 'Q105731';
  const WORKS: PlaceKind<{ locks: string[] }> = {
    name: 'engineering works',
    trees: vi.fn(async () => ({ locks: [LOCK] })),
    poolClasses: (trees) => ({ broad: [], narrow: trees.locks }),
    readsContainers: false,
    admissionPool: true,
  };
  const LOCKY_ART: PlaceKind<{ admitting: string[] }> = { ...ART, trees: vi.fn(async () => ({ admitting: [STATUE, LOCK] })) };

  it('reads a kind\'s admission pool from the subset at the register\'s floor, for that kind alone (ADR-0175)', async () => {
    vi.mocked(readsSubset).mockReturnValue(true);
    KNOWN.Q6 = facts([LOCK]);
    // The Caen Hill flight's shape: 3 Wikipedia editions, far under the shared pool's floor.
    vi.mocked(fetchAdmissionPool).mockResolvedValueOnce([entity('Q6', 3)]);

    const gathered = await gatherPlaces(run, [
      { kind: WORKS as PlaceKind<unknown>, admitted: new Set() },
      { kind: LOCKY_ART as PlaceKind<unknown>, admitted: new Set() },
    ]);
    delete KNOWN.Q6;
    vi.mocked(readsSubset).mockReturnValue(false);

    expect(vi.mocked(fetchAdmissionPool).mock.calls.map(([, classes, floor]) => [classes, floor])).toEqual([[[LOCK], 3]]);
    expect(shareOf(gathered, WORKS).pool.has('Q6')).toBe(true);
    expect(shareOf(gathered, WORKS).facts.get('Q6')?.classes).toEqual([LOCK]);
    expect(shareOf(gathered, WORKS).admissionPool).toEqual(new Set(['Q6']));
    // The other kind meets no candidate under the shared floor, though its classes name it, and reads no bars.
    expect(shareOf(gathered, LOCKY_ART).pool.has('Q6')).toBe(false);
    expect(shareOf(gathered, LOCKY_ART).admissionPool).toBeNull();
  });

  it('counts a held row the admission pool names as the pool\'s, not as one asked for by id', async () => {
    vi.mocked(readsSubset).mockReturnValue(true);
    KNOWN.Q6 = facts([LOCK]);
    // Held under the shared floor, so asked for by id; the admission pool names it by its class too.
    vi.mocked(fetchAdmissionPool).mockResolvedValueOnce([entity('Q6', 3)]);
    const gathered = await gatherPlaces(run, [{ kind: WORKS as PlaceKind<unknown>, admitted: new Set(['Q6']) }]);
    delete KNOWN.Q6;
    vi.mocked(readsSubset).mockReturnValue(false);
    expect(fetchEntitiesByIds).toHaveBeenCalled();
    expect(shareOf(gathered, WORKS).pool.has('Q6')).toBe(true);
    expect(shareOf(gathered, WORKS).byId.has('Q6')).toBe(false);
    expect(shareOf(gathered, WORKS).admissionPool?.has('Q6')).toBe(true);
  });

  it('reads no admission pool on the live service, and the share says so', async () => {
    const gathered = await gatherPlaces(run, [{ kind: WORKS as PlaceKind<unknown>, admitted: new Set() }]);
    expect(fetchAdmissionPool).not.toHaveBeenCalled();
    expect(shareOf(gathered, WORKS).admissionPool).toBeNull();
  });

  it('refuses to hand a share of a kind it was not asked for', async () => {
    const gathered = await gatherPlaces(run, [{ kind: ART as PlaceKind<unknown>, admitted: new Set() }]);
    expect(() => shareOf(gathered, WORSHIP)).toThrow(/not asked for places of worship/);
  });
});
