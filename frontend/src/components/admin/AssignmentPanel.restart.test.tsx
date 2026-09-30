/**
 * What the Region Assignment panel says when the server is restarted under a
 * run (#1152).
 *
 * The rebuild is one transaction, so a restart keeps nothing it did, and the
 * server that comes back knows nothing of the run: its status answers a bare
 * `{ running: false }`. The panel keeps asking through the refusals and says
 * in words what happened, rather than going quiet as if the run had ended.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentPanel, RESTARTED_UNDER_IT } from './AssignmentPanel';
import { getAssignmentStatus, getSources, startRegionAssignment } from '../../api/admin';
import type { AssignmentStatus } from '../../api/admin';
import { fetchWorldViews } from '../../api/worldViews';

vi.mock('../../api/admin', () => ({
  getSources: vi.fn(),
  startRegionAssignment: vi.fn(),
  getAssignmentStatus: vi.fn(),
  cancelAssignment: vi.fn(),
  getExperienceCountsByRegion: vi.fn(async () => []),
}));
vi.mock('../../api/worldViews', () => ({ fetchWorldViews: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));

const mockedStatus = getAssignmentStatus as unknown as ReturnType<typeof vi.fn>;
const mockedStart = startRegionAssignment as unknown as ReturnType<typeof vi.fn>;

const assigning: AssignmentStatus = {
  running: true, status: 'assigning', statusMessage: 'Computing direct spatial containment for locations...',
  directAssignments: 0, ancestorAssignments: 0, totalAssignments: 0, errors: 0,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AssignmentPanel />
    </QueryClientProvider>,
  );
}

/** Choose the world view and start a run on it. */
async function startOnWorldView(): Promise<void> {
  fireEvent.mouseDown((await screen.findAllByRole('combobox'))[0]);
  fireEvent.click(await screen.findByRole('option', { name: 'Regions of the World' }));
  await waitFor(() => expect(mockedStatus).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /Start Assignment/ }));
  await waitFor(() => expect(mockedStart).toHaveBeenCalled());
}

describe('a region assignment the server was restarted under', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedStatus.mockReset();
    mockedStart.mockReset();
    (getSources as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchWorldViews as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 5, name: 'Regions of the World', isDefault: false },
    ]);
    mockedStart.mockResolvedValue({ started: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps asking through the refusals, and says nothing it did was kept', async () => {
    mockedStatus
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce(assigning)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({ running: false });

    renderPanel();
    await startOnWorldView();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(await screen.findByText(assigning.statusMessage as string)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

    expect(await screen.findByText(RESTARTED_UNDER_IT)).toBeInTheDocument();
    expect(RESTARTED_UNDER_IT).toBe('The server was restarted while this was assigning; nothing it did '
      + 'was kept, and the assignments from before stand. Start it again.');
    expect(screen.getByRole('button', { name: /Start Assignment/ })).toBeInTheDocument();
  });

  it('reads no restart into an answer to an ask sent before the run was started', async () => {
    let answerFirst: (status: AssignmentStatus) => void = () => {};
    mockedStatus
      .mockReturnValueOnce(new Promise<AssignmentStatus>((resolve) => { answerFirst = resolve; }))
      .mockResolvedValue(assigning);

    renderPanel();
    fireEvent.mouseDown((await screen.findAllByRole('combobox'))[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Regions of the World' }));
    fireEvent.click(screen.getByRole('button', { name: /Start Assignment/ }));
    await waitFor(() => expect(mockedStart).toHaveBeenCalled());
    // The world view's first ask, sent before the start, answers only now.
    await act(async () => { answerFirst({ running: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(screen.queryByText(RESTARTED_UNDER_IT)).toBeNull();
    expect(await screen.findByText(assigning.statusMessage as string)).toBeInTheDocument();
  });

  it('lets go of a run it lost touch with, and says so', async () => {
    mockedStatus
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce(assigning)
      .mockRejectedValue(new Error('Failed to fetch'));

    renderPanel();
    await startOnWorldView();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(await screen.findByText(assigning.statusMessage as string)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(130_000); });

    expect(await screen.findByText(/Lost touch with the server/)).toBeInTheDocument();
    expect(screen.queryByText(assigning.statusMessage as string)).toBeNull();
    expect(screen.getByRole('button', { name: /Start Assignment/ })).toBeInTheDocument();
  });

  it('says how a run that ended on its own ended, and nothing of a restart', async () => {
    mockedStatus
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce(assigning)
      .mockResolvedValue({
        running: false, status: 'cancelled', statusMessage: 'Cancelled; the assignments from before stand.',
      });

    renderPanel();
    await startOnWorldView();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(await screen.findByText('Cancelled; the assignments from before stand.')).toBeInTheDocument();
    expect(screen.queryByText(RESTARTED_UNDER_IT)).toBeNull();
  });

  it('says nothing of a restart when no run was being followed', async () => {
    mockedStatus.mockResolvedValue({ running: false });

    renderPanel();
    fireEvent.mouseDown((await screen.findAllByRole('combobox'))[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Regions of the World' }));
    await waitFor(() => expect(mockedStatus).toHaveBeenCalled());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(screen.queryByText(RESTARTED_UNDER_IT)).toBeNull();
  });
});
