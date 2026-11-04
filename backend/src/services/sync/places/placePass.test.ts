import { describe, it, expect, vi } from 'vitest';
import { PLACE_PASS } from '../passes.js';

// What a world tier admitted before the run is read from the database; none here.
vi.mock('../admission.js', () => ({ admittedExternalIds: vi.fn(async () => new Set<string>()) }));

import { passKinds } from './placePass.js';

describe('the kinds of the place pass (#2320)', () => {
  const gather = () => Promise.reject(new Error('not read'));

  it('are the sources the routes name as the pass, in its order', () => {
    expect(passKinds().flatMap((kind) => kind.sourceIds)).toEqual(PLACE_PASS);
  });

  it('run one member for each of their sources, so no kind of the pass is left out of the run', () => {
    expect(passKinds().flatMap((kind) => kind.members(gather, {}).map((member) => member.sourceId))).toEqual(PLACE_PASS);
  });

  it('each ask the gather for a share of their own, all but Art Museums, which gathers no place', async () => {
    const asking = passKinds().filter((kind) => kind.request);
    expect(passKinds().filter((kind) => !kind.request).flatMap((kind) => kind.sourceIds)).toEqual([2]);
    const requests = await Promise.all(asking.map((kind) => kind.request!()));
    expect(new Set(requests.map((request) => request.kind)).size).toBe(asking.length);
    for (const request of requests) expect(request.admitted.size).toBe(0);
  });

  it('give the surroundings pool the neighbourhoods of every kind with a surroundings tier, Archaeology asking the map instead and Art Museums having none', () => {
    const without = passKinds().filter((kind) => kind.surroundings().length === 0).flatMap((kind) => kind.sourceIds);
    expect(without).toEqual([5, 2]);
    const publicArt = passKinds().find((kind) => kind.sourceIds.includes(3));
    expect(publicArt?.surroundings()).toHaveLength(2);
  });
});
