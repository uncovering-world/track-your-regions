import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const query = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import {
  keepPlaces, keepPool, passKeys, placesOf, poolKey, poolOf, readKeptPlaces, readKeptPool, type PassKeep, type PassKeys,
} from './keptGather.js';
import type { GatheredPlaces, GatherRequest, KindShare, KindTrees, PlaceKind } from './gather.js';
import type { SurroundingsPool } from './surroundingsPool.js';
import { SURROUNDINGS_CUT } from './surroundingsCut.js';
import { writeSliced } from './slicedV8.js';

/** A kind's trees here: the classes it asks by, and a tree only its rule reads. */
interface Trees { place: string[]; rule: string[] }
const kind = (name: string, more: Partial<PlaceKind<Trees>> = {}) => ({
  name,
  trees: async () => ({ place: [], rule: [] }),
  poolClasses: (trees: Trees) => ({ broad: [], narrow: trees.place }),
  readsContainers: false,
  ...more,
}) as PlaceKind<unknown>;
const TOWERS = kind('towers');
const SQUARES = kind('squares and streets');

/** The trees a run walked: a tower's classes and the tree a rule refuses the destroyed by. */
const walked = (towers: Partial<Trees> = {}, squares: Partial<Trees> = {}): KindTrees => new Map([
  [TOWERS, { place: ['Q12518'], rule: ['Q19860854'], ...towers }],
  [SQUARES, { place: ['Q174782'], rule: [], ...squares }],
]);

function share(qids: string[]): KindShare<unknown> {
  return {
    trees: { place: ['Q12518'], rule: ['Q19860854'] },
    pool: new Map(qids.map((qid) => [qid, { qid } as never])),
    byId: new Set<string>(),
    facts: new Map(),
    containers: { holders: new Map(), owners: new Map() } as never,
    subjects: new Map(),
    entered: new Map(),
    enteredBy: new Map(),
  } as unknown as KindShare<unknown>;
}

function gathered(): GatheredPlaces {
  return {
    shares: new Map([[TOWERS, share(['Q41225'])], [SQUARES, share(['Q770631', 'Q463400'])]]),
    pooled: 3,
    classes: new Set(['Q12518', 'Q174782']),
  };
}

const requests = (admitted: string[] = []): GatherRequest[] => [
  { kind: TOWERS, admitted: new Set(admitted) },
  { kind: SQUARES, admitted: new Set<string>() },
];

describe('the keys the kept steps of the place pass are read again by (#2424, #2448)', () => {
  let code: string;
  const codeOf = () => ({ places: [pathToFileURL(join(code, 'gather.js'))], pool: [pathToFileURL(join(code, 'pool.js'))] });
  const keysOf = async (asked: GatherRequest[] = requests(), trees: KindTrees = walked()): Promise<PassKeys> => {
    const keys = await passKeys(asked, trees, codeOf());
    if (!keys) throw new Error('no key');
    return keys;
  };
  const gatherHash = async (asked: GatherRequest[] = requests(), trees: KindTrees = walked()) => (await keysOf(asked, trees)).places.hash;
  /** The requests with the towers asked as `towers`. */
  const asking = (towers: PlaceKind<unknown>): GatherRequest[] => [{ kind: towers, admitted: new Set() }, requests()[1]];
  const withTowers = (towers: PlaceKind<unknown>): KindTrees => new Map([[towers, walked().get(TOWERS)], [SQUARES, walked().get(SQUARES)]]);

  beforeEach(async () => {
    code = await mkdtemp(join(tmpdir(), 'kept-code-'));
    await writeFile(join(code, 'gather.ts'), 'export const asked = 1;\n');
    await writeFile(join(code, 'pool.ts'), 'export const cut = 1;\n');
    query.mockResolvedValue({ rows: [{ builds: '71', newest: 1204 }] });
  });
  afterEach(() => rm(code, { recursive: true, force: true }));

  it('are the same over the same builds, admitted rows, question and code, whatever order the rows were read in', async () => {
    const first = await keysOf(requests(['Q41225', 'Q243']));
    const second = await keysOf(requests(['Q243', 'Q41225']));
    expect(second).toEqual(first);
    expect(first.places.builds).toBe('71 builds, the newest #1204');
  });

  it('change once another build has succeeded, a kind admits another row, or the gather\'s code changes', async () => {
    const before = await gatherHash();
    query.mockResolvedValueOnce({ rows: [{ builds: '72', newest: 1205 }] });
    expect(await gatherHash()).not.toBe(before);
    expect(await gatherHash(requests(['Q41225']))).not.toBe(before);
    await writeFile(join(code, 'gather.ts'), 'export const asked = 2;\n');
    expect(await gatherHash()).not.toBe(before);
  });

  it('keep the gather across a tree only a kind\'s rule reads: a refusal or an exception reads its tree afresh', async () => {
    const before = await gatherHash();
    // Towers come to refuse the unbuilt too: a tree the rule reads, not one the gather asks by.
    expect(await gatherHash(requests(), walked({ rule: ['Q19860854', 'Q811683'] }))).toBe(before);
  });

  it('make the gather again when a kind asks by another class, root, floor or entrance, or by editions', async () => {
    const before = await gatherHash();
    // The tower tree reaches the bell towers: one class more to ask by.
    expect(await gatherHash(requests(), walked({ place: ['Q12518', 'Q200334'] }))).not.toBe(before);
    const changed = [
      kind('towers', { poolClasses: (trees: Trees) => ({ broad: [{ qid: 'Q12518', label: 'tower' }], narrow: trees.place }) }),
      kind('towers', { admissionPool: 3 }),
      kind('towers', { readsContainers: true }),
      kind('towers', { readsSubjects: true }),
      kind('towers', { entrances: { 'English Wikipedia\'s towers categories': async () => [] } }),
      kind('towers', { editions: { enter: async () => [], attach: async () => undefined } }),
    ];
    for (const towers of changed) expect(await gatherHash(asking(towers), withTowers(towers))).not.toBe(before);
    // A floor that moves is another question.
    const atThree = kind('towers', { admissionPool: 3 });
    const atFive = kind('towers', { admissionPool: 5 });
    expect(await gatherHash(asking(atFive), withTowers(atFive))).not.toBe(await gatherHash(asking(atThree), withTowers(atThree)));
  });

  it('give the pool its own code: a change to it makes the pool again and keeps the gather', async () => {
    const before = await keysOf();
    await writeFile(join(code, 'pool.ts'), 'export const cut = 2;\n');
    const after = await keysOf();
    expect(after.places).toEqual(before.places);
    expect(after.poolCode).not.toBe(before.poolCode);
    const members = { classes: new Set(['Q12518']) };
    const groups = [{ key: 'all', classes: null }];
    expect(poolKey(after, members, SURROUNDINGS_CUT, groups).hash).not.toBe(poolKey(before, members, SURROUNDINGS_CUT, groups).hash);
  });

  it('make the pool again when the gather is made again', async () => {
    const before = await keysOf();
    const after = await keysOf(requests(['Q41225']));
    const members = { classes: new Set(['Q12518']) };
    const groups = [{ key: 'all', classes: null }];
    expect(after.poolCode).toBe(before.poolCode);
    expect(poolKey(after, members, SURROUNDINGS_CUT, groups).hash).not.toBe(poolKey(before, members, SURROUNDINGS_CUT, groups).hash);
  });

  it('give the pool a key that changes with what the pool is asked for', async () => {
    const keys = await keysOf();
    const members = { classes: new Set(['Q12518']), items: new Set(['Q243']) };
    const groups = [{ key: 'towers', classes: new Set(['Q12518']) }];
    const base = poolKey(keys, members, SURROUNDINGS_CUT, groups).hash;
    expect(base).not.toBe(keys.places.hash);
    expect(poolKey(keys, { classes: new Set(['Q12518']), items: new Set(['Q243']) }, SURROUNDINGS_CUT, groups).hash).toBe(base);
    expect(poolKey(keys, members, { ...SURROUNDINGS_CUT, radiusKm: SURROUNDINGS_CUT.radiusKm + 1 }, groups).hash).not.toBe(base);
    expect(poolKey(keys, members, SURROUNDINGS_CUT, [{ key: 'squares', classes: new Set(['Q174782']) }]).hash).not.toBe(base);
    // The venue classes are data the pool is asked for; the line test is the readers' code, which the pool's code holds.
    const venues = { ...members, venues: new Set(['Q174782']) };
    expect(poolKey(keys, venues, SURROUNDINGS_CUT, groups).hash).not.toBe(base);
    expect(poolKey(keys, { ...venues, venueLine: () => true }, SURROUNDINGS_CUT, groups).hash).toBe(poolKey(keys, venues, SURROUNDINGS_CUT, groups).hash);
  });

  it('are no keys where either step\'s code cannot be read, so the run keeps and reads nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(code, 'pool.ts'), "export { gone } from './gone.js';\n");
    expect(await passKeys(requests(), walked(), codeOf())).toBeNull();
    await writeFile(join(code, 'pool.ts'), 'export const cut = 1;\n');
    await writeFile(join(code, 'gather.ts'), "export { gone } from './gone.js';\n");
    expect(await passKeys(requests(), walked(), codeOf())).toBeNull();
  });
});

describe('a kept step of the place pass (#2424)', () => {
  let dumps: string;
  const key = (hash: string) => ({ hash, builds: '71 builds, the newest #1204' });

  beforeEach(async () => {
    dumps = await mkdtemp(join(tmpdir(), 'kept-dumps-'));
    vi.stubEnv('DUMPS_DIR', dumps);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dumps, { recursive: true, force: true });
  });

  it('gives each kind its share back by name, under the key it was kept by and no other', async () => {
    await keepPlaces(key('a'), gathered());
    const kept = await readKeptPlaces(key('a'), requests(), walked());
    expect(kept?.value.pooled).toBe(3);
    expect([...(kept?.value.shares.get(SQUARES)?.pool.keys() ?? [])]).toEqual(['Q770631', 'Q463400']);
    expect(kept?.value.shares.get(TOWERS)?.pool.has('Q41225')).toBe(true);
    expect(kept?.keptAt).toBeInstanceOf(Date);
    expect(await readKeptPlaces(key('b'), requests(), walked())).toBeNull();
  });

  it('is not read for a kind it holds no share of', async () => {
    await keepPlaces(key('a'), gathered());
    expect(await readKeptPlaces(key('a'), [...requests(), { kind: kind('parks'), admitted: new Set() }], walked())).toBeNull();
  });

  it('replaces the older step of its kind when a newer is kept, and leaves the other step', async () => {
    const pool = { rows: new Map([['Q41225', { qid: 'Q41225' }]]), around: new Map(), seconds: 1 } as unknown as SurroundingsPool;
    await keepPool(key('a'), pool);
    await keepPlaces(key('a'), gathered());
    await keepPlaces(key('b'), gathered());
    expect((await readdir(join(dumps, 'kept-gather'))).sort()).toEqual(['places-b.v8', 'pool-a.v8']);
    expect((await readKeptPool(key('a')))?.value.rows.has('Q41225')).toBe(true);
  });

  it('keeps no pool that was not read', async () => {
    await keepPool(key('a'), { rows: new Map(), around: new Map(), seconds: 0, unread: 'no year of readers' });
    expect(await readKeptPool(key('a'))).toBeNull();
  });

  it('is neither kept nor read where the deployment names no dumps directory', async () => {
    vi.stubEnv('DUMPS_DIR', '');
    await keepPlaces(key('a'), gathered());
    expect(await readKeptPlaces(key('a'), requests(), walked())).toBeNull();
    expect(await readdir(dumps)).toEqual([]);
  });

  it('is made again, not read, when its file cannot be read', async () => {
    await keepPlaces(key('a'), gathered());
    await writeFile(join(dumps, 'kept-gather', 'places-a.v8'), 'not a serialized value');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await readKeptPlaces(key('a'), requests(), walked())).toBeNull();
  });
});

describe('the place pass reads a kept step back only in a dry run (#2424)', () => {
  let dumps: string;
  const keys: PassKeys = { places: { hash: 'a', builds: '71 builds, the newest #1204' }, poolCode: 'p' };
  const key = keys.places;
  const run = { sparql: vi.fn(), live: vi.fn(), cancelled: () => false, phase: vi.fn(), step: vi.fn() } as never;
  const members = { classes: new Set(['Q12518']) };
  const groups = [{ key: 'all', classes: null }];
  const madePool = { rows: new Map([['Q243', { qid: 'Q243' }]]), around: new Map(), seconds: 900 } as unknown as SurroundingsPool;
  const keep = (read: boolean, withKey = true): PassKeep => ({ key: withKey ? keys : null, read, note: {} });

  beforeEach(async () => {
    dumps = await mkdtemp(join(tmpdir(), 'kept-pass-'));
    vi.stubEnv('DUMPS_DIR', dumps);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dumps, { recursive: true, force: true });
  });

  it('makes the steps in a real run and keeps them, reading nothing back', async () => {
    await keepPlaces(key, gathered());
    const gather = vi.fn(async () => gathered());
    const real = keep(false);
    await placesOf(real, requests(), walked(), run, gather);
    expect(gather).toHaveBeenCalledOnce();
    const read = vi.fn(async () => madePool);
    await poolOf(real, members, SURROUNDINGS_CUT, groups, run, read);
    expect(read).toHaveBeenCalledOnce();
    expect(real.note).toEqual({});
    expect((await readKeptPool(poolKey(keys, members, SURROUNDINGS_CUT, groups)))?.value.rows.has('Q243')).toBe(true);
  });

  it('keeps the venues read around the places with the pool (ADR-0192)', async () => {
    const venues = {
      counts: new Map([['Q174782', 31]]), around: new Map([['Q2353', { venues: 31, median: 12 }]]),
      along: new Map([['Q2353', { metres: 420, venues: 18, artery: false }]]), arteries: new Set(['Q99']),
    };
    await keepPool(key, { ...madePool, venues } as unknown as SurroundingsPool);
    const kept = (await readKeptPool(key))?.value.venues;
    expect(kept).toEqual(venues);
  });

  it('reads them back in a dry run on the same key, and says when they were kept', async () => {
    await keepPlaces(key, gathered());
    await keepPool(poolKey(keys, members, SURROUNDINGS_CUT, groups), madePool);
    const dry = keep(true);
    const gather = vi.fn(async () => gathered());
    const read = vi.fn(async () => madePool);
    expect((await placesOf(dry, requests(), walked(), run, gather)).pooled).toBe(3);
    expect((await poolOf(dry, members, SURROUNDINGS_CUT, groups, run, read)).rows.has('Q243')).toBe(true);
    expect(gather).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(dry.note).toEqual({ places: expect.any(Date), pool: expect.any(Date), builds: key.builds });
  });

  it('keeps no trees, and hands each kind the trees this run walked, kept gather or made (#2448)', async () => {
    const gather = vi.fn(async () => gathered());
    const now = walked({ rule: ['Q19860854', 'Q811683'] });
    await placesOf(keep(false), requests(), now, run, gather);
    expect(gather).toHaveBeenCalledWith(run, requests(), now);
    const read = await placesOf(keep(true), requests(), now, run, gather);
    expect(gather).toHaveBeenCalledOnce();
    // The tree the rule now reads is the one walked this run, though the gather was kept before it.
    expect(read.shares.get(TOWERS)?.trees).toEqual({ place: ['Q12518'], rule: ['Q19860854', 'Q811683'] });
  });

  it('makes the pool in a dry run whose pool is asked for something else, though the gather of places was read', async () => {
    await keepPool(poolKey(keys, members, SURROUNDINGS_CUT, groups), madePool);
    const read = vi.fn(async () => madePool);
    await poolOf(keep(true), { classes: new Set(['Q174782']) }, SURROUNDINGS_CUT, groups, run, read);
    expect(read).toHaveBeenCalledOnce();
  });

  it('neither reads nor keeps where the run has no key: a run on the live service', async () => {
    const gather = vi.fn(async () => gathered());
    await placesOf(keep(true, false), requests(), walked(), run, gather);
    expect(gather).toHaveBeenCalledOnce();
    expect(await readdir(dumps)).toEqual([]);
  });
});

describe('a kept file that is not what its name says (#2424)', () => {
  let dumps: string;
  const key = { hash: 'a', builds: '71 builds, the newest #1204' };
  beforeEach(async () => {
    dumps = await mkdtemp(join(tmpdir(), 'kept-shape-'));
    vi.stubEnv('DUMPS_DIR', dumps);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dumps, { recursive: true, force: true });
  });

  it('is made again, not read, when a gather of places holds no shares by kind name', async () => {
    await mkdir(join(dumps, 'kept-gather'));
    await writeSliced(join(dumps, 'kept-gather', 'places-a.v8'), { keptAt: '2026-11-11T05:02:00.000Z', value: { shares: 5, pooled: 3, classes: new Set() } });
    expect(await readKeptPlaces(key, requests(), walked())).toBeNull();
  });

  it('is made again, not read, when a pool holds no rows', async () => {
    await keepPlaces(key, gathered());
    await rename(join(dumps, 'kept-gather', 'places-a.v8'), join(dumps, 'kept-gather', 'pool-a.v8'));
    expect(await readKeptPool(key)).toBeNull();
  });
});

