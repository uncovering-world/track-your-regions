import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Who is signed in changing forgets what the last traveller left in the tab
 * (#2120): the Undo of their last untick is not offered to the visitor after
 * them, nor to the next traveller who signs in on the same tab, whose Undo
 * would write the first one's visits and trip dates into their own account.
 * A refresh that returns the session another tab signed in is such a change.
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
vi.mock('../components/shared/trips/visitTrips', () => ({
  default: (props: { part: string }) => <p>{`chunk: ${props.part}`}</p>,
  forgetOffer: () => {},
}));

import { getHeldAccount, refreshSession, setAccessToken } from '../api/fetchUtils';
import { LazyVisitRemovedLine } from '../components/shared/lazyVisitTrips';
import {
  clearRemovedVisits, dateLineAt, noteRemovedVisits, OFFER_SILENCE_KEY, removedVisitsOf, showDateLine, writeOrigin,
} from '../components/shared/visitRemovals';
import { AuthProvider, useAuth } from './useAuth';

/** An access token `useAuth` can read: only its expiry is looked at. */
const part = (value: object) => btoa(JSON.stringify(value)).replaceAll('=', '');
const token = (sub: number) => {
  const payload = part({ sub, uuid: 'u' + sub, role: 'user', iat: 0, exp: 4102444800 });
  return `${part({ alg: 'HS256' })}.${payload}.sig`;
};
const traveller = (id: number) => ({
  accessToken: token(id),
  user: { id, uuid: `u${id}`, email: `t${id}@example.org`, displayName: `Traveller ${id}`, role: 'user' },
});
const withTrips = { experienceId: 9461, markedAt: null, notes: null, rating: null, trips: [{ year: 2015, month: null, day: null }] };

let auth: ReturnType<typeof useAuth>;
function Tab() {
  auth = useAuth();
  return <LazyVisitRemovedLine scope={6737} />;
}

const client = new QueryClient();
function renderTab() {
  render(<QueryClientProvider client={client}><AuthProvider><Tab /></AuthProvider></QueryClientProvider>);
}

async function signIn(id: number) {
  apiLogin.mockResolvedValueOnce(traveller(id));
  await act(async () => { await auth.login({ email: `t${id}@example.org`, password: 'secret' }); });
}

describe("the Undo of a traveller's untick and the next sign-in", () => {
  beforeEach(() => {
    // The provider's first silent refresh finds no session.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
  });

  afterEach(() => {
    act(() => clearRemovedVisits());
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('is gone once the traveller signs out', async () => {
    renderTab();
    await waitFor(() => expect(auth.isLoading).toBe(false));
    await signIn(7);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(7)));
    expect(await screen.findByText('chunk: removed')).toBeTruthy();

    await act(async () => { await auth.logout(); });
    expect(screen.queryByText('chunk: removed')).toBeNull();
    expect(removedVisitsOf(7)).toBeNull();
  });

  it('is nothing of the next traveller who signs in on the same tab', async () => {
    renderTab();
    await waitFor(() => expect(auth.isLoading).toBe(false));
    await signIn(7);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(7)));
    expect(await screen.findByText('chunk: removed')).toBeTruthy();

    await act(async () => { await auth.logout(); });
    await signIn(8);
    expect(screen.queryByText('chunk: removed')).toBeNull();
    expect(removedVisitsOf(8)).toBeNull();
    // The first traveller signing back in finds nothing left either.
    await act(async () => { await auth.logout(); });
    await signIn(7);
    expect(removedVisitsOf(7)).toBeNull();
  });

  it('is forgotten when a refresh returns the session another tab signed in', async () => {
    renderTab();
    await waitFor(() => expect(auth.isLoading).toBe(false));
    await signIn(7);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(7)));
    expect(await screen.findByText('chunk: removed')).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => traveller(8) })));
    await act(async () => { await refreshSession(); });
    expect(auth.user?.id).toBe(8);
    expect(screen.queryByText('chunk: removed')).toBeNull();
    expect(removedVisitsOf(7)).toBeNull();
  });

  it("forgets the date line and its silence when a refresh returns another tab's traveller", async () => {
    renderTab();
    await waitFor(() => expect(auth.isLoading).toBe(false));
    await signIn(7);
    act(() => showDateLine(9461, 7));
    sessionStorage.setItem(OFFER_SILENCE_KEY, JSON.stringify({ owner: 7, until: Date.now() + 3_600_000 }));

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => traveller(8) })));
    await act(async () => { await refreshSession(); });
    expect(dateLineAt()).toBeNull();
    expect(sessionStorage.getItem(OFFER_SILENCE_KEY)).toBeNull();
  });

  it('stays when a refresh returns the same traveller', async () => {
    renderTab();
    await waitFor(() => expect(auth.isLoading).toBe(false));
    await signIn(7);
    act(() => noteRemovedVisits([withTrips], client, writeOrigin(7)));
    expect(await screen.findByText('chunk: removed')).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => traveller(7) })));
    await act(async () => { await refreshSession(); });
    expect(screen.getByText('chunk: removed')).toBeTruthy();
    expect(removedVisitsOf(7)).not.toBeNull();
  });

  it('holds the account the tab has committed, for a refresh and a call with no token to be compared with', async () => {
    renderTab();
    await waitFor(() => expect(auth.isLoading).toBe(false));
    expect(getHeldAccount()).toBeNull();
    await signIn(7);
    expect(getHeldAccount()).toBe(7);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => traveller(8) })));
    await act(async () => { await refreshSession(); });
    expect(getHeldAccount()).toBe(8);

    await act(async () => { await auth.logout(); });
    expect(getHeldAccount()).toBeNull();
  });
});
