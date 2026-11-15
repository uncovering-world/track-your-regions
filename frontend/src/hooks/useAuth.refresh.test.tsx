import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * What a failed silent refresh leaves the tab (#2506). A refused refresh (401:
 * the cookie holds no session) ends the session the way an expired one ends,
 * so the tab draws no control that would write with no session. An unreachable
 * one (the network, the server failing, a 429) says nothing of the session, so
 * the traveller stays signed in with the token in hand.
 */

const apiLogin = vi.fn();
vi.mock('../api/auth', () => ({
  login: (credentials: unknown) => apiLogin(credentials),
  register: vi.fn(),
  logout: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(),
  verifyEmail: vi.fn(),
  changePassword: vi.fn(),
  setLastGoogleEmail: vi.fn(),
}));

import { apiFetch, getAccessToken, getHeldAccount, setAccessToken } from '../api/fetchUtils';
import { AuthProvider, useAuth } from './useAuth';

/** An access token `useAuth` can read: only its expiry is looked at. */
const part = (value: object) => btoa(JSON.stringify(value)).replaceAll('=', '');
const token = (sub: number, mark = '') => {
  const payload = part({ sub, uuid: 'u' + sub, role: 'user', iat: 0, exp: 4102444800, mark });
  return `${part({ alg: 'HS256' })}.${payload}.sig`;
};
const traveller = (id: number, mark = '') => ({
  accessToken: token(id, mark),
  user: { id, uuid: `u${id}`, email: `t${id}@example.org`, displayName: `Traveller ${id}`, role: 'user' },
});

let auth: ReturnType<typeof useAuth>;
function Tab() {
  auth = useAuth();
  return null;
}

let refresh: () => unknown;
beforeEach(() => {
  // The first silent refresh finds no session; later ones answer as the case says.
  refresh = () => ({ ok: false, status: 401, json: async () => ({}) });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/api/auth/refresh')
    ? refresh()
    : { ok: false, status: 401, json: async () => ({ error: 'Invalid or expired token' }) })));
});

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

/**
 * Traveller 7 signed in, then a tick answered 401 through `apiFetch`, the one
 * fetch every screen's call takes, renewed by the refresh `answer` gives.
 */
async function signedInThenRefreshed(answer: () => unknown, through: 'apiFetch' | 'authFetch' = 'apiFetch') {
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Tab /></AuthProvider></QueryClientProvider>);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  apiLogin.mockResolvedValueOnce(traveller(7));
  await act(async () => { await auth.login({ email: 't7@example.org', password: 'secret' }); });
  expect(auth.user?.id).toBe(7);
  refresh = answer;
  const call = through === 'apiFetch'
    ? () => apiFetch('/api/experiences/visits', { method: 'POST' })
    : () => auth.authFetch('/api/experiences/visits');
  await act(async () => { await call().catch(() => undefined); });
}

describe('a failed silent refresh (#2506)', () => {
  it('refused: the tab is signed out, the token gone and no account held', async () => {
    await signedInThenRefreshed(() => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid or expired refresh token' }) }));
    await waitFor(() => expect(auth.user).toBeNull());
    expect(auth.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getHeldAccount()).toBeNull();
  });

  it('refused inside the hook\'s own refresh: the tab is signed out the same way', async () => {
    // useAuth's silent refresh, reached through its authFetch, used to drop the token and keep the user.
    await signedInThenRefreshed(() => ({ ok: false, status: 401, json: async () => ({}) }), 'authFetch');
    await waitFor(() => expect(auth.user).toBeNull());
    expect(getAccessToken()).toBeNull();
    expect(getHeldAccount()).toBeNull();
  });

  it('unreachable: the traveller stays signed in with the token in hand', async () => {
    for (const answer of [
      () => { throw new TypeError('Failed to fetch'); },
      () => ({ ok: false, status: 503, json: async () => ({}) }),
    ]) {
      await signedInThenRefreshed(answer);
      expect(auth.user?.id).toBe(7);
      expect(getAccessToken()).toBe(token(7));
      expect(getHeldAccount()).toBe(7);
    }
  });

  it('renewed: the traveller stays signed in with the new token', async () => {
    await signedInThenRefreshed(() => ({ ok: true, status: 200, json: async () => traveller(7, 'renewed') }));
    expect(auth.user?.id).toBe(7);
    expect(getAccessToken()).toBe(token(7, 'renewed'));
  });
});
