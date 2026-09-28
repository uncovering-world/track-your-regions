import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './fetchUtils';
import { fetchDivisionGeometry } from './divisions';
import { fetchRegionGeometry } from './regions';

/**
 * What a 204 reads as. A geometry read answers 204 for "this region has no
 * outline yet" (Europe in the development data, whose union times out), and
 * its callers test the answer and then read its keys: an empty array, which a
 * list read once made of a 204, passes that test and has none of them, so
 * `answer.properties.crossesDateline` threw. Those reads go through the
 * generated client, which reads a 204 as `undefined`, and answer null.
 */
describe('a 204 with no content', () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads as null for a region with no outline', async () => {
    await expect(fetchRegionGeometry(6737)).resolves.toBeNull();
  });

  it('reads as null for a division with no outline', async () => {
    await expect(fetchDivisionGeometry(42)).resolves.toBeNull();
  });
});
