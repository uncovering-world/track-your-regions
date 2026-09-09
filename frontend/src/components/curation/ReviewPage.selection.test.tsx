/**
 * Tests for answering a selection from the page (#852): the ticks reach the
 * bar and the summary, one answer goes to the batch route in the server's
 * words, the line afterwards says what happened, and a batch past one page
 * asks first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
  invalidateAfterBatchPublication: vi.fn(),
}));

const { mockedFetch, mockedAnswer } = vi.hoisted(() => ({ mockedFetch: vi.fn(), mockedAnswer: vi.fn() }));

vi.mock('../../api/experiences', () => ({
  fetchReviewQueue: async (params: unknown) => shaped(await mockedFetch(params)),
  answerReviewRows: mockedAnswer,
  REVIEW_ANSWER_ROWS_MAX: 100,
  setRunAside: vi.fn(),
  bringRunBack: vi.fn(),
  setExperienceState: vi.fn(),
  setExperienceAdmission: vi.fn(),
  setLocationState: vi.fn(),
  acceptSourceValue: vi.fn(),
  declineSourceValue: vi.fn(),
  declineHeld: vi.fn(),
  publishExperience: vi.fn(),
  refuseArrival: vi.fn(),
  refuseContents: vi.fn(),
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
    expect(mockedAnswer).toHaveBeenCalledWith(
      [{ kind: 'waiting', id: 55, runId: 98 }, { kind: 'waiting', id: 56, runId: 98 }], 'accept');
    expect(await screen.findByText('2 objects published. 1 point now visible.')).toBeInTheDocument();
    expect(invalidateAfterBatchPublication).toHaveBeenCalled();
    // The ticks are gone with the batch, and the bar with them.
    expect(screen.queryByRole('region', { name: 'Selected questions' })).toBeNull();
  });

  it('renames the one kind the row spells differently, and carries the run', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Serengeti National Park' });
    tick('Serengeti National Park');
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(
      [{ kind: 'conflict', id: 88, runId: 98 }], 'reject'));
  });

  it('offers Lost to a selection wholly of one verdict kind', async () => {
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Dresden Elbe Valley' });
    tick('Dresden Elbe Valley');
    expect(screen.getByRole('button', { name: 'Lost' })).toBeInTheDocument();
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

  it('asks first before turning down unread contents, the one answer without a take-back', async () => {
    mockedFetch.mockResolvedValue({ contents: [CONTENTS], limit: 25 });
    renderQueue();
    await screen.findByRole('checkbox', { name: 'Select Museo del Prado' });
    tick('Museo del Prado');
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('cannot be brought back yet');
    expect(mockedAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says an all-matching answer under a held filter reaches the unread contents those rows hold', async () => {
    // A held filter lists every row with an open held change, unread points
    // and works included, and the answer reaches both — which is the one act
    // without a take-back, so it is named even though it cannot be counted.
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
    expect(dialog.textContent).toContain('412 held changes: Not this — refuse every held field');
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
    fireEvent.click(screen.getByRole('button', { name: 'Reject the proposed changes' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Reject all 1,078 matching these filters?');
    expect(dialog.textContent).toContain('1,070 arrivals: Keep it out');
    expect(dialog.textContent).toContain('5 refusals: The rule was right — keep it out');
    expect(dialog.textContent).toContain('3 disagreements: Keep ours');
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
