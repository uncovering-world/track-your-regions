import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router';
import type { ReactNode } from 'react';
import type { Region } from '../types';

const { mockFetchRegionAncestors, mockFetchWorldViews, authState } = vi.hoisted(() => ({
  mockFetchRegionAncestors: vi.fn(),
  mockFetchWorldViews: vi.fn(),
  authState: { isLoading: false, isAdmin: false, user: null as { id: number } | null },
}));

vi.mock('../api', () => ({
  fetchWorldViews: mockFetchWorldViews,
  fetchDivisionAncestors: vi.fn().mockResolvedValue([]),
  fetchRootRegions: vi.fn().mockResolvedValue([]),
  fetchRegionAncestors: mockFetchRegionAncestors,
}));

const WV5 = { id: 5, name: 'Administrative', isDefault: false, isPublic: true };
const WV7 = { id: 7, name: 'Cultural Regions', isDefault: false, isPublic: true };

vi.mock('./useAuth', () => ({
  useAuth: () => authState,
}));

import { NavigationProvider, useNavigation } from './useNavigation';

function makeWrapper(entry = '/wv/5') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={queryClient}>
          <NavigationProvider>{children}</NavigationProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

const EUROPE = {
  id: 6737, worldViewId: 5, name: 'Europe', parentRegionId: null, color: '#123456',
  focusBbox: [-25, 34, 45, 72] as [number, number, number, number],
  anchorPoint: [10, 50] as [number, number], hasSubregions: true,
};
const MALTA = {
  id: 7100, worldViewId: 5, name: 'Malta', parentRegionId: 6737, color: '#abcdef',
  focusBbox: [14.1, 35.8, 14.6, 36.1] as [number, number, number, number],
  anchorPoint: [14.4, 35.9] as [number, number], hasSubregions: false,
};

/**
 * What a click on the map knows, and what it has to be told (#649).
 *
 * A vector tile carries a region's id, name and colour; it carries no focus box
 * and no anchor point, and `tile_region_islands` — the real coastlines of a hull
 * region — carries no parent either. The ancestors read fires on every selection
 * for the breadcrumbs anyway, and it answers with the full row, so it is what
 * completes the selection the map built out of tile properties.
 */
describe('useNavigation — completing a region selected from the map', () => {
  beforeEach(() => {
    mockFetchRegionAncestors.mockReset();
    mockFetchRegionAncestors.mockResolvedValue([EUROPE, MALTA]);
    mockFetchWorldViews.mockReset();
    mockFetchWorldViews.mockResolvedValue([WV5]);
    authState.isLoading = false;
    authState.user = null;
  });

  it('gives a selection made from a tile its focus box and anchor point', async () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: makeWrapper() });

    // What the click handler can build from the properties of the tile feature.
    act(() => {
      result.current.setSelectedRegion({
        id: 7100, worldViewId: 5, name: 'Malta', description: null,
        parentRegionId: 6737, color: '#abcdef', hasSubregions: false,
      } as Region);
    });

    await waitFor(() => expect(result.current.selectedRegion?.focusBbox).toEqual(MALTA.focusBbox));
    expect(result.current.selectedRegion?.anchorPoint).toEqual(MALTA.anchorPoint);
    expect(result.current.regionBreadcrumbs.map(r => r.id)).toEqual([6737, 7100]);
  });

  it('gives an island click the parent the islands layer does not carry', async () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: makeWrapper() });

    act(() => {
      result.current.setSelectedRegion({
        id: 7100, worldViewId: 5, name: 'Malta', description: null,
        parentRegionId: null, color: '#abcdef', hasSubregions: false,
      } as Region);
    });

    await waitFor(() => expect(result.current.selectedRegion?.parentRegionId).toBe(6737));
  });

  it('refuses an answer about another world view', async () => {
    // An ancestors answer about a world view the caller may see but is not
    // looking at. The read is keyed on a region id alone and bounded by
    // `requireVisibleWorldView`, so completing a selection from it would point
    // this map at that world view's regions. #660 scoped the layer that used to
    // hand over such an id; this is the fence behind it.
    mockFetchRegionAncestors.mockResolvedValue([
      { ...EUROPE, worldViewId: 9 },
      { ...MALTA, worldViewId: 9 },
    ]);
    const { result } = renderHook(() => useNavigation(), { wrapper: makeWrapper() });

    act(() => {
      result.current.setSelectedRegion({
        id: 7100, worldViewId: 5, name: 'Malta', description: null,
        parentRegionId: null, color: '#abcdef', hasSubregions: false,
      } as Region);
    });

    await waitFor(() => expect(mockFetchRegionAncestors).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.selectedRegion?.focusBbox).toBeUndefined();
    expect(result.current.selectedRegion?.parentRegionId).toBeNull();
  });

  it('leaves a root region parentless, and asks once', async () => {
    mockFetchRegionAncestors.mockResolvedValue([EUROPE]);
    const { result } = renderHook(() => useNavigation(), { wrapper: makeWrapper() });

    act(() => {
      result.current.setSelectedRegion({
        id: 6737, worldViewId: 5, name: 'Europe', description: null,
        parentRegionId: null, color: '#123456', hasSubregions: true,
      } as Region);
    });

    await waitFor(() => expect(result.current.selectedRegion?.focusBbox).toEqual(EUROPE.focusBbox));
    // A patch that could be applied twice would re-select the region for ever;
    // each branch requires the field it fills to be missing, so this settles.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.selectedRegion?.parentRegionId).toBeNull();
    expect(mockFetchRegionAncestors).toHaveBeenCalledExactlyOnceWith(6737);
  });
});

/**
 * The region is in the address (#644): `/wv/5/r/7100-malta`. The address is
 * the source of truth for *which* region; the hook holds the hydrated object.
 * A selection writes the address, and an address that arrives from elsewhere —
 * a shared link, Back, the address bar — is followed.
 */
describe('useNavigation — the region the address names', () => {
  beforeEach(() => {
    mockFetchRegionAncestors.mockReset();
    mockFetchRegionAncestors.mockResolvedValue([EUROPE, MALTA]);
    mockFetchWorldViews.mockReset();
    mockFetchWorldViews.mockResolvedValue([WV5]);
    authState.isLoading = false;
    authState.user = null;
  });

  function renderAt(entry: string) {
    return renderHook(() => ({
      nav: useNavigation(),
      at: useLocation().pathname,
      type: useNavigationType(),
      navigate: useNavigate(),
    }), { wrapper: makeWrapper(entry) });
  }

  it('restores the region a shared link names, with its breadcrumbs', async () => {
    const { result } = renderAt('/wv/5/r/7100');

    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(7100));
    expect(result.current.nav.selectedRegion?.name).toBe('Malta');
    expect(result.current.nav.selectedRegion?.focusBbox).toEqual(MALTA.focusBbox);
    expect(result.current.nav.regionBreadcrumbs.map(r => r.id)).toEqual([6737, 7100]);
    // One read serves the restore and the breadcrumbs: same key, same function.
    expect(mockFetchRegionAncestors).toHaveBeenCalledExactlyOnceWith(7100);
  });

  it('brings the slug up to date in place once the name is known', async () => {
    // Ids decide, slugs decorate: a link made before a rename, or with a slug
    // typed by hand, still opens the region — and the address bar is corrected
    // without a step in history.
    const { result } = renderAt('/wv/5/r/7100-gozo');

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/7100-malta'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.nav.selectedRegion?.id).toBe(7100);
  });

  it('waits for the session to settle before asking', async () => {
    // For the reason the world-view list waits: the read is bounded by what the
    // caller may see, and an admin's hidden region asked for anonymously answers
    // 404 — which is not a 401, so nothing would retry it with the token.
    authState.isLoading = true;
    const { result, rerender } = renderAt('/wv/5/r/7100');

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(mockFetchRegionAncestors).not.toHaveBeenCalled();

    authState.isLoading = false;
    rerender();
    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(7100));
  });

  it('degrades to the world view when the region cannot be seen, and says nothing', async () => {
    // A 404 covers a region that does not exist and one in a hidden world view
    // alike, and the address must not tell them apart either.
    mockFetchRegionAncestors.mockRejectedValue(new Error('Not found'));
    const { result } = renderAt('/wv/5/r/424242');

    await waitFor(() => expect(result.current.at).toBe('/wv/5'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.nav.selectedRegion).toBeNull();
  });

  it('degrades when the region belongs to another world view', async () => {
    // The ancestors read is keyed on a region id alone, so it can answer about
    // a world view the caller may see but the address does not name.
    mockFetchRegionAncestors.mockResolvedValue([{ ...EUROPE, worldViewId: 9 }, { ...MALTA, worldViewId: 9 }]);
    const { result } = renderAt('/wv/5/r/7100');

    await waitFor(() => expect(result.current.at).toBe('/wv/5'));
    expect(result.current.nav.selectedRegion).toBeNull();
  });

  it('writes a selection into the address as a step the visitor took', async () => {
    const { result } = renderAt('/wv/5');

    act(() => { result.current.nav.setSelectedRegion(MALTA as Region); });

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/7100-malta'));
    expect(result.current.type).toBe('PUSH');
    expect(result.current.nav.selectedRegion?.id).toBe(7100);
  });

  it('writes the world view alone when the selection is cleared', async () => {
    const { result } = renderAt('/wv/5/r/7100');
    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(7100));

    act(() => { result.current.nav.setSelectedRegion(null); });

    await waitFor(() => expect(result.current.at).toBe('/wv/5'));
    expect(result.current.nav.selectedRegion).toBeNull();
    expect(result.current.nav.regionBreadcrumbs).toEqual([]);
  });

  it('follows Back to the region left behind', async () => {
    mockFetchRegionAncestors.mockImplementation(async (id: number) => (id === 6737 ? [EUROPE] : [EUROPE, MALTA]));
    const { result } = renderAt('/wv/5');

    act(() => { result.current.nav.setSelectedRegion(EUROPE as Region); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe'));
    act(() => { result.current.nav.setSelectedRegion(MALTA as Region); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/7100-malta'));

    act(() => { result.current.navigate(-1); });
    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(6737));
    expect(result.current.at).toBe('/wv/5/r/6737-europe');
    expect(result.current.nav.regionBreadcrumbs.map(r => r.id)).toEqual([6737]);

    act(() => { result.current.navigate(-1); });
    await waitFor(() => expect(result.current.nav.selectedRegion).toBeNull());
    expect(result.current.at).toBe('/wv/5');
  });

  it('follows Back across a world view switch without disturbing the address it went back to', async () => {
    // The two halves meet here: Back restores a *different* world view, and the
    // address it goes back to still names a region of it. Following a world
    // view the address already names must write nothing at all.
    //
    // The end state survives a write — `clearRegion` deliberately leaves a
    // restore the address has already asked for alone, so the region comes back
    // and rewrites the address — but the round trip is visible: the address
    // passes through the world view alone, replacing the entry that named the
    // region and then rebuilding it, two navigations where none was needed.
    // So this records every address rendered rather than only where it settles.
    mockFetchWorldViews.mockResolvedValue([WV5, WV7]);
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const nav = useNavigation();
      const at = useLocation().pathname;
      seen.push(at);
      return { nav, at, navigate: useNavigate() };
    }, { wrapper: makeWrapper('/wv/5/r/7100') });

    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(7100));
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/7100-malta'));

    act(() => { result.current.nav.setSelectedWorldView(WV7 as never); });
    await waitFor(() => expect(result.current.at).toBe('/wv/7'));
    expect(result.current.nav.selectedRegion).toBeNull();

    seen.length = 0;
    act(() => { result.current.navigate(-1); });

    await waitFor(() => expect(result.current.nav.selectedWorldView?.id).toBe(5));
    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(7100));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(result.current.at).toBe('/wv/5/r/7100-malta');
    expect(seen).not.toContain('/wv/5');
  });

  it('drops the region from the address on a world view switch', async () => {
    mockFetchWorldViews.mockResolvedValue([WV5, WV7]);
    const { result } = renderAt('/wv/5/r/7100');
    await waitFor(() => expect(result.current.nav.selectedRegion?.id).toBe(7100));

    act(() => { result.current.nav.setSelectedWorldView(WV7 as never); });

    await waitFor(() => expect(result.current.at).toBe('/wv/7'));
    expect(result.current.nav.selectedRegion).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.at).toBe('/wv/7');
  });
});
