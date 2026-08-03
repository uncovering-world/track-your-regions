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
  acceptSourceValue: vi.fn(),
}));

import { fetchReviewQueue, setExperienceState, acceptSourceValue } from '../../api/experiences';
import { ReviewQueue } from './ReviewQueue';

const mockedFetch = fetchReviewQueue as unknown as ReturnType<typeof vi.fn>;
const mockedState = setExperienceState as unknown as ReturnType<typeof vi.fn>;
const mockedAccept = acceptSourceValue as unknown as ReturnType<typeof vi.fn>;

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
    mockedFetch.mockResolvedValue({ missing: [MISSING], conflicts: [CONFLICT], limit: 25, offset: 0 });
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
