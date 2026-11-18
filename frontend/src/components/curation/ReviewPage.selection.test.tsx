/**
 * Tests for answering a selection from the page (#852): the ticks reach the
 * bar and the summary, one answer goes to the batch route in the server's
 * words, the line afterwards says what happened, and a batch past one page
 * asks first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
  invalidateAfterBatchPublication: vi.fn(),
}));

const { mockedFetch, mockedAnswer } = vi.hoisted(() => ({ mockedFetch: vi.fn(), mockedAnswer: vi.fn() }));

// The crowded-city read (#2282): no arrival a crowded city shadows.
vi.mock('../../api/crowding', () => ({
  fetchShadowedArrivals: vi.fn(async () => ({ groups: [] })),
}));
vi.mock('../../api/reviewQueue', () => ({
  fetchReviewQueue: async (params: unknown) => shaped(await mockedFetch(params)),
  answerReviewRows: mockedAnswer,
  REVIEW_ANSWER_ROWS_MAX: 100,
  setRunAside: vi.fn(),
  bringRunBack: vi.fn(),
}));
vi.mock('../../api/curation', () => ({
  setExperienceState: vi.fn(),
  setExperienceAdmission: vi.fn(),
  setLocationState: vi.fn(),
  acceptSourceValue: vi.fn(),
  declineSourceValue: vi.fn(),
  declineHeld: vi.fn(),
  publishExperience: vi.fn(),
  refuseArrival: vi.fn(),
  refuseContents: vi.fn(),
}));
vi.mock('../../api/experiences', () => ({
  fetchExperience: vi.fn(),
}));

import { invalidateAfterBatchPublication } from '../../utils/queryInvalidation';
import {
  shaped, renderQueue, ARRIVAL, CONFLICT, CONTENTS, MISSING, NO_FACETS,
} from './reviewQueueFixtures';

const SECOND_ARRIVAL = { ...ARRIVAL, id: 56, name: 'Museo Jumex' };

function tick(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
}

describe('answering a selection', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedAnswer.mockReset();
    mockedFetch.mockResolvedValue({
      arrivals: [ARRIVAL, SECOND_ARRIVAL], conflicts: [CONFLICT], missing: [MISSING], limit: 25,
    });
    mockedAnswer.mockResolvedValue({
      answer: 'accept',
      answered: [
        { kind: 'waiting', id: 55, name: 'Museo Soumaya', answer: 'accept', did: { published: 1, locations: 1 } },
        { kind: 'waiting', id: 56, name: 'Museo Jumex', answer: 'accept', did: { published: 1 } },
      ],
      refused: [], outOfScope: 0, placementFailed: [],
    });
  });

  it('shows the bar and the summary once two rows are ticked, and Lost only for the verdict kinds', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    tick('Museo Soumaya');
    tick('Museo Jumex');

    const bar = screen.getByRole('region', { name: 'Selected questions' });
    expect(bar.textContent).toContain('2 arrivals');
    expect(screen.queryByRole('button', { name: 'Lost' })).toBeNull();
    // The bench sums the selection rather than opening one card.
    expect(screen.getByText('2 questions ticked. One answer goes to all of them; each object is answered on its own, and the line afterwards says what refused.')).toBeInTheDocument();
    // Every kind says what the answer does in its card's words.
    fireEvent.click(screen.getAllByRole('button', { name: 'What it does' })[1]);
    expect(bar.textContent).toContain('Keep it out');
  });

  it('sends the ticked rows to the batch route in the server’s words and reports the line', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    tick('Museo Soumaya');
    tick('Museo Jumex');
    fireEvent.click(screen.getByRole('button', { name: 'Accept the proposed changes' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledTimes(1));
    // An acceptance gives no reason: only a turn-away says why.
    expect(mockedAnswer).toHaveBeenCalledWith(
      [{ kind: 'waiting', id: 55, runId: 98 }, { kind: 'waiting', id: 56, runId: 98 }], 'accept', undefined);
    expect(await screen.findByText('2 objects published. 1 point now visible.')).toBeInTheDocument();
    expect(invalidateAfterBatchPublication).toHaveBeenCalled();
    // The ticks are gone with the batch, and the bar with them.
    expect(screen.queryByRole('region', { name: 'Selected questions' })).toBeNull();
  });

  it('renames the one kind the row spells differently, and carries the run', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Serengeti National Park' });
    tick('Serengeti National Park');
    // A disagreement kept as it stands turns nothing away, so it asks no reason.
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(
      [{ kind: 'conflict', id: 88, runId: 98 }], 'reject', undefined));
  });

  it('turns a selection of arrivals away with one reason for every one of them (#863)', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    tick('Museo Soumaya');
    tick('Museo Jumex');

    expect(screen.queryByRole('button', { name: 'Reject the proposed changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn away 2' }));
    const lines = within(screen.getByRole('menu')).getAllByRole('menuitem').map(line => line.textContent);
    expect(lines).toEqual([
      'Not this kind of place', 'Nothing to see', 'Not one place', 'Gone or not built', 'Same as another', 'Wrong place', 'Other…',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Same as another' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(
      [{ kind: 'waiting', id: 55, runId: 98 }, { kind: 'waiting', id: 56, runId: 98 }], 'reject',
      { reasonCode: 'duplicate', note: undefined }));
  });

  it('sends the words typed under Other with a batch turned away', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    tick('Museo Soumaya');
    fireEvent.click(screen.getByRole('button', { name: 'Turn away 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('A few words'), { target: { value: 'a private collection' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn away 1' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(
      [{ kind: 'waiting', id: 55, runId: 98 }], 'reject', { reasonCode: 'other', note: 'a private collection' }));
  });

  it('offers Lost to a selection wholly of one verdict kind', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Dresden Elbe Valley' });
    tick('Dresden Elbe Valley');
    expect(screen.getByRole('button', { name: 'Lost' })).toBeInTheDocument();
  });

  it('records a selection of missing places as lost with one reason for every one of them (#863)', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Dresden Elbe Valley' });
    tick('Dresden Elbe Valley');
    fireEvent.click(screen.getByRole('button', { name: 'Lost' }));
    expect(within(screen.getByRole('menu')).getByText('Why record them as gone by hand')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'The rule missed it' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'missing', id: 77 })], 'lost', { reasonCode: 'missing-from-rule', note: undefined }));
  });

  it('withholds Lost from an all-matching selection whose filters reach other kinds', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], limit: 25, total: 1078 });
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Dresden Elbe Valley' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select the 1 questions loaded' }));
    expect(screen.getByRole('button', { name: 'Lost' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all 1,078 matching' }));
    expect(screen.queryByRole('button', { name: 'Lost' })).toBeNull();
  });

  it('turns down a page of unread contents without asking, now that it has a take-back', async () => {
    // Turning down unread contents has the list and the take-back its neighbours
    // have (#859), so a page in view is answered like every other page in view
    // rather than asked about whatever the size.
    mockedFetch.mockResolvedValue({ contents: [CONTENTS], limit: 25 });
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo del Prado' });
    tick('Museo del Prado');
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says an all-matching answer under a held filter reaches the unread contents those rows hold', async () => {
    // A held filter lists every row with an open held change, unread points
    // and works included, and the answer reaches both — named even though it
    // cannot be counted, since the ticks show one kind and answer two.
    mockedFetch.mockResolvedValue({
      held: [{ ...ARRIVAL, kind: 'held', curation_state: 'verified', proposed: [], sync_log_id: 61 }],
      limit: 25, total: 412,
      facets: { ...NO_FACETS, kind: [{ kind: 'waiting', count: 412 }, { kind: 'held', count: 412 }] },
    });
    renderQueue('/review?kind=held');
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select the 1 questions loaded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 412 matching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('412 held changes: Keep all current');
    expect(dialog.textContent).toContain('the unread points and works a row may also hold are answered too: Turn them down — they stay unread.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks first, naming what it will do per kind, for an all-matching selection', async () => {
    // The page holds two arrivals; the filters match 1,078 questions of three
    // kinds, which is what the confirmation has to name — the loaded rows are
    // one page of a list the answer walks whole.
    mockedFetch.mockResolvedValue({
      arrivals: [ARRIVAL, SECOND_ARRIVAL], limit: 25, total: 1078,
      facets: {
        ...NO_FACETS,
        kind: [
          { kind: 'waiting', count: 1070 }, { kind: 'arrival', count: 1070 },
          { kind: 'refused', count: 5 }, { kind: 'conflict', count: 3 }, { kind: 'missing', count: 0 },
        ],
        source: [{ id: 4, name: 'Places of worship', count: 1078 }],
        run: [{ id: 105, sourceId: 4, completedAt: null, count: 1078, setAside: false }],
      },
    });
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select the 2 questions loaded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 1,078 matching' }));
    // The bar's expander reads the same reach as the confirmation: the kinds
    // the filters match, not the page's.
    fireEvent.click(screen.getAllByRole('button', { name: 'What it does' })[1]);
    expect(screen.getByRole('region', { name: 'Selected questions' }).textContent).toContain('5 refusals');
    // And the bench's summary reads the same reach, not the two rows on screen —
    // its source and run facets from the queue's counts too, so one card
    // counts one population.
    expect(screen.getByText('1,070 arrivals')).toBeInTheDocument();
    expect(screen.getByText('1,078 from Places of worship')).toBeInTheDocument();
    expect(screen.getByText('1,078 asked by run 105')).toBeInTheDocument();
    // The rejection turns the arrivals among them away, so it asks why first,
    // and says the reason is the arrivals' (#863).
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));
    expect(within(screen.getByRole('menu')).getByText('Why the arrivals are turned away')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nothing to see' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Reject all 1,078 matching these filters?');
    expect(dialog.textContent).toContain('1,070 arrivals: Keep it out (Nothing to see)');
    // Rejecting a refusal is the take-back: the card proposes the refusal (#906).
    expect(dialog.textContent).toContain('5 refusals: The rule was wrong — put it back until the next run');
    expect(dialog.textContent).toContain('3 disagreements: Keep all current');
    expect(dialog.textContent).not.toContain('gone from the source');
    expect(mockedAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('clears the ticks with a notice when a filter changes', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo Soumaya' });
    tick('Museo Soumaya');
    fireEvent.click(screen.getByRole('button', {
      name: (accessible: string) => accessible.startsWith('Question'),
    }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /disagrees/i }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(await screen.findByText(/1 ticked question was cleared/)).toBeInTheDocument();
  });
});
