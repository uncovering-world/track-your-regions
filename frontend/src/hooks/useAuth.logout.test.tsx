import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Signing out ends the access token as well as the refresh token.
 *
 * The server blacklists the access token only when the logout request carries
 * it (`authController.ts` `logout`), and `useAuth` clears its own state before
 * that request. So the token is taken first and handed to the request; taken
 * after the clear, it is gone, and the signed-out token keeps working until it
 * expires (#1110).
 */

const apiLogout = vi.fn(async (_token: string | null) => undefined);

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: (token: string | null) => apiLogout(token),
  getCurrentUser: vi.fn(),
  verifyEmail: vi.fn(),
  changePassword: vi.fn(),
  setLastGoogleEmail: vi.fn(),
}));

import { getAccessToken, setAccessToken } from '../api/fetchUtils';
import { AuthProvider, useAuth } from './useAuth';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('useAuth logout', () => {
  beforeEach(() => {
    // The provider's first silent refresh finds no session.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
  });

  afterEach(() => {
    setAccessToken(null);
    apiLogout.mockClear();
    vi.unstubAllGlobals();
  });

  it('sends the token it is ending, then holds none', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    setAccessToken('the-session-token');

    await act(async () => { await result.current.logout(); });

    expect(apiLogout).toHaveBeenCalledWith('the-session-token');
    expect(getAccessToken()).toBeNull();
  });

  it('sends no token when none is held', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.logout(); });

    expect(apiLogout).toHaveBeenCalledWith(null);
  });
});
