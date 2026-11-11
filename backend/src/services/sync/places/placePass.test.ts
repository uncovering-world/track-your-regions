import { describe, it, expect, vi } from 'vitest';
import { PLACE_PASS } from '../passes.js';

// What a world tier admitted before the run is read from the database; none here.
vi.mock('../admission.js', () => ({ admittedExternalIds: vi.fn(async () => new Set<string>()) }));

import { codeHash } from './codeGraph.js';
import { gatheredPlaceKinds, PASS_KIND_MODULES, passKinds, SHARED_STEPS_CODE } from './placePass.js';

describe('the kinds of the place pass (#2320)', () => {
  const gather = () => Promise.reject(new Error('not read'));

  it('are the sources the routes name as the pass, in its order', () => {
    expect(passKinds().flatMap((kind) => kind.sourceIds)).toEqual(PLACE_PASS);
  });

  it('run one member for each of their sources, so no kind of the pass is left out of the run', () => {
    expect(passKinds().flatMap((kind) => kind.members(gather, {}).map((member) => member.sourceId))).toEqual(PLACE_PASS);
  });

  it('each ask the gather for a share of their own, all but Art Museums, which gathers no place', async () => {
    const asking = passKinds().flatMap((kind) => (kind.share ? [kind.share] : []));
    expect(passKinds().filter((kind) => !kind.share).flatMap((kind) => kind.sourceIds)).toEqual([2]);
    expect(new Set(asking.map((share) => share.kind)).size).toBe(asking.length);
    for (const admitted of await Promise.all(asking.map((share) => share.admitted()))) expect(admitted.size).toBe(0);
  });

  it('name each kind they gather by class with the kinds of the catalogue it fills, for the coverage report\'s class reach (#2146)', () => {
    expect(gatheredPlaceKinds().map(({ kindIds }) => kindIds)).toEqual([[3, 6], [4], [5], [7], [8], [9]]);
  });

  it('give the surroundings pool the neighbourhoods of every kind with a surroundings tier, Archaeology asking the map instead and Art Museums having none', () => {
    const without = passKinds().filter((kind) => kind.surroundings().length === 0).flatMap((kind) => kind.sourceIds);
    expect(without).toEqual([5, 2]);
    const publicArt = passKinds().find((kind) => kind.sourceIds.includes(3));
    expect(publicArt?.surroundings()).toHaveLength(2);
  });

  it('declare every kind they gather in a module the kept gather\'s code key reads (#2424)', async () => {
    const exported = new Set<unknown>();
    for (const module of PASS_KIND_MODULES) for (const value of Object.values(await import(module.href))) exported.add(value);
    const missing = gatheredPlaceKinds().filter(({ kind }) => !exported.has(kind)).map(({ kind }) => kind.name);
    expect(missing).toEqual([]);
  });

  it('have a code key over the code the pass runs, every module it reaches found, the key\'s own modules among them (#2424)', async () => {
    const { files } = await codeHash(SHARED_STEPS_CODE);
    expect(files).toEqual(expect.arrayContaining([
      'services/sync/places/gather.ts', 'services/sync/places/keptGather.ts', 'services/sync/places/codeGraph.ts',
      'services/sync/places/surroundingsPool.ts', 'services/sync/squares/kind.ts',
    ]));
  });
});
