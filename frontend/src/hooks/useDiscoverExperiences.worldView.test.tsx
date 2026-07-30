import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Discover keeps its own world-view context — the breadcrumb trail, the active
 * region+category view, and the selected experience — and `useNavigation` cannot
 * reach it. On main that did not matter: the reconciliation lived in
 * `HierarchySwitcher`, which mounts only in map mode, so a world view on
 * /discover simply stayed put. Moving it into `useNavigation` reaches this route
 * for the first time, and a switch that leaves the old trail rendered is the
 * thing the reconciliation exists to prevent.
 */
const navState = {
  selectedWorldView: null as { id: number; name: string } | null,
  selectedWorldViewId: null as number | null,
  worldViews: [] as unknown[],
  setSelectedWorldView: vi.fn(),
};

vi.mock('./useNavigation', () => ({ useNavigation: () => navState }));
// The hook imports from '../api/experiences', not the barrel — vitest matches on
// the resolved path, so mocking '../api' here would be inert and every query
// would reach the real authFetchJson.
const { countsSpy } = vi.hoisted(() => ({ countsSpy: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/experiences', () => ({
  fetchExperienceRegionCounts: countsSpy,
  fetchExperienceCategories: vi.fn().mockResolvedValue([]),
  fetchExperiencesByRegion: vi.fn().mockResolvedValue([]),
  fetchExperienceLocations: vi.fn().mockResolvedValue([]),
}));

import { useDiscoverExperiences } from './useDiscoverExperiences';

/**
 * The client is built once, outside the component. Both tests here drive the hook
 * with `rerender()`, and a client constructed in the render body would be a new
 * one each time — react-query seeds its observer from the client it saw on first
 * render, so the observers and the context would drift apart while the test
 * looked isolated.
 */
function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useDiscoverExperiences world view context', () => {
  beforeEach(() => {
    navState.selectedWorldView = { id: 5, name: 'Administrative' };
    navState.selectedWorldViewId = 5;
  });

  it('drops its whole context when the world view changes underneath it', () => {
    const { result, rerender } = renderHook(() => useDiscoverExperiences(), { wrapper: makeWrapper() });

    // All three, and each set to something — asserting that a field which was
    // already null is still null proves nothing.
    act(() => {
      result.current.navigateToRegion(91, 'A region of world view 5');
    });
    act(() => {
      result.current.openExperienceView(91, 'A region of world view 5', 1, 'UNESCO');
    });
    act(() => { result.current.setSelectedExperienceId(777); });
    expect(result.current.breadcrumbs).toHaveLength(1);
    expect(result.current.activeView).not.toBeNull();
    expect(result.current.selectedExperienceId).toBe(777);

    // What the reconciliation does on session expiry: no call into this hook,
    // just a different world view arriving from useNavigation.
    navState.selectedWorldView = { id: 2, name: 'Wikivoyage Regions' };
    navState.selectedWorldViewId = 2;
    rerender();

    expect(result.current.breadcrumbs).toEqual([]);
    expect(result.current.activeView).toBeNull();
    expect(result.current.selectedExperienceId).toBeNull();
  });

  it('does not wipe a region chosen before the world view object arrives', () => {
    // selectedWorldViewId falls back to `?wv`, so the counts query is enabled and
    // the root level is rendered and clickable while the world view list is still
    // in flight. The first arrival of the object must not read as a switch.
    navState.selectedWorldView = null;
    navState.selectedWorldViewId = 5;

    const { result, rerender } = renderHook(() => useDiscoverExperiences(), {
      wrapper: makeWrapper(),
    });

    act(() => { result.current.navigateToRegion(91, 'Chosen early'); });
    expect(result.current.breadcrumbs).toHaveLength(1);

    // The list lands and useNavigation picks the world view `?wv` named.
    navState.selectedWorldView = { id: 5, name: 'Administrative' };
    rerender();

    expect(result.current.breadcrumbs).toHaveLength(1);
  });

  it('never asks for counts pairing the new world view with the old region', () => {
    // The counts query is keyed on [selectedWorldViewId, currentParentId]. Reset
    // from an effect, one render would escape with the new id and the old parent
    // and fire a request for a pairing that never existed.
    const { result, rerender } = renderHook(() => useDiscoverExperiences(), { wrapper: makeWrapper() });

    act(() => { result.current.navigateToRegion(91, 'A region of world view 5'); });
    countsSpy.mockClear();

    navState.selectedWorldView = { id: 2, name: 'Wikivoyage Regions' };
    navState.selectedWorldViewId = 2;
    rerender();

    // The positive half first: a loop over an empty array asserts nothing, and a
    // query gated behind something that never lands would empty it.
    expect(countsSpy).toHaveBeenCalledWith(2, undefined);
    for (const call of countsSpy.mock.calls) {
      expect(call).not.toEqual([2, 91]);
    }
  });
});
