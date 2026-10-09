/**
 * Tests for how the sync panel follows a picture repair.
 *
 * A repair is not a sync, and knowing which one the panel is following by
 * remembering which button was pressed loses it on a reload — the page then
 * shows "Syncing..." and ends in a sync's sentence. The server says
 * which kind of run it is (`kind`), and these pin that the panel reads it:
 * for the chip, for the sentence at the end, and for following a run it did
 * not start.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPanel } from './SyncPanel';
import { getSources, getSyncStatus, fixPictures, findComponentItems } from '../../api/admin';
import type { ExperienceSource, SyncStatus } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  getSources: vi.fn(),
  getSyncStatus: vi.fn(),
  startSync: vi.fn(),
  fixPictures: vi.fn(),
  findComponentItems: vi.fn(),
  cancelSync: vi.fn(),
  reorderSources: vi.fn(),
}));
// The two sections a card carries ask the server for things of their own; they
// are not what these tests are about.
vi.mock('./CurationGateControls', () => ({ CurationGateControls: () => null }));
vi.mock('./WikidataCacheSection', () => ({ WikidataCacheSection: () => null }));

const mockedSources = getSources as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = getSyncStatus as unknown as ReturnType<typeof vi.fn>;
const mockedFix = fixPictures as unknown as ReturnType<typeof vi.fn>;
const mockedFind = findComponentItems as unknown as ReturnType<typeof vi.fn>;

const UNESCO: ExperienceSource = {
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
  enter_sitelinks: null,
  stay_sitelinks: null,
  find_enter_sitelinks: null,
  find_stay_sitelinks: null,
  // The UNESCO run reads its own API and keeps nothing between runs.
  caches: false,
  repairsPictures: true,
  findsComponentItems: true,
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
    mockedSources.mockReset();
    mockedStatus.mockReset();
    mockedFix.mockReset();
    mockedSources.mockResolvedValue([UNESCO]);
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
    mockedSources.mockResolvedValue([UNESCO, { ...UNESCO, id: 3, name: 'Public Art & Monuments', repairsPictures: false, findsComponentItems: false }]);

    renderPanel();

    await screen.findByText('Public Art & Monuments');
    expect(screen.getAllByRole('button', { name: 'Fix pictures' })).toHaveLength(1);
  });
});

describe('a search for component items', () => {
  beforeEach(() => {
    mockedSources.mockReset();
    mockedStatus.mockReset();
    mockedFind.mockReset();
    mockedSources.mockResolvedValue([UNESCO, { ...UNESCO, id: 2, name: 'Art Museums', findsComponentItems: false }]);
  });

  it('is offered only where the server says it acts, named from the press, and ends in its own count', async () => {
    mockedStatus
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce({ running: true, kind: 'components', status: 'fetching', statusMessage: 'Looking near the points' })
      .mockResolvedValue({
        running: false, kind: 'components', status: 'complete',
        statusMessage: '412 of 2519 components without an item have a candidate for a curator',
      });
    mockedFind.mockResolvedValue({ started: true, message: '' });

    renderPanel();
    await screen.findByText('Art Museums');
    expect(screen.getAllByRole('button', { name: 'Find component items' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Find component items' }));

    expect(await screen.findByText('Finding component items...')).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByText(/Component items: 412 of 2519 components/)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.queryByText(/Sync completed|Pictures repaired/)).toBeNull();
  });

  it('says a failed search failed, in its own words', async () => {
    mockedStatus
      .mockResolvedValueOnce({ running: true, kind: 'components', status: 'fetching', statusMessage: '' })
      .mockResolvedValue({ running: false, kind: 'components', status: 'failed', statusMessage: 'Wikidata did not answer' });

    renderPanel();
    await screen.findByText('Finding component items...');
    await waitFor(
      () => expect(screen.getByText('The component search failed: Wikidata did not answer')).toBeInTheDocument(),
      { timeout: 4000 },
    );
  });
});
