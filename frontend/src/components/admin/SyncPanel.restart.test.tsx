/**
 * Tests for what the sync card says when the backend is restarted under a run
 * (#1131).
 *
 * A restart kills the run, and the startup sweep closes its row `failed` with
 * how far it got. The card says so in words — the chip alone reads Failed,
 * as if the sync had gone wrong on its own — and keeps following a run
 * through the seconds the server refuses to answer, saying it has lost touch
 * only after about two minutes of that. A run another server holds is shown
 * from its row, and its Cancel says why it cannot be pressed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPanel } from './SyncPanel';
import { getSources, getSyncStatus, startSync } from '../../api/admin';
import type { ExperienceSource, SyncLastRun, SyncStatus } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  getSources: vi.fn(),
  getSyncStatus: vi.fn(),
  startSync: vi.fn(),
  fixPictures: vi.fn(),
  cancelSync: vi.fn(),
  reorderSources: vi.fn(),
}));
vi.mock('./CurationGateControls', () => ({ CurationGateControls: () => null }));
vi.mock('./WikidataCacheSection', () => ({ WikidataCacheSection: () => null }));

const mockedSources = getSources as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = getSyncStatus as unknown as ReturnType<typeof vi.fn>;
const mockedStart = startSync as unknown as ReturnType<typeof vi.fn>;

const MUSEUMS: ExperienceSource = {
  id: 2,
  name: 'Art Museums',
  description: 'World\'s most notable museums ranked by artwork fame, sourced from Wikidata',
  is_active: true,
  requires_curation: false,
  last_sync_at: '2026-09-29T21:00:00Z',
  last_sync_status: 'failed',
  display_priority: 2,
  created_at: '2026-01-01T00:00:00Z',
  waiting: { arrivals: 0, held: 0, contents: 0 },
  enter_sitelinks: null,
  stay_sitelinks: null,
  find_enter_sitelinks: null,
  find_stay_sitelinks: null,
  caches: true,
  repairsPictures: true,
};

/** A museum run the restart stopped 412 of 1,083 objects in. */
function killed(overrides: Partial<SyncLastRun> = {}): SyncStatus {
  return {
    running: false,
    lastSyncAt: '2026-09-29T21:00:00Z',
    lastSyncStatus: 'failed',
    lastRun: {
      logId: 140, status: 'failed', dryRun: false,
      startedAt: '2026-09-29T20:40:00Z', completedAt: '2026-09-29T21:00:00Z',
      phase: 'processing', progress: 412, total: 1083, created: 37, updated: 12, held: 0, errors: 0,
      stoppedByRestart: true,
      ...overrides,
    },
  };
}

const inFlight: SyncStatus = {
  running: true, cancellable: true, kind: 'sync', status: 'processing',
  statusMessage: 'Processing 412/1083: Rijksmuseum', progress: 412, total: 1083, percent: 38,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncPanel />
    </QueryClientProvider>,
  );
}

describe('a run the server was restarted under', () => {
  beforeEach(() => {
    mockedSources.mockReset();
    mockedStatus.mockReset();
    mockedSources.mockResolvedValue([MUSEUMS]);
  });

  it('is said in words, with how far it got and what starting it again costs', async () => {
    mockedStatus.mockResolvedValue(killed());

    renderPanel();

    expect(await screen.findByText(
      'The last sync stopped when the server was restarted under it — 412 of 1,083 done: '
      + '37 created, 12 updated. What it wrote stands; starting it again goes over everything, '
      + 'with the answers the source already gave kept. Objects it wrote may need Region Assignment.',
    )).toBeInTheDocument();
  });

  it('says a run stopped while collecting had not got to any object', async () => {
    mockedStatus.mockResolvedValue(killed({ phase: 'fetching', progress: 0, total: 0, created: 0, updated: 0 }));

    renderPanel();

    expect(await screen.findByText(
      /stopped when the server was restarted under it, while it was still collecting from the source\./,
    )).toBeInTheDocument();
    expect(screen.queryByText(/Region Assignment/)).toBeNull();
  });

  it('calls a stopped preview a preview, and does not say it wrote anything', async () => {
    mockedStatus.mockResolvedValue(killed({ dryRun: true }));

    renderPanel();

    expect(await screen.findByText(/^The last preview stopped when the server was restarted under it — 412 of 1,083 done\. A preview writes nothing;/))
      .toBeInTheDocument();
    expect(screen.queryByText(/What it wrote stands/)).toBeNull();
  });

  it('says nothing of a last run that ended on its own', async () => {
    mockedStatus.mockResolvedValue(killed({ stoppedByRestart: false }));

    renderPanel();

    await screen.findByText('Art Museums');
    await waitFor(() => expect(mockedStatus).toHaveBeenCalled());
    expect(screen.queryByText(/restarted under it/)).toBeNull();
  });

  it('shows a run another server holds, with a Cancel that says why it is not offered', async () => {
    mockedStatus.mockResolvedValue({ ...inFlight, cancellable: false, progressAt: '2026-09-29T20:58:14Z' });

    renderPanel();

    const button = await screen.findByRole('button', { name: 'Running on another server' });
    expect(button).toBeDisabled();
  });
});

describe('following a run through a restart', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedSources.mockReset();
    mockedStatus.mockReset();
    mockedSources.mockResolvedValue([MUSEUMS]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps asking through the refusals, and says what became of the run once the server answers', async () => {
    mockedStatus
      .mockResolvedValueOnce(inFlight)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(killed());

    renderPanel();
    await screen.findByText('Processing 412/1083: Rijksmuseum');

    // One second to the next ask, then one and two seconds of backing off.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(await screen.findByText(/The last sync stopped when the server was restarted under it/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Lost touch with the server/)).toBeNull();
    expect(mockedStatus).toHaveBeenCalledTimes(4);
  });

  it('backs off, and says it lost touch only after about two minutes of refusals', async () => {
    mockedStatus
      .mockResolvedValueOnce(inFlight)
      .mockRejectedValue(new Error('Failed to fetch'));

    renderPanel();
    await screen.findByText('Processing 412/1083: Rijksmuseum');

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.queryByText(/Lost touch with the server/)).toBeNull();
    // 1 s to the first refusal, then 1, 2, 4, 8 and every 10 s: a minute is
    // about ten asks, not sixty.
    const asksInAMinute = mockedStatus.mock.calls.length;
    expect(asksInAMinute).toBeLessThan(15);

    await act(async () => { await vi.advanceTimersByTimeAsync(70000); });
    expect(await screen.findByText('Lost touch with the server — reload to see how this run ended.'))
      .toBeInTheDocument();

    const asksWhenLost = mockedStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mockedStatus).toHaveBeenCalledTimes(asksWhenLost);
  });

  it('keeps a run started here even when the answer to an earlier ask arrives after it', async () => {
    let answerFirst: (status: SyncStatus) => void = () => {};
    mockedStatus.mockReturnValueOnce(new Promise<SyncStatus>((resolve) => { answerFirst = resolve; }));
    mockedStatus.mockResolvedValue(inFlight);
    mockedStart.mockResolvedValue({ started: true });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Start Sync/ }));
    await waitFor(() => expect(mockedStart).toHaveBeenCalled());
    // The mount's ask, sent before the run began, answers idle only now.
    await act(async () => { answerFirst(killed()); });

    // Still following the run: its Cancel stands where Start Sync would be.
    expect(screen.queryByRole('button', { name: /Start Sync/ })).toBeNull();
    expect(screen.queryByText(/The last sync stopped/)).toBeNull();
  });
});
