/**
 * Asking again about the curators' pins from a source's card (#1370): the run
 * is an ordinary sync with one option, started from a button of its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPanel } from './SyncPanel';
import { getSources, getSyncStatus, startSync } from '../../api/admin';
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
vi.mock('./CurationGateControls', () => ({ CurationGateControls: () => null }));
vi.mock('./WikidataCacheSection', () => ({ WikidataCacheSection: () => null }));

const ART: ExperienceSource = {
  id: 2,
  name: 'Art Museums',
  description: 'World-famous art museums',
  is_active: true,
  requires_curation: true,
  last_sync_at: null,
  last_sync_status: null,
  display_priority: 2,
  created_at: '2026-01-01T00:00:00Z',
  waiting: { arrivals: 0, held: 0, contents: 0 },
  enter_sitelinks: null,
  stay_sitelinks: null,
  find_enter_sitelinks: null,
  find_stay_sitelinks: null,
  caches: true,
  repairsPictures: true,
  findsComponentItems: false,
  wikidataReader: 'live',
  subsetReady: false,
};

const idle: SyncStatus = { running: false, kind: 'sync', status: 'complete', statusMessage: '', progress: 0, total: 0, percent: 0 };

beforeEach(() => {
  vi.mocked(getSources).mockResolvedValue([ART]);
  vi.mocked(getSyncStatus).mockResolvedValue(idle);
  vi.mocked(startSync).mockResolvedValue({
    started: true, sourceId: 2, sourceName: 'Art Museums', dryRun: false, refreshCache: false, askAboutPins: true,
    message: 'Sync started.',
  });
});

describe('asking again about the pins of a source (#1370)', () => {
  it('starts an ordinary run that asks about every pin it disagrees with', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SyncPanel />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again about pins' }));
    await waitFor(() => expect(startSync).toHaveBeenCalledWith(2, { askAboutPins: true }));
  });
});
