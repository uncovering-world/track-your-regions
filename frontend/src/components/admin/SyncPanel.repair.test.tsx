/**
 * Tests for how the sync panel follows a picture repair.
 *
 * A repair is not a sync, and the panel used to know which it was following
 * only by remembering which button was pressed — so a page reloaded during
 * one showed "Syncing..." and ended in a sync's sentence. The server says
 * which kind of run it is now (`kind`), and these pin that the panel reads it:
 * for the chip, for the sentence at the end, and for following a run it did
 * not start.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPanel } from './SyncPanel';
import { getCategories, getSyncStatus, fixPictures } from '../../api/admin';
import type { ExperienceCategory, SyncStatus } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  getCategories: vi.fn(),
  getSyncStatus: vi.fn(),
  startSync: vi.fn(),
  fixPictures: vi.fn(),
  cancelSync: vi.fn(),
  reorderCategories: vi.fn(),
}));
// The two sections a card carries ask the server for things of their own; they
// are not what these tests are about.
vi.mock('./CurationGateControls', () => ({ CurationGateControls: () => null }));
vi.mock('./WikidataCacheSection', () => ({ WikidataCacheSection: () => null }));

const mockedCategories = getCategories as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = getSyncStatus as unknown as ReturnType<typeof vi.fn>;
const mockedFix = fixPictures as unknown as ReturnType<typeof vi.fn>;

const UNESCO: ExperienceCategory = {
  id: 1,
  name: 'UNESCO World Heritage Sites',
  description: 'Official UNESCO World Heritage List',
  is_active: true,
  requires_curation: true,
  last_sync_at: null,
  last_sync_status: null,
  display_priority: 1,
  created_at: '2026-01-01T00:00:00Z',
  waiting: { arrivals: 0, held: 0, contents: 0 },
  repairsPictures: true,
};

const inFlight: SyncStatus = {
  running: true, kind: 'repair', status: 'processing',
  statusMessage: 'Fixing 40/1272: Aalto Works', progress: 40, total: 1272, percent: 3,
};
const finished: SyncStatus = {
  running: false, kind: 'repair', status: 'complete',
  statusMessage: '1234 given a Commons picture, 38 left without one, 0 had none either way',
  progress: 1272, total: 1272, percent: 100,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncPanel />
    </QueryClientProvider>,
  );
}

describe('a picture repair found already in flight', () => {
  beforeEach(() => {
    mockedCategories.mockReset();
    mockedStatus.mockReset();
    mockedFix.mockReset();
    mockedCategories.mockResolvedValue([UNESCO]);
  });

  it('is named as one, followed to its end, and ends in its own sentence', async () => {
    // The page was reloaded during a repair: the first poll finds it running.
    // Nothing on this panel pressed a button, so what the chip and the closing
    // sentence say can only come from what the server sent.
    mockedStatus
      .mockResolvedValueOnce(inFlight)
      .mockResolvedValue(finished);

    renderPanel();

    expect(await screen.findByText('Fixing pictures...')).toBeInTheDocument();

    // Followed: a second poll happens without anybody pressing anything, and
    // the run's own count is what the panel says when it ends.
    await waitFor(
      () => expect(screen.getByText(/Pictures repaired: 1234 given a Commons picture/)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(mockedStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Sync completed/)).toBeNull();
  });

  it('keeps a repair\'s last words on screen when it stopped', async () => {
    // A repair that stops — Wikidata did not answer — reports it on its final
    // poll and writes no sync log, so the chip goes back to the previous sync's
    // verdict and nothing else would say a picture was not repaired.
    mockedStatus
      .mockResolvedValueOnce(inFlight)
      .mockResolvedValue({
        running: false, kind: 'repair', status: 'failed',
        statusMessage: 'Wikidata did not answer, so nothing was changed — try again later',
      });

    renderPanel();

    await screen.findByText('Fixing pictures...');
    await waitFor(
      () => expect(screen.getByText(/The picture repair failed: Wikidata did not answer/)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.queryByText(/Pictures repaired/)).toBeNull();
  });

  it('says a cancelled repair was cancelled, in its own words', async () => {
    // The message a cancellation carries is the orchestrator's "Sync
    // cancelled"; a repair's sentence must not say sync.
    mockedStatus
      .mockResolvedValueOnce(inFlight)
      .mockResolvedValue({ running: false, kind: 'repair', status: 'cancelled', statusMessage: 'Sync cancelled' });

    renderPanel();

    await screen.findByText('Fixing pictures...');
    await waitFor(
      () => expect(screen.getByText('The picture repair was cancelled.')).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.queryByText(/Sync cancelled/)).toBeNull();
  });

  it('names the repair from the moment it is pressed, before the server has said anything', async () => {
    // The chip shows as soon as the request is in flight, and the last poll's
    // status is still the previous run's; read from that, the press said
    // "Syncing..." until the first poll answered a second later.
    mockedStatus.mockResolvedValue({ running: false });
    mockedFix.mockResolvedValue({ started: true, message: '' });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Fix pictures' }));

    expect(await screen.findByText('Fixing pictures...')).toBeInTheDocument();
    expect(screen.queryByText('Syncing...')).toBeNull();
  });

  it('offers the repair only where the server says it acts', async () => {
    mockedStatus.mockResolvedValue({ running: false });
    mockedCategories.mockResolvedValue([UNESCO, { ...UNESCO, id: 3, name: 'Public Art & Monuments', repairsPictures: false }]);

    renderPanel();

    await screen.findByText('Public Art & Monuments');
    expect(screen.getAllByRole('button', { name: 'Fix pictures' })).toHaveLength(1);
  });
});
