import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import type { Region } from '../types';

const { mockFetchRegionAncestors, authState } = vi.hoisted(() => ({
  mockFetchRegionAncestors: vi.fn(),
  authState: { isLoading: false, isAdmin: false, user: null as { id: number } | null },
}));

vi.mock('../api', () => ({
  fetchWorldViews: vi.fn().mockResolvedValue([{ id: 5, name: 'Administrative', isDefault: false, isPublic: true }]),
  fetchDivisionAncestors: vi.fn().mockResolvedValue([]),
  fetchRootRegions: vi.fn().mockResolvedValue([]),
  fetchRegionAncestors: mockFetchRegionAncestors,
}));

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
