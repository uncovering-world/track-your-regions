/**
 * The review page's *Crowded cities* tab (#2282) on Berlin's squares and
 * Rome's churches: one line per city, kind and type, the first open by
 * default, the Region and Kind filters, the window in the page with its
 * Apply, and each city's staged answers kept to that city.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/crowding', () => ({ fetchShadowedArrivals: vi.fn() }));
vi.mock('../../../api/crowdingAnswers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/crowdingAnswers')>()),
  answerCrowding: vi.fn(),
  fetchCrowdingWindow: vi.fn(),
}));
vi.mock('../../../api/reviewQueue', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/reviewQueue')>()),
  searchReviewRegions: vi.fn(),
}));
// The map needs WebGL; the list and the answers are what is tested here.
vi.mock('./CrowdingMap', () => ({ CrowdingMap: () => <div data-testid="crowding-map" /> }));

import { fetchShadowedArrivals } from '../../../api/crowding';
import { answerCrowding, fetchCrowdingWindow } from '../../../api/crowdingAnswers';
import { searchReviewRegions } from '../../../api/reviewQueue';
import type { ShadowedArrivalsGroup } from '../../../api/crowding';
import { CrowdedCities } from './CrowdedCities';
import type { GroupStagings } from './crowdedGroups';
import {
  aroundSchlossplatz, BERLIN_SQUARES, FRANKFURTER_TOR, NOLLENDORFPLATZ, ROME_CHURCHES, SCHLOSSPLATZ,
} from './crowdingFixtures';

const mockedArrivals = vi.mocked(fetchShadowedArrivals);
const mockedWindow = vi.mocked(fetchCrowdingWindow);
const mockedAnswer = vi.mocked(answerCrowding);
const mockedRegionSearch = vi.mocked(searchReviewRegions);

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

/** The tab as the page holds it: the address's group, and the staging the page keeps. */
function renderTab(initial: string | null = null) {
  const onSelect = vi.fn();
  const onApplied = vi.fn();
  function Page() {
    const [selected, setSelected] = useState<string | null>(initial);
    const [stagings, setStagings] = useState<GroupStagings>(new Map());
    return (
      <CrowdedCities
        selected={selected}
        onSelect={(key, opts) => { onSelect(key, opts); setSelected(key); }}
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
  return { onSelect, onApplied };
}

/** The list's line of one group, by its name. */
const line = (name: string) => screen.getByRole('button', { name: (accessible: string) => accessible.startsWith(name) });

/** The window's row of one place, by its name. */
function rowOf(name: string) {
  const cell = screen.getAllByText(name).find(element => element.closest('tbody'));
  return within(cell!.closest('tr')!);
}

/** Picks one row of a filter chip's menu, and closes it the way a curator does. */
async function pick(chip: string, row: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: (accessible: string) => accessible.startsWith(chip) }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: row }));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

beforeEach(() => {
  mockedArrivals.mockReset();
  serve([BERLIN_SQUARES, ROME_CHURCHES]);
  mockedRegionSearch.mockReset().mockResolvedValue([]);
  mockedWindow.mockReset().mockResolvedValue(aroundSchlossplatz);
  mockedAnswer.mockReset();
});

describe('the crowded cities tab', () => {
  it('lists one line per city, kind and type, in the queue’s words', async () => {
    renderTab();

    expect(await screen.findByText('Berlin · squares')).toBeInTheDocument();
    expect(line('Berlin · squares')).toHaveTextContent('Squares & streets · 11 new places a crowded city would shadow');
    expect(line('Rome · churches')).toHaveTextContent('Places of worship · 3 new places a crowded city would shadow');
    expect(screen.getByText('14 new')).toBeInTheDocument();
  });

  it('opens the first group when the address names none, as a replace', async () => {
    const { onSelect } = renderTab();

    expect(await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith('7-9-square', { replace: true });
    expect(mockedWindow).toHaveBeenCalledWith(SCHLOSSPLATZ, null);
    expect(screen.getByText('Berlin · squares: arrival 1 of 2')).toBeInTheDocument();
    expect(line('Berlin · squares')).toHaveClass('Mui-selected');
  });

  it('opens a group a curator picks, as a push', async () => {
    const { onSelect } = renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(line('Rome · churches'));
    expect(onSelect).toHaveBeenLastCalledWith('8-4-church', undefined);
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(40, null));
  });

  it('narrows the list by region, counting what each region would leave, and opens what is left', async () => {
    const { onSelect } = renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

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
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith('8-4-church', { replace: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(await screen.findByText('Berlin · squares')).toBeInTheDocument();
  });

  it('searches every region, and shows the groups within the one found (#2349)', async () => {
    // A world view that splits Berlin into its districts: the list names the
    // districts, never Berlin, which only the search finds.
    const mitte = { ...BERLIN_SQUARES, regionId: 71, regionName: 'Mitte', arrivals: 3, membershipIds: [SCHLOSSPLATZ] };
    const kreuzberg = { ...BERLIN_SQUARES, regionId: 72, regionName: 'Friedrichshain-Kreuzberg', arrivals: 4, membershipIds: [FRANKFURTER_TOR] };
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
    const mitte = { ...BERLIN_SQUARES, regionId: 71, regionName: 'Mitte', arrivals: 3, membershipIds: [SCHLOSSPLATZ] };
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
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
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
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([{ membershipId: SCHLOSSPLATZ, answer: 'list' }]));
    expect(await screen.findByText('1 place kept in the list (1 new, published): Schloßplatz.')).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('keeps each city’s answers to itself: Apply sends the city’s own, and a city left keeps them', async () => {
    mockedAnswer.mockResolvedValue({ answered: [], refused: [], outOfScope: 0, placementFailed: [] });
    renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    expect(line('Berlin · squares')).toHaveTextContent('1 staged');

    // To Rome, asked nothing: Berlin's answer is not Rome's to apply, and Rome's bar says where it waits.
    fireEvent.click(line('Rome · churches'));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(40, null));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('1 answer staged in Berlin · squares')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([{ membershipId: NOLLENDORFPLATZ, answer: 'shadow' }]));

    // Back to Berlin from the bar: its answer is still there, and goes with its own Apply.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(SCHLOSSPLATZ, null));
    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/staged in/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenLastCalledWith([{ membershipId: SCHLOSSPLATZ, answer: 'list' }]));
  });

  it('opens a city with answers staged from the bar though the chips hide it', async () => {
    renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    await pick('Region', /Rome/);
    expect(screen.queryByText('Berlin · squares')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Berlin · squares')).toBeInTheDocument();
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(SCHLOSSPLATZ, null));
  });

  it('opens a group whose type is two words, as a link names it', async () => {
    // Places of worship's holy sites in Jerusalem: `holy site` holds a space.
    const holySites = { ...ROME_CHURCHES, regionId: 21, regionName: 'Jerusalem', type: 'holy site', arrivals: 2, membershipIds: [70, 71] };
    mockedArrivals.mockResolvedValue({ groups: [BERLIN_SQUARES, holySites] });
    const { onSelect } = renderTab('21-4-holy site');

    await waitFor(() => expect(mockedWindow).toHaveBeenCalledWith(70, null));
    expect(line('Jerusalem · holy sites')).toHaveClass('Mui-selected');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps an Apply’s report when the Apply answers the group out of the list', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    const { onSelect } = renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    // Read again after the Apply, Berlin's squares have no arrival left to ask about.
    mockedArrivals.mockResolvedValue({ groups: [ROME_CHURCHES] });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));

    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith('8-4-church', { replace: true }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(40, null));
    expect(await screen.findByText('1 place kept in the list (1 new, published): Schloßplatz.')).toBeInTheDocument();
  });

  it('shows the newer report where a group that is gone lands on one holding an older report', async () => {
    const berlinReport = '1 place kept in the list (1 new, published): Schloßplatz.';
    const romeReport = '1 place kept in the shadow: Nollendorfplatz.';
    mockedArrivals.mockResolvedValue({ groups: [ROME_CHURCHES, BERLIN_SQUARES] });
    renderTab();
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(40, null));
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    // Some answers on Rome's churches: Rome stays listed and keeps its report.
    mockedAnswer.mockResolvedValueOnce({
      answered: [{ membershipId: NOLLENDORFPLATZ, experienceId: 1009, name: 'Nollendorfplatz', answer: 'shadow', pin: 'shadow', published: false, refused: false }],
      refused: [], outOfScope: 0, placementFailed: [],
    });
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    expect(await screen.findByText(romeReport)).toBeInTheDocument();

    // Berlin's squares all answered: Berlin leaves the list, and the tab lands on Rome.
    await waitFor(() => expect(line('Berlin · squares')).not.toHaveClass('Mui-disabled'));
    fireEvent.click(line('Berlin · squares'));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(SCHLOSSPLATZ, null));
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    mockedAnswer.mockResolvedValueOnce({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [], outOfScope: 0, placementFailed: [],
    });
    mockedArrivals.mockResolvedValue({ groups: [ROME_CHURCHES] });
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));

    await waitFor(() => expect(screen.queryByText('Berlin · squares')).toBeNull());
    expect(await screen.findByText(berlinReport)).toBeInTheDocument();
    expect(screen.queryByText(romeReport)).toBeNull();
  });

  it('says what the Apply did over the empty list when it answers the last group out of it', async () => {
    mockedArrivals.mockResolvedValue({ groups: [BERLIN_SQUARES] });
    mockedAnswer.mockResolvedValue({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [], outOfScope: 0, placementFailed: [],
    });
    renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    mockedArrivals.mockResolvedValue({ groups: [] });
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));

    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.getByText('1 place kept in the list (1 new, published): Schloßplatz.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('1 place kept in the list (1 new, published): Schloßplatz.')).toBeNull();
  });

  it('shows a report moved from a group that is gone on the group it moved to alone', async () => {
    const KYOTO_TEMPLES = { ...ROME_CHURCHES, regionId: 30, regionName: 'Kyoto', type: 'temple', arrivals: 33, membershipIds: [90, 91] };
    mockedArrivals.mockResolvedValue({ groups: [BERLIN_SQUARES, ROME_CHURCHES, KYOTO_TEMPLES] });
    mockedAnswer.mockResolvedValueOnce({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [], outOfScope: 0, placementFailed: [],
    });
    renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    const berlinReport = '1 place kept in the list (1 new, published): Schloßplatz.';

    // The Apply answers Berlin's last arrival: the list loses Berlin, and its report moves to Rome.
    mockedArrivals.mockResolvedValue({ groups: [ROME_CHURCHES, KYOTO_TEMPLES] });
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(40, null));
    expect(await screen.findByText(berlinReport)).toBeInTheDocument();

    // Kyoto, with no report of its own, does not show Berlin's.
    fireEvent.click(line('Kyoto · temples'));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(90, null));
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    expect(screen.queryByText(berlinReport)).toBeNull();

    // Kyoto's own Apply reports; back on Rome, Berlin's report has been read and is gone.
    mockedAnswer.mockResolvedValueOnce({
      answered: [{ membershipId: NOLLENDORFPLATZ, experienceId: 1009, name: 'Nollendorfplatz', answer: 'shadow', pin: 'shadow', published: false, refused: false }],
      refused: [], outOfScope: 0, placementFailed: [],
    });
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    expect(await screen.findByText('1 place kept in the shadow: Nollendorfplatz.')).toBeInTheDocument();
    await waitFor(() => expect(line('Rome · churches')).not.toHaveClass('Mui-disabled'));
    fireEvent.click(line('Rome · churches'));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(40, null));
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    expect(screen.queryByText(berlinReport)).toBeNull();
    expect(screen.queryByText('1 place kept in the shadow: Nollendorfplatz.')).toBeNull();
  });

  it('opens no other city while an Apply runs', async () => {
    let finish: (value: Awaited<ReturnType<typeof answerCrowding>>) => void = () => {};
    mockedAnswer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderTab();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(line('Rome · churches')).toHaveClass('Mui-disabled'));

    finish({ answered: [], refused: [], outOfScope: 0, placementFailed: [] });
    await waitFor(() => expect(line('Rome · churches')).not.toHaveClass('Mui-disabled'));
  });

  it('says so when no new place waits in a crowded city’s shadow', async () => {
    mockedArrivals.mockResolvedValue({ groups: [] });
    renderTab();
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(mockedWindow).not.toHaveBeenCalled();
  });
});
