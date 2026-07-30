import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router';
import type { ReactNode } from 'react';

const { mockFetchWorldViews, authState } = vi.hoisted(() => ({
  mockFetchWorldViews: vi.fn(),
  authState: { isLoading: true, isAdmin: false, user: null as { id: number } | null },
}));

vi.mock('../api', () => ({
  fetchWorldViews: mockFetchWorldViews,
  fetchDivisionAncestors: vi.fn().mockResolvedValue([]),
  fetchRootRegions: vi.fn().mockResolvedValue([]),
  fetchRegionAncestors: vi.fn().mockResolvedValue([]),
}));

vi.mock('./useAuth', () => ({
  useAuth: () => authState,
}));

import { NavigationProvider, useNavigation } from './useNavigation';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <NavigationProvider>{children}</NavigationProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/**
 * The world view list is not the same for everyone: `getWorldViews` filters on
 * `is_public` unless the caller is an admin. Asking before the session is
 * restored gets the anonymous answer — and, crucially, gets it as a **200 with a
 * shorter list** rather than a 401, so `authFetchJson`'s only recovery path (its
 * 401 retry) never runs and `staleTime: Infinity` then freezes that answer for
 * the rest of the session. The observed symptom was an admin whose world view
 * picker offered only the one published world view, with the hidden base-layer
 * mirror missing for the whole session.
 */
const HIDDEN_WV = { id: 5, name: 'Administrative', isDefault: false, isPublic: false };
const PUBLIC_WV = { id: 2, name: 'Wikivoyage Regions', isDefault: false, isPublic: true };
const OTHER_WV = { id: 7, name: 'Cultural Regions', isDefault: false, isPublic: true };

/** A wrapper whose provider stays mounted across rerenders, starting at ?wv=5. */
function makeWrapper(entry = '/?wv=5') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={queryClient}>
          <NavigationProvider>{children}</NavigationProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }
  Wrapper.queryClient = queryClient;
  return Wrapper;
}

describe('useNavigation world view fetching', () => {
  beforeEach(() => {
    mockFetchWorldViews.mockReset();
    mockFetchWorldViews.mockResolvedValue([]);
    authState.isLoading = true;
    authState.isAdmin = false;
    authState.user = null;
  });

  it('does not ask for world views while the session is still being restored', async () => {
    renderHook(() => useNavigation(), { wrapper });

    // Give React Query a chance to fire it if the gate is missing.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockFetchWorldViews).not.toHaveBeenCalled();
  });

  it('asks once the session has resolved', async () => {
    authState.isLoading = false;
    renderHook(() => useNavigation(), { wrapper });

    await waitFor(() => expect(mockFetchWorldViews).toHaveBeenCalled());
  });

  it('caches under a different key per identity, so one answer cannot serve another', async () => {
    // The bug this replaces: one shared key, so whichever answer arrived first
    // held the entry. Keyed by identity, an anonymous list and an admin list are
    // different entries and neither can stand in for the other.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapWith = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <NavigationProvider>{children}</NavigationProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    authState.isLoading = false;
    authState.user = null;
    const { unmount } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    await waitFor(() => expect(mockFetchWorldViews).toHaveBeenCalledTimes(1));
    unmount();

    authState.user = { id: 1 };
    renderHook(() => useNavigation(), { wrapper: wrapWith });
    await waitFor(() => expect(mockFetchWorldViews).toHaveBeenCalledTimes(2));
  });

  it('drops a selected world view that the new identity cannot see', async () => {
    // The half the cache key does not fix: `selectedWorldView` is component
    // state. NavigationProvider sits under AuthProvider and is never remounted
    // when a session ends, so the selection *survives* — which is why this test
    // keeps one provider alive and rerenders it rather than mounting a second
    // one. Mounting fresh would start from a null selection and pass through the
    // initial-pick branch, which behaved the same before this change: the test
    // would be green either way and prove nothing.
    const wrapWith = makeWrapper();

    authState.isLoading = false;
    authState.isAdmin = true;
    authState.user = { id: 1 };
    mockFetchWorldViews.mockResolvedValue([HIDDEN_WV, PUBLIC_WV]);

    const { result, rerender } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(5));

    // Session ends. Same provider, same component state — only the identity and
    // what the server will answer have changed.
    authState.isAdmin = false;
    authState.user = null;
    mockFetchWorldViews.mockResolvedValue([PUBLIC_WV]);
    rerender();

    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(2));
  });

  it('clears the previous world view\'s region when reconciling, not just the world view', async () => {
    // A half-applied switch is worse than none: the world view flips while the
    // old one's region and breadcrumbs stay on screen, which is the very thing
    // the reconciliation exists to remove.
    const wrapWith = makeWrapper();

    authState.isLoading = false;
    authState.isAdmin = true;
    authState.user = { id: 1 };
    mockFetchWorldViews.mockResolvedValue([HIDDEN_WV, PUBLIC_WV]);

    const { result, rerender } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(5));

    act(() => {
      result.current.setSelectedRegion({ id: 99, name: 'A region of world view 5' } as never);
    });
    expect(result.current.selectedRegion?.id).toBe(99);

    authState.isAdmin = false;
    authState.user = null;
    mockFetchWorldViews.mockResolvedValue([PUBLIC_WV]);
    rerender();

    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(2));
    expect(result.current.selectedRegion).toBeNull();
    expect(result.current.regionBreadcrumbs).toEqual([]);
  });

  it('clears the old context when the list comes back empty, not just the world view', async () => {
    // Dropping only `selectedWorldView` is worse than dropping nothing: both
    // derived values fall back to the URL, so isCustomWorldView turns true and
    // selectedWorldViewId becomes the departed id — rootRegions stays enabled
    // and keeps asking for it as an anonymous caller.
    const wrapWith = makeWrapper();
    authState.isLoading = false;
    authState.isAdmin = true;
    authState.user = { id: 1 };
    mockFetchWorldViews.mockResolvedValue([HIDDEN_WV]);

    const { result, rerender } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(5));
    act(() => {
      result.current.setSelectedRegion({ id: 99, name: 'A region of world view 5' } as never);
    });

    authState.isAdmin = false;
    authState.user = null;
    mockFetchWorldViews.mockResolvedValue([]);
    rerender();

    await waitFor(() => expect(result.current.selectedWorldView).toBeNull());
    expect(result.current.selectedRegion).toBeNull();
    expect(result.current.regionBreadcrumbs).toEqual([]);
    expect(result.current.selectedWorldViewId).toBeNull();
  });

  it('does not wipe a region chosen before the list arrives', async () => {
    // The sidebar renders outside MainDisplay's loading gate and rootRegions is
    // enabled from the URL, so a region can be picked while the world view list
    // is still in flight — a window this change widened by making the list wait
    // on the session. The first pick must not be treated as a switch.
    const wrapWith = makeWrapper();
    authState.isLoading = false;
    authState.isAdmin = false;
    authState.user = null;
    let release: (v: unknown) => void = () => {};
    mockFetchWorldViews.mockImplementation(() => new Promise(r => { release = r; }));

    const { result } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    act(() => {
      result.current.setSelectedRegion({ id: 42, name: 'Chosen early' } as never);
    });
    expect(result.current.selectedRegion?.id).toBe(42);

    act(() => release([PUBLIC_WV]));
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(2));
    expect(result.current.selectedRegion?.id).toBe(42);
  });

  it('reconciles a selection that goes invalid without the list changing', async () => {
    // The case HierarchySwitcher used to carry its own copy of, and the only one
    // the id-joined dep array cannot reach by itself: the list never changes, so
    // `selectedWorldView` in the deps is the whole reason the effect fires.
    //
    // The assertion is the invariant, not a particular id. setSelectedWorldView
    // *is* applyWorldView, so it writes `?wv=5` on the way in, and react-router
    // v7 defers that through startTransition — whether the effect re-reads the
    // URL before or after that lands decides between two answers that are both
    // correct. What must hold either way is that the selection ends up as one
    // the caller can actually see.
    const wrapWith = makeWrapper('/?wv=7');
    authState.isLoading = false;
    authState.isAdmin = true;
    authState.user = { id: 1 };
    mockFetchWorldViews.mockResolvedValue([PUBLIC_WV, OTHER_WV]);

    const { result } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    // The initial pick is what proves URL preference: worldViews[0] is 2, ?wv is 7.
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(7));

    act(() => { result.current.setSelectedWorldView(HIDDEN_WV as never); });

    await waitFor(() => {
      const id = result.current.selectedWorldView?.id;
      expect([PUBLIC_WV.id, OTHER_WV.id]).toContain(id);
    });
  });

  it('leaves an optimistically selected world view alone while the list refetches', async () => {
    // Creating a world view invalidates the list and selects the new one in the
    // same batch. invalidateQueries keeps status 'success' with the previous
    // data, so without the isFetching gate the reconciliation runs against a list
    // that cannot contain the id just created, and bounces the admin off it.
    const wrapWith = makeWrapper('/');
    authState.isLoading = false;
    authState.isAdmin = true;
    authState.user = { id: 1 };
    mockFetchWorldViews.mockResolvedValue([PUBLIC_WV]);

    const { result } = renderHook(() => useNavigation(), { wrapper: wrapWith });
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(2));

    // What createMutation.onSuccess does, in its order.
    const created = { id: 42, name: 'Freshly created', isDefault: false, isPublic: false };
    mockFetchWorldViews.mockResolvedValue([PUBLIC_WV, created]);
    act(() => {
      wrapWith.queryClient.invalidateQueries({ queryKey: ['worldViews'] }).catch(() => {});
      result.current.setSelectedWorldView(created as never);
    });

    expect(result.current.selectedWorldView?.id).toBe(42);
    await waitFor(() => expect(result.current.selectedWorldView?.id).toBe(42));
  });

  it('drops ?wv when the world view it names is not visible', async () => {
    // A bookmarked /?wv=5 opened after the session ends. The selection corrects
    // to a visible world view; the URL has to follow, or the address bar keeps
    // advertising one the picker does not show, re-shares a dead link, and
    // leaves selectedWorldViewId falling back to that id on every load — one
    // 404 root-regions request per visit before it corrects itself.
    //
    // Asserted on the query string rather than selectedWorldViewId: that is
    // `selectedWorldView?.id ?? urlWorldViewId`, so it reads 2 from the
    // selection alone and would pass with the URL left untouched.
    const wrapWith = makeWrapper('/?wv=5');
    authState.isLoading = false;
    authState.isAdmin = false;
    authState.user = null;
    mockFetchWorldViews.mockResolvedValue([PUBLIC_WV]);

    const { result } = renderHook(
      () => ({ nav: useNavigation(), params: useSearchParams()[0] }),
      { wrapper: wrapWith },
    );

    await waitFor(() => expect(result.current.nav.selectedWorldView?.id).toBe(2));
    await waitFor(() => expect(result.current.params.get('wv')).toBe('2'));
  });

  it('drops ?wv when there is nothing visible at all', async () => {
    // A fresh install, or every world view hidden, plus a bookmarked /?wv=5.
    // Nothing was ever selected, so there is no context to clear — but the URL
    // still names a world view this caller cannot see, and no later branch runs
    // to correct it: no selection is made, so the effect has no reason to fire
    // again. Until it is cleared, selectedWorldViewId reads 5 and rootRegions
    // keeps requesting a world view that answers 404.
    const wrapWith = makeWrapper('/?wv=5');
    authState.isLoading = false;
    authState.isAdmin = false;
    authState.user = null;
    mockFetchWorldViews.mockResolvedValue([]);

    const { result } = renderHook(
      () => ({ nav: useNavigation(), params: useSearchParams()[0] }),
      { wrapper: wrapWith },
    );

    await waitFor(() => expect(result.current.params.get('wv')).toBeNull());
    expect(result.current.nav.selectedWorldView).toBeNull();
    expect(result.current.nav.selectedWorldViewId).toBeNull();
  });

  it('asks for an anonymous visitor too, once auth has settled', async () => {
    // "Session restored" and "logged in" are different things: a visitor with no
    // session must still get the public list rather than an empty picker.
    authState.isLoading = false;
    authState.isAdmin = false;
    renderHook(() => useNavigation(), { wrapper });

    await waitFor(() => expect(mockFetchWorldViews).toHaveBeenCalled());
  });
});
