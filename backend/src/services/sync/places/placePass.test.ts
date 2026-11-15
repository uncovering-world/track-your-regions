import { describe, it, expect, vi } from 'vitest';
import { PLACE_PASS } from '../passes.js';

// What a world tier admitted before the run is read from the database; none here.
vi.mock('../admission.js', () => ({ admittedExternalIds: vi.fn(async () => new Set<string>()) }));

import { codeHash } from './codeGraph.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gatheredPlaceKinds, KIND_GATHER_MODULES, PASS_KIND_MODULES, passKinds, STEPS_CODE } from './placePass.js';

/** A module by its path from `src/`, as the code key lists them. */
const SRC = new URL('../../../', import.meta.url);
const fromSrc = (url: URL) => fileURLToPath(url).slice(fileURLToPath(SRC).length);

/**
 * The modules a kind's verdict, exceptions or world bars are declared in,
 * which the gather of places must not import (#2448): each kind's declaring
 * module, the declared kinds' verdict and declarations, every rule module of
 * a kind, and the world tier with the register of the admission frame.
 */
const RULE_MODULES = [
  ...PASS_KIND_MODULES.map((url) => fromSrc(url).replace(/\.js$/, '.ts')),
  'services/sync/places/declaredKind.ts',
  'services/sync/places/worldTier.ts',
  'services/sync/places/worldBars.ts',
  'services/sync/places/worldMemory.ts',
  'services/sync/places/admissionRegister.ts',
  'services/sync/squares/classes.ts',
  'services/sync/towers/classes.ts',
  'services/sync/towers/masts.ts',
  'services/sync/bridges/classes.ts',
  'services/sync/publicArt/kindRules.ts',
  'services/sync/publicArt/publicArtTest.ts',
  'services/sync/publicArt/streetArtTest.ts',
  'services/sync/worship/worshipTest.ts',
  'services/sync/archaeology/siteTest.ts',
  'services/sync/archaeology/museumTest.ts',
];

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

  it('declare every kind they gather in a module the kept pool\'s code key reads (#2424)', async () => {
    const exported = new Set<unknown>();
    for (const module of PASS_KIND_MODULES) for (const value of Object.values(await import(module.href))) exported.add(value);
    const missing = gatheredPlaceKinds().filter(({ kind }) => !exported.has(kind)).map(({ kind }) => kind.name);
    expect(missing).toEqual([]);
  });

  it('declare every kind\'s entrances and editions in a module the gather\'s code key reads (#2448)', async () => {
    const exported = new Set<unknown>();
    for (const module of KIND_GATHER_MODULES) for (const value of Object.values(await import(module.href))) exported.add(value);
    const doors = gatheredPlaceKinds().flatMap(({ kind }) => [
      ...(kind.entrances ? [[`${kind.name}'s entrances`, kind.entrances]] : []),
      ...(kind.editions ? [[`${kind.name}'s editions`, kind.editions]] : []),
    ] as [string, unknown][]);
    expect(doors.map(([name]) => name)).toEqual(["public art and monuments's entrances", "public art and monuments's editions"]);
    expect(doors.filter(([, value]) => !exported.has(value)).map(([name]) => name)).toEqual([]);
  });

  it('have a gather\'s code key that reaches no kind\'s verdict, exceptions or world bars (#2448)', async () => {
    for (const module of RULE_MODULES) expect(existsSync(new URL(module, SRC)), module).toBe(true);
    const { files } = await codeHash(STEPS_CODE.places);
    expect(files).toEqual(expect.arrayContaining([
      'services/sync/places/gather.ts', 'services/sync/places/keptGather.ts', 'services/sync/places/codeGraph.ts',
      'services/sync/publicArt/entrances.ts', 'services/sync/publicArt/monumentCategories.ts', 'services/sync/publicArt/castGroups.ts',
    ]));
    expect(files.filter((file) => RULE_MODULES.includes(file))).toEqual([]);
  });

  it('have a pool\'s code key over the surroundings tier, its cut and venues, and every kind\'s declaration (#2448)', async () => {
    const { files } = await codeHash(STEPS_CODE.pool);
    expect(files).toEqual(expect.arrayContaining([
      'services/sync/places/surroundingsPool.ts', 'services/sync/places/surroundingsTier.ts', 'services/sync/places/surroundingsCut.ts',
      'services/sync/places/surroundingsVenues.ts', 'services/sync/places/admissionRegister.ts', 'services/sync/places/keptGather.ts',
      ...PASS_KIND_MODULES.map((url) => fromSrc(url).replace(/\.js$/, '.ts')),
    ]));
  });
});
