/**
 * The crowded-city window (#2282, #2358) opened from Schloßplatz's card: the
 * place in its own circle within Berlin's squares, what it is compared with,
 * the way back to the region's list as Berlin's page shows it, each place's
 * picture, credit and article, the answers by standing, a hover's reason, the
 * map held in view, and answers staged and applied together with the Apply
 * bar's summary and the report by name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTheme } from '@mui/material';

vi.mock('../../../api/crowdingAnswers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/crowdingAnswers')>()),
  answerCrowding: vi.fn(),
  fetchCrowdingGroup: vi.fn(),
  fetchCrowdingPlace: vi.fn(),
}));
// The map needs WebGL; the list, the card and the answers are what is tested here.
vi.mock('./CrowdingMap', () => ({ CrowdingMap: () => <div data-testid="crowding-map" />, CrowdingLegend: () => null }));

import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingGroup, fetchCrowdingPlace } from '../../../api/crowdingAnswers';
import { crowdingLayout, HELD_MIN_HEIGHT } from './CrowdingWindow';
import { CrowdingWindowDialog } from './CrowdingWindowDialog';
import {
  ALEXANDERPLATZ_LOOK, berlinGroup, berlinSquares, NOLLENDORFPLATZ, ROSA_LUXEMBURG_PLATZ, SCHLOSSPLATZ, schlossplatzCircle,
} from './crowdingFixtures';

const mockedGroup = vi.mocked(fetchCrowdingGroup);
const mockedPlace = vi.mocked(fetchCrowdingPlace);
const mockedAnswer = vi.mocked(answerCrowding);
/** The theme's breakpoints are MUI's own. */
const theme = createTheme();
const TITLE = 'Berlin · Squares & streets · square';

function renderWindow(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CrowdingWindowDialog membershipId={SCHLOSSPLATZ} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

/** The window open on the region's list, from the card's place. */
async function inRegion() {
  fireEvent.click(await screen.findByRole('button', { name: `← ${TITLE}, the whole region` }));
  await screen.findByText(/^On the region page · /);
}

/** The region list's row of one place, by its name. */
function rowOf(name: string) {
  const { membershipId } = berlinSquares.find(place => place.name === name)!;
  return within(screen.getByTestId(`crowding-place-${membershipId}`));
}

beforeEach(() => {
  mockedGroup.mockReset();
  mockedPlace.mockReset();
  mockedAnswer.mockReset();
  mockedGroup.mockResolvedValue(berlinGroup);
  mockedPlace.mockResolvedValue(schlossplatzCircle);
});

describe("the region list's numbers (#2400)", () => {
  it("shows on every row what the place's score is made of, and the score, in the headings' columns, a dash where nothing is read (#2454)", async () => {
    renderWindow();
    await inRegion();

    const list = within(screen.getByRole('region', { name: "The region's list" }));
    // Each part of the list carries the figures' headings in its header, which sticks while the part scrolls.
    const page = within(list.getByRole('rowgroup', { name: /^On the region page/ }));
    expect(page.getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual([expect.stringMatching(/^On the region page/), 'Readers a year', 'Editions', 'In Wikivoyage', 'Score', 'Venues']);
    const cells = (name: string) => rowOf(name).getAllByRole('cell').map(cell => cell.textContent);
    expect(cells('Alexanderplatz')).toEqual(['209,401', '47', 'yes', '0.95', '64']);
    expect(cells('Leipziger Platz')).toEqual(['—', '18', '—', '0.73', '—']);
  });
});

describe('the window opened from a card', () => {
  it('opens the card’s place in its own circle, within its region’s group', async () => {
    renderWindow();

    expect(await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TITLE, level: 2 })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledWith(SCHLOSSPLATZ);
    expect(mockedGroup).toHaveBeenCalledWith(berlinGroup.group);
    expect(screen.getByText(/^The rule shadows it: 13 better-known squares stand within 10 km of it\./)).toBeInTheDocument();
    expect(screen.getByText('The answer is about Schloßplatz alone. Every other square keeps its own standing.')).toBeInTheDocument();

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText('13 better-known squares within 10 km. One other is less known.')).toBeInTheDocument();
    const compared = within(around.getByRole('rowgroup', { name: 'better known, compared with it' }));
    expect(compared.getByRole('button', { name: 'Alexanderplatz' })).toBeInTheDocument();
    expect(compared.getByText('0.7 km')).toBeInTheDocument();
    expect(compared.queryByRole('button', { name: 'Kulturforum' })).toBeNull();
    // The button counts every square around, so the circle names the ones the rule does not count against it too.
    const less = within(around.getByRole('rowgroup', { name: 'less known, not counted against it' }));
    expect(less.getByRole('button', { name: 'Kulturforum' })).toBeInTheDocument();
    expect(around.getByText(/^For the rule to show it, fewer than 10 squares better known than it/)).toBeInTheDocument();
  });

  it('lists a better-known neighbour the rule leaves out apart from the less known, with its reason (#2420)', async () => {
    // A square holding works a reader is shown, scored above Schloßplatz: ADR-0173 never counts it against another.
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      around: [...schlossplatzCircle.around, {
        ...schlossplatzCircle.around[0], membershipId: 998, name: 'Museum Island square', score: 0.9, compared: false, holdsWorks: true,
      }],
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText('13 better-known squares within 10 km. One more better known is not counted. One other is less known.'))
      .toBeInTheDocument();
    const uncounted = within(around.getByRole('rowgroup', { name: 'better known, not counted against it' }));
    expect(uncounted.getByRole('button', { name: 'Museum Island square' })).toBeInTheDocument();
    expect(uncounted.getByText('It holds works readers are shown.')).toBeInTheDocument();
    expect(within(around.getByRole('rowgroup', { name: 'less known, not counted against it' })).queryByRole('button', { name: 'Museum Island square' }))
      .toBeNull();
  });

  it('lists a neighbour a curator keeps on the list as compared with a place not measured yet', async () => {
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      place: { ...schlossplatzCircle.place, score: null, outrankedBy: null, ruleCrowded: false },
      around: schlossplatzCircle.around.map((entry, i) => ({ ...entry, compared: i === 0, pin: i === 0 ? 'list' as const : null })),
      measuringRun: null,
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(within(around.getByRole('rowgroup', { name: 'better known, compared with it' })).getByRole('button', { name: 'Alexanderplatz' }))
      .toBeInTheDocument();
    expect(around.getByText('Not measured yet: only the one a curator keeps on the list counts above it until the next sync run ends.'))
      .toBeInTheDocument();
    expect(around.queryByText(/nothing is compared/)).toBeNull();
  });

  it('lists the neighbours of a place not measured yet by their own figures, and never says nothing is above it (#2420)', async () => {
    // The Russian Church in Florence on 2026-11-10: arrived after fame was measured, while the next run went on.
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      place: { ...schlossplatzCircle.place, score: null, outrankedBy: null, ruleCrowded: false },
      around: [
        ...schlossplatzCircle.around.map(entry => ({ ...entry, compared: false })),
        { ...schlossplatzCircle.around[0], membershipId: 999, name: 'Marx-Engels-Forum', score: null, readers: null, compared: false },
      ],
      measuringRun: 'Squares & streets',
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText('Not measured yet: nothing is compared with it until the run of Squares & streets in progress ends.'))
      .toBeInTheDocument();
    expect(around.queryByText(/better-known|best-known/)).toBeNull();
    expect(around.queryByRole('rowgroup', { name: 'better known, compared with it' })).toBeNull();
    expect(within(around.getByRole('rowgroup', { name: 'measured, not compared with it' })).getByRole('button', { name: 'Alexanderplatz' }))
      .toBeInTheDocument();
    expect(within(around.getByRole('rowgroup', { name: 'not measured yet' })).getByRole('button', { name: 'Marx-Engels-Forum' }))
      .toBeInTheDocument();
  });

  it("shows the place's figures first in a table, and each place around it in the same columns (#2400, #2454)", async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const table = within(screen.getByRole('table', { name: 'Its figures and the places around it' }));
    expect(table.getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Place', 'Readers a year', 'Editions', 'In Wikivoyage', 'Score', 'Venues', '', 'Distance']);
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map(cell => cell.textContent);
    // The place itself is the first row, marked, with no rule's count in it: the card's sentence says that once.
    expect(cells(table.getByRole('row', { name: 'Schloßplatz, this place' }))).toEqual(['20,000', '17', 'yes', '0.70', '3', '', '']);
    expect(screen.queryByText(/Better within/)).toBeNull();
    const compared = within(screen.getByRole('rowgroup', { name: 'better known, compared with it' }));
    const rowOf = (name: string) => compared.getByRole('button', { name }).closest('[role="row"]') as HTMLElement;
    // Each place's name heads its row, and its figures stand in the headings' columns before its standing and distance.
    expect(within(rowOf('Alexanderplatz')).getByRole('rowheader')).toHaveTextContent('Alexanderplatz');
    expect(cells(rowOf('Alexanderplatz'))).toEqual(['209,401', '47', 'yes', '0.95', '64', '', '0.7 km']);
    // A place not read yet is a dash, never a zero, and its hint says so without a tab stop of its own.
    expect(cells(rowOf('Leipziger Platz')).slice(0, 5)).toEqual(['—', '18', '—', '0.73', '—']);
    expect(within(rowOf('Leipziger Platz')).getAllByLabelText('Not measured yet.')).toHaveLength(3);
    expect(within(rowOf('Leipziger Platz')).getAllByLabelText('Not measured yet.')[0]).not.toHaveAttribute('tabindex');
  });

  it('says what each heading counts, on hover and on keyboard focus (#2454)', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const score = screen.getByText('Score', { selector: '[tabindex="0"]' });
    score.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/from 0 to 1/);
  });

  it('answers the open place alone, with the answers its standing takes', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Show anyway' }));
    expect(screen.getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Keep shadowed' })).toBeInTheDocument();
    expect(screen.getByText(/^1 answer staged: show Schloßplatz anyway\. The region page will show 12 squares/)).toBeInTheDocument();
  });

  it('says how many of the places it is compared with it does not list', async () => {
    // Two of the thirteen above it are new arrivals of another curator's scope: counted, not named.
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      around: schlossplatzCircle.around.filter(entry => entry.name !== 'Frankfurter Tor' && entry.name !== 'Rosa-Luxemburg-Platz'),
      comparedUnlisted: 2,
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText(/^13 better-known squares within 10 km\./)).toBeInTheDocument();
    expect(around.queryByRole('button', { name: 'Frankfurter Tor' })).toBeNull();
    expect(around.getByText('2 more better known are not listed here: outside your scope, or no longer offered by their source.'))
      .toBeInTheDocument();
  });

  it('shows the place’s picture with its credit as a line, and opens it enlarged (ADR-0182)', async () => {
    mockedPlace.mockResolvedValue({ ...schlossplatzCircle, place: { ...schlossplatzCircle.place, ...ALEXANDERPLATZ_LOOK } });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    expect(screen.getByRole('img', { name: 'Schloßplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=250');
    expect(screen.getByRole('link', { name: 'Wladyslaw Sojka' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Schloßplatz — enlarge the picture' }));
    const enlarged = await screen.findByRole('dialog', { name: 'Schloßplatz' });
    expect(within(enlarged).getByRole('img', { name: 'Schloßplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=960');
  });

  it('opens a place it is compared with in that place’s own circle', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(within(screen.getByRole('region', { name: 'The places around it' })).getByRole('button', { name: 'Potsdamer Platz' }));
    await waitFor(() => expect(mockedPlace).toHaveBeenLastCalledWith(2));
  });

  it('returns to the region’s list as its page shows it: the page first, then the shadowed tail', async () => {
    renderWindow();
    await inRegion();

    expect(screen.getByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
    expect(screen.getByText('Shadowed · 3, in the list’s tail')).toBeInTheDocument();
    expect(rowOf('Alexanderplatz').getByText('the best known here')).toBeInTheDocument();
    expect(rowOf('Leipziger Platz').getByText('11 better known within 10 km')).toBeInTheDocument();
    expect(rowOf('Rosa-Luxemburg-Platz').getByText('New')).toBeInTheDocument();
  });

  it('offers each place the answers its standing takes', async () => {
    renderWindow();
    await inRegion();

    const buttons = (name: string) => rowOf(name).queryAllByRole('button').map(button => button.textContent).slice(1);
    expect(buttons('Nollendorfplatz')).toEqual(['Shadow']);
    expect(buttons('Leipziger Platz')).toEqual(['Show anyway', 'Keep shadowed']);
    expect(buttons('Rosa-Luxemburg-Platz')).toEqual(['Publish', 'Shadow', 'Don’t take']);
    expect(buttons('Schloßplatz')).toEqual(['Show anyway', 'Keep shadowed', 'Don’t take']);
    expect(buttons('Kulturforum')).toEqual([]);
    expect(rowOf('Kulturforum').getByText('Always shown: it holds works')).toBeInTheDocument();
  });

  it('says on a hover why a place stands where it stands', async () => {
    renderWindow();
    await inRegion();

    expect(screen.getByLabelText(
      'Shadowed: 11 better-known squares stand within 10 km of it: Alexanderplatz, Potsdamer Platz, Gendarmenmarkt, …',
    )).toBe(screen.getByTestId('crowding-place-12'));
  });

  it('shows what each place is: its picture with its credit, and its article; a place without them shows neither (#2345)', async () => {
    renderWindow();
    await inRegion();

    const alexanderplatz = rowOf('Alexanderplatz');
    expect(alexanderplatz.getByRole('img', { name: 'Alexanderplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=120');
    // A dense row: the credit is the badge on the thumbnail, opening the full credit (ADR-0182).
    fireEvent.click(alexanderplatz.getByRole('button', { name: 'Picture credit: © Wladyslaw Sojka · FAL' }));
    const credit = await screen.findByRole('presentation');
    expect(within(credit).getByRole('link', { name: 'Wladyslaw Sojka' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Berlin_-_Alexanderplatz1.jpg');
    fireEvent.keyDown(credit, { key: 'Escape' });
    expect(alexanderplatz.getByRole('link', { name: 'Wikipedia' }))
      .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Alexanderplatz');

    const potsdamerPlatz = rowOf('Potsdamer Platz');
    expect(potsdamerPlatz.queryByRole('img')).toBeNull();
    expect(potsdamerPlatz.queryByRole('link')).toBeNull();
  });

  it('takes the credit away with a picture that fails to load, and keeps the article', async () => {
    renderWindow();
    await inRegion();

    fireEvent.error(rowOf('Alexanderplatz').getByRole('img', { name: 'Alexanderplatz' }));

    expect(rowOf('Alexanderplatz').queryByRole('img')).toBeNull();
    expect(rowOf('Alexanderplatz').queryByRole('button', { name: /Picture credit/ })).toBeNull();
    expect(rowOf('Alexanderplatz').queryByRole('button', { name: /enlarge the picture/ })).toBeNull();
    expect(rowOf('Alexanderplatz').getByRole('link', { name: 'Wikipedia' })).toBeInTheDocument();
  });

  it('opens a row’s picture enlarged, with its full credit, without opening the place', async () => {
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Alexanderplatz').getByRole('button', { name: 'Alexanderplatz — enlarge the picture' }));

    const enlarged = await screen.findByRole('dialog', { name: 'Alexanderplatz' });
    expect(within(enlarged).getByRole('img', { name: 'Alexanderplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=960');
    expect(within(enlarged).getByRole('link', { name: 'Wladyslaw Sojka' })).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalledWith(1);
  });

  it('keeps the map in view while the list scrolls, beside it on a wide screen (#2345)', async () => {
    renderWindow();
    await inRegion();

    expect(within(screen.getByTestId('crowding-map-pane')).getByTestId('crowding-map')).toBeInTheDocument();
    expect(crowdingLayout('dialog', theme)).toEqual({
      body: {},
      mapPane: { p: 2, position: { md: 'sticky' }, top: { md: 0 } },
      mapFrame: { height: 420 },
      list: expect.objectContaining({ overflow: 'auto', minHeight: 0, maxHeight: { md: '65vh' } }),
    });
  });

  it('holds a lower map over the list on a tall enough laptop screen, and beside it on the widest (#2345)', () => {
    const held = '@media (min-width:900px) and (max-width:1535.95px) and (min-height:740px)';
    expect(HELD_MIN_HEIGHT).toBe(740);
    const page = crowdingLayout('page', theme);

    expect(page.mapPane).toMatchObject({ position: { xl: 'sticky' }, top: { xl: 16 } });
    expect(page.mapFrame).toEqual({ height: 420, [held]: { height: 'clamp(160px, calc(100vh - 573px), 280px)' } });
    expect(page.body).toEqual({ [held]: { maxHeight: 'max(calc(100vh - 140px), 593px)' } });
    expect(page.list).toEqual({
      flexGrow: 1, minWidth: 0, minHeight: 0, overflow: 'auto', [held]: { minHeight: 137 },
    });
    expect(Object.keys(page.body as object)).toEqual([held]);
    expect(page.mapPane).not.toHaveProperty('position.md');
  });
});

describe('answers applied together', () => {
  it('sums the staged answers up with the count the region page will show, and reports each by name', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [
        { membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false },
        { membershipId: ROSA_LUXEMBURG_PLATZ, experienceId: 1013, name: 'Rosa-Luxemburg-Platz', answer: 'publish', pin: null, published: true, refused: false },
        { membershipId: NOLLENDORFPLATZ, experienceId: 1009, name: 'Nollendorfplatz', answer: 'shadow', pin: 'shadow', published: false, refused: false },
      ],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    const onClose = renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Show anyway' }));
    await inRegion();
    fireEvent.click(rowOf('Rosa-Luxemburg-Platz').getByRole('button', { name: 'Publish' }));
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(
      '3 answers staged: show Schloßplatz anyway, publish Rosa-Luxemburg-Platz, shadow Nollendorfplatz. '
        + 'The region page will show 12 squares, before the rule recounts their neighbours.',
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply 3 answers' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([
      { membershipId: SCHLOSSPLATZ, answer: 'list' },
      { membershipId: ROSA_LUXEMBURG_PLATZ, answer: 'publish' },
      { membershipId: NOLLENDORFPLATZ, answer: 'shadow' },
    ]));
    expect(await screen.findByText('1 place shown anyway (1 new, published): Schloßplatz.')).toBeInTheDocument();
    expect(screen.getByText('1 place published and left to the rule: Rosa-Luxemburg-Platz.')).toBeInTheDocument();
    // The staging is cleared and the city read again.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await waitFor(() => expect(mockedGroup).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Close the window' }));
    expect(onClose).toHaveBeenCalledWith(expect.stringContaining('Schloßplatz'));
  });

  it('returns to the region’s list once the open place is not taken', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'refuse', pin: null, published: false, refused: true }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Don’t take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    expect(await screen.findByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
  });

  it('returns to the region’s list once a partly applied Apply refused the open place', async () => {
    // The first page refused Schloßplatz, and a later page failed.
    mockedAnswer.mockRejectedValue(new CrowdingPartlyApplied({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'refuse', pin: null, published: false, refused: true }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    }, new Error('The connection was lost')));
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Don’t take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    expect(await screen.findByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeNull();
  });

  it('keeps the answers a failed later page never sent staged, and clears only the ones it settled', async () => {
    mockedAnswer.mockRejectedValue(new CrowdingPartlyApplied({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    }, new Error('The connection was lost')));
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 answers' }));

    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an answer staged while an Apply runs, which that Apply did not send', async () => {
    let finish: (value: Awaited<ReturnType<typeof answerCrowding>>) => void = () => {};
    mockedAnswer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([{ membershipId: SCHLOSSPLATZ, answer: 'list' }]));
    // Staged while the first Apply's pages go.
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    finish({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('takes a staged answer back with a second press and with Reset', async () => {
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Keep shadowed' }));
    expect(screen.getByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Keep shadowed' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(mockedAnswer).not.toHaveBeenCalled();
  });
});
