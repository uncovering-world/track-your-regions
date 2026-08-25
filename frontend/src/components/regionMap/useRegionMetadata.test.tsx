import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const {
  mockFetchSubregions,
  mockFetchRootDivisions,
  mockFetchSubdivisions,
  navState,
} = vi.hoisted(() => ({
  mockFetchSubregions: vi.fn(),
  mockFetchRootDivisions: vi.fn(),
  mockFetchSubdivisions: vi.fn(),
  navState: {
    selectedWorldView: { id: 5 } as { id: number } | null,
    selectedWorldViewId: 5 as number | null,
    isCustomWorldView: true,
    rootRegions: [] as Array<{ id: number; name: string }>,
  },
}));

vi.mock('../../api', () => ({
  fetchSubregions: mockFetchSubregions,
  fetchRootDivisions: mockFetchRootDivisions,
  fetchSubdivisions: mockFetchSubdivisions,
}));

vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => navState,
}));

import { useRegionMetadata } from './useRegionMetadata';

const EUROPE = { id: 6737, name: 'Europe', hasSubregions: true, parentRegionId: null };
const AFRICA = { id: 6738, name: 'Africa', hasSubregions: true, parentRegionId: null };
const FRANCE = { id: 7100, name: 'France', hasSubregions: false, parentRegionId: 6737 };

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  Wrapper.queryClient = queryClient;
  return Wrapper;
}

/**
 * What the map reads to name and place what it draws (#649).
 *
 * The root of a custom world view draws every leaf region in it — 3 594 of them
 * on the Administrative world view — and reading the metadata of all of them
 * was the page's largest transfer after the entry chunk. It reads none of them
 * now: the tile carries a region's name, colour and parent, and the fly-to's
 * focus box comes with the ancestors read every selection makes anyway.
 */
describe('useRegionMetadata', () => {
  beforeEach(() => {
    mockFetchSubregions.mockReset();
    mockFetchSubregions.mockResolvedValue([]);
    mockFetchRootDivisions.mockReset();
    mockFetchRootDivisions.mockResolvedValue([]);
    mockFetchSubdivisions.mockReset();
    mockFetchSubdivisions.mockResolvedValue([]);
    navState.selectedWorldView = { id: 5 };
    navState.selectedWorldViewId = 5;
    navState.isCustomWorldView = true;
    navState.rootRegions = [EUROPE, AFRICA];
  });

  it('asks for no region list at the world-view root', async () => {
    const { result } = renderHook(() => useRegionMetadata('all-leaf', 'root'), {
      wrapper: makeWrapper(),
    });

    // Give React Query a chance to fire a request if the gate is missing.
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mockFetchSubregions).not.toHaveBeenCalled();
    expect(result.current.metadataLoading).toBe(false);
    // The eight regions the world view is rooted in are already in hand, from
    // the navigation context — the lookup is not empty, it is small.
    expect(Object.keys(result.current.metadataById)).toEqual(['6737', '6738']);
  });

  it("asks for one level's children below the root", async () => {
    mockFetchSubregions.mockResolvedValue([FRANCE]);

    const { result } = renderHook(() => useRegionMetadata(6737, 'root'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.metadataById[7100]).toBeDefined());
    expect(mockFetchSubregions).toHaveBeenCalledExactlyOnceWith(6737);
    expect(result.current.metadataById[7100].name).toBe('France');
    // Root regions stay in the lookup: a context layer draws them at this level,
    // and a click on one has to resolve to a name and a focus box.
    expect(result.current.metadataById[6737].name).toBe('Europe');
  });

  it('reads the children the region list already fetched, under its key', async () => {
    const Wrapper = makeWrapper();
    Wrapper.queryClient.setQueryData(['subregions', 6737], [FRANCE]);

    const { result } = renderHook(() => useRegionMetadata(6737, 'root'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.metadataById[7100]).toBeDefined());
    expect(mockFetchSubregions).not.toHaveBeenCalled();
  });

  it('reads divisions, not regions, on the GADM world view', async () => {
    navState.isCustomWorldView = false;
    mockFetchRootDivisions.mockResolvedValue([{ id: 1, name: 'France', hasChildren: true }]);

    const { result } = renderHook(() => useRegionMetadata('all-leaf', 'root'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.metadataById[1]).toBeDefined());
    expect(mockFetchSubregions).not.toHaveBeenCalled();
    expect(result.current.metadataById[1].hasChildren).toBe(true);
  });
});
