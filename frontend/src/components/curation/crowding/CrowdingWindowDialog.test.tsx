/**
 * The crowded-city window (#2282) on Berlin's squares around Schloßplatz:
 * the rows and the rule's line, each place's picture, credit and article, the
 * map held in view, answers staged and applied together with one Apply, the
 * report by name, and a step through a group of arrivals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTheme } from '@mui/material';

vi.mock('../../../api/crowdingAnswers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/crowdingAnswers')>()),
  answerCrowding: vi.fn(),
  fetchCrowdingWindow: vi.fn(),
}));
// The map needs WebGL; the list and the answers are what is tested here.
vi.mock('./CrowdingMap', () => ({ CrowdingMap: () => <div data-testid="crowding-map" /> }));

import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingWindow } from '../../../api/crowdingAnswers';
import { crowdingLayout, HELD_MIN_HEIGHT } from './CrowdingWindow';
import { CrowdingWindowDialog } from './CrowdingWindowDialog';
import { aroundSchlossplatz, FRANKFURTER_TOR, NOLLENDORFPLATZ, SCHLOSSPLATZ } from './crowdingFixtures';

const mockedWindow = vi.mocked(fetchCrowdingWindow);
/** The theme's breakpoints are MUI's own. */
const theme = createTheme();
const mockedAnswer = vi.mocked(answerCrowding);

function renderWindow(memberships: number[] = [SCHLOSSPLATZ], onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CrowdingWindowDialog memberships={memberships} groupName={memberships.length > 1 ? 'Berlin · squares' : undefined} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

/** The list's row of one place, by its name. */
function rowOf(name: string) {
  const cell = screen.getAllByText(name).find(element => element.closest('tbody'));
  return within(cell!.closest('tr')!);
}

beforeEach(() => {
  mockedWindow.mockReset();
  mockedAnswer.mockReset();
  mockedWindow.mockResolvedValue(aroundSchlossplatz);
});

describe('the crowded-city window', () => {
  it('lists every square around the card’s place, best known first, with the line where the rule’s ten end', async () => {
    renderWindow();

    expect(await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' })).toBeInTheDocument();
    expect(mockedWindow).toHaveBeenCalledWith(SCHLOSSPLATZ, null);
    const names = screen.getAllByRole('row').slice(1).map(row => row.textContent ?? '');
    expect(names[0]).toMatch(/^1Alexanderplatz/);
    // The line stands between Hackescher Markt, the tenth, and Frankfurter Tor.
    expect(names[10]).toMatch(/^The rule’s 10 end here/);
    expect(names[11]).toMatch(/^11Frankfurter Tor/);
    expect(rowOf('Schloßplatz').getByText('new · the rule shadows it')).toBeInTheDocument();
    expect(rowOf('Schloßplatz').getByText('the card’s place')).toBeInTheDocument();
    expect(rowOf('Leipziger Platz').getByText('shadowed')).toBeInTheDocument();
    expect(rowOf('Leipziger Platz').getByText('counts above Schloßplatz')).toBeInTheDocument();
  });

  it('offers no pin on a place holding works, which is always shown', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    const kulturforum = rowOf('Kulturforum');
    expect(kulturforum.getByRole('button', { name: 'List' })).toBeDisabled();
    expect(kulturforum.getByRole('button', { name: 'Shadow' })).toBeDisabled();
    expect(kulturforum.getByRole('button', { name: 'Don’t take' })).toBeEnabled();
    expect(kulturforum.getByText('holds works · always shown')).toBeInTheDocument();
  });

  it('shows what each place is: its picture with its credit, and its article; a row without them shows neither (#2345)', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    const alexanderplatz = rowOf('Alexanderplatz');
    expect(alexanderplatz.getByRole('img', { name: 'Alexanderplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=120');
    expect(alexanderplatz.getByRole('link', { name: 'Wladyslaw Sojka' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Berlin_-_Alexanderplatz1.jpg');
    expect(alexanderplatz.getByRole('link', { name: 'FAL' })).toHaveAttribute('href', 'http://artlibre.org/licence/lal/en');
    expect(alexanderplatz.getByRole('link', { name: 'Wikipedia' }))
      .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Alexanderplatz');

    const potsdamerPlatz = rowOf('Potsdamer Platz');
    expect(potsdamerPlatz.queryByRole('img')).toBeNull();
    expect(potsdamerPlatz.queryByRole('link')).toBeNull();
  });

  it('takes the credit away with a picture that fails to load, and keeps the article', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.error(rowOf('Alexanderplatz').getByRole('img', { name: 'Alexanderplatz' }));

    const alexanderplatz = rowOf('Alexanderplatz');
    expect(alexanderplatz.queryByRole('img')).toBeNull();
    expect(alexanderplatz.queryByText('Wladyslaw Sojka')).toBeNull();
    expect(alexanderplatz.queryByText('FAL')).toBeNull();
    expect(alexanderplatz.getByRole('link', { name: 'Wikipedia' })).toBeInTheDocument();
  });

  it('draws no picture, and so no credit, from a host the product may not draw from', async () => {
    mockedWindow.mockResolvedValue({
      ...aroundSchlossplatz,
      rows: aroundSchlossplatz.rows.map(row => (row.name === 'Alexanderplatz'
        ? { ...row, imageUrl: 'https://whc.unesco.org/uploads/sites/gallery/original/site_0001.jpg' }
        : row)),
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    expect(rowOf('Alexanderplatz').queryByRole('img')).toBeNull();
    expect(rowOf('Alexanderplatz').queryByText('Wladyslaw Sojka')).toBeNull();
  });

  it('keeps the map in view while the list scrolls, beside it on a wide screen (#2345)', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    expect(within(screen.getByTestId('crowding-map-pane')).getByTestId('crowding-map')).toBeInTheDocument();
    // The dialog sets the map beside the list from a medium width and holds it at the top of its
    // content; the list scrolls in its own box. Below that the dialog is a phone's full screen.
    expect(crowdingLayout('dialog', theme)).toEqual({
      body: {},
      mapPane: { p: 2, position: { md: 'sticky' }, top: { md: 0 } },
      mapFrame: { height: 420 },
      list: expect.objectContaining({ overflow: 'auto', minHeight: 0, maxHeight: { md: '65vh' } }),
    });
  });

  it('holds a lower map over the list on a tall enough laptop screen, and beside it on the widest (#2345)', () => {
    // A laptop's width, on a screen tall enough for the least map, three rows and the Apply bar:
    // a 1440 by 900 laptop shows about 780 px inside the browser.
    const held = '@media (min-width:900px) and (max-width:1535.95px) and (min-height:740px)';
    expect(HELD_MIN_HEIGHT).toBe(740);
    const page = crowdingLayout('page', theme);

    // From the widest screens the map stands beside the list and holds just below the top, as
    // the page's list of cities does; the list runs on with the page.
    expect(page.mapPane).toMatchObject({ position: { xl: 'sticky' }, top: { xl: 16 } });
    // On such a laptop screen the map is lower, as tall as the screen leaves room for between
    // 160 and 280 px, and the map and the list together stand no taller than the screen above
    // the Apply bar, never leaving the list fewer than three rows: the list scrolls in its own
    // box under the map, so its header row is never under the map.
    expect(page.mapFrame).toEqual({ height: 420, [held]: { height: 'clamp(160px, calc(100vh - 573px), 280px)' } });
    expect(page.body).toEqual({ [held]: { maxHeight: 'max(calc(100vh - 140px), 593px)' } });
    expect(page.list).toEqual({
      flexGrow: 1, minWidth: 0, minHeight: 0, overflow: 'auto', [held]: { minHeight: 137 },
    });
    // On a shorter laptop screen (1366 by 768, or one at 200 % zoom) and on a phone, nothing
    // is held or capped: the full map stands over the list and the page scrolls both.
    expect(Object.keys(page.body as object)).toEqual([held]);
    expect(page.mapPane).not.toHaveProperty('position.md');
  });

  it('applies the staged answers together and reports each by name', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [
        { membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false },
        { membershipId: NOLLENDORFPLATZ, experienceId: 1009, name: 'Nollendorfplatz', answer: 'shadow', pin: 'shadow', published: false, refused: false },
      ],
      refused: [{ membershipId: FRANKFURTER_TOR, experienceId: 1011, name: 'Frankfurter Tor', status: 409, error: 'This place is a new arrival now — reload to publish it with its answer' }],
      outOfScope: 0,
      placementFailed: [],
    });
    const onClose = renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(rowOf('Frankfurter Tor').getByRole('button', { name: 'Don’t take' }));
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/New here: 2, answered 2\. Changed among those already in: 1\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply 3 answers' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([
      { membershipId: SCHLOSSPLATZ, answer: 'list' },
      { membershipId: NOLLENDORFPLATZ, answer: 'shadow' },
      { membershipId: FRANKFURTER_TOR, answer: 'refuse' },
    ]));
    expect(await screen.findByText('1 place kept in the list (1 new, published): Schloßplatz.')).toBeInTheDocument();
    expect(screen.getByText('1 place kept in the shadow: Nollendorfplatz.')).toBeInTheDocument();
    expect(screen.getByText(/^Frankfurter Tor refused — This place is a new arrival now/)).toBeInTheDocument();
    // The staging is cleared and the city read again.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await waitFor(() => expect(mockedWindow).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Close the window' }));
    expect(onClose).toHaveBeenCalledWith(expect.stringContaining('Schloßplatz'));
  });

  it('keeps the answers a failed later page never sent staged, and clears only the ones it settled', async () => {
    // Rome's churches can pass the 100-answer page: the first page applies, the second fails.
    mockedAnswer.mockRejectedValue(new CrowdingPartlyApplied({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    }, new Error('The connection was lost')));
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 answers' }));

    // Schloßplatz was settled; Nollendorfplatz was never sent and stays staged to send again.
    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an answer staged while an Apply runs, which that Apply did not send', async () => {
    let finish: (value: Awaited<ReturnType<typeof answerCrowding>>) => void = () => {};
    mockedAnswer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'List' }));
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
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says why an answer is not offered where a curator can hover it', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    // A disabled button takes no pointer events: the reason is on the element around it.
    const list = rowOf('Kulturforum').getByRole('button', { name: 'List' });
    expect(list.closest('span[title]')?.getAttribute('title')).toMatch(/works/);
  });

  it('takes a staged answer back with a second press and with Reset', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Shadow' }));
    expect(screen.getByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Shadow' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Don’t take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(mockedAnswer).not.toHaveBeenCalled();
  });

  it('switches to another type of the kind around the same place', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });

    fireEvent.click(screen.getByRole('button', { name: 'Street · 9' }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(SCHLOSSPLATZ, 'street'));
  });

  it('takes no new answer on the squares still shown while the streets load', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Squares around Schloßplatz · 10 km' });
    mockedWindow.mockReturnValueOnce(new Promise(() => {}));

    fireEvent.click(screen.getByRole('button', { name: 'Street · 9' }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(SCHLOSSPLATZ, 'street'));
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'List' })).toBeDisabled();
  });

  it('steps through a group of shadowed arrivals', async () => {
    renderWindow([SCHLOSSPLATZ, FRANKFURTER_TOR]);
    expect(await screen.findByText('Berlin · squares: arrival 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(FRANKFURTER_TOR, null));
    expect(screen.getByText('Berlin · squares: arrival 2 of 2')).toBeInTheDocument();
  });
});
