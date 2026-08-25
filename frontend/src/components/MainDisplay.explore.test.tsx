/**
 * When the explore panel is open, and when it is not.
 *
 * Two rules meet here, and each was got wrong once. A card in the address is
 * open in the panel, so a link straight to one lands on the card rather than on
 * a closed panel with a card inside it — and closing that card leaves the panel
 * open, because the reader came for the place and is now browsing the rest of
 * it. A change of *region*, meanwhile, closes the panel.
 *
 * The two only stay apart if "a card is in the address" is scoped to the region
 * that card belongs to: a selection made in the app sets the region urgently and
 * writes the address through the router's transition, so there is a commit
 * holding the new region beside the previous region's card.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Region } from '../types';

const { navState, mockFetchByRegion } = vi.hoisted(() => ({
  navState: {
    selectedRegion: null as Region | null,
    worldViews: [{ id: 5, name: 'Administrative', isDefault: false }],
    isLoading: false,
  },
  mockFetchByRegion: vi.fn(),
}));

vi.mock('../hooks/useNavigation', () => ({ useNavigation: () => navState }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
// The leaves jsdom cannot run, and the panel's own contents, which have their
// own tests: what is under test here is whether the panel is mounted at all.
vi.mock('./RegionMapVT', () => ({ RegionMapVT: () => <div data-testid="map" /> }));
vi.mock('./RegionDescriptionSection', () => ({
  RegionDescriptionSection: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose} data-testid="panel">Close exploration</button>
  ),
}));
vi.mock('../api/experiences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/experiences')>();
  return { ...actual, fetchExperiencesByRegion: mockFetchByRegion };
});

import { MainDisplay } from './MainDisplay';

const TESTLAND = { id: 9001, name: 'Testland', worldViewId: 5 } as Region;
const ELSEWHERE = { id: 9002, name: 'Elsewhere', worldViewId: 5 } as Region;

function renderAt(entry: string, children?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <MainDisplay />
        {children}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const panel = () => screen.queryByTestId('panel');

describe('the explore panel', () => {
  beforeEach(() => {
    mockFetchByRegion.mockReset();
    mockFetchByRegion.mockResolvedValue({ experiences: [], total: 0, lostHidden: 0 });
    navState.selectedRegion = null;
    navState.isLoading = false;
  });

  it('is closed on a region with no card in its address', () => {
    navState.selectedRegion = TESTLAND;
    renderAt('/wv/5/r/9001-testland');
    expect(panel()).toBeNull();
  });

  it('is open when the address names a card of the region on screen', () => {
    navState.selectedRegion = TESTLAND;
    renderAt('/wv/5/r/9001-testland/e/1-somewhere');
    expect(panel()).not.toBeNull();
  });

  it('stays closed when the address names a card of another region', () => {
    // The commit a selection passes through: the region is set urgently and the
    // address catches up a beat later, so this render holds the new region and
    // the previous region's card. Reading that as "a card is open here" would
    // leave the panel open on a region the reader has just moved to.
    navState.selectedRegion = ELSEWHERE;
    renderAt('/wv/5/r/9001-testland/e/1-somewhere');
    expect(panel()).toBeNull();
  });

  it('closes when the reader moves to another region', async () => {
    // Opened by the reader rather than by the address, so this covers the
    // effect and nothing else: with a card in the address the panel would be
    // closed on the new region anyway — the card belongs to the region left —
    // and the test would pass with that effect deleted.
    navState.selectedRegion = TESTLAND;
    const { rerender } = renderAt('/wv/5/r/9001-testland');
    expect(panel()).toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: 'Explore experiences in this region' }).click();
    });
    expect(panel()).not.toBeNull();

    navState.selectedRegion = ELSEWHERE;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      rerender(
        <MemoryRouter initialEntries={['/wv/5/r/9001-testland']}>
          <QueryClientProvider client={client}>
            <MainDisplay />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });

    expect(panel()).toBeNull();
  });
});
