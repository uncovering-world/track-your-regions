import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, apiFetch, setAccessToken } from './fetchUtils';
import {
  getExperiencesReviewQueue, postExperiencesReviewAnswer, putExperiencesReviewSetAsideBySyncLogId,
} from './client.generated';

/**
 * `apiFetch` is the one fetch the generated client calls (ADR-0073). A call
 * moved to it behaves as it did through `authFetchJson`: the origin in front of
 * the document's path, the session's token, one refresh and retry on a 401.
 * Only a 204 reads differently, as `undefined`, which is what the generated
 * types say such a route may answer.
 */
describe('apiFetch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAccessToken(null);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('puts the origin in front of the path and sends the session token', async () => {
    // A token that decodes to no expiry would be refreshed first; this one is
    // not a JWT at all, and the refresh it triggers answers 401, so the call
    // still goes out with the token in hand.
    setAccessToken('the-session-token');
    fetchSpy.mockImplementation(async (url: string) => (url.endsWith('/api/auth/refresh')
      ? { ok: false, status: 401, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ answered: 1 }) }));

    await expect(apiFetch('/api/experiences/review/answer', { method: 'POST' })).resolves.toEqual({ answered: 1 });

    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/experiences/review/answer`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer the-session-token');
  });

  it('reads a 204 as undefined', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });

    await expect(apiFetch('/api/world-views/regions/6737/geometry')).resolves.toBeUndefined();
  });

  it('throws the server’s error sentence', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'A submitted number is outside the range this field allows.' }) });

    await expect(apiFetch('/api/experiences/review/queue')).rejects.toThrow('A submitted number is outside the range this field allows.');
  });
});

/**
 * What the generated client buys: a request the document does not describe
 * does not compile. The lines below are type-checked by `tsc` with the rest of
 * `src/`, never run; each `@ts-expect-error` fails the typecheck if its line
 * ever starts compiling.
 */
describe('the generated client', () => {
  it('refuses at compile time a request the document does not describe', () => {
    const neverCalled = () => {
      // @ts-expect-error `answers` is not a field of the answer body
      void postExperiencesReviewAnswer({ rows: [], answers: 'accept' });
      // @ts-expect-error `defer` is not one of the answers the route takes
      void postExperiencesReviewAnswer({ rows: [], answer: 'defer' });
      // @ts-expect-error a run id is a number
      void putExperiencesReviewSetAsideBySyncLogId('98');
      // @ts-expect-error `question` is the only order besides the default
      void getExperiencesReviewQueue({ sort: 'newest' });
    };
    expect(neverCalled).toBeTypeOf('function');
  });
});
