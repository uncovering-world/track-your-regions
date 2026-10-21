/**
 * Tests for what the Sync panel says of sources that fill their kinds from one
 * gather (ADR-0132): each card names the sources a start of it also runs, and
 * a card of a source that runs alone says nothing of the kind.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPanel } from './SyncPanel';
import { getSources, getSyncStatus } from '../../api/admin';
import type { ExperienceSource, SyncStatus } from '../../api/admin';

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

/** A Wikidata source as the panel lists it; the pass is the test's to say. */
function source(id: number, name: string, runsWith: number[]): ExperienceSource {
  return {
    id, name, description: null, is_active: true, requires_curation: true,
    last_sync_at: null, last_sync_status: null, display_priority: id, created_at: '2026-01-01T00:00:00Z',
    waiting: { arrivals: 0, held: 0, contents: 0 },
    enter_sitelinks: 22, stay_sitelinks: 18, find_enter_sitelinks: null, find_stay_sitelinks: null,
    caches: true, repairsPictures: false, findsComponentItems: false, wikidataReader: 'subset', subsetReady: true,
    runsWith,
  };
}

const idle: SyncStatus = { running: false, lastSyncAt: null, lastSyncStatus: null };

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncPanel />
    </QueryClientProvider>,
  );
}

describe('a source that shares its gather', () => {
  beforeEach(() => {
    vi.mocked(getSyncStatus).mockResolvedValue(idle);
  });

  it('names on each card the sources a start of it also runs', async () => {
    vi.mocked(getSources).mockResolvedValue([
      source(3, 'Monuments & memorials', [6]),
      source(6, 'Public art', [3]),
      source(4, 'Places of worship', []),
    ]);

    renderPanel();

    expect(await screen.findByText(/Runs with Public art: they read one gather/)).toBeInTheDocument();
    expect(screen.getByText(/Runs with Monuments & memorials: they read one gather/)).toBeInTheDocument();
    expect(screen.getAllByText(/Runs with/)).toHaveLength(2);
  });
});
