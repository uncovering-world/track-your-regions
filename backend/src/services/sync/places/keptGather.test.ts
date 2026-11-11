import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const query = vi.fn();
vi.mock('../../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import { gatherKey, keepPlaces, keepPool, placesOf, poolKey, poolOf, readKeptPlaces, readKeptPool, type PassKeep } from './keptGather.js';
import type { GatheredPlaces, GatherRequest, KindShare, PlaceKind } from './gather.js';
import type { SurroundingsPool } from './surroundingsPool.js';
import { SURROUNDINGS_CUT } from './surroundingsCut.js';
import { writeSliced } from './slicedV8.js';

const kind = (name: string) => ({ name }) as PlaceKind<unknown>;
const TOWERS = kind('towers');
const SQUARES = kind('squares and streets');

function share(qids: string[]): KindShare<unknown> {
  return {
    trees: { roots: new Set(['Q12518']) },
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

describe('the key a kept step of the place pass is read again by (#2424)', () => {
  let code: string;
  const codeUrl = () => [pathToFileURL(join(code, 'entry.js'))];
  const keyOf = async (asked: GatherRequest[], url: URL[]) => {
    const key = await gatherKey(asked, url);
    if (!key) throw new Error('no key');
    return key;
  };

  beforeEach(async () => {
    code = await mkdtemp(join(tmpdir(), 'kept-code-'));
    await writeFile(join(code, 'entry.ts'), 'export const rule = 1;\n');
    query.mockResolvedValue({ rows: [{ builds: '71', newest: 1204 }] });
  });
  afterEach(() => rm(code, { recursive: true, force: true }));

  it('is the same over the same builds, admitted rows and code, whatever order the rows were read in', async () => {
    const first = await keyOf(requests(['Q41225', 'Q243']), codeUrl());
    const second = await keyOf(requests(['Q243', 'Q41225']), codeUrl());
    expect(second.hash).toBe(first.hash);
    expect(first.builds).toBe('71 builds, the newest #1204');
  });

  it('changes once another build has succeeded, a kind admits another row, or the code changes', async () => {
    const before = (await keyOf(requests(), codeUrl())).hash;
    query.mockResolvedValueOnce({ rows: [{ builds: '72', newest: 1205 }] });
    expect((await keyOf(requests(), codeUrl())).hash).not.toBe(before);
    expect((await keyOf(requests(['Q41225']), codeUrl())).hash).not.toBe(before);
    await writeFile(join(code, 'entry.ts'), 'export const rule = 2;\n');
    expect((await keyOf(requests(), codeUrl())).hash).not.toBe(before);
  });

  it('gives the pool its own key, which changes with what the pool is asked for', async () => {
    const key = await keyOf(requests(), codeUrl());
    const members = { classes: new Set(['Q12518']), items: new Set(['Q243']) };
    const groups = [{ key: 'towers', classes: new Set(['Q12518']) }];
    const base = poolKey(key, members, SURROUNDINGS_CUT, groups).hash;
    expect(base).not.toBe(key.hash);
    expect(poolKey(key, { classes: new Set(['Q12518']), items: new Set(['Q243']) }, SURROUNDINGS_CUT, groups).hash).toBe(base);
    expect(poolKey(key, members, { ...SURROUNDINGS_CUT, radiusKm: SURROUNDINGS_CUT.radiusKm + 1 }, groups).hash).not.toBe(base);
    expect(poolKey(key, members, SURROUNDINGS_CUT, [{ key: 'squares', classes: new Set(['Q174782']) }]).hash).not.toBe(base);
    // The venue classes are data the pool is asked for; the line test is the readers' code over the gather, which the gather's key holds.
    const venues = { ...members, venues: new Set(['Q174782']) };
    expect(poolKey(key, venues, SURROUNDINGS_CUT, groups).hash).not.toBe(base);
    expect(poolKey(key, { ...venues, venueLine: () => true }, SURROUNDINGS_CUT, groups).hash).toBe(poolKey(key, venues, SURROUNDINGS_CUT, groups).hash);
  });

  it('is no key where the code cannot be read, so the run keeps and reads nothing', async () => {
    await writeFile(join(code, 'entry.ts'), "export { gone } from './gone.js';\n");
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await gatherKey(requests(), codeUrl())).toBeNull();
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
    const kept = await readKeptPlaces(key('a'), requests());
    expect(kept?.value.pooled).toBe(3);
    expect([...(kept?.value.shares.get(SQUARES)?.pool.keys() ?? [])]).toEqual(['Q770631', 'Q463400']);
    expect(kept?.value.shares.get(TOWERS)?.pool.has('Q41225')).toBe(true);
    expect(kept?.keptAt).toBeInstanceOf(Date);
    expect(await readKeptPlaces(key('b'), requests())).toBeNull();
  });

  it('is not read for a kind it holds no share of', async () => {
    await keepPlaces(key('a'), gathered());
    expect(await readKeptPlaces(key('a'), [...requests(), { kind: kind('parks'), admitted: new Set() }])).toBeNull();
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
    expect(await readKeptPlaces(key('a'), requests())).toBeNull();
    expect(await readdir(dumps)).toEqual([]);
  });

  it('is made again, not read, when its file cannot be read', async () => {
    await keepPlaces(key('a'), gathered());
    await writeFile(join(dumps, 'kept-gather', 'places-a.v8'), 'not a serialized value');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await readKeptPlaces(key('a'), requests())).toBeNull();
  });
});

describe('the place pass reads a kept step back only in a dry run (#2424)', () => {
  let dumps: string;
  const key = { hash: 'a', builds: '71 builds, the newest #1204' };
  const run = { sparql: vi.fn(), live: vi.fn(), cancelled: () => false, phase: vi.fn(), step: vi.fn() } as never;
  const members = { classes: new Set(['Q12518']) };
  const groups = [{ key: 'all', classes: null }];
  const madePool = { rows: new Map([['Q243', { qid: 'Q243' }]]), around: new Map(), seconds: 900 } as unknown as SurroundingsPool;
  const keep = (read: boolean, withKey = true): PassKeep => ({ key: withKey ? key : null, read, note: {} });

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
    await placesOf(real, requests(), run, gather);
    expect(gather).toHaveBeenCalledOnce();
    const read = vi.fn(async () => madePool);
    await poolOf(real, members, SURROUNDINGS_CUT, groups, run, read);
    expect(read).toHaveBeenCalledOnce();
    expect(real.note).toEqual({});
    expect((await readKeptPool(poolKey(key, members, SURROUNDINGS_CUT, groups)))?.value.rows.has('Q243')).toBe(true);
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
    await keepPool(poolKey(key, members, SURROUNDINGS_CUT, groups), madePool);
    const dry = keep(true);
    const gather = vi.fn(async () => gathered());
    const read = vi.fn(async () => madePool);
    expect((await placesOf(dry, requests(), run, gather)).pooled).toBe(3);
    expect((await poolOf(dry, members, SURROUNDINGS_CUT, groups, run, read)).rows.has('Q243')).toBe(true);
    expect(gather).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(dry.note).toEqual({ places: expect.any(Date), pool: expect.any(Date), builds: key.builds });
  });

  it('makes the pool in a dry run whose pool is asked for something else, though the gather of places was read', async () => {
    await keepPool(poolKey(key, members, SURROUNDINGS_CUT, groups), madePool);
    const read = vi.fn(async () => madePool);
    await poolOf(keep(true), { classes: new Set(['Q174782']) }, SURROUNDINGS_CUT, groups, run, read);
    expect(read).toHaveBeenCalledOnce();
  });

  it('neither reads nor keeps where the run has no key: a run on the live service', async () => {
    const gather = vi.fn(async () => gathered());
    await placesOf(keep(true, false), requests(), run, gather);
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
    expect(await readKeptPlaces(key, requests())).toBeNull();
  });

  it('is made again, not read, when a pool holds no rows', async () => {
    await keepPlaces(key, gathered());
    await rename(join(dumps, 'kept-gather', 'places-a.v8'), join(dumps, 'kept-gather', 'pool-a.v8'));
    expect(await readKeptPool(key)).toBeNull();
  });
});

