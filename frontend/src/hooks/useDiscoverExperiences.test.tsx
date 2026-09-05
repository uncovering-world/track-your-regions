/**
 * Discover reads its place from the address (#644): the region the visitor is
 * looking at, the category list open on it, the card open in that list.
 *
 *   /discover/wv/5/r/7100-malta          the tree standing at Malta
 *   /discover/wv/5/r/7100-malta?cat=1    Malta's UNESCO list, the tree at its parent
 *   /discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1   that list, with the card open
 *
 * `r` is the region in question. With a list open it is the region whose list
 * it is, and the tree stands at its parent — exactly the state a chip click
 * produces. Discover keeps no region state of its own: the region comes from
 * `useNavigation`, so the two views share one place and the header can carry
 * it across.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import type { Experience } from '../api/experiences';

const { mockFetchWorldViews, mockFetchRegionAncestors, countsSpy, mockFetchByRegion, authState } = vi.hoisted(() => ({
  mockFetchWorldViews: vi.fn(),
  mockFetchRegionAncestors: vi.fn(),
  countsSpy: vi.fn(),
  mockFetchByRegion: vi.fn(),
  authState: { isLoading: false, isAdmin: false, user: null as { id: number } | null },
}));

vi.mock('../api', () => ({
  fetchWorldViews: mockFetchWorldViews,
  fetchDivisionAncestors: vi.fn().mockResolvedValue([]),
  fetchRootRegions: vi.fn().mockResolvedValue([]),
  fetchRegionAncestors: mockFetchRegionAncestors,
}));
// The hook imports from '../api/experiences', not the barrel — vitest matches on
// the resolved path, so mocking '../api' alone would leave these on the real
// authFetchJson.
vi.mock('../api/experiences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/experiences')>();
  return {
    ...actual,
    fetchExperienceRegionCounts: countsSpy,
    fetchExperienceCategories: vi.fn().mockResolvedValue([
      { id: 1, name: 'UNESCO World Heritage Sites', is_active: true },
      { id: 2, name: 'Top Art Museums', is_active: true },
    ]),
    fetchExperiencesByRegion: mockFetchByRegion,
    fetchExperienceLocations: vi.fn().mockResolvedValue({ locations: [] }),
  };
});
vi.mock('./useAuth', () => ({ useAuth: () => authState }));

import { NavigationProvider } from './useNavigation';
import { useDiscoverExperiences } from './useDiscoverExperiences';

const WV5 = { id: 5, name: 'Administrative', isDefault: false, isPublic: true };
const WV2 = { id: 2, name: 'Wikivoyage Regions', isDefault: false, isPublic: true };
const EUROPE = { id: 6737, worldViewId: 5, name: 'Europe', parentRegionId: null, color: null, hasSubregions: true };
const MALTA = { id: 7100, worldViewId: 5, name: 'Malta', parentRegionId: 6737, color: null, hasSubregions: false };
const STONEHENGE = { id: 1234, name: 'Stonehenge', type: 'cultural', category_name: 'UNESCO World Heritage Sites' } as Experience;

function makeWrapper(entry = '/discover/wv/5') {
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

function useUnderTest() {
  const discover = useDiscoverExperiences();
  const location = useLocation();
  return { discover, at: `${location.pathname}${location.search}`, type: useNavigationType() };
}

function renderAt(entry?: string) {
  return renderHook(useUnderTest, { wrapper: makeWrapper(entry) });
}

beforeEach(() => {
  mockFetchWorldViews.mockReset();
  mockFetchWorldViews.mockResolvedValue([WV5, WV2]);
  mockFetchRegionAncestors.mockReset();
  mockFetchRegionAncestors.mockImplementation(async (id: number) => (id === 6737 ? [EUROPE] : [EUROPE, MALTA]));
  countsSpy.mockReset();
  countsSpy.mockResolvedValue([]);
  mockFetchByRegion.mockReset();
  mockFetchByRegion.mockResolvedValue({ experiences: [STONEHENGE], total: 1, lostHidden: 0 });
  authState.isLoading = false;
  authState.user = null;
});

describe('useDiscoverExperiences — the place is in the address', () => {
  it('writes the tree level into the address as a step', async () => {
    const { result } = renderAt();
    await waitFor(() => expect(result.current.discover.selectedWorldView?.id).toBe(5));

    act(() => { result.current.discover.navigateToRegion(6737, 'Europe'); });

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/6737-europe'));
    expect(result.current.type).toBe('PUSH');
    expect(result.current.discover.currentParentId).toBe(6737);
    expect(result.current.discover.breadcrumbs).toEqual([{ regionId: 6737, regionName: 'Europe' }]);
    expect(result.current.discover.activeView).toBeNull();
  });

  it('writes an open category list beside the region, with the tree at its parent', async () => {
    const { result } = renderAt();
    await waitFor(() => expect(result.current.discover.selectedWorldView?.id).toBe(5));
    act(() => { result.current.discover.navigateToRegion(6737, 'Europe'); });
    // Wait for the level's own ancestors, as a real click on a chip does: the
    // trail is complete before the reader can reach a chip on that level.
    await waitFor(() => expect(result.current.discover.breadcrumbs).toEqual([{ regionId: 6737, regionName: 'Europe' }]));

    // A chip on Malta's row, at the Europe level.
    act(() => { result.current.discover.openExperienceView(7100, 'Malta', 1, 'UNESCO World Heritage Sites'); });

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/7100-malta?cat=1'));
    expect(result.current.discover.activeView).toEqual({
      regionId: 7100, regionName: 'Malta', categoryId: 1, categoryName: 'UNESCO World Heritage Sites',
    });
    // The tree stays where the chip was clicked. The level trail derives from
    // the region's ancestors, so it settles a tick after the address.
    expect(result.current.discover.currentParentId).toBe(6737);
    await waitFor(() => expect(result.current.discover.breadcrumbs).toEqual([{ regionId: 6737, regionName: 'Europe' }]));
  });

  it('restores the tree level from the address', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100');

    await waitFor(() => expect(result.current.discover.currentParentId).toBe(7100));
    expect(result.current.discover.breadcrumbs).toEqual([
      { regionId: 6737, regionName: 'Europe' },
      { regionId: 7100, regionName: 'Malta' },
    ]);
    expect(result.current.discover.activeView).toBeNull();
  });

  it('restores an open list from the address, with the tree at the region\'s parent', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100?cat=1');

    await waitFor(() => expect(result.current.discover.activeView?.regionId).toBe(7100));
    expect(result.current.discover.activeView).toEqual({
      regionId: 7100, regionName: 'Malta', categoryId: 1, categoryName: 'UNESCO World Heritage Sites',
    });
    expect(result.current.discover.currentParentId).toBe(6737);
    expect(result.current.discover.breadcrumbs).toEqual([{ regionId: 6737, regionName: 'Europe' }]);
    await waitFor(() => expect(result.current.discover.experiences).toEqual([STONEHENGE]));
  });

  it('closing the list returns to the level it was opened from', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100?cat=1');
    await waitFor(() => expect(result.current.discover.activeView?.regionId).toBe(7100));

    act(() => { result.current.discover.closeExperienceView(); });

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/6737-europe'));
    expect(result.current.discover.activeView).toBeNull();
    expect(result.current.discover.currentParentId).toBe(6737);
  });

  it('a breadcrumb takes the tree back up, and home takes it to the root', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100');
    await waitFor(() => expect(result.current.discover.currentParentId).toBe(7100));

    act(() => { result.current.discover.navigateToBreadcrumb(0); });
    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/6737-europe'));
    expect(result.current.discover.currentParentId).toBe(6737);

    act(() => { result.current.discover.navigateToBreadcrumb(-1); });
    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5'));
    expect(result.current.discover.currentParentId).toBeNull();
    expect(result.current.discover.breadcrumbs).toEqual([]);
  });

  it('opens a card by writing it into the address, pushed', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100?cat=1');
    await waitFor(() => expect(result.current.discover.experiences).toEqual([STONEHENGE]));

    act(() => { result.current.discover.setSelectedExperienceId(1234); });

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1'));
    expect(result.current.type).toBe('PUSH');
    expect(result.current.discover.selectedExperienceId).toBe(1234);
  });

  it('finds the category of a card the address names without one', async () => {
    // What the header writes on the way from the map: the card, no category.
    // The category is the object's own, so it is read off the object.
    const { result } = renderAt('/discover/wv/5/r/7100/e/1234');

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.discover.activeView?.categoryId).toBe(1);
    expect(result.current.discover.selectedExperienceId).toBe(1234);
  });

  it('brings the card\'s slug up to date in place once the list names it', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100-malta/e/1234?cat=1');

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.discover.selectedExperienceId).toBe(1234);
  });

  it('keeps the card when the list fails, rather than spending the link on a hiccup', async () => {
    mockFetchByRegion.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderAt('/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1');

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(result.current.at).toBe('/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1');
  });

  it('keeps a card whose category is unknown when the list fails', async () => {
    // The other effect: without a category it reads the object to find one, and
    // a failure there must not take the card out of the address either.
    mockFetchByRegion.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderAt('/discover/wv/5/r/7100-malta/e/1234-stonehenge');

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(result.current.at).toBe('/discover/wv/5/r/7100-malta/e/1234-stonehenge');
  });

  it('drops a card the list does not hold, in place', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100/e/999?cat=1');

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/7100-malta?cat=1'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.discover.selectedExperienceId).toBeNull();
  });

  it('drops a category nobody knows, in place', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100?cat=42');

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5/r/7100-malta'));
    expect(result.current.discover.activeView).toBeNull();
    expect(result.current.discover.currentParentId).toBe(7100);
  });
});

/**
 * Discover no longer keeps a world-view context of its own: its trail, list
 * and card all derive from the region `useNavigation` holds, so a world view
 * that changes underneath it takes the whole of that with it, in the same
 * commit — nothing here has to notice.
 */
describe('useDiscoverExperiences — the world view underneath it', () => {
  it('drops its whole context when the world view changes underneath it', async () => {
    const { result } = renderAt('/discover/wv/5/r/7100/e/1234?cat=1');
    await waitFor(() => expect(result.current.discover.selectedExperienceId).toBe(1234));
    expect(result.current.discover.breadcrumbs).toHaveLength(1);
    expect(result.current.discover.activeView).not.toBeNull();

    // What the picker does, and what the reconciliation does on session expiry.
    act(() => { result.current.discover.changeWorldView(WV2 as never); });

    await waitFor(() => expect(result.current.discover.selectedWorldView?.id).toBe(2));
    expect(result.current.discover.breadcrumbs).toEqual([]);
    expect(result.current.discover.activeView).toBeNull();
    expect(result.current.discover.selectedExperienceId).toBeNull();
    await waitFor(() => expect(result.current.at).toBe('/discover/wv/2'));
  });

  it('does not wipe a region chosen before the world view object arrives', async () => {
    // selectedWorldViewId falls back to the address, so the counts query is
    // enabled and the root level is rendered and clickable while the world view
    // list is still in flight. The first arrival of the object must not read as
    // a switch.
    let release: (v: unknown) => void = () => {};
    mockFetchWorldViews.mockImplementation(() => new Promise(r => { release = r; }));
    const { result } = renderAt();

    act(() => { result.current.discover.navigateToRegion(6737, 'Europe'); });
    expect(result.current.discover.breadcrumbs).toHaveLength(1);

    act(() => release([WV5, WV2]));
    await waitFor(() => expect(result.current.discover.selectedWorldView?.id).toBe(5));
    expect(result.current.discover.breadcrumbs).toHaveLength(1);
  });

  it('never asks for counts pairing the new world view with the old region', async () => {
    // The counts query is keyed on [selectedWorldViewId, currentParentId]. Were
    // the trail reset from an effect, one render would escape with the new id
    // and the old parent and fire a request for a pairing that never existed.
    const { result } = renderAt();
    await waitFor(() => expect(result.current.discover.selectedWorldView?.id).toBe(5));
    act(() => { result.current.discover.navigateToRegion(6737, 'Europe'); });
    await waitFor(() => expect(countsSpy).toHaveBeenCalledWith(5, 6737));
    countsSpy.mockClear();

    act(() => { result.current.discover.changeWorldView(WV2 as never); });

    // The positive half first: a loop over an empty array asserts nothing.
    await waitFor(() => expect(countsSpy).toHaveBeenCalledWith(2, undefined));
    for (const call of countsSpy.mock.calls) {
      expect(call).not.toEqual([2, 6737]);
    }
  });
});
