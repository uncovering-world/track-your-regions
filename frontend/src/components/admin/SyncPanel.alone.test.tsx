/**
 * A dry run of one kind of a pass alone (#2424): the pass's card offers a
 * preview of each kind under its Start Sync, started through the pass's first
 * source with the kind named; a card of a source outside a pass offers none.
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
vi.mock('./WikidataReaderControls', () => ({ WikidataReaderControls: () => null }));
vi.mock('./SourceLineControls', () => ({ SourceLineControls: () => null }));

function source(id: number, name: string, pass: number[]): ExperienceSource {
  return {
    id,
    name,
    description: '',
    is_active: true,
    requires_curation: true,
    last_sync_at: null,
    last_sync_status: null,
    display_priority: id,
    created_at: '2026-01-01T00:00:00Z',
    waiting: { arrivals: 0, held: 0, contents: 0 },
    enter_sitelinks: null,
    stay_sitelinks: null,
    find_enter_sitelinks: null,
    find_stay_sitelinks: null,
    caches: false,
    repairsPictures: false,
    findsComponentItems: false,
    wikidataReader: 'subset',
    subsetReady: true,
    pass,
  };
}

const idle: SyncStatus = { running: false, kind: 'sync', status: 'complete', statusMessage: '', progress: 0, total: 0, percent: 0 };

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SyncPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getSyncStatus).mockResolvedValue(idle);
  vi.mocked(startSync).mockResolvedValue({
    started: true, sourceId: 3, sourceName: 'Public art', dryRun: true, refreshCache: false, askAboutPins: false,
    message: 'Dry run started.',
  });
});

describe('a preview of one kind of a pass alone (#2424)', () => {
  it('starts the pass through its first source with the one kind named', async () => {
    vi.mocked(getSources).mockResolvedValue([source(3, 'Public art', [3, 9]), source(9, 'Squares & streets', [3, 9])]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'How to run the sync' }));
    expect(screen.getByRole('menuitem', { name: /Preview Public art alone/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Preview Squares & streets alone/ }));

    await waitFor(() => expect(startSync).toHaveBeenCalledWith(3, { dryRun: true, alone: [9] }));
  });

  it('offers no such preview on the card of a source outside a pass', async () => {
    vi.mocked(getSources).mockResolvedValue([source(1, 'UNESCO World Heritage Sites', [])]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'How to run the sync' }));
    expect(await screen.findByRole('menuitem', { name: /Preview \(dry run\)/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /alone/ })).toBeNull();
  });
});
