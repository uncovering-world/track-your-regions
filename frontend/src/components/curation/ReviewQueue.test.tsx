/**
 * Tests for the curator's review queue.
 *
 * The behaviour worth pinning is what the page promises: three distinct answers
 * to a missing object (two of which change something and one of which does
 * not), and a conflict view that shows both versions before asking anyone to
 * choose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/experiences', () => ({
  fetchReviewQueue: vi.fn(),
  setExperienceState: vi.fn(),
  setExperienceAdmission: vi.fn(),
  acceptSourceValue: vi.fn(),
}));

import {
  fetchReviewQueue, setExperienceState, setExperienceAdmission, acceptSourceValue,
} from '../../api/experiences';
import { ReviewQueue } from './ReviewQueue';

const mockedFetch = fetchReviewQueue as unknown as ReturnType<typeof vi.fn>;
const mockedState = setExperienceState as unknown as ReturnType<typeof vi.fn>;
const mockedAccept = acceptSourceValue as unknown as ReturnType<typeof vi.fn>;
const mockedAdmission = setExperienceAdmission as unknown as ReturnType<typeof vi.fn>;

const MISSING = {
  id: 77,
  external_id: '1234',
  name: 'Dresden Elbe Valley',
  category_id: 1,
  category_name: 'UNESCO World Heritage Sites',
  missing_since: '2026-08-03T10:00:00Z',
  source_membership: 'present' as const,
  existence: 'extant' as const,
  kind: 'missing' as const,
  proposed: null,
};

const REFUSED = {
  ...MISSING,
  id: 99,
  external_id: 'Q6373',
  name: 'British Museum',
  category_id: 2,
  category_name: 'Top Art Museums',
  kind: 'refused' as const,
  missing_since: null,
  admission_reason: 'not an art museum \u2014 archaeology',
};

const KEPT_OUT = {
  ...REFUSED,
  kind: 'kept-out' as const,
  state_decided_at: '2026-08-08T09:00:00Z',
  state_note: 'archaeology, comes back with that import',
};

const CONFLICT = {
  ...MISSING,
  id: 88,
  name: 'Serengeti National Park',
  kind: 'conflict' as const,
  missing_since: null,
  proposed: [{ field: 'name', old: 'Curator wording', new: 'Renamed upstream', acceptable: true }],
  sync_log_id: 41,
};

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewQueue />
    </QueryClientProvider>
  );
}

describe('ReviewQueue', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedState.mockReset().mockResolvedValue({ experienceId: 77 });
    mockedAccept.mockReset().mockResolvedValue({ experienceId: 88, applied: ['name'], released: [], fromSyncLogId: 9 });
    mockedAdmission.mockReset().mockResolvedValue({ experienceId: 99, admission: 'refused' });
    mockedFetch.mockResolvedValue({
      missing: [MISSING], refused: [], conflicts: [CONFLICT], limit: 25, offset: 0,
    });
  });

  it('offers the three answers a missing object can have', async () => {
    renderQueue();

    expect(await screen.findByRole('button', { name: /former/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lost/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /false alarm/i })).toBeInTheDocument();
  });

  it('tells the server what the card was showing', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // Without it the server cannot tell this card from one drawn before
    // someone else answered — and a correction from a current view has to
    // stay possible, or a mis-clicked verdict could never be taken back
    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({
        expected: { membership: 'present', existence: 'extant', flagged: true },
      }));
    });
  });

  it('sends "former" as a membership decision, leaving existence alone', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({ membership: 'former' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('existence');
  });

  it('sends "lost" as an existence decision — a destroyed site can still be listed', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /lost/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({ existence: 'lost' }));
    });
    expect(mockedState.mock.calls[0][1]).not.toHaveProperty('membership');
  });

  it('treats "false alarm" as restoring presence, which clears the flag', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /false alarm/i }));

    await waitFor(() => {
      expect(mockedState).toHaveBeenCalledWith(77, expect.objectContaining({ membership: 'present' }));
    });
  });

  it('shows both versions before asking anyone to choose', async () => {
    renderQueue();

    expect(await screen.findByText(/yours: Curator wording/)).toBeInTheDocument();
    expect(screen.getByText(/source: Renamed upstream/)).toBeInTheDocument();
  });

  it('accepts exactly the fields the source proposed', async () => {
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /accept the source/i }));

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['name'], 41));
  });

  it('says when accepting takes effect at the next sync instead of now', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'location', old: [1, 2], new: [3, 4], acceptable: false },
      ] }],
      limit: 25,
      offset: 0,
    });
    renderQueue();

    expect(await screen.findByText(/lands at the next sync/)).toBeInTheDocument();
    // Still answerable: releasing the claim is what takes it off the queue,
    // and it is the only thing that does — editing only ever adds a claim
    expect(screen.getByRole('button', { name: /accept the source/i })).toBeEnabled();
  });

  it('sends every conflicted field, not only the ones written on the spot', async () => {
    mockedFetch.mockResolvedValue({
      missing: [],
      conflicts: [{ ...CONFLICT, proposed: [
        { field: 'name', old: 'a', new: 'b', acceptable: true },
        { field: 'location', old: [1, 2], new: [3, 4], acceptable: false },
      ] }],
      limit: 25,
      offset: 0,
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /accept the source/i }));

    await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(88, ['name', 'location'], 41));
  });

  it('can reach the items behind a full page', async () => {
    mockedFetch.mockResolvedValue({
      missing: Array.from({ length: 2 }, (_, i) => ({ ...MISSING, id: i + 1 })),
      conflicts: [],
      limit: 2,
      offset: 0,
    });
    renderQueue();

    // Without this the curator is told more exist and cannot see them until
    // the ones in front are answered
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith({ offset: 2 }));
  });

  it('offers no paging when one page holds everything', async () => {
    mockedFetch.mockResolvedValue({ missing: [MISSING], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    await screen.findByRole('button', { name: /former/i });
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('does not present a full page as the whole backlog', async () => {
    mockedFetch.mockResolvedValue({
      missing: Array.from({ length: 2 }, (_, i) => ({ ...MISSING, id: i + 1 })),
      conflicts: [],
      limit: 2,
      offset: 0,
    });
    renderQueue();

    expect(await screen.findByText(/Gone from the source \(first 2\)/)).toBeInTheDocument();
  });

  it('refreshes after a refusal, so the stale card cannot be clicked again', async () => {
    mockedState.mockRejectedValue(new Error('Already answered: this object is not waiting on that decision'));
    // The second read is what the server now says: someone else answered it
    mockedFetch
      .mockResolvedValueOnce({ missing: [MISSING], conflicts: [], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    // The card goes, and the reason survives it — the message cannot live on
    // the card, because refetching is what takes the card away
    await waitFor(() => expect(screen.queryByRole('button', { name: /former/i })).toBeNull());
    expect(screen.getByText(/Already answered/)).toBeInTheDocument();
  });

  it('keeps the card and shows the reason while the queue still lists it', async () => {
    mockedState.mockRejectedValue(new Error('network down'));
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /former/i }));

    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /former/i })).toBeInTheDocument();
  });

  it('says what landed and which run it came from', async () => {
    mockedAccept.mockResolvedValue({
      experienceId: 88, applied: ['name'], released: ['location'], fromSyncLogId: 41,
    });
    mockedFetch
      .mockResolvedValueOnce({ missing: [], conflicts: [CONFLICT], limit: 25, offset: 0 })
      .mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /accept the source/i }));

    // The refetch removes the card, so this is the only place the split the
    // button promised, and the run the values came from, can be said at all
    expect(await screen.findByText(/name applied now/)).toBeInTheDocument();
    expect(screen.getByText(/location at the next sync/)).toBeInTheDocument();
    expect(screen.getByText(/from run 41/)).toBeInTheDocument();
  });

  describe('a row this category refused', () => {
    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [], refused: [REFUSED], conflicts: [], limit: 25, offset: 0,
      });
    });

    it('shows the rule\'s own words, which is the whole point of the card', async () => {
      renderQueue();

      // "Refused" alone leaves a curator guessing; the reason is what lets them
      // confirm a rule or spot a bad one.
      expect(await screen.findByText(/not an art museum/i)).toBeInTheDocument();
    });

    it('offers the two answers a refusal has, and none of the three a disappearance has', async () => {
      renderQueue();

      expect(await screen.findByRole('button', { name: /the rule was right/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /the rule was wrong/i })).toBeInTheDocument();
      // An open museum that was never a legitimate member is none of these.
      expect(screen.queryByRole('button', { name: /former/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /lost/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /false alarm/i })).not.toBeInTheDocument();
    });

    it('sends confirm when the curator agrees with the rule', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /the rule was right/i }));

      await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(
        99, expect.objectContaining({ decision: 'confirm' })));
    });

    it('sends override when the curator does not', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /the rule was wrong/i }));

      await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(
        99, expect.objectContaining({ decision: 'override' })));
    });

    it('withdraws the page\'s promise for this section only', async () => {
      renderQueue();

      // The standing line — nothing here has changed what visitors see — is
      // false of a refusal, which is hidden already.
      expect(await screen.findByText(/hidden already/i)).toBeInTheDocument();
    });

    it('keeps the promise intact when nothing was refused', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], conflicts: [], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByText(/hidden already/i)).not.toBeInTheDocument();
    });

    it('can reach refusals behind a full page', async () => {
      const page = Array.from({ length: 25 }, (_, i) => ({ ...REFUSED, id: 200 + i }));
      mockedFetch.mockResolvedValue({
        missing: [], refused: page, conflicts: [], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /show more/i });
      expect(screen.getByRole('button', { name: /show more/i })).toBeEnabled();
    });
  });

  describe('a refusal the curator confirmed', () => {
    beforeEach(() => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [KEPT_OUT], conflicts: [], limit: 25, offset: 0,
      });
    });

    it('stays out of the way until asked for', async () => {
      renderQueue();

      // These are answered. A curator opening the page is here for what is not.
      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /put it back/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /show what you have kept out/i })).toBeInTheDocument();
    });

    it('offers the way back, because no other surface shows the row at all', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));

      expect(await screen.findByRole('button', { name: /put it back/i })).toBeInTheDocument();
      // The rule's objection is still what a curator needs to judge by.
      expect(screen.getByText(/not an art museum/i)).toBeInTheDocument();
    });

    it('does not re-ask the settled question', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));

      await screen.findByRole('button', { name: /put it back/i });
      // Answered means answered: offering "the rule was right" again invites a
      // second answer to a question that has one.
      expect(screen.queryByRole('button', { name: /the rule was right/i })).not.toBeInTheDocument();
    });

    it('sends override when the curator takes it back', async () => {
      renderQueue();
      fireEvent.click(await screen.findByRole('button', { name: /show what you have kept out/i }));
      fireEvent.click(await screen.findByRole('button', { name: /put it back/i }));

      await waitFor(() => expect(mockedAdmission).toHaveBeenCalledWith(
        99, expect.objectContaining({ decision: 'override' })));
    });

    it('shows nothing at all when nothing has been kept out', async () => {
      mockedFetch.mockResolvedValue({
        missing: [MISSING], refused: [], keptOut: [], conflicts: [], limit: 25, offset: 0,
      });
      renderQueue();

      await screen.findByRole('button', { name: /former/i });
      expect(screen.queryByRole('button', { name: /kept out/i })).not.toBeInTheDocument();
    });
  });

  it('says plainly when there is nothing to answer', async () => {
    mockedFetch.mockResolvedValue({ missing: [], conflicts: [], limit: 25, offset: 0 });
    renderQueue();

    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it('reports a failed load instead of showing an empty queue', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));
    renderQueue();

    expect(await screen.findByText(/could not load the review queue/i)).toBeInTheDocument();
  });
});
