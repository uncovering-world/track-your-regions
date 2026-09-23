import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetchJson, authFetchOptionalJson, setAccessToken } from './fetchUtils';

/**
 * What a 204 reads as. A list read answers 204 for "nothing", and its callers
 * iterate what they get, so `authFetchJson` hands them an empty array. A
 * geometry read answers 204 for "this region has no outline yet" (Europe in the
 * development data, whose union times out), and its callers test the answer
 * and then read its keys: an empty array passes that test and has none of
 * them, so `answer.properties.crossesDateline` threw. That read goes through
 * `authFetchOptionalJson`, and gets null.
 */
describe('a 204 with no content', () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads as an empty list through authFetchJson', async () => {
    await expect(authFetchJson<string[]>('/api/list')).resolves.toEqual([]);
  });

  it('reads as null through authFetchOptionalJson', async () => {
    await expect(authFetchOptionalJson<{ properties: object }>('/api/world-views/regions/6737/geometry')).resolves.toBeNull();
  });
});
