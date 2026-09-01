/**
 * What the navigation pane's search offers, and what one click does (#592).
 *
 * The rule under test is the one the maintainer settled when the feature was
 * planned: the search answers about the whole catalogue, and a row is a link
 * only where the world view already open places the object. Everything else is
 * still an answer — shown, and saying why it cannot be opened — because a
 * catalogue that holds the Great Barrier Reef must not report "no results" for
 * it.
 *
 * The address is written through the real `useAppAddress` and read back off the
 * router, so what these assert is the URL a visitor would actually land on,
 * slugs included.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';

const { navState, mockSearchExperiences, mockSearchRegions, mockSearchDivisions } = vi.hoisted(() => ({
  navState: {
    selectedWorldView: { id: 5, name: 'Administrative', isDefault: false },
    isCustomWorldView: true,
    setSelectedDivision: vi.fn(),
    setSelectedRegion: vi.fn(),
  },
  mockSearchExperiences: vi.fn(),
  mockSearchRegions: vi.fn(),
  mockSearchDivisions: vi.fn(),
}));

vi.mock('../hooks/useNavigation', () => ({ useNavigation: () => navState }));
vi.mock('../api', () => ({
  searchRegions: mockSearchRegions,
  searchDivisions: mockSearchDivisions,
}));
vi.mock('../api/experiences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/experiences')>();
  return { ...actual, searchExperiences: mockSearchExperiences };
});

import { Search } from './Search';

/** The Rijksmuseum's own chain, as the read returns it: smallest place first. */
const RIJKSMUSEUM = {
  id: 6198,
  name: 'Rijksmuseum',
  short_description: null,
  category: 'art',
  category_id: 2,
  category_name: 'Top Art Museums',
  country_names: ['Netherlands'],
  image_url: null,
  longitude: 4.88,
  latitude: 52.36,
  relevance: 1,
  regions: [
    { id: 7100, name: 'Noord-Holland', world_view_id: 5, world_view_name: 'Administrative' },
    { id: 7091, name: 'Netherlands', world_view_id: 5, world_view_name: 'Administrative' },
    { id: 6737, name: 'Europe', world_view_id: 5, world_view_name: 'Administrative' },
  ],
};

/** Placed, but not in the world view the reader is in. */
const ALHAMBRA = {
  ...RIJKSMUSEUM,
  id: 411,
  name: 'Alhambra',
  category_name: 'UNESCO World Heritage Sites',
  country_names: ['Spain'],
  regions: [
    { id: 8001, name: 'Andalusia', world_view_id: 2, world_view_name: 'Wikivoyage Regions' },
  ],
};

/** Placed nowhere: the matcher gap (#469, #470), not a gap in the catalogue. */
const GREAT_BARRIER_REEF = {
  ...RIJKSMUSEUM,
  id: 412,
  name: 'Great Barrier Reef',
  category_name: 'UNESCO World Heritage Sites',
  country_names: ['Australia'],
  regions: [],
};

function Address() {
  const location = useLocation();
  return <div data-testid="address">{`${location.pathname}${location.search}`}</div>;
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/wv/5']}>
      <QueryClientProvider client={client}>
        <Search />
        <Address />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function type(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Search regions and experiences...'), {
    target: { value: text },
  });
}

const address = () => screen.getByTestId('address').textContent;

describe('the navigation pane search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navState.selectedWorldView = { id: 5, name: 'Administrative', isDefault: false };
    navState.isCustomWorldView = true;
    mockSearchRegions.mockResolvedValue([]);
    mockSearchDivisions.mockResolvedValue([]);
    mockSearchExperiences.mockResolvedValue({ query: '', results: [], total: 0 });
  });

  it('opens a result at the smallest region of the world view the reader is in', async () => {
    mockSearchExperiences.mockResolvedValue({
      query: 'rijks', results: [RIJKSMUSEUM], total: 1,
    });
    renderSearch();
    await type('rijks');

    const row = await screen.findByRole('button', { name: /Rijksmuseum/ });
    fireEvent.click(row);

    // Noord-Holland, not Europe: the object hangs on the whole chain, and the
    // smallest of them is the one that frames it rather than the continent.
    expect(address()).toBe('/wv/5/r/7100-noord-holland/e/6198-rijksmuseum');
  });

  it('shows an object this world view does not place, without offering a link to it', async () => {
    mockSearchExperiences.mockResolvedValue({ query: 'alh', results: [ALHAMBRA], total: 1 });
    renderSearch();
    await type('alh');

    expect(await screen.findByText(/not in this world view/)).toBeTruthy();
    // The search never moves anyone between world views: the lens is the
    // reader's choice, and a result is not a reason to change it.
    expect(screen.queryByRole('button', { name: /Alhambra/ })).toBeNull();
  });

  it('shows an object no world view places at all, and says that is what happened', async () => {
    mockSearchExperiences.mockResolvedValue({
      query: 'great', results: [GREAT_BARRIER_REEF], total: 1,
    });
    renderSearch();
    await type('great');

    expect(await screen.findByText(/not on a map yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Great Barrier Reef/ })).toBeNull();
  });

  it('answers about regions and experiences at once, each under its own heading', async () => {
    mockSearchRegions.mockResolvedValue([
      { id: 7091, name: 'Netherlands', path: 'Europe > Netherlands' },
    ]);
    mockSearchExperiences.mockResolvedValue({
      query: 'nether', results: [RIJKSMUSEUM], total: 1,
    });
    renderSearch();
    await type('nether');

    expect(await screen.findByText('Regions')).toBeTruthy();
    expect(screen.getByText('Experiences')).toBeTruthy();
  });

  it('says nothing found only when neither half found anything', async () => {
    renderSearch();
    await type('zzzz');

    expect(await screen.findByText('No results found')).toBeTruthy();
  });

  it('asks nothing of the API for a single character', async () => {
    renderSearch();
    await type('r');

    // Waited past the debounce deliberately. The assertion is that nothing was
    // sent, and at t=0 nothing has been sent whatever the minimum length is —
    // `useDebouncedValue` publishes at 300 ms, so asserting before that would
    // pass with `MIN_QUERY` removed altogether. Inside `act` because the
    // debounce publishing is a state update.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
    });
    expect(mockSearchExperiences).not.toHaveBeenCalled();
    expect(mockSearchRegions).not.toHaveBeenCalled();
  });

  it('leaves the reader where they are while the default world view is open', async () => {
    // The default world view owns no regions — its map is the administrative
    // tree — so an address under it names no region and nothing is openable.
    navState.selectedWorldView = { id: 1, name: 'GADM', isDefault: true };
    navState.isCustomWorldView = false;
    mockSearchExperiences.mockResolvedValue({
      query: 'rijks', results: [RIJKSMUSEUM], total: 1,
    });
    renderSearch();
    await type('rijks');

    expect(await screen.findByText(/not in this world view/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rijksmuseum/ })).toBeNull();
  });
});
