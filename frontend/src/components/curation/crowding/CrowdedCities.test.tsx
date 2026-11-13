/**
 * The review page's *Crowded cities* tab (#2282, #2358) on Berlin's squares
 * and Rome's churches: one line per region, kind and type, the first open by
 * default, a group the address names open whether the list holds it or not,
 * a place of it open in its own circle as the address says, the Region and
 * Kind filters, the window in the page with its Apply, and each group's staged
 * answers kept to that group.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/crowding', () => ({ fetchShadowedArrivals: vi.fn() }));
vi.mock('../../../api/crowdingAnswers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/crowdingAnswers')>()),
  answerCrowding: vi.fn(),
  fetchCrowdingGroup: vi.fn(),
  fetchCrowdingPlace: vi.fn(),
}));
vi.mock('../../../api/reviewQueue', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/reviewQueue')>()),
  searchReviewRegions: vi.fn(),
}));
// The map needs WebGL; the list and the answers are what is tested here.
vi.mock('./CrowdingMap', () => ({ CrowdingMap: () => <div data-testid="crowding-map" />, CrowdingLegend: () => null }));

import { fetchShadowedArrivals } from '../../../api/crowding';
import { answerCrowding, fetchCrowdingGroup, fetchCrowdingPlace } from '../../../api/crowdingAnswers';
import { searchReviewRegions } from '../../../api/reviewQueue';
import type { CrowdingGroup, ShadowedArrivalsGroup } from '../../../api/crowding';
import { CrowdedCities } from './CrowdedCities';
import type { GroupStagings } from './crowdedGroups';
import {
  berlinGroup, berlinSquares, BERLIN_SQUARES, ROME_CHURCHES, SCHLOSSPLATZ, schlossplatzCircle, squarePlace,
} from './crowdingFixtures';

const mockedArrivals = vi.mocked(fetchShadowedArrivals);
const mockedGroup = vi.mocked(fetchCrowdingGroup);
const mockedPlace = vi.mocked(fetchCrowdingPlace);
const mockedAnswer = vi.mocked(answerCrowding);
const mockedRegionSearch = vi.mocked(searchReviewRegions);

const PANTHEON = 40;
/** Rome's churches as Rome's page holds them: the Pantheon shown, Santa Maria Antiqua new and shadowed. */
const romeGroup: CrowdingGroup = {
  group: { regionId: 8, regionName: 'Rome', kindId: 4, type: 'church' },
  kind: { id: 4, name: 'Places of worship', limit: 10, radiusKm: 10, readsVenues: false, venueRadiusM: null },
  typeExempt: false,
  places: [
    squarePlace({ membershipId: PANTHEON, name: 'Pantheon', score: 0.98 }),
    squarePlace({
      membershipId: 41, name: 'Santa Maria Antiqua', score: 0.4, standing: 'new', crowded: true, ruleCrowded: true,
      outrankedBy: 33, betterKnown: ['St. Peter’s Basilica', 'Pantheon', 'Santa Maria Maggiore'],
    }),
  ],
  truncated: false,
};
const BERLIN_TITLE = 'Berlin · Squares & streets · square';
const ROME_TITLE = 'Rome · Places of worship · church';

/**
 * The read as the server answers it: the whole list, or the groups within the
 * region asked for (#2349), here each group's own region or the region `under`
 * names it under.
 */
function serve(groups: ShadowedArrivalsGroup[], under: Record<number, number[]> = {}) {
  mockedArrivals.mockImplementation(async (region?: number | 'none') => ({
    groups: region === undefined
      ? groups
      : groups.filter(group => (region === 'none'
        ? group.regionId === null
        : group.regionId === region || (under[region] ?? []).includes(group.regionId ?? -1))),
  }));
}

/** The tab as the page holds it: the address's group and place, and the staging the page keeps. */
function renderTab(initial: string | null = null, initialPlace: number | null = null) {
  const onSelect = vi.fn();
  const onSelectPlace = vi.fn();
  const onApplied = vi.fn();
  function Page() {
    const [selected, setSelected] = useState<string | null>(initial);
    const [place, setPlace] = useState<number | null>(initialPlace);
    const [stagings, setStagings] = useState<GroupStagings>(new Map());
    return (
      <CrowdedCities
        selected={selected}
        selectedPlace={place}
        onSelect={(key, opts) => { onSelect(key, opts); setSelected(key); setPlace(opts?.place ?? null); }}
        onSelectPlace={id => { onSelectPlace(id); setPlace(id); }}
        stagings={stagings}
        onStagings={setStagings}
        onApplied={onApplied}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page />
    </QueryClientProvider>,
  );
  return { onSelect, onSelectPlace, onApplied };
}

/** The list's line of one group, by its name. */
const line = (name: string) => screen.getByRole('button', { name: (accessible: string) => accessible.startsWith(name) });

/** The region list's row of one place, by its name. */
function rowOf(name: string) {
  const { membershipId } = [...berlinSquares, ...romeGroup.places].find(place => place.name === name)!;
  return within(screen.getByTestId(`crowding-place-${membershipId}`));
}

/** Picks one row of a filter chip's menu, and closes it the way a curator does. */
async function pick(chip: string, row: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith(chip) }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: row }));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

const berlinOpen = () => screen.findByRole('heading', { name: BERLIN_TITLE, level: 2 });

/** The list of groups unfolded from the bar it folds to beside an open group. */
const unfold = () => fireEvent.click(screen.getByRole('button', { name: 'Show every crowded city' }));

beforeEach(() => {
  mockedArrivals.mockReset();
  serve([BERLIN_SQUARES, ROME_CHURCHES]);
  mockedRegionSearch.mockReset().mockResolvedValue([]);
  mockedGroup.mockReset().mockImplementation(async group => (group.kindId === 4 ? romeGroup : berlinGroup));
  mockedPlace.mockReset().mockResolvedValue(schlossplatzCircle);
  mockedAnswer.mockReset();
});

describe('the crowded cities tab', () => {
  it('lists one line per region, kind and type, in the queue’s words', async () => {
    renderTab();

    expect(await screen.findByText('Berlin · squares')).toBeInTheDocument();
    expect(line('Berlin · squares')).toHaveTextContent('Squares & streets · 11 new places a crowded city would shadow');
    expect(line('Rome · churches')).toHaveTextContent('Places of worship · 3 new places a crowded city would shadow');
    expect(screen.getByText('14 new')).toBeInTheDocument();
  });

  it('opens the first group’s region list when the address names none, as a replace', async () => {
    const { onSelect } = renderTab();

    expect(await berlinOpen()).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith('7-9-square', { replace: true });
    expect(mockedGroup).toHaveBeenCalledWith(expect.objectContaining({ regionId: 7, kindId: 9, type: 'square' }));
    expect(screen.getByText(/^11 shown · 1 shadowed · 3 new\. As the region page shows it/)).toBeInTheDocument();
    expect(line('Berlin · squares')).toHaveClass('Mui-selected');
  });

  it('opens a group a curator picks, as a push', async () => {
    const { onSelect } = renderTab();
    await berlinOpen();

    fireEvent.click(line('Rome · churches'));
    expect(onSelect).toHaveBeenLastCalledWith('8-4-church', undefined);
    expect(await screen.findByRole('heading', { name: ROME_TITLE, level: 2 })).toBeInTheDocument();
  });

  it('opens a group the address names though the list holds none of its arrivals', async () => {
    const { onSelect } = renderTab('5-9-square');

    await waitFor(() => expect(mockedGroup).toHaveBeenCalledWith({ regionId: 5, kindId: 9, type: 'square' }));
    expect(onSelect).not.toHaveBeenCalled();
    // A group the address names opens with the list folded beside it (#2487).
    await berlinOpen();
    expect(screen.queryByRole('list', { name: 'Crowded cities' })).toBeNull();
    unfold();
    expect(line('Berlin · squares')).not.toHaveClass('Mui-selected');
  });

  it('opens the place a way in names alone, in its own group, and writes the group in as a replace (#2487)', async () => {
    const { onSelect } = renderTab(null, SCHLOSSPLATZ);

    expect(await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledWith(SCHLOSSPLATZ);
    // The place's group, never the first one the list holds, and the place stays open in it.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('7-9-square', { replace: true, place: SCHLOSSPLATZ });
    expect(screen.getByRole('heading', { name: BERLIN_TITLE, level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Crowded cities' })).toBeNull();
  });

  it('says so when the place a way in names cannot be read, and opens no other group in its place', async () => {
    mockedPlace.mockRejectedValue(new Error('Not found'));
    const { onSelect } = renderTab(null, 999);

    expect(await screen.findByText('Could not read the place: Not found')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Crowded cities' })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(mockedGroup).not.toHaveBeenCalled();
  });

  it('shows the list on a phone where a way in’s place cannot be read (#2487)', async () => {
    mockedPlace.mockRejectedValue(new Error('Not found'));
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query.includes('max-width'), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    try {
      renderTab(null, 999);

      expect(await screen.findByText('Could not read the place: Not found')).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Crowded cities' })).toBeInTheDocument();
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('opens a way in on the window on a phone, with the way back to the list (#2487)', async () => {
    // A phone: every max-width query matches, so the tab shows one side at a time.
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query.includes('max-width'), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    try {
      renderTab(null, SCHLOSSPLATZ);

      expect(await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Crowded cities' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'All crowded cities' }));
      expect(screen.getByRole('list', { name: 'Crowded cities' })).toBeInTheDocument();
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('folds the list to a bar while a picked group is open, and unfolds it from the bar (#2487)', async () => {
    renderTab();
    await berlinOpen();
    // Arriving on the tab with no group named, the curator reads the list first.
    expect(screen.getByRole('list', { name: 'Crowded cities' })).toBeInTheDocument();

    fireEvent.click(line('Rome · churches'));
    expect(await screen.findByRole('heading', { name: ROME_TITLE, level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Crowded cities' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Crowded cities' })).toHaveTextContent('Rome · churches');

    unfold();
    expect(line('Rome · churches')).toHaveClass('Mui-selected');
    fireEvent.click(screen.getByRole('button', { name: 'Fold the list beside the open group' }));
    expect(screen.queryByRole('list', { name: 'Crowded cities' })).toBeNull();
  });

  it('opens a place in its own circle on a click, as the address’s, and goes back to the region', async () => {
    const { onSelectPlace } = renderTab();
    await berlinOpen();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Schloßplatz' }));
    expect(onSelectPlace).toHaveBeenLastCalledWith(SCHLOSSPLATZ);
    expect(await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledWith(SCHLOSSPLATZ);

    fireEvent.click(screen.getByRole('button', { name: `← ${BERLIN_TITLE}, the whole region` }));
    expect(onSelectPlace).toHaveBeenLastCalledWith(null);
    expect(await screen.findByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
  });

  it('opens the place the address names', async () => {
    renderTab('7-9-square', SCHLOSSPLATZ);
    expect(await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeInTheDocument();
  });

  it('narrows the list by region, counting what each region would leave, and opens what is left', async () => {
    const { onSelect } = renderTab();
    await berlinOpen();

    fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Region') }));
    expect(screen.getByRole('menuitemradio', { name: /Berlin/ })).toHaveTextContent('11');
    expect(screen.getByRole('menuitemradio', { name: /Rome/ })).toHaveTextContent('3');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // Rome is a leaf: the server keeps its one group, as the list named it.
    await pick('Region', /Rome/);
    expect(mockedArrivals).toHaveBeenLastCalledWith(8);
    expect(await screen.findByText('Rome · churches')).toBeInTheDocument();
    expect(screen.queryByText('Berlin · squares')).toBeNull();
    expect(screen.getByText('3 new')).toBeInTheDocument();
    // The chip hides Berlin's squares, so the window opens what is left: Rome's churches.
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith('8-4-church', { replace: true }));
    expect(await screen.findByRole('heading', { name: ROME_TITLE, level: 2 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(await screen.findByText('Berlin · squares')).toBeInTheDocument();
  });

  it('searches every region, and shows the groups within the one found (#2349)', async () => {
    // A world view that splits Berlin into its districts: the list names the
    // districts, never Berlin, which only the search finds.
    const mitte = { ...BERLIN_SQUARES, regionId: 71, regionName: 'Mitte', arrivals: 3 };
    const kreuzberg = { ...BERLIN_SQUARES, regionId: 72, regionName: 'Friedrichshain-Kreuzberg', arrivals: 4 };
    serve([ROME_CHURCHES, kreuzberg, mitte], { 70: [71, 72] });
    mockedRegionSearch.mockResolvedValue([
      { id: 70, name: 'Berlin', path: 'Europe > Germany > Berlin', worldViewId: 2, worldView: 'Wikivoyage Regions' },
    ]);
    renderTab();
    await screen.findByText('Rome · churches');

    fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Region') }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a region' }), { target: { value: 'berl' } });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Berlin/ }));
    expect(mockedRegionSearch).toHaveBeenCalledWith('berl');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    expect(mockedArrivals).toHaveBeenLastCalledWith(70);
    expect(await screen.findByText('Mitte · squares')).toBeInTheDocument();
    expect(screen.getByText('Friedrichshain-Kreuzberg · squares')).toBeInTheDocument();
    expect(screen.queryByText('Rome · churches')).toBeNull();
    expect(screen.getByText('7 new')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Region') })).toHaveTextContent('Region: Berlin');

    // Its row stands at the top of the menu, counted, with its path, and clears it.
    fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Region') }));
    const berlin = screen.getAllByRole('menuitemradio')[0];
    expect(berlin).toHaveAccessibleName(/^Berlin/);
    expect(berlin).toHaveAttribute('aria-checked', 'true');
    expect(berlin).toHaveTextContent('Europe > Germany > Berlin · Wikivoyage Regions');
    expect(berlin).toHaveTextContent('7');
    fireEvent.click(berlin);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(await screen.findByText('Rome · churches')).toBeInTheDocument();
    expect(screen.getByText('Mitte · squares')).toBeInTheDocument();
    expect(screen.getByText('10 new')).toBeInTheDocument();
  });

  it('restores the whole list when the searched region is cleared by Clear all (#2349)', async () => {
    const mitte = { ...BERLIN_SQUARES, regionId: 71, regionName: 'Mitte', arrivals: 3 };
    serve([ROME_CHURCHES, mitte], { 70: [71] });
    mockedRegionSearch.mockResolvedValue([
      { id: 70, name: 'Berlin', path: 'Europe > Germany > Berlin', worldViewId: 2, worldView: 'Wikivoyage Regions' },
    ]);
    renderTab();
    await screen.findByText('Rome · churches');

    fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Region') }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search a region' }), { target: { value: 'berl' } });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Berlin/ }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(await screen.findByText('Mitte · squares')).toBeInTheDocument();
    expect(screen.queryByText('Rome · churches')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(await screen.findByText('Rome · churches')).toBeInTheDocument();
    expect(screen.getByText('Mitte · squares')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Region') })).toHaveTextContent(/^Region$/);
  });

  it('counts a kind under the region chosen, and dims one that would leave nothing', async () => {
    renderTab();
    await berlinOpen();
    await pick('Region', /Berlin/);
    await screen.findByText('Berlin · squares');

    fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith('Kind') }));
    expect(screen.getByRole('menuitemcheckbox', { name: /Squares & streets/ })).toHaveTextContent('11');
    expect(screen.getByRole('menuitemcheckbox', { name: /Places of worship/ })).toHaveTextContent('0');
  });

  it('applies the window’s answers in the page and has the page read the queue again', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    const { onApplied } = renderTab();
    await berlinOpen();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([{ membershipId: SCHLOSSPLATZ, answer: 'list' }]));
    expect(await screen.findByText('1 place shown anyway (1 new, published): Schloßplatz.')).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('keeps each group’s answers to itself: Apply sends the group’s own, and a group left keeps them', async () => {
    mockedAnswer.mockResolvedValue({ answered: [], refused: [], outOfScope: 0, placementFailed: [] });
    renderTab();
    await berlinOpen();
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    expect(line('Berlin · squares')).toHaveTextContent('1 staged');

    // To Rome: Berlin's answer is not Rome's to apply, and Rome's bar says where it waits.
    fireEvent.click(line('Rome · churches'));
    await screen.findByRole('heading', { name: ROME_TITLE, level: 2 });
    expect(await screen.findByText('1 answer staged in Berlin · squares')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.click(rowOf('Santa Maria Antiqua').getByRole('button', { name: 'Keep shadowed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([{ membershipId: 41, answer: 'shadow' }]));

    // Back to Berlin from the bar: its answer is still there, and goes with its own Apply.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await berlinOpen();
    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/staged in/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenLastCalledWith([{ membershipId: SCHLOSSPLATZ, answer: 'list' }]));
  });

  it('opens a group whose type is two words, as a link names it', async () => {
    // Places of worship's holy sites in Jerusalem: `holy site` holds a space.
    const holySites = { ...ROME_CHURCHES, regionId: 21, regionName: 'Jerusalem', type: 'holy site', arrivals: 2 };
    mockedArrivals.mockResolvedValue({ groups: [BERLIN_SQUARES, holySites] });
    const { onSelect } = renderTab('21-4-holy site');

    await waitFor(() => expect(mockedGroup).toHaveBeenCalledWith({ regionId: 21, kindId: 4, type: 'holy site' }));
    await screen.findByRole('heading', { name: ROME_TITLE, level: 2 });
    unfold();
    expect(line('Jerusalem · holy sites')).toHaveClass('Mui-selected');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays on its group and keeps its report when the Apply answers the group’s last arrival', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    const { onSelect } = renderTab();
    await berlinOpen();
    // Read again after the Apply, Berlin's squares have no arrival left to ask about.
    mockedArrivals.mockResolvedValue({ groups: [ROME_CHURCHES] });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));

    expect(await screen.findByText('1 place shown anyway (1 new, published): Schloßplatz.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Berlin · squares')).toBeNull());
    expect(screen.getByRole('heading', { name: BERLIN_TITLE, level: 2 })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('opens no other group while an Apply runs', async () => {
    let finish: (value: Awaited<ReturnType<typeof answerCrowding>>) => void = () => {};
    mockedAnswer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderTab();
    await berlinOpen();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(line('Rome · churches')).toHaveClass('Mui-disabled'));

    finish({ answered: [], refused: [], outOfScope: 0, placementFailed: [] });
    await waitFor(() => expect(line('Rome · churches')).not.toHaveClass('Mui-disabled'));
  });

  it('says so when no new place waits in a crowded city’s shadow', async () => {
    mockedArrivals.mockResolvedValue({ groups: [] });
    renderTab();
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(mockedGroup).not.toHaveBeenCalled();
  });
});
