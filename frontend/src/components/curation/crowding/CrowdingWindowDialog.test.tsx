/**
 * The crowded-city window (#2282) on Berlin's squares around Schloßplatz:
 * the rows and the rule's line, answers staged and applied together with one
 * Apply, the report by name, and a step through a group of arrivals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/crowdingAnswers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/crowdingAnswers')>()),
  answerCrowding: vi.fn(),
  fetchCrowdingWindow: vi.fn(),
}));

import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingWindow } from '../../../api/crowdingAnswers';
import { CrowdingWindowDialog } from './CrowdingWindowDialog';
import { aroundSchlossplatz, FRANKFURTER_TOR, NOLLENDORFPLATZ, SCHLOSSPLATZ } from './crowdingFixtures';

const mockedWindow = vi.mocked(fetchCrowdingWindow);
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

  it('steps through a group of shadowed arrivals', async () => {
    renderWindow([SCHLOSSPLATZ, FRANKFURTER_TOR]);
    expect(await screen.findByText('Berlin · squares: arrival 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mockedWindow).toHaveBeenLastCalledWith(FRANKFURTER_TOR, null));
    expect(screen.getByText('Berlin · squares: arrival 2 of 2')).toBeInTheDocument();
  });
});
