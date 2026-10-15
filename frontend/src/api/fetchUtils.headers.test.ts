import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setAccessToken } from './fetchUtils';

/**
 * Which headers a request carries. `Content-Type: application/json` is not
 * CORS-safelisted, so sending it on a bodiless read made every read a
 * non-simple request and cost an anonymous reader a preflight before each one
 * (#1542). It goes only where there is a body.
 */
describe('the headers a request carries', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const sent = () => new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);

  beforeEach(() => {
    setAccessToken(null);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an anonymous read without a body names no content type, so it is a simple request', async () => {
    await apiFetch('/api/experiences/kinds');

    expect(sent().has('Content-Type')).toBe(false);
    expect(sent().has('Authorization')).toBe(false);
  });

  it('a request with a JSON body names application/json when the caller did not', async () => {
    await apiFetch('/api/things', { method: 'POST', body: JSON.stringify({ a: 1 }), tokenPolicy: 'as-held' });

    expect(sent().get('Content-Type')).toBe('application/json');
  });

  it("a caller's own content type wins", async () => {
    await apiFetch('/api/things', {
      method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' }, tokenPolicy: 'as-held',
    });

    expect(sent().get('Content-Type')).toBe('text/plain');
  });

  it('a signed-in read still carries its token, and no content type', async () => {
    setAccessToken('header.payload.signature');

    await apiFetch('/api/users/me/visited', { tokenPolicy: 'as-held' });

    expect(sent().get('Authorization')).toBe('Bearer header.payload.signature');
    expect(sent().has('Content-Type')).toBe(false);
  });
});
